"use server";

import { randomInt } from "crypto";
import type { User } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendTemporaryAccessEmail } from "@/lib/auth/temporary-access-email";
import { isPlatformOrganization } from "@/lib/acquisition/platform";
import { notifyPlatformReviewers } from "@/lib/acquisition/requests";
import { createNotification } from "@/lib/notifications/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type PublicRequestState = {
  status?: "success" | "error";
  message?: string;
};

export type InternalApprovalState = {
  status?: "success" | "warning" | "error";
  message?: string;
  temporaryPassword?: string;
  loginUrl?: string;
  emailSent?: boolean;
};

type PlatformContext = {
  userId: string;
  organizationId: string;
  organizationName: string;
  role: string;
};

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function safeReturnView(value: string): "demo" | "internal" {
  return value === "internal" ? "internal" : "demo";
}

function go(message: string, kind: "success" | "error", view: "demo" | "internal"): never {
  const params = new URLSearchParams({ [kind]: message, view });
  redirect(`/dashboard/acquisition?${params.toString()}`);
}

async function getPlatformContext(allowedRoles: string[]): Promise<PlatformContext> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role,is_active,organizations(name)")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const rawOrganization = membership?.organizations as
    | { name?: string | null }
    | { name?: string | null }[]
    | null
    | undefined;
  const organization = Array.isArray(rawOrganization)
    ? rawOrganization[0] ?? null
    : rawOrganization;

  if (
    !membership ||
    !allowedRoles.includes(String(membership.role)) ||
    !isPlatformOrganization({
      organizationId: String(membership.organization_id),
      organizationName: organization?.name ?? null,
    })
  ) {
    redirect("/dashboard");
  }

  return {
    userId: authData.user.id,
    organizationId: String(membership.organization_id),
    organizationName: organization?.name ?? "iLEAD Global",
    role: String(membership.role),
  };
}

async function logAcquisition(input: {
  requestType: "demo" | "internal_access";
  requestId: string;
  organizationId?: string | null;
  actorId?: string | null;
  action: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("acquisition_audit_log").insert({
    request_type: input.requestType,
    request_id: input.requestId,
    organization_id: input.organizationId ?? null,
    actor_id: input.actorId ?? null,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Acquisition audit failed", error);
}

async function findAuthUserByEmail(email: string): Promise<User | null> {
  const admin = createAdminClient();
  const normalizedEmail = normalizeEmail(email);
  const perPage = 200;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const found = data.users.find(
      (candidate) => normalizeEmail(candidate.email ?? "") === normalizedEmail,
    );
    if (found) return found;
    if (data.users.length < perPage) return null;
  }
  return null;
}

function generateTemporaryPassword(): string {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%*-_";
  const all = `${uppercase}${lowercase}${digits}${symbols}`;
  const chars = [
    uppercase[randomInt(uppercase.length)],
    lowercase[randomInt(lowercase.length)],
    digits[randomInt(digits.length)],
    symbols[randomInt(symbols.length)],
  ];
  while (chars.length < 14) chars.push(all[randomInt(all.length)]);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [chars[index], chars[other]] = [chars[other], chars[index]];
  }
  return `SL-${chars.join("")}`;
}

function temporaryExpiry(): string {
  const parsed = Number.parseInt(process.env.TEMPORARY_PASSWORD_EXPIRY_HOURS ?? "48", 10);
  const hours = Number.isFinite(parsed) ? Math.min(168, Math.max(1, parsed)) : 48;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export async function submitInternalAccessRequestAction(
  _state: PublicRequestState,
  formData: FormData,
): Promise<PublicRequestState> {
  if (text(formData, "website")) {
    return { status: "success", message: "Votre demande a été transmise." };
  }

  const fullName = text(formData, "fullName");
  const email = normalizeEmail(text(formData, "email"));
  const phone = text(formData, "phone");
  const entityName = text(formData, "entityName");
  const department = text(formData, "department");
  const positionTitle = text(formData, "positionTitle");
  const supervisorName = text(formData, "supervisorName");
  const requestedTeam = text(formData, "requestedTeam");
  const employeeReference = text(formData, "employeeReference");
  const reason = text(formData, "reason");
  const consent = formData.get("consent") === "on";

  if (!fullName || !email || !entityName || !positionTitle || reason.length < 10) {
    return {
      status: "error",
      message: "Complète le nom, l’email, l’entité, le poste et le motif de la demande.",
    };
  }
  if (!email.includes("@")) {
    return { status: "error", message: "L’adresse email n’est pas valide." };
  }
  if (!consent) {
    return { status: "error", message: "La confirmation des informations est obligatoire." };
  }

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("internal_access_requests")
    .select("id,status")
    .eq("email", email)
    .in("status", ["pending", "reviewing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string }>();

  if (existingError) {
    return { status: "error", message: `Demande impossible : ${existingError.message}` };
  }

  const payload = {
    full_name: fullName,
    email,
    phone: phone || null,
    entity_name: entityName,
    department: department || null,
    position_title: positionTitle,
    supervisor_name: supervisorName || null,
    requested_team: requestedTeam || null,
    employee_reference: employeeReference || null,
    reason,
    updated_at: new Date().toISOString(),
  };

  let requestId: string;
  if (existing) {
    const { data, error } = await admin
      .from("internal_access_requests")
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single<{ id: string }>();
    if (error) return { status: "error", message: `Demande impossible : ${error.message}` };
    requestId = data.id;
  } else {
    const { data, error } = await admin
      .from("internal_access_requests")
      .insert({ ...payload, status: "pending" })
      .select("id")
      .single<{ id: string }>();
    if (error) return { status: "error", message: `Demande impossible : ${error.message}` };
    requestId = data.id;
  }

  await logAcquisition({
    requestType: "internal_access",
    requestId,
    action: existing ? "request_updated" : "request_submitted",
    details: { email, entity_name: entityName },
  });

  await notifyPlatformReviewers({
    eventType: "internal_access_request_received",
    titleFr: "Nouvelle demande d’accès iLEAD",
    titleEn: "New iLEAD access request",
    bodyFr: `${fullName} demande un accès pour ${entityName}.`,
    bodyEn: `${fullName} is requesting access for ${entityName}.`,
    actionUrl: `/dashboard/acquisition?view=internal&request=${requestId}`,
    dedupeKey: `internal-access-${requestId}`,
    roles: ["owner", "admin", "hr"],
  });

  return {
    status: "success",
    message: "Demande reçue. Owner, Admin ou RH vérifiera les informations avant toute activation.",
  };
}

export async function updateDemoRequestAction(formData: FormData) {
  const context = await getPlatformContext(["owner", "admin"]);
  const requestId = text(formData, "requestId");
  const status = text(formData, "status");
  const salesNotes = text(formData, "salesNotes");
  const scheduledDemoAt = text(formData, "scheduledDemoAt");
  const assignedTo = text(formData, "assignedTo");
  const view = safeReturnView(text(formData, "view"));
  const allowed = [
    "new",
    "contact_pending",
    "demo_scheduled",
    "demo_completed",
    "trial_approved",
    "free_approved",
    "client_active",
    "rejected",
    "archived",
  ];
  if (!requestId || !allowed.includes(status)) go("Demande ou statut invalide.", "error", view);

  const admin = createAdminClient();
  const { error } = await admin
    .from("demo_requests")
    .update({
      status,
      sales_notes: salesNotes || null,
      scheduled_demo_at: scheduledDemoAt ? new Date(scheduledDemoAt).toISOString() : null,
      assigned_to: assignedTo || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);
  if (error) go(`Mise à jour impossible : ${error.message}`, "error", view);

  await logAcquisition({
    requestType: "demo",
    requestId,
    organizationId: context.organizationId,
    actorId: context.userId,
    action: "pipeline_updated",
    details: { status, scheduled_demo_at: scheduledDemoAt || null, assigned_to: assignedTo || null },
  });
  revalidatePath("/dashboard/acquisition");
  go("Demande de démonstration mise à jour.", "success", view);
}

export async function convertDemoRequestAction(formData: FormData) {
  const context = await getPlatformContext(["owner", "admin"]);
  const requestId = text(formData, "requestId");
  if (!requestId) go("Demande invalide.", "error", "demo");

  const admin = createAdminClient();
  const { data: request, error: requestError } = await admin
    .from("demo_requests")
    .select("id,requester_user_id,email,organization_name,sector,status,converted_organization_id,requested_plan_code")
    .eq("id", requestId)
    .maybeSingle<{
      id: string;
      requester_user_id: string | null;
      email: string;
      organization_name: string;
      sector: string | null;
      status: string;
      converted_organization_id: string | null;
      requested_plan_code: string | null;
    }>();
  if (requestError || !request) go("Demande introuvable.", "error", "demo");
  if (request.converted_organization_id) go("Cette demande a déjà été convertie.", "error", "demo");
  const freeRequest = request.requested_plan_code === "free";
  const convertibleStatuses = freeRequest
    ? ["free_approved", "demo_completed", "trial_approved"]
    : ["demo_completed", "trial_approved"];
  if (!convertibleStatuses.includes(request.status)) {
    go(
      freeRequest
        ? "Vérifie la demande puis sélectionne « Plan Free approuvé » avant l’activation."
        : "Termine d’abord la démonstration ou approuve l’essai avant la conversion.",
      "error",
      "demo",
    );
  }

  const authUser = request.requester_user_id
    ? await admin.auth.admin.getUserById(request.requester_user_id).then((result) => result.data.user)
    : await findAuthUserByEmail(request.email);
  if (!authUser) {
    go("Le demandeur doit d’abord confirmer ou créer son compte Super Leader.", "error", "demo");
  }

  const { data: existingMembership } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ organization_id: string }>();
  if (existingMembership) {
    go("Ce demandeur appartient déjà à une organisation active.", "error", "demo");
  }

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .insert({
      name: request.organization_name,
      sector: request.sector,
      created_by: authUser.id,
    })
    .select("id,name")
    .single<{ id: string; name: string }>();
  if (organizationError) go(`Création impossible : ${organizationError.message}`, "error", "demo");

  const { error: membershipError } = await admin.from("organization_members").insert({
    organization_id: organization.id,
    user_id: authUser.id,
    role: "owner",
    is_active: true,
  });
  if (membershipError) {
    await admin.from("organizations").delete().eq("id", organization.id);
    go(`Activation impossible : ${membershipError.message}`, "error", "demo");
  }

  // V2.5.2: attribue le plan demandé. Free est actif sans échéance ; les autres plans démarrent en essai.
  try {
    const requestedPlanCode = ["free", "starter", "growth", "enterprise"].includes(
      String(request.requested_plan_code ?? ""),
    )
      ? String(request.requested_plan_code)
      : "starter";
    const { data: selectedPlan } = await admin
      .from("subscription_plans")
      .select("id,code,currency,default_trial_days,pricing_mode")
      .eq("code", requestedPlanCode)
      .eq("status", "active")
      .maybeSingle<{
        id: string;
        code: string;
        currency: string;
        default_trial_days: number;
        pricing_mode: string;
      }>();

    if (!selectedPlan) {
      throw new Error(`Le plan ${requestedPlanCode} est introuvable ou inactif.`);
    }

    {
      const now = new Date();
      const isFree = selectedPlan.code === "free" || selectedPlan.pricing_mode === "free";
      const trialDays = Math.max(0, Number(selectedPlan.default_trial_days ?? 14));
      const trialEnd = isFree ? null : new Date(now.getTime() + trialDays * 86400000);
      const periodEnd = isFree ? null : new Date(now);
      if (periodEnd) periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

      const { error: subscriptionInsertError } = await admin.from("organization_subscriptions").insert({
        organization_id: organization.id,
        plan_id: selectedPlan.id,
        status: isFree ? "active" : "trialing",
        billing_interval: "monthly",
        currency: selectedPlan.currency || "USD",
        provider: process.env.SUPER_LEADER_BILLING_MODE === "test" ? "test" : "manual",
        trial_started_at: isFree ? null : now.toISOString(),
        trial_ends_at: trialEnd?.toISOString() ?? null,
        current_period_started_at: now.toISOString(),
        current_period_ends_at: periodEnd?.toISOString() ?? null,
        created_by: context.userId,
        metadata: {
          source: "demo_conversion",
          request_id: request.id,
          requested_plan_code: requestedPlanCode,
          free_activation: isFree,
        },
      });
      if (subscriptionInsertError) throw new Error(subscriptionInsertError.message);
    }
  } catch (subscriptionError) {
    console.error("Requested plan assignment unavailable", subscriptionError);
    await admin
      .from("organization_members")
      .delete()
      .eq("organization_id", organization.id)
      .eq("user_id", authUser.id);
    await admin.from("organizations").delete().eq("id", organization.id);
    go(
      `Activation du plan impossible : ${subscriptionError instanceof Error ? subscriptionError.message : "erreur inconnue"}`,
      "error",
      "demo",
    );
  }

  await admin
    .from("demo_requests")
    .update({
      requester_user_id: authUser.id,
      converted_organization_id: organization.id,
      status: "client_active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.id);

  await logAcquisition({
    requestType: "demo",
    requestId: request.id,
    organizationId: context.organizationId,
    actorId: context.userId,
    action: "converted_to_organization",
    details: {
      converted_organization_id: organization.id,
      owner_user_id: authUser.id,
      requested_plan_code: request.requested_plan_code ?? "starter",
    },
  });

  revalidatePath("/dashboard/acquisition");
  go(
    request.requested_plan_code === "free"
      ? `${organization.name} est maintenant active sur le plan Free.`
      : `${organization.name} est maintenant une organisation cliente active.`,
    "success",
    "demo",
  );
}

export async function updateInternalAccessRequestAction(formData: FormData) {
  const context = await getPlatformContext(["owner", "admin", "hr"]);
  const requestId = text(formData, "requestId");
  const status = text(formData, "status");
  const reviewNote = text(formData, "reviewNote");
  if (!requestId || !["pending", "reviewing", "rejected", "cancelled"].includes(status)) {
    go("Demande ou décision invalide.", "error", "internal");
  }
  if (status === "rejected" && reviewNote.length < 5) {
    go("Ajoute un motif de refus.", "error", "internal");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("internal_access_requests")
    .update({
      status,
      review_note: reviewNote || null,
      reviewed_by: context.userId,
      reviewed_at: new Date().toISOString(),
      organization_id: context.organizationId,
    })
    .eq("id", requestId)
    .neq("status", "approved");
  if (error) go(`Mise à jour impossible : ${error.message}`, "error", "internal");

  await logAcquisition({
    requestType: "internal_access",
    requestId,
    organizationId: context.organizationId,
    actorId: context.userId,
    action: `request_${status}`,
    details: { review_note: reviewNote || null },
  });
  revalidatePath("/dashboard/acquisition");
  go("Demande d’accès mise à jour.", "success", "internal");
}

export async function approveInternalAccessRequestAction(
  _state: InternalApprovalState,
  formData: FormData,
): Promise<InternalApprovalState> {
  const context = await getPlatformContext(["owner", "admin", "hr"]);
  const requestId = text(formData, "requestId");
  const role = text(formData, "role");
  const teamIds = formData.getAll("teamIds").map(String).filter(Boolean);
  const managerTeamId = text(formData, "managerTeamId");
  const supervisorId = text(formData, "supervisorId");
  const locale = formData.get("locale") === "en" ? "en" : "fr";
  const sendEmail = formData.get("sendEmail") === "on";
  const reviewNote = text(formData, "reviewNote");

  if (!requestId || !["admin", "hr", "manager", "employee"].includes(role)) {
    return { status: "error", message: "Demande ou rôle invalide." };
  }
  if (context.role === "hr" && !["manager", "employee"].includes(role)) {
    return { status: "error", message: "Le Responsable RH peut activer uniquement un Manager ou un Employé. Owner ou Admin doit attribuer les rôles Admin et RH." };
  }

  const admin = createAdminClient();
  const { data: request, error: requestError } = await admin
    .from("internal_access_requests")
    .select("id,full_name,email,status")
    .eq("id", requestId)
    .in("status", ["pending", "reviewing"])
    .maybeSingle<{ id: string; full_name: string; email: string; status: string }>();
  if (requestError || !request) {
    return { status: "error", message: "Cette demande n’est plus disponible." };
  }

  if (teamIds.length) {
    const { data: validTeams, error: teamsError } = await admin
      .from("teams")
      .select("id")
      .eq("organization_id", context.organizationId)
      .eq("is_active", true)
      .in("id", teamIds);
    if (teamsError || (validTeams ?? []).length !== new Set(teamIds).size) {
      return { status: "error", message: "Une équipe sélectionnée est invalide." };
    }
  }

  if (managerTeamId) {
    const { data: managedTeam } = await admin
      .from("teams")
      .select("id")
      .eq("organization_id", context.organizationId)
      .eq("id", managerTeamId)
      .eq("is_active", true)
      .maybeSingle();
    if (!managedTeam || role !== "manager") {
      return { status: "error", message: "L’équipe à diriger est invalide." };
    }
  }

  if (supervisorId) {
    const { data: supervisor } = await admin
      .from("organization_members")
      .select("user_id,role")
      .eq("organization_id", context.organizationId)
      .eq("user_id", supervisorId)
      .eq("is_active", true)
      .in("role", ["owner", "admin", "hr", "manager"])
      .maybeSingle();
    if (!supervisor) return { status: "error", message: "Le superviseur sélectionné est invalide." };
  }

  const email = normalizeEmail(request.email);
  const temporaryPassword = generateTemporaryPassword();
  const expiresAt = temporaryExpiry();
  const now = new Date().toISOString();
  let authUser = await findAuthUserByEmail(email);

  try {
    if (!authUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          full_name: request.full_name,
          must_change_password: true,
          temporary_password_expires_at: expiresAt,
        },
      });
      if (error || !data.user) throw new Error(error?.message || "Compte utilisateur non créé.");
      authUser = data.user;
    } else {
      const { data, error } = await admin.auth.admin.updateUserById(authUser.id, {
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          ...(authUser.user_metadata ?? {}),
          full_name: request.full_name,
          must_change_password: true,
          temporary_password_expires_at: expiresAt,
        },
      });
      if (error || !data.user) throw new Error(error?.message || "Compte utilisateur non mis à jour.");
      authUser = data.user;
    }

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: authUser.id,
        full_name: request.full_name,
        email,
        must_change_password: true,
        temporary_password_issued_at: now,
        temporary_password_expires_at: expiresAt,
        temporary_password_issued_by: context.userId,
        password_changed_at: null,
        updated_at: now,
      },
      { onConflict: "id" },
    );
    if (profileError) throw new Error(profileError.message);

    const { error: membershipError } = await admin.from("organization_members").upsert(
      {
        organization_id: context.organizationId,
        user_id: authUser.id,
        role,
        is_active: true,
        disabled_at: null,
        updated_at: now,
      },
      { onConflict: "organization_id,user_id" },
    );
    if (membershipError) throw new Error(membershipError.message);

    if (teamIds.length) {
      const { error: teamsError } = await admin.from("team_members").upsert(
        teamIds.map((teamId) => ({
          team_id: teamId,
          user_id: authUser!.id,
          assigned_by: context.userId,
          updated_at: now,
        })),
        { onConflict: "team_id,user_id" },
      );
      if (teamsError) throw new Error(teamsError.message);
    }

    if (managerTeamId && role === "manager") {
      const { error: managerError } = await admin
        .from("teams")
        .update({ manager_id: authUser.id, updated_at: now })
        .eq("id", managerTeamId)
        .eq("organization_id", context.organizationId);
      if (managerError) throw new Error(managerError.message);
    }

    if (supervisorId && supervisorId !== authUser.id) {
      const { data: settings } = await admin
        .from("performance_settings")
        .select("timezone,default_start_time,default_end_time,grace_minutes,report_deadline_time")
        .eq("organization_id", context.organizationId)
        .maybeSingle();
      const { error: scheduleError } = await admin.from("member_work_schedules").upsert(
        {
          organization_id: context.organizationId,
          user_id: authUser.id,
          timezone: settings?.timezone ?? "Europe/Dublin",
          work_days: [1, 2, 3, 4, 5],
          start_time: settings?.default_start_time ?? "09:00",
          end_time: settings?.default_end_time ?? "17:00",
          grace_minutes: settings?.grace_minutes ?? 10,
          report_deadline_time: settings?.report_deadline_time ?? "18:00",
          effective_from: new Date().toISOString().slice(0, 10),
          is_active: true,
          supervisor_id: supervisorId,
          updated_by: context.userId,
          updated_at: now,
        },
        { onConflict: "organization_id,user_id" },
      );
      if (scheduleError) throw new Error(scheduleError.message);
    }

    await admin.from("internal_access_requests").update({
      status: "approved",
      organization_id: context.organizationId,
      approved_user_id: authUser.id,
      assigned_role: role,
      reviewed_by: context.userId,
      review_note: reviewNote || null,
      reviewed_at: now,
      updated_at: now,
    }).eq("id", request.id);

    await admin.from("temporary_access_audit_log").insert({
      organization_id: context.organizationId,
      user_id: authUser.id,
      event_type: "issued_from_internal_access_request",
      actor_user_id: context.userId,
      metadata: { request_id: request.id, expires_at: expiresAt, role, team_ids: teamIds },
    });

    await logAcquisition({
      requestType: "internal_access",
      requestId: request.id,
      organizationId: context.organizationId,
      actorId: context.userId,
      action: "access_approved",
      details: { user_id: authUser.id, role, team_ids: teamIds, supervisor_id: supervisorId || null },
    });

    await createNotification({
      organizationId: context.organizationId,
      userId: authUser.id,
      actorId: context.userId,
      category: "system",
      eventType: "internal_access_approved",
      titleFr: "Ton accès iLEAD Global est approuvé",
      titleEn: "Your iLEAD Global access is approved",
      bodyFr: "Ton compte Super Leader a été activé. Change ton mot de passe lors de la première connexion.",
      bodyEn: "Your Super Leader account has been activated. Change your password at first sign-in.",
      actionUrl: "/change-password-required",
      priority: "success",
      requiresAction: true,
      dedupeKey: `internal-access-approved-${request.id}`,
    });

    let emailSent = false;
    let emailError = "";
    if (sendEmail) {
      const result = await sendTemporaryAccessEmail({
        to: email,
        fullName: request.full_name,
        temporaryPassword,
        expiresAt,
        locale,
        organizationName: context.organizationName,
      });
      emailSent = result.sent;
      emailError = result.error ?? "";
    }

    revalidatePath("/dashboard/acquisition");
    revalidatePath("/dashboard/members");
    return {
      status: sendEmail && !emailSent ? "warning" : "success",
      message:
        sendEmail && !emailSent
          ? `Accès activé, mais l’email n’a pas été envoyé : ${emailError || "configuration email indisponible"}.`
          : sendEmail
            ? "Accès activé et instructions envoyées par email."
            : "Accès activé. Transmets les informations temporaires de manière sécurisée.",
      temporaryPassword,
      loginUrl: `${getSiteUrl()}/login`,
      emailSent,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Activation impossible.",
    };
  }
}
