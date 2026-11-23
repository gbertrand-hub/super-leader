"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const text = (formData: FormData, name: string, max = 1000) => String(formData.get(name) ?? "").trim().slice(0, max);
const normalizeEmail = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();

function finish(message: string, kind: "success" | "error" = "success", returnTo = "/dashboard/admin/identity-audit"): never {
  const safeReturn = returnTo.startsWith("/dashboard/admin/identity-audit") || returnTo.startsWith("/dashboard/crm/prospects")
    ? returnTo
    : "/dashboard/admin/identity-audit";
  redirect(`${safeReturn}${safeReturn.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

async function context() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ organization_id: string; role: string }>();
  if (!membership || !["owner", "admin"].includes(membership.role)) redirect("/dashboard?error=access-denied");
  return { admin, user: auth.user, membership };
}

type ClientRow = { id: string; email: string | null; linked_user_id: string | null };
type EnrollmentRow = { id: string; user_id: string | null; crm_client_id: string | null };
type MemberRow = { user_id: string; is_active: boolean };
type ProfileRow = { id: string; email: string | null };
type DecisionRow = { crm_client_id: string; candidate_user_id: string; decision: string };
type SafeCandidate = { clientId: string; userId: string; email: string };

async function readOrganizationRows<T>(admin: SupabaseClient, table: string, columns: string, organizationId: string) {
  const rows: T[] = [];
  const batchSize = 1000;
  for (let start = 0; ; start += batchSize) {
    const result = await admin.from(table).select(columns).eq("organization_id", organizationId).range(start, start + batchSize - 1);
    if (result.error) throw new Error(result.error.message);
    const batch = (result.data ?? []) as unknown as T[];
    rows.push(...batch);
    if (batch.length < batchSize) break;
  }
  return rows;
}

async function readProfiles(admin: SupabaseClient, userIds: string[]) {
  const rows: ProfileRow[] = [];
  for (let start = 0; start < userIds.length; start += 500) {
    const result = await admin.from("profiles").select("id,email").in("id", userIds.slice(start, start + 500));
    if (result.error) throw new Error(result.error.message);
    rows.push(...((result.data ?? []) as ProfileRow[]));
  }
  return rows;
}

async function safeAcademyCandidates(admin: SupabaseClient, organizationId: string): Promise<SafeCandidate[]> {
  const [clients, enrollments, members, decisions] = await Promise.all([
    readOrganizationRows<ClientRow>(admin, "crm_clients", "id,email,linked_user_id", organizationId),
    readOrganizationRows<EnrollmentRow>(admin, "academy_school_enrollments", "id,user_id,crm_client_id", organizationId),
    readOrganizationRows<MemberRow>(admin, "organization_members", "user_id,is_active", organizationId),
    readOrganizationRows<DecisionRow>(admin, "person_identity_review_decisions", "crm_client_id,candidate_user_id,decision", organizationId).catch(() => [] as DecisionRow[]),
  ]);

  // V4.10.112 bulk repair is deliberately restricted to CRM dossiers already used by Academy.
  const academyClientIds = new Set(enrollments.map((row) => row.crm_client_id).filter((id): id is string => Boolean(id)));
  const userIds = [...new Set([
    ...members.filter((row) => row.is_active).map((row) => row.user_id),
    ...enrollments.map((row) => row.user_id).filter((id): id is string => Boolean(id)),
    ...clients.map((row) => row.linked_user_id).filter((id): id is string => Boolean(id)),
  ])];
  const profiles = await readProfiles(admin, userIds);

  const clientsByEmail = new Map<string, ClientRow[]>();
  for (const client of clients) {
    const email = normalizeEmail(client.email);
    if (!email) continue;
    clientsByEmail.set(email, [...(clientsByEmail.get(email) ?? []), client]);
  }

  const profilesByEmail = new Map<string, ProfileRow[]>();
  for (const profile of profiles) {
    const email = normalizeEmail(profile.email);
    if (!email) continue;
    profilesByEmail.set(email, [...(profilesByEmail.get(email) ?? []), profile]);
  }

  const linkedClientByUser = new Map<string, string>();
  for (const client of clients) if (client.linked_user_id) linkedClientByUser.set(client.linked_user_id, client.id);
  const enrollmentClientsByUser = new Map<string, Set<string>>();
  const enrollmentUsersByClient = new Map<string, Set<string>>();
  for (const enrollment of enrollments) {
    if (enrollment.user_id && enrollment.crm_client_id) {
      const clientIds = enrollmentClientsByUser.get(enrollment.user_id) ?? new Set<string>();
      clientIds.add(enrollment.crm_client_id);
      enrollmentClientsByUser.set(enrollment.user_id, clientIds);

      const userIdsForClient = enrollmentUsersByClient.get(enrollment.crm_client_id) ?? new Set<string>();
      userIdsForClient.add(enrollment.user_id);
      enrollmentUsersByClient.set(enrollment.crm_client_id, userIdsForClient);
    }
  }
  const blockedPairs = new Set(decisions.filter((row) => row.decision === "different_person").map((row) => `${row.crm_client_id}:${row.candidate_user_id}`));

  const result: SafeCandidate[] = [];
  for (const client of clients) {
    if (!academyClientIds.has(client.id) || client.linked_user_id) continue;
    const email = normalizeEmail(client.email);
    if (!email) continue;
    const sameEmailClients = clientsByEmail.get(email) ?? [];
    const sameEmailProfiles = profilesByEmail.get(email) ?? [];
    if (sameEmailClients.length !== 1 || sameEmailProfiles.length !== 1) continue;
    const userId = sameEmailProfiles[0].id;
    const occupiedClientId = linkedClientByUser.get(userId);
    if (occupiedClientId && occupiedClientId !== client.id) continue;
    const userEnrollmentClients = enrollmentClientsByUser.get(userId) ?? new Set<string>();
    if ([...userEnrollmentClients].some((clientId) => clientId !== client.id)) continue;
    const clientEnrollmentUsers = enrollmentUsersByClient.get(client.id) ?? new Set<string>();
    if ([...clientEnrollmentUsers].some((enrollmentUserId) => enrollmentUserId !== userId)) continue;
    if (blockedPairs.has(`${client.id}:${userId}`)) continue;
    result.push({ clientId: client.id, userId, email });
  }
  return result;
}

async function linkIdentity(args: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  actorId: string;
  clientId: string;
  userId: string;
  reason: string;
  auditAction: "safe_link_applied" | "manual_same_person";
}) {
  const { admin, organizationId, actorId, clientId, userId, reason, auditAction } = args;
  const { data, error } = await admin.rpc("apply_person_identity_link", {
    p_organization_id: organizationId,
    p_crm_client_id: clientId,
    p_user_id: userId,
    p_actor_id: actorId,
    p_reason: reason,
    p_action: auditAction,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function applyCertainIdentityLinksAction(formData: FormData) {
  const { admin, user, membership } = await context();
  const returnTo = text(formData, "returnTo", 500) || "/dashboard/admin/identity-audit";
  let candidates: SafeCandidate[] = [];
  try {
    candidates = await safeAcademyCandidates(admin, membership.organization_id);
  } catch (error) {
    finish(`Analyse impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`, "error", returnTo);
  }
  if (!candidates.length) finish("Aucun lien certain Academy/CRM à appliquer. Les cas restants nécessitent une vérification manuelle.", "success", returnTo);

  let applied = 0;
  let synchronizedEnrollments = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    try {
      synchronizedEnrollments += await linkIdentity({
        admin,
        organizationId: membership.organization_id,
        actorId: user.id,
        clientId: candidate.clientId,
        userId: candidate.userId,
        reason: `Correspondance sûre Academy/CRM : e-mail exact et unique (${candidate.email}).`,
        auditAction: "safe_link_applied",
      });
      applied += 1;
    } catch {
      skipped += 1;
    }
  }

  revalidatePath("/dashboard/admin/identity-audit");
  revalidatePath("/dashboard/crm/identity-sync");
  revalidatePath("/dashboard/academy/students");
  finish(`${applied} identité(s) certaine(s) reliée(s), ${synchronizedEnrollments} inscription(s) synchronisée(s), ${skipped} cas ignoré(s) par sécurité.`, "success", returnTo);
}

export async function decideIdentityReviewAction(formData: FormData) {
  const { admin, user, membership } = await context();
  const clientId = text(formData, "crmClientId", 80);
  const candidateUserId = text(formData, "candidateUserId", 80);
  const decision = text(formData, "decision", 40);
  const reason = text(formData, "reason") || "Décision administrative après vérification de l’identité.";
  const returnTo = text(formData, "returnTo", 500) || "/dashboard/admin/identity-audit";
  if (!clientId || !candidateUserId || !["same_person", "different_person", "deferred"].includes(decision) || reason.length < 5) {
    finish("Décision d’identité incomplète.", "error", returnTo);
  }

  const { error } = await admin.rpc("resolve_person_identity_review", {
    p_organization_id: membership.organization_id,
    p_crm_client_id: clientId,
    p_candidate_user_id: candidateUserId,
    p_actor_id: user.id,
    p_decision: decision,
    p_reason: reason,
  });
  if (error) finish(`Décision impossible : ${error.message}`, "error", returnTo);

  revalidatePath("/dashboard/admin/identity-audit");
  revalidatePath(`/dashboard/admin/identity-audit/${clientId}`);
  revalidatePath("/dashboard/crm/identity-sync");
  revalidatePath("/dashboard/academy/students");
  finish(decision === "same_person" ? "Identité confirmée et dossiers reliés." : decision === "different_person" ? "Les deux dossiers sont marqués comme personnes différentes." : "Cas conservé pour vérification ultérieure.", "success", returnTo);
}


export async function resolveLegacyAcademyIdentityReviewAction(formData: FormData) {
  const { admin, user, membership } = await context();
  const reviewId = text(formData, "reviewId", 80);
  const clientId = text(formData, "clientId", 80);
  const reason = text(formData, "reason") || "File historique Academy/CRM résolue après vérification administrative.";
  const returnTo = text(formData, "returnTo", 500) || "/dashboard/admin/identity-audit";
  if (!reviewId || !clientId || reason.length < 5) {
    finish("Résolution de la file historique incomplète.", "error", returnTo);
  }

  const { data, error } = await admin.rpc("resolve_legacy_academy_identity_review", {
    p_organization_id: membership.organization_id,
    p_review_id: reviewId,
    p_crm_client_id: clientId,
    p_actor_id: user.id,
    p_reason: reason,
  });
  if (error) finish(`Résolution impossible : ${error.message}`, "error", returnTo);

  revalidatePath("/dashboard/admin/identity-audit");
  revalidatePath(`/dashboard/admin/identity-audit/${clientId}`);
  revalidatePath("/dashboard/crm/identity-sync");
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy/journey-control");
  finish(`File historique résolue. ${Number(data ?? 0)} inscription(s) Academy synchronisée(s) avec le dossier CRM confirmé.`, "success", returnTo);
}

export async function confirmPersonIdentityAssociationAction(formData: FormData) {
  const { admin, user, membership } = await context();
  const primaryUserId = text(formData, "primaryUserId", 80);
  const crmClientId = text(formData, "crmClientId", 80);
  const reason = text(formData, "reason") || "Identité confirmée manuellement par l’administration.";
  const returnTo = text(formData, "returnTo", 500);
  if (!primaryUserId || !crmClientId || reason.length < 5) finish("Association incomplète.", "error", returnTo);

  const [{ data: member }, { data: client }, { data: existing }] = await Promise.all([
    admin.from("organization_members").select("user_id").eq("organization_id", membership.organization_id).eq("user_id", primaryUserId).eq("is_active", true).maybeSingle(),
    admin.from("crm_clients").select("id,linked_user_id").eq("organization_id", membership.organization_id).eq("id", crmClientId).maybeSingle<{ id: string; linked_user_id: string | null }>(),
    admin.from("person_identity_associations").select("id,primary_user_id").eq("organization_id", membership.organization_id).eq("crm_client_id", crmClientId).eq("status", "active").maybeSingle<{ id: string; primary_user_id: string }>(),
  ]);
  if (!member || !client) finish("Employé ou dossier CRM introuvable dans cette organisation.", "error", returnTo);
  if (existing?.primary_user_id === primaryUserId) finish("Cette identité est déjà confirmée.", "success", returnTo);
  if (existing) finish("Ce dossier CRM est déjà associé à un autre compte principal.", "error", returnTo);

  const { error } = await admin.from("person_identity_associations").insert({
    organization_id: membership.organization_id,
    primary_user_id: primaryUserId,
    crm_client_id: crmClientId,
    related_user_id: client.linked_user_id && client.linked_user_id !== primaryUserId ? client.linked_user_id : null,
    confirmation_reason: reason,
    confirmed_by: user.id,
  });
  if (error) finish(`Association impossible : ${error.message}`, "error", returnTo);

  // Audit is best-effort so this legacy association action remains usable before the V4.10.112 DB migration.
  await admin.from("person_identity_link_audit").insert({
    organization_id: membership.organization_id,
    crm_client_id: crmClientId,
    user_id: primaryUserId,
    action: "manual_link_confirmed",
    reason,
    actor_id: user.id,
    details: { linked_user_id_preserved: client.linked_user_id },
  });

  revalidatePath("/dashboard/admin/identity-audit");
  revalidatePath(`/dashboard/admin/identity-audit/${crmClientId}`);
  finish("Identité confirmée sans modifier les comptes ni les inscriptions.", "success", returnTo);
}

export async function revokePersonIdentityAssociationAction(formData: FormData) {
  const { admin, user, membership } = await context();
  const associationId = text(formData, "associationId", 80);
  const reason = text(formData, "reason") || "Association annulée par l’administration.";
  const returnTo = text(formData, "returnTo", 500);
  if (!associationId || reason.length < 5) finish("Motif d’annulation incomplet.", "error", returnTo);
  const { data: association } = await admin.from("person_identity_associations").select("id,crm_client_id,primary_user_id").eq("id", associationId).eq("organization_id", membership.organization_id).eq("status", "active").maybeSingle<{ id: string; crm_client_id: string; primary_user_id: string }>();
  if (!association) finish("Association active introuvable.", "error", returnTo);
  const { error } = await admin.from("person_identity_associations").update({ status: "revoked", revoked_by: user.id, revoked_at: new Date().toISOString(), revocation_reason: reason, updated_at: new Date().toISOString() }).eq("id", associationId).eq("organization_id", membership.organization_id).eq("status", "active");
  if (error) finish(`Annulation impossible : ${error.message}`, "error", returnTo);

  // This revokes the administrative association only. Existing CRM/Academy links are deliberately preserved.
  await admin.from("person_identity_link_audit").insert({
    organization_id: membership.organization_id,
    crm_client_id: association.crm_client_id,
    user_id: association.primary_user_id,
    action: "association_revoked",
    reason,
    actor_id: user.id,
    details: { association_id: associationId, base_links_preserved: true },
  });

  revalidatePath("/dashboard/admin/identity-audit");
  revalidatePath(`/dashboard/admin/identity-audit/${association.crm_client_id}`);
  finish("Association administrative annulée. Les liens CRM/Academy existants restent intacts par sécurité.", "success", returnTo);
}
