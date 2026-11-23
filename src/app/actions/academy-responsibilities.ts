"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {
  ACADEMY_RESPONSIBILITY_CODES,
  getAcademyResponsibilityProfile,
  type AcademyResponsibilityProfile,
  type LocalizedText,
} from "@/lib/academy/responsibilities";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string};

function clean(value: FormDataEntryValue | null, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

async function getActor() {
  const supabase = await createClient();
  const {data: auth, error: authError} = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (!membership) redirect("/dashboard/company");
  return {admin, userId: auth.user.id, membership};
}

async function actorCanManageResponsibilities(
  _admin: ReturnType<typeof createAdminClient>,
  _organizationId: string,
  _userId: string,
  organizationRole: string,
) {
  // Formal school responsibilities are managed in Academy > Trainers and school leads.
  // This complementary assignment table is restricted to organization-level Academy governance.
  return ["owner", "admin", "hr"].includes(organizationRole);
}

function go(message: string, kind: "success" | "error"): never {
  const key = kind === "success" ? "success" : "error";
  redirect(`/dashboard/academy/responsibilities?${key}=${encodeURIComponent(message)}`);
}

function goManage(roleCode: string, message: string, kind: "success" | "error"): never {
  const key = kind === "success" ? "success" : "error";
  redirect(`/dashboard/academy/responsibilities/manage?role=${encodeURIComponent(roleCode)}&${key}=${encodeURIComponent(message)}`);
}

export async function assignAcademyResponsibilityAction(formData: FormData) {
  const {admin, userId, membership} = await getActor();
  const canManage = await actorCanManageResponsibilities(
    admin,
    membership.organization_id,
    userId,
    membership.role,
  );
  if (!canManage) go("Vous n’avez pas l’autorisation d’attribuer des responsabilités académiques.", "error");

  const targetUserId = clean(formData.get("userId"), 80);
  const roleCode = clean(formData.get("roleCode"), 80);
  const contextLabel = clean(formData.get("contextLabel"), 160);
  const notes = clean(formData.get("notes"), 500);

  if (!targetUserId || !ACADEMY_RESPONSIBILITY_CODES.some((code) => code === roleCode)) {
    go("Sélectionnez un collaborateur et un poste valide.", "error");
  }

  const {data: targetMembership} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", targetUserId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{user_id: string}>();

  if (!targetMembership) go("Ce collaborateur n’est pas un membre actif de votre organisation.", "error");

  const {data: existing} = await admin
    .from("academy_responsibility_assignments")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", targetUserId)
    .eq("role_code", roleCode)
    .eq("context_label", contextLabel)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{id: string}>();

  if (existing?.id) go("Cette responsabilité est déjà active pour ce collaborateur dans ce contexte.", "error");

  const {error} = await admin.from("academy_responsibility_assignments").insert({
    organization_id: membership.organization_id,
    user_id: targetUserId,
    role_code: roleCode,
    context_label: contextLabel,
    notes: notes || null,
    assigned_by: userId,
    is_active: true,
  });

  if (error) go(`Impossible d’attribuer la responsabilité : ${error.message}`, "error");

  revalidatePath("/dashboard/academy/responsibilities");
  go("Responsabilité académique attribuée.", "success");
}

export async function deactivateAcademyResponsibilityAction(formData: FormData) {
  const {admin, userId, membership} = await getActor();
  const canManage = await actorCanManageResponsibilities(
    admin,
    membership.organization_id,
    userId,
    membership.role,
  );
  if (!canManage) go("Vous n’avez pas l’autorisation de modifier les responsabilités académiques.", "error");

  const assignmentId = clean(formData.get("assignmentId"), 80);
  if (!assignmentId) go("Affectation introuvable.", "error");

  const {error} = await admin
    .from("academy_responsibility_assignments")
    .update({is_active: false, ended_at: new Date().toISOString(), updated_at: new Date().toISOString()})
    .eq("id", assignmentId)
    .eq("organization_id", membership.organization_id);

  if (error) go(`Impossible de clôturer cette responsabilité : ${error.message}`, "error");

  revalidatePath("/dashboard/academy/responsibilities");
  go("Responsabilité clôturée.", "success");
}

function multiline(value: FormDataEntryValue | null, max = 12000) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function lines(value: FormDataEntryValue | null, maxItems = 40) {
  return multiline(value)
    .split("\n")
    .map((item) => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, maxItems);
}

function localizedList(frValue: FormDataEntryValue | null, enValue: FormDataEntryValue | null): LocalizedText[] {
  const fr = lines(frValue);
  const en = lines(enValue);
  const length = Math.max(fr.length, en.length);
  return Array.from({length}, (_, index) => ({
    fr: fr[index] || en[index] || "",
    en: en[index] || fr[index] || "",
  })).filter((item) => item.fr || item.en);
}

function optionalList(items: LocalizedText[]) {
  return items.length ? items : undefined;
}

function buildProfileFromForm(formData: FormData, roleCode: AcademyResponsibilityProfile["code"]): AcademyResponsibilityProfile {
  const defaultProfile = getAcademyResponsibilityProfile(roleCode);
  if (!defaultProfile) throw new Error("Unknown academy responsibility role.");

  const titleFr = clean(formData.get("titleFr"), 160) || defaultProfile.title.fr;
  const titleEn = clean(formData.get("titleEn"), 160) || defaultProfile.title.en;
  const missionFr = multiline(formData.get("missionFr"), 1200) || defaultProfile.mission.fr;
  const missionEn = multiline(formData.get("missionEn"), 1200) || defaultProfile.mission.en;

  const responsibilities = localizedList(formData.get("responsibilitiesFr"), formData.get("responsibilitiesEn"));
  const daily = localizedList(formData.get("dailyFr"), formData.get("dailyEn"));
  const weekly = localizedList(formData.get("weeklyFr"), formData.get("weeklyEn"));
  const monthly = localizedList(formData.get("monthlyFr"), formData.get("monthlyEn"));
  const beforeSession = localizedList(formData.get("beforeSessionFr"), formData.get("beforeSessionEn"));
  const afterSession = localizedList(formData.get("afterSessionFr"), formData.get("afterSessionEn"));
  const kpis = localizedList(formData.get("kpisFr"), formData.get("kpisEn"));
  const restrictions = localizedList(formData.get("restrictionsFr"), formData.get("restrictionsEn"));

  return {
    code: roleCode,
    title: {fr: titleFr, en: titleEn},
    mission: {fr: missionFr, en: missionEn},
    responsibilities: responsibilities.length ? responsibilities : defaultProfile.responsibilities,
    daily: optionalList(daily),
    weekly: optionalList(weekly),
    monthly: optionalList(monthly),
    beforeSession: optionalList(beforeSession),
    afterSession: optionalList(afterSession),
    kpis: kpis.length ? kpis : defaultProfile.kpis,
    restrictions: optionalList(restrictions),
  };
}

async function requireResponsibilityReferenceEditor() {
  const actor = await getActor();
  if (!["owner", "admin"].includes(actor.membership.role)) {
    go("Seuls le propriétaire et les administrateurs peuvent modifier le référentiel des responsabilités.", "error");
  }
  return actor;
}

export async function updateAcademyResponsibilityProfileAction(formData: FormData) {
  const {admin, userId, membership} = await requireResponsibilityReferenceEditor();
  const roleCodeValue = clean(formData.get("roleCode"), 80);
  if (!ACADEMY_RESPONSIBILITY_CODES.some((code) => code === roleCodeValue)) {
    goManage(roleCodeValue || "school_direction", "Poste de responsabilité invalide.", "error");
  }

  const roleCode = roleCodeValue as AcademyResponsibilityProfile["code"];
  const reason = clean(formData.get("changeReason"), 400);
  if (reason.length < 5) {
    goManage(roleCode, "Indiquez brièvement la raison de la modification afin de conserver une trace d’audit.", "error");
  }

  const nextProfile = buildProfileFromForm(formData, roleCode);
  const {data: existing, error: existingError} = await admin
    .from("academy_responsibility_profile_overrides")
    .select("id, profile_json, revision")
    .eq("organization_id", membership.organization_id)
    .eq("role_code", roleCode)
    .limit(1)
    .maybeSingle<{id: string; profile_json: unknown; revision: number}>();

  if (existingError) goManage(roleCode, `Impossible de lire le référentiel : ${existingError.message}`, "error");

  const defaultProfile = getAcademyResponsibilityProfile(roleCode);
  if (!defaultProfile) goManage(roleCode, "Poste de responsabilité introuvable.", "error");
  const previousProfile = existing?.profile_json ?? defaultProfile;
  const previousRevision = existing?.revision ?? 1;
  const nextRevision = previousRevision + 1;
  const now = new Date().toISOString();

  const {error: saveError} = await admin
    .from("academy_responsibility_profile_overrides")
    .upsert({
      organization_id: membership.organization_id,
      role_code: roleCode,
      profile_json: nextProfile,
      revision: nextRevision,
      is_customized: true,
      updated_by: userId,
      updated_at: now,
    }, {onConflict: "organization_id,role_code"});

  if (saveError) goManage(roleCode, `Impossible d’enregistrer la fiche : ${saveError.message}`, "error");

  const {error: historyError} = await admin.from("academy_responsibility_profile_history").insert({
    organization_id: membership.organization_id,
    role_code: roleCode,
    previous_profile_json: previousProfile,
    new_profile_json: nextProfile,
    previous_revision: previousRevision,
    new_revision: nextRevision,
    change_reason: reason,
    changed_by: userId,
  });

  if (historyError) goManage(roleCode, `La fiche a été modifiée mais l’audit n’a pas pu être enregistré : ${historyError.message}`, "error");

  revalidatePath("/dashboard/academy/responsibilities");
  revalidatePath("/dashboard/academy/responsibilities/manage");
  redirect(`/dashboard/academy/responsibilities/manage?role=${encodeURIComponent(roleCode)}&success=${encodeURIComponent("Fiche de responsabilité mise à jour.")}`);
}

export async function resetAcademyResponsibilityProfileAction(formData: FormData) {
  const {admin, userId, membership} = await requireResponsibilityReferenceEditor();
  const roleCodeValue = clean(formData.get("roleCode"), 80);
  if (!ACADEMY_RESPONSIBILITY_CODES.some((code) => code === roleCodeValue)) {
    goManage(roleCodeValue || "school_direction", "Poste de responsabilité invalide.", "error");
  }
  const roleCode = roleCodeValue as AcademyResponsibilityProfile["code"];
  const reason = clean(formData.get("changeReason"), 400);
  if (reason.length < 5) goManage(roleCode, "Indiquez la raison du retour au référentiel initial.", "error");

  const defaultProfile = getAcademyResponsibilityProfile(roleCode);
  if (!defaultProfile) goManage(roleCode, "Poste de responsabilité introuvable.", "error");

  const {data: existing, error: existingError} = await admin
    .from("academy_responsibility_profile_overrides")
    .select("profile_json, revision")
    .eq("organization_id", membership.organization_id)
    .eq("role_code", roleCode)
    .limit(1)
    .maybeSingle<{profile_json: unknown; revision: number}>();
  if (existingError) goManage(roleCode, `Impossible de lire le référentiel : ${existingError.message}`, "error");
  if (!existing) redirect(`/dashboard/academy/responsibilities/manage?role=${encodeURIComponent(roleCode)}&success=${encodeURIComponent("Cette fiche utilise déjà le référentiel initial.")}`);

  const nextRevision = existing.revision + 1;
  const {error: historyError} = await admin.from("academy_responsibility_profile_history").insert({
    organization_id: membership.organization_id,
    role_code: roleCode,
    previous_profile_json: existing.profile_json,
    new_profile_json: defaultProfile,
    previous_revision: existing.revision,
    new_revision: nextRevision,
    change_reason: reason,
    changed_by: userId,
  });
  if (historyError) goManage(roleCode, `Impossible d’enregistrer l’audit : ${historyError.message}`, "error");

  const {error: restoreError} = await admin
    .from("academy_responsibility_profile_overrides")
    .update({
      profile_json: defaultProfile,
      revision: nextRevision,
      is_customized: false,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", membership.organization_id)
    .eq("role_code", roleCode);
  if (restoreError) goManage(roleCode, `Impossible de restaurer la fiche initiale : ${restoreError.message}`, "error");

  revalidatePath("/dashboard/academy/responsibilities");
  revalidatePath("/dashboard/academy/responsibilities/manage");
  redirect(`/dashboard/academy/responsibilities/manage?role=${encodeURIComponent(roleCode)}&success=${encodeURIComponent("Référentiel initial restauré.")}`);
}
