"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {requireAccessContext} from "@/lib/auth/access-control";
import {EMPLOYEE_BADGE_ADMIN_ROLES, loadEmployeeBadgeSnapshot, type EmployeeBadgeSnapshot} from "@/lib/badges/snapshot";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

function value(formData: FormData, key: string, max = 2000) {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function profileBadgeRedirect(kind: "success" | "error", message: string): never {
  redirect(`/dashboard/profile/badge?${new URLSearchParams({[kind]: message}).toString()}`);
}

function adminBadgeRedirect(kind: "success" | "error", message: string): never {
  redirect(`/dashboard/badges/manage?${new URLSearchParams({[kind]: message}).toString()}`);
}

async function getMyBadgeContext() {
  const {locale} = await getI18n();
  const language: "fr" | "en" = locale === "fr" ? "fr" : "en";
  const tr = (fr: string, en: string) => language === "fr" ? fr : en;
  const supabase = await createClient();
  const {data: auth, error} = await supabase.auth.getUser();
  if (error || !auth.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role,is_active")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();
  if (!membership) redirect("/dashboard/company");
  return {admin, user: auth.user, membership, language, tr};
}

async function writeAudit({
  admin,
  organizationId,
  userId,
  actorId,
  action,
  badgeId,
  requestId,
  details,
}: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  userId: string;
  actorId: string;
  action: string;
  badgeId?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
}) {
  const {error} = await admin.from("employee_badge_audit_log").insert({
    organization_id: organizationId,
    user_id: userId,
    actor_id: actorId,
    badge_id: badgeId ?? null,
    request_id: requestId ?? null,
    action,
    details: details ?? {},
  });
  if (error) console.error("Employee badge audit failed", error);
}

export async function requestMyEmployeeBadgeAction(formData: FormData) {
  const {admin, user, membership, tr} = await getMyBadgeContext();
  const requestedType = value(formData, "requestType", 30);
  const reason = value(formData, "reason", 1200) || null;

  const [{data: profile}, {data: pending}, {data: current}] = await Promise.all([
    admin
      .from("profiles")
      .select("full_name,avatar_storage_path")
      .eq("id", user.id)
      .maybeSingle<{full_name: string | null; avatar_storage_path: string | null}>(),
    admin
      .from("employee_badge_requests")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle<{id: string}>(),
    admin
      .from("employee_badges")
      .select("id,status,valid_until,needs_reissue")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", user.id)
      .in("status", ["active", "suspended"])
      .order("issue_number", {ascending: false})
      .limit(1)
      .maybeSingle<{id: string; status: string; valid_until: string; needs_reissue: boolean}>(),
  ]);

  if (!profile?.full_name?.trim()) {
    profileBadgeRedirect("error", tr("Complète d’abord ton nom dans Mon profil.", "Complete your name in My profile first."));
  }
  if (!profile.avatar_storage_path) {
    profileBadgeRedirect("error", tr("Ajoute d’abord une photo de profil avant de demander ton badge.", "Add a profile photo before requesting your badge."));
  }
  if (pending) {
    profileBadgeRedirect("error", tr("Une demande de badge est déjà en attente.", "A badge request is already pending."));
  }

  const today = new Date();
  const expiry = current?.valid_until ? new Date(`${current.valid_until}T00:00:00Z`) : null;
  const daysUntilExpiry = expiry ? Math.ceil((expiry.getTime() - today.getTime()) / 86400000) : null;
  let requestType: "initial" | "update" | "renewal" | "replacement" = "initial";

  if (current) {
    if (requestedType === "replacement") {
      if (!reason) profileBadgeRedirect("error", tr("Indique la raison du remplacement.", "Provide a reason for the replacement."));
      requestType = "replacement";
    } else if (current.needs_reissue || requestedType === "update") {
      requestType = "update";
    } else if ((daysUntilExpiry ?? 9999) <= 120 || requestedType === "renewal") {
      requestType = "renewal";
    } else {
      profileBadgeRedirect("error", tr("Ton badge est déjà actif et à jour.", "Your badge is already active and up to date."));
    }
  }

  const {data: request, error} = await admin
    .from("employee_badge_requests")
    .insert({
      organization_id: membership.organization_id,
      user_id: user.id,
      request_type: requestType,
      status: "pending",
      reason,
      requested_by: user.id,
    })
    .select("id")
    .single<{id: string}>();
  if (error) profileBadgeRedirect("error", tr("La demande n’a pas pu être créée : ", "The request could not be created: ") + error.message);

  await writeAudit({
    admin,
    organizationId: membership.organization_id,
    userId: user.id,
    actorId: user.id,
    requestId: request.id,
    action: "request_created",
    details: {request_type: requestType, reason},
  });

  revalidatePath("/dashboard/profile/badge");
  revalidatePath("/dashboard/badges/manage");
  profileBadgeRedirect("success", tr("Ta demande de badge a été transmise pour validation.", "Your badge request has been submitted for approval."));
}

export async function cancelMyEmployeeBadgeRequestAction(formData: FormData) {
  const {admin, user, membership, tr} = await getMyBadgeContext();
  const requestId = value(formData, "requestId", 80);
  const {data: request, error} = await admin
    .from("employee_badge_requests")
    .update({status: "cancelled"})
    .eq("id", requestId)
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle<{id: string}>();
  if (error || !request) profileBadgeRedirect("error", tr("La demande ne peut plus être annulée.", "The request can no longer be cancelled."));

  await writeAudit({
    admin,
    organizationId: membership.organization_id,
    userId: user.id,
    actorId: user.id,
    requestId,
    action: "request_cancelled",
  });
  revalidatePath("/dashboard/profile/badge");
  revalidatePath("/dashboard/badges/manage");
  profileBadgeRedirect("success", tr("La demande a été annulée.", "The request has been cancelled."));
}

async function getBadgeAdminContext() {
  const context = await requireAccessContext("people");
  const {locale} = await getI18n();
  const language: "fr" | "en" = locale === "fr" ? "fr" : "en";
  const tr = (fr: string, en: string) => language === "fr" ? fr : en;
  if (!EMPLOYEE_BADGE_ADMIN_ROLES.has(context.role)) redirect("/dashboard/members");
  return {...context, language, tr};
}

export async function approveEmployeeBadgeRequestAction(formData: FormData) {
  const {admin, user, organizationId, language, tr} = await getBadgeAdminContext();
  const requestId = value(formData, "requestId", 80);
  const validMonths = Math.max(1, Math.min(36, Number(value(formData, "validMonths", 3)) || 12));
  const reviewNote = value(formData, "reviewNote", 2000) || null;

  const {data: request, error: requestError} = await admin
    .from("employee_badge_requests")
    .select("id,user_id,status")
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .maybeSingle<{id: string; user_id: string; status: string}>();
  if (requestError || !request || request.status !== "pending") {
    adminBadgeRedirect("error", tr("Cette demande n’est plus disponible.", "This request is no longer available."));
  }

  let snapshot: EmployeeBadgeSnapshot;
  try {
    snapshot = await loadEmployeeBadgeSnapshot({admin, organizationId, userId: request.user_id, locale: language});
  } catch (error) {
    adminBadgeRedirect("error", error instanceof Error ? error.message : tr("Dossier incomplet.", "Incomplete record."));
  }
  if (!snapshot.avatarStoragePath) {
    adminBadgeRedirect("error", tr("Le collaborateur doit ajouter une photo avant l’approbation.", "The employee must add a photo before approval."));
  }

  const {data: badgeId, error} = await admin.rpc("approve_employee_badge_request", {
    p_request_id: requestId,
    p_actor_id: user.id,
    p_valid_months: validMonths,
    p_review_note: reviewNote,
    p_full_name: snapshot.fullName,
    p_email: snapshot.email,
    p_country: snapshot.country,
    p_city: snapshot.city,
    p_avatar_storage_path: snapshot.avatarStoragePath,
    p_role: snapshot.role,
    p_role_label: snapshot.roleLabel,
    p_position_title: snapshot.positionTitle,
    p_department: snapshot.department,
    p_team_name: snapshot.teamName,
    p_organization_name: snapshot.organizationName,
  });
  if (error || !badgeId) adminBadgeRedirect("error", tr("Le badge n’a pas pu être émis : ", "The badge could not be issued: ") + (error?.message ?? ""));

  revalidatePath("/dashboard/badges/manage");
  revalidatePath("/dashboard/profile/badge");
  revalidatePath(`/dashboard/badges/card/${badgeId}`);
  adminBadgeRedirect("success", tr("Le badge officiel a été approuvé et émis.", "The official badge has been approved and issued."));
}

export async function rejectEmployeeBadgeRequestAction(formData: FormData) {
  const {admin, user, organizationId, tr} = await getBadgeAdminContext();
  const requestId = value(formData, "requestId", 80);
  const reviewNote = value(formData, "reviewNote", 2000);
  if (reviewNote.length < 3) adminBadgeRedirect("error", tr("Indique le motif du refus.", "Provide the reason for rejection."));

  const {data: request, error} = await admin
    .from("employee_badge_requests")
    .update({status: "rejected", reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_note: reviewNote})
    .eq("id", requestId)
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .select("id,user_id")
    .maybeSingle<{id: string; user_id: string}>();
  if (error || !request) adminBadgeRedirect("error", tr("La demande ne peut plus être refusée.", "The request can no longer be rejected."));

  await writeAudit({
    admin,
    organizationId,
    userId: request.user_id,
    actorId: user.id,
    requestId,
    action: "request_rejected",
    details: {review_note: reviewNote},
  });
  revalidatePath("/dashboard/badges/manage");
  revalidatePath("/dashboard/profile/badge");
  adminBadgeRedirect("success", tr("La demande a été refusée.", "The request has been rejected."));
}

export async function changeEmployeeBadgeStatusAction(formData: FormData) {
  const {admin, user, organizationId, tr} = await getBadgeAdminContext();
  const badgeId = value(formData, "badgeId", 80);
  const nextStatus = value(formData, "nextStatus", 30);
  const reason = value(formData, "reason", 1200);
  if (!["active", "suspended", "revoked"].includes(nextStatus)) {
    adminBadgeRedirect("error", tr("Statut de badge invalide.", "Invalid badge status."));
  }
  if (["suspended", "revoked"].includes(nextStatus) && reason.length < 3) {
    adminBadgeRedirect("error", tr("Indique le motif de cette décision.", "Provide a reason for this decision."));
  }

  const {data: badge} = await admin
    .from("employee_badges")
    .select("id,user_id,status,valid_until")
    .eq("id", badgeId)
    .eq("organization_id", organizationId)
    .maybeSingle<{id: string; user_id: string; status: string; valid_until: string}>();
  if (!badge) adminBadgeRedirect("error", tr("Badge introuvable.", "Badge not found."));

  if (nextStatus === "active") {
    const {data: membership} = await admin
      .from("organization_members")
      .select("is_active")
      .eq("organization_id", organizationId)
      .eq("user_id", badge.user_id)
      .maybeSingle<{is_active: boolean}>();
    if (!membership?.is_active || badge.valid_until < new Date().toISOString().slice(0, 10)) {
      adminBadgeRedirect("error", tr("Ce badge ne peut pas être réactivé. Renouvelle-le ou réactive d’abord le collaborateur.", "This badge cannot be reactivated. Renew it or reactivate the employee first."));
    }
  }

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {status: nextStatus};
  let action = "badge_reactivated";
  if (nextStatus === "suspended") {
    payload.suspended_by = user.id;
    payload.suspended_at = now;
    payload.suspension_reason = reason;
    action = "badge_suspended";
  } else if (nextStatus === "revoked") {
    payload.revoked_by = user.id;
    payload.revoked_at = now;
    payload.revocation_reason = reason;
    action = "badge_revoked";
  } else {
    payload.suspended_by = null;
    payload.suspended_at = null;
    payload.suspension_reason = null;
  }

  const {error} = await admin.from("employee_badges").update(payload).eq("id", badgeId).eq("organization_id", organizationId);
  if (error) adminBadgeRedirect("error", tr("Le statut n’a pas pu être modifié : ", "The status could not be changed: ") + error.message);

  await writeAudit({admin, organizationId, userId: badge.user_id, actorId: user.id, badgeId, action, details: {reason}});
  revalidatePath("/dashboard/badges/manage");
  revalidatePath("/dashboard/profile/badge");
  revalidatePath(`/dashboard/badges/card/${badgeId}`);
  adminBadgeRedirect("success", tr("Le statut du badge a été mis à jour.", "The badge status has been updated."));
}

