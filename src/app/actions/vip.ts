"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {addMonthsToDate, getActiveVipCategory, getVipProgramSettings} from "@/lib/vip/settings";

const VIP_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const VIP_REGISTRY_ROLES = new Set(["owner", "admin", "hr"]);
const VIP_DECISION_ROLES = new Set(["owner", "admin", "executive"]);
const MEMBER_TYPES = new Set(["internal", "external"]);

const MEMBER_STATUSES = new Set(["active", "pending_renewal", "expired", "suspended", "withdrawn", "honorary"]);
const NOMINATION_DECISIONS = new Set(["under_review", "needs_information", "approved", "rejected"]);
const RENEWAL_DECISIONS = new Set(["under_review", "needs_information", "approved", "rejected"]);

function text(value: FormDataEntryValue | null, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function email(value: FormDataEntryValue | null) {
  const result = text(value, 254).toLowerCase();
  if (!result) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : "";
}

function dateValue(value: FormDataEntryValue | null) {
  const result = text(value, 10);
  if (!result) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return "";
  return Number.isNaN(new Date(`${result}T00:00:00Z`).getTime()) ? "" : result;
}


function go(message: string, kind: "success" | "error" = "success", view = "overview"): never {
  redirect(`/dashboard/vip?view=${encodeURIComponent(view)}&${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const translate = (frText: string, enText: string) => fr ? frText : enText;
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();

  if (error || !membership) redirect("/dashboard/company");
  const {data: vipSettings} = await admin.from("vip_program_settings")
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_growth_membership_manager_user_id,vip_membership_concierge_assistant_user_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{vip_manager_user_id: string | null; vip_assistant_manager_user_id: string | null; vip_growth_membership_manager_user_id: string | null; vip_membership_concierge_assistant_user_id: string | null}>();
  const hasVipLeadershipRole = vipSettings?.vip_manager_user_id === authData.user.id || vipSettings?.vip_assistant_manager_user_id === authData.user.id;
  const isVipGrowthMembershipManager = vipSettings?.vip_growth_membership_manager_user_id === authData.user.id;
  const isVipMembershipConciergeAssistant = vipSettings?.vip_membership_concierge_assistant_user_id === authData.user.id;
  const hasVipRegistryRole = hasVipLeadershipRole || isVipMembershipConciergeAssistant;
  if (!VIP_ROLES.has(membership.role) && !hasVipRegistryRole && !isVipGrowthMembershipManager) redirect("/dashboard/my-day");
  return {user: authData.user, membership, admin, fr, translate, hasVipLeadershipRole, isVipGrowthMembershipManager, isVipMembershipConciergeAssistant, hasVipRegistryRole};
}

async function resolvePerson(input: {
  memberType: string;
  linkedUserId: string | null;
  fullName: string;
  emailAddress: string | null | "";
  organizationId: string;
  admin: ReturnType<typeof createAdminClient>;
}) {
  if (!MEMBER_TYPES.has(input.memberType)) return null;
  if (input.emailAddress === "") return null;

  if (input.memberType === "internal") {
    if (!input.linkedUserId) return null;
    const {data: internalMembership} = await input.admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", input.organizationId)
      .eq("user_id", input.linkedUserId)
      .eq("is_active", true)
      .maybeSingle<{user_id: string}>();
    if (!internalMembership) return null;

    const {data: profile} = await input.admin
      .from("profiles")
      .select("full_name, email")
      .eq("id", input.linkedUserId)
      .maybeSingle<{full_name: string | null; email: string | null}>();

    const resolvedName = profile?.full_name?.trim() || input.fullName;
    const resolvedEmail = profile?.email?.trim().toLowerCase() || input.emailAddress || null;
    if (resolvedName.length < 2) return null;
    return {linkedUserId: input.linkedUserId, fullName: resolvedName, emailAddress: resolvedEmail};
  }

  if (input.fullName.length < 2) return null;
  return {linkedUserId: null, fullName: input.fullName, emailAddress: input.emailAddress || null};
}

async function auditVip(input: {
  organizationId: string;
  entityType: "nomination" | "member" | "card" | "renewal";
  entityId: string;
  actorId: string;
  action: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  details?: Record<string, unknown>;
  admin: ReturnType<typeof createAdminClient>;
}) {
  const {error} = await input.admin.from("vip_audit_log").insert({
    organization_id: input.organizationId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    actor_id: input.actorId,
    action: input.action,
    previous_status: input.previousStatus ?? null,
    new_status: input.newStatus ?? null,
    details: input.details ?? {},
  });
  if (error) console.error("VIP audit failed", error);
}

export async function createVipNominationAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  const nomineeType = text(formData.get("nomineeType"), 20);
  const linkedUserId = text(formData.get("linkedUserId"), 80) || null;
  const fullName = text(formData.get("fullName"), 180);
  const emailAddress = email(formData.get("email"));
  const recognitionCategory = text(formData.get("recognitionCategory"), 50);
  const contributionSummary = text(formData.get("contributionSummary"), 5000);
  const evidenceNotes = text(formData.get("evidenceNotes"), 5000) || null;

  const settings = await getVipProgramSettings(admin, membership.organization_id);
  const recognitionCategoryRecord = await getActiveVipCategory(admin, membership.organization_id, recognitionCategory);
  if (!recognitionCategoryRecord || contributionSummary.length < 10 || (settings.nomination_requires_evidence && !evidenceNotes)) {
    go(
      settings.nomination_requires_evidence
        ? translate("Complète la catégorie, la contribution et la preuve de contribution.", "Complete the category, contribution and supporting evidence.")
        : translate("Complète la catégorie et la contribution distinctive.", "Complete the category and distinctive contribution."),
      "error",
      "nominations",
    );
  }

  const person = await resolvePerson({
    memberType: nomineeType,
    linkedUserId,
    fullName,
    emailAddress,
    organizationId: membership.organization_id,
    admin,
  });
  if (!person) {
    go(translate("Les informations de la personne sont invalides.", "The nominee information is invalid."), "error", "nominations");
  }

  if (person.linkedUserId) {
    const [{data: existingMember}, {data: existingNomination}] = await Promise.all([
      admin
        .from("vip_members")
        .select("id")
        .eq("organization_id", membership.organization_id)
        .eq("linked_user_id", person.linkedUserId)
        .neq("status", "withdrawn")
        .limit(1)
        .maybeSingle<{id: string}>(),
      admin
        .from("vip_nominations")
        .select("id")
        .eq("organization_id", membership.organization_id)
        .eq("linked_user_id", person.linkedUserId)
        .in("status", ["submitted", "under_review", "needs_information"])
        .limit(1)
        .maybeSingle<{id: string}>(),
    ]);
    if (existingMember) {
      go(translate("Cette personne est déjà membre VIP.", "This person is already a VIP member."), "error", "nominations");
    }
    if (existingNomination) {
      go(translate("Une nomination active existe déjà pour cette personne.", "An active nomination already exists for this person."), "error", "nominations");
    }
  }

  const {data: created, error: createError} = await admin
    .from("vip_nominations")
    .insert({
      organization_id: membership.organization_id,
      nominee_type: nomineeType,
      linked_user_id: person.linkedUserId,
      full_name: person.fullName,
      email: person.emailAddress,
      phone: text(formData.get("phone"), 60) || null,
      country: text(formData.get("country"), 120) || null,
      organization_name: text(formData.get("organizationName"), 180) || null,
      job_title: text(formData.get("jobTitle"), 180) || null,
      recognition_category: recognitionCategory,
      relationship_to_organization: text(formData.get("relationship"), 500) || null,
      contribution_summary: contributionSummary,
      evidence_notes: evidenceNotes,
      status: "submitted",
      nominated_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (createError || !created) {
    go(translate("La nomination n’a pas pu être enregistrée : ", "The nomination could not be saved: ") + (createError?.message ?? "unknown error"), "error", "nominations");
  }

  await auditVip({
    organizationId: membership.organization_id,
    entityType: "nomination",
    entityId: created.id,
    actorId: user.id,
    action: "nomination_created",
    newStatus: "submitted",
    details: {nomineeType, recognitionCategory},
    admin,
  });

  revalidatePath("/dashboard/vip");
  go(translate("Nomination transmise au comité VIP.", "Nomination sent to the VIP committee."), "success", "nominations");
}

export async function reviewVipNominationAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  const nominationId = text(formData.get("nominationId"), 80);
  const decision = text(formData.get("decision"), 40);
  const reviewNotes = text(formData.get("reviewNotes"), 5000) || null;

  if (!nominationId || !NOMINATION_DECISIONS.has(decision)) {
    go(translate("Décision invalide.", "Invalid decision."), "error", "approvals");
  }
  const settings = await getVipProgramSettings(admin, membership.organization_id);
  const finalDecisionRoles = settings.nomination_requires_committee_approval
    ? VIP_DECISION_ROLES
    : new Set([...VIP_DECISION_ROLES, "hr"]);
  if (["approved", "rejected"].includes(decision) && !finalDecisionRoles.has(membership.role)) {
    go(translate("Tu n’as pas l’autorisation de prendre la décision finale.", "You are not allowed to make the final decision."), "error", "approvals");
  }

  const {data: nomination} = await admin
    .from("vip_nominations")
    .select("id, status")
    .eq("id", nominationId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string}>();
  if (!nomination) go(translate("Nomination introuvable.", "Nomination not found."), "error", "approvals");

  if (decision === "approved") {
    const {error} = await admin.rpc("approve_vip_nomination", {
      p_nomination_id: nominationId,
      p_actor_id: user.id,
      p_review_notes: reviewNotes,
    });
    if (error) {
      go(translate("Approbation impossible : ", "Unable to approve: ") + error.message, "error", "approvals");
    }
    revalidatePath("/dashboard/vip");
    go(translate("Nomination approuvée et membre VIP créé.", "Nomination approved and VIP member created."), "success", "approvals");
  }

  const patch: Record<string, unknown> = {
    status: decision,
    reviewed_by: user.id,
    review_notes: reviewNotes,
    decided_at: decision === "rejected" ? new Date().toISOString() : null,
  };
  const {error} = await admin
    .from("vip_nominations")
    .update(patch)
    .eq("id", nominationId)
    .eq("organization_id", membership.organization_id);
  if (error) {
    go(translate("Mise à jour impossible : ", "Unable to update: ") + error.message, "error", "approvals");
  }

  await auditVip({
    organizationId: membership.organization_id,
    entityType: "nomination",
    entityId: nominationId,
    actorId: user.id,
    action: decision === "rejected" ? "nomination_rejected" : "nomination_status_changed",
    previousStatus: nomination.status,
    newStatus: decision,
    details: {reviewNotes},
    admin,
  });

  revalidatePath("/dashboard/vip");
  go(
    decision === "rejected"
      ? translate("Nomination refusée.", "Nomination rejected.")
      : translate("Statut de la nomination mis à jour.", "Nomination status updated."),
    "success",
    "approvals",
  );
}

export async function createVipMemberAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipRegistryRole} = await getContext();
  if (!VIP_REGISTRY_ROLES.has(membership.role) && !hasVipRegistryRole) {
    go(translate("Tu n’as pas la permission d’ajouter directement un membre.", "You do not have permission to add a member directly."), "error", "members");
  }

  const memberType = text(formData.get("memberType"), 20);
  const linkedUserId = text(formData.get("linkedUserId"), 80) || null;
  const fullName = text(formData.get("fullName"), 180);
  const emailAddress = email(formData.get("email"));
  const recognitionCategory = text(formData.get("recognitionCategory"), 50);
  const contributionSummary = text(formData.get("contributionSummary"), 5000);
  const statusInput = text(formData.get("status"), 40) || "active";
  const admissionInput = dateValue(formData.get("admissionDate"));
  const expiresInput = dateValue(formData.get("expiresOn"));
  if (admissionInput === "" || expiresInput === "") {
    go(translate("Les dates du membre sont invalides.", "The member dates are invalid."), "error", "members");
  }
  const admissionDate = admissionInput ?? new Date().toISOString().slice(0, 10);
  const settings = await getVipProgramSettings(admin, membership.organization_id);
  const expiresOn = expiresInput ?? addMonthsToDate(admissionDate, settings.card_validity_months);
  const recognitionCategoryRecord = await getActiveVipCategory(admin, membership.organization_id, recognitionCategory);

  if (!recognitionCategoryRecord || !MEMBER_STATUSES.has(statusInput) || expiresOn < admissionDate || contributionSummary.length < 10) {
    go(translate("Les informations du membre sont invalides.", "The member information is invalid."), "error", "members");
  }

  const person = await resolvePerson({
    memberType,
    linkedUserId,
    fullName,
    emailAddress,
    organizationId: membership.organization_id,
    admin,
  });
  if (!person) go(translate("Les informations de la personne sont invalides.", "The person information is invalid."), "error", "members");

  const {data: created, error} = await admin
    .from("vip_members")
    .insert({
      organization_id: membership.organization_id,
      member_type: memberType,
      linked_user_id: person.linkedUserId,
      full_name: person.fullName,
      email: person.emailAddress,
      phone: text(formData.get("phone"), 60) || null,
      country: text(formData.get("country"), 120) || null,
      organization_name: text(formData.get("organizationName"), 180) || null,
      job_title: text(formData.get("jobTitle"), 180) || null,
      recognition_category: recognitionCategory,
      contribution_summary: contributionSummary,
      status: recognitionCategoryRecord.is_honorary ? "honorary" : statusInput,
      admission_date: admissionDate,
      expires_on: expiresOn,
      notes: text(formData.get("notes"), 5000) || null,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id, status")
    .single<{id: string; status: string}>();

  if (error || !created) {
    go(translate("Création impossible : ", "Unable to create: ") + (error?.message ?? "unknown error"), "error", "members");
  }

  await auditVip({
    organizationId: membership.organization_id,
    entityType: "member",
    entityId: created.id,
    actorId: user.id,
    action: "member_created",
    newStatus: created.status,
    details: {directImport: true, recognitionCategory},
    admin,
  });

  revalidatePath("/dashboard/vip");
  go(translate("Membre VIP ajouté au registre.", "VIP member added to the registry."), "success", "members");
}

export async function updateVipMemberDetailsAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipRegistryRole} = await getContext();
  if (!VIP_REGISTRY_ROLES.has(membership.role) && !hasVipRegistryRole) {
    go(translate("Permission insuffisante pour modifier ce dossier.", "Insufficient permission to edit this record."), "error", "members");
  }

  const memberId = text(formData.get("memberId"), 80);
  const saveMode = text(formData.get("saveMode"), 30) || "save";
  const fullName = text(formData.get("fullName"), 180);
  const emailAddress = email(formData.get("email"));
  const recognitionCategory = text(formData.get("recognitionCategory"), 50);
  const contributionSummary = text(formData.get("contributionSummary"), 5000);
  const admissionDate = dateValue(formData.get("admissionDate"));
  const expiresOn = dateValue(formData.get("expiresOn"));
  const recognitionCategoryRecord = await getActiveVipCategory(admin, membership.organization_id, recognitionCategory);

  if (
    !memberId ||
    !["save", "save_reissue"].includes(saveMode) ||
    fullName.length < 2 ||
    emailAddress === "" ||
    !recognitionCategoryRecord ||
    contributionSummary.length < 10 ||
    !admissionDate ||
    !expiresOn ||
    expiresOn < admissionDate ||
    (saveMode === "save_reissue" && expiresOn < new Date().toISOString().slice(0, 10))
  ) {
    go(translate("Les informations modifiées sont invalides.", "The edited information is invalid."), "error", "members");
  }

  const {data: current} = await admin
    .from("vip_members")
    .select("id,full_name,email,phone,country,organization_name,job_title,recognition_category,contribution_summary,admission_date,expires_on,notes,status")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{
      id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      country: string | null;
      organization_name: string | null;
      job_title: string | null;
      recognition_category: string;
      contribution_summary: string;
      admission_date: string;
      expires_on: string;
      notes: string | null;
      status: string;
    }>();
  if (!current) {
    go(translate("Membre introuvable.", "Member not found."), "error", "members");
  }

  const nextMemberStatus = recognitionCategoryRecord.is_honorary
    ? "honorary"
    : current.status === "honorary"
      ? (expiresOn >= new Date().toISOString().slice(0, 10) ? "active" : "expired")
      : current.status;

  const updated = {
    full_name: fullName,
    email: emailAddress || null,
    phone: text(formData.get("phone"), 60) || null,
    country: text(formData.get("country"), 120) || null,
    organization_name: text(formData.get("organizationName"), 180) || null,
    job_title: text(formData.get("jobTitle"), 180) || null,
    recognition_category: recognitionCategory,
    contribution_summary: contributionSummary,
    admission_date: admissionDate,
    expires_on: expiresOn,
    notes: text(formData.get("notes"), 5000) || null,
    status: nextMemberStatus,
    updated_by: user.id,
  };

  const comparableCurrent = {
    full_name: current.full_name,
    email: current.email,
    phone: current.phone,
    country: current.country,
    organization_name: current.organization_name,
    job_title: current.job_title,
    recognition_category: current.recognition_category,
    contribution_summary: current.contribution_summary,
    admission_date: current.admission_date,
    expires_on: current.expires_on,
    notes: current.notes,
    status: current.status,
  };
  const comparableUpdated = {...updated};
  delete (comparableUpdated as {updated_by?: string}).updated_by;
  const changedFields = Object.keys(comparableUpdated).filter((key) => {
    const currentValue = comparableCurrent[key as keyof typeof comparableCurrent] ?? null;
    const newValue = comparableUpdated[key as keyof typeof comparableUpdated] ?? null;
    return currentValue !== newValue;
  });

  const {error} = await admin
    .from("vip_members")
    .update(updated)
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id);
  if (error) {
    go(translate("Mise à jour impossible : ", "Unable to update: ") + error.message, "error", "members");
  }

  await auditVip({
    organizationId: membership.organization_id,
    entityType: "member",
    entityId: memberId,
    actorId: user.id,
    action: "member_updated",
    previousStatus: current.status,
    newStatus: current.status,
    details: {
      changedFields,
      previousValues: comparableCurrent,
      newValues: comparableUpdated,
      cardReissueRequested: saveMode === "save_reissue",
    },
    admin,
  });

  if (saveMode === "save_reissue") {
    if (["suspended", "withdrawn"].includes(current.status)) {
      revalidatePath("/dashboard/vip");
      go(
        translate(
          "Dossier mis à jour, mais la carte ne peut pas être réémise tant que le membre est suspendu ou retiré.",
          "Record updated, but the card cannot be reissued while the member is suspended or withdrawn.",
        ),
        "error",
        "members",
      );
    }

    const {data: activeCard} = await admin
      .from("vip_cards")
      .select("id,valid_from")
      .eq("organization_id", membership.organization_id)
      .eq("member_id", memberId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle<{id: string; valid_from: string}>();

    const validFrom = activeCard?.valid_from && activeCard.valid_from <= expiresOn
      ? activeCard.valid_from
      : admissionDate;
    const {data: newCardId, error: cardError} = await admin.rpc("issue_vip_card", {
      p_member_id: memberId,
      p_actor_id: user.id,
      p_valid_from: validFrom,
      p_valid_until: expiresOn,
      p_reason: "member_information_corrected",
    });

    if (cardError || !newCardId) {
      revalidatePath("/dashboard/vip");
      go(
        translate(
          "Le dossier a été mis à jour, mais la réémission de la carte a échoué : ",
          "The record was updated, but card reissue failed: ",
        ) + (cardError?.message ?? "unknown error"),
        "error",
        "members",
      );
    }

    revalidatePath("/dashboard/vip");
    revalidatePath(`/dashboard/vip/card/${newCardId}`);
    redirect(`/dashboard/vip/card/${newCardId}?success=${encodeURIComponent(translate("Dossier corrigé et nouvelle carte émise.", "Record corrected and new card issued."))}`);
  }

  revalidatePath("/dashboard/vip");
  go(translate("Dossier du membre mis à jour.", "Member record updated."), "success", "members");
}

export async function updateVipMemberStatusAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipRegistryRole} = await getContext();
  if (!VIP_REGISTRY_ROLES.has(membership.role) && !hasVipRegistryRole) {
    go(translate("Permission insuffisante.", "Insufficient permission."), "error", "members");
  }
  const memberId = text(formData.get("memberId"), 80);
  const status = text(formData.get("status"), 40);
  if (!memberId || !MEMBER_STATUSES.has(status)) {
    go(translate("Statut invalide.", "Invalid status."), "error", "members");
  }

  const {data: current} = await admin
    .from("vip_members")
    .select("id, status")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string}>();
  if (!current) go(translate("Membre introuvable.", "Member not found."), "error", "members");

  const {error} = await admin
    .from("vip_members")
    .update({status, updated_by: user.id})
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id);
  if (error) go(translate("Mise à jour impossible : ", "Unable to update: ") + error.message, "error", "members");

  await auditVip({
    organizationId: membership.organization_id,
    entityType: "member",
    entityId: memberId,
    actorId: user.id,
    action: "member_status_changed",
    previousStatus: current.status,
    newStatus: status,
    admin,
  });

  revalidatePath("/dashboard/vip");
  go(translate("Statut du membre mis à jour.", "Member status updated."), "success", "members");
}

export async function createVipRenewalRequestAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipRegistryRole} = await getContext();
  if (!VIP_REGISTRY_ROLES.has(membership.role) && !hasVipRegistryRole) {
    go(translate("Permission insuffisante pour demander un renouvellement.", "Insufficient permission to request a renewal."), "error", "renewals");
  }

  const memberId = text(formData.get("memberId"), 80);
  const requestReason = text(formData.get("requestReason"), 2000) || null;
  if (!memberId) {
    go(translate("Sélectionne un membre VIP.", "Select a VIP member."), "error", "renewals");
  }

  const {data: member} = await admin
    .from("vip_members")
    .select("id,status,recognition_category,expires_on")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string; recognition_category: string; expires_on: string}>();
  if (!member) {
    go(translate("Membre VIP introuvable.", "VIP member not found."), "error", "renewals");
  }
  if (["suspended", "withdrawn"].includes(member.status)) {
    go(translate("Ce membre doit être réactivé avant un renouvellement.", "This member must be reactivated before renewal."), "error", "renewals");
  }
  const renewalCategory = await getActiveVipCategory(admin, membership.organization_id, member.recognition_category);

  const [{data: openRequest}, {data: currentCard}] = await Promise.all([
    admin
      .from("vip_renewal_requests")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .eq("member_id", memberId)
      .in("status", ["submitted", "under_review", "needs_information"])
      .limit(1)
      .maybeSingle<{id: string}>(),
    admin
      .from("vip_cards")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .eq("member_id", memberId)
      .eq("status", "active")
      .order("issue_number", {ascending: false})
      .limit(1)
      .maybeSingle<{id: string}>(),
  ]);

  if (openRequest) {
    go(translate("Une demande de renouvellement est déjà ouverte pour ce membre.", "An open renewal request already exists for this member."), "error", "renewals");
  }

  const {data: created, error} = await admin
    .from("vip_renewal_requests")
    .insert({
      organization_id: membership.organization_id,
      member_id: memberId,
      current_card_id: currentCard?.id ?? null,
      status: "submitted",
      request_reason: requestReason,
      requested_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !created) {
    go(translate("Demande impossible : ", "Unable to create request: ") + (error?.message ?? "unknown error"), "error", "renewals");
  }

  if (!renewalCategory?.is_honorary) {
    await admin
      .from("vip_members")
      .update({status: "pending_renewal", updated_by: user.id})
      .eq("id", memberId)
      .eq("organization_id", membership.organization_id);
  }

  await auditVip({
    organizationId: membership.organization_id,
    entityType: "renewal",
    entityId: created.id,
    actorId: user.id,
    action: "renewal_requested",
    newStatus: "submitted",
    details: {memberId, currentCardId: currentCard?.id ?? null, requestReason},
    admin,
  });

  revalidatePath("/dashboard/vip");
  go(translate("Demande de renouvellement transmise au comité VIP.", "Renewal request sent to the VIP committee."), "success", "renewals");
}

export async function reviewVipRenewalAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  const renewalId = text(formData.get("renewalId"), 80);
  const decision = text(formData.get("decision"), 40);
  const reviewNotes = text(formData.get("reviewNotes"), 5000) || null;

  if (!renewalId || !RENEWAL_DECISIONS.has(decision)) {
    go(translate("Décision de renouvellement invalide.", "Invalid renewal decision."), "error", "renewals");
  }
  if (["approved", "rejected"].includes(decision) && !VIP_DECISION_ROLES.has(membership.role)) {
    go(translate("Seuls la Direction, les Administrateurs et les Exécutifs peuvent prendre la décision finale.", "Only Leadership, Administrators and Executives can make the final decision."), "error", "renewals");
  }

  const {data: renewal} = await admin
    .from("vip_renewal_requests")
    .select("id,member_id,status")
    .eq("id", renewalId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; member_id: string; status: string}>();
  if (!renewal) {
    go(translate("Demande de renouvellement introuvable.", "Renewal request not found."), "error", "renewals");
  }

  if (decision === "approved") {
    const {data: cardId, error} = await admin.rpc("approve_vip_renewal", {
      p_renewal_id: renewalId,
      p_actor_id: user.id,
      p_review_notes: reviewNotes,
    });
    if (error || !cardId) {
      go(translate("Renouvellement impossible : ", "Unable to renew: ") + (error?.message ?? "unknown error"), "error", "renewals");
    }
    revalidatePath("/dashboard/vip");
    revalidatePath(`/dashboard/vip/card/${cardId}`);
    redirect(`/dashboard/vip/card/${cardId}?success=${encodeURIComponent(translate("Renouvellement approuvé et nouvelle carte émise.", "Renewal approved and new card issued."))}`);
  }

  const {error} = await admin
    .from("vip_renewal_requests")
    .update({
      status: decision,
      reviewed_by: user.id,
      review_notes: reviewNotes,
      decided_at: decision === "rejected" ? new Date().toISOString() : null,
    })
    .eq("id", renewalId)
    .eq("organization_id", membership.organization_id);
  if (error) {
    go(translate("Mise à jour impossible : ", "Unable to update: ") + error.message, "error", "renewals");
  }

  if (decision === "rejected") {
    const {data: member} = await admin
      .from("vip_members")
      .select("recognition_category,expires_on")
      .eq("id", renewal.member_id)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{recognition_category: string; expires_on: string}>();
    if (member) {
      const category = await getActiveVipCategory(admin, membership.organization_id, member.recognition_category);
      const restoredStatus = category?.is_honorary
        ? "honorary"
        : member.expires_on >= new Date().toISOString().slice(0, 10) ? "active" : "expired";
      await admin
        .from("vip_members")
        .update({status: restoredStatus, updated_by: user.id})
        .eq("id", renewal.member_id)
        .eq("organization_id", membership.organization_id);
    }
  }

  await auditVip({
    organizationId: membership.organization_id,
    entityType: "renewal",
    entityId: renewalId,
    actorId: user.id,
    action: decision === "rejected" ? "renewal_rejected" : "renewal_status_changed",
    previousStatus: renewal.status,
    newStatus: decision,
    details: {reviewNotes, memberId: renewal.member_id},
    admin,
  });

  revalidatePath("/dashboard/vip");
  go(
    decision === "rejected"
      ? translate("Renouvellement refusé.", "Renewal rejected.")
      : translate("Statut du renouvellement mis à jour.", "Renewal status updated."),
    "success",
    "renewals",
  );
}

export async function reissueVipCardAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipRegistryRole} = await getContext();
  if (!VIP_REGISTRY_ROLES.has(membership.role) && !hasVipRegistryRole) {
    go(translate("Permission insuffisante pour réémettre une carte.", "Insufficient permission to reissue a card."), "error", "cards");
  }

  const cardId = text(formData.get("cardId"), 80);
  const reason = text(formData.get("reason"), 500) || "replacement";
  const {data: card} = await admin
    .from("vip_cards")
    .select("id,member_id,status,valid_until")
    .eq("id", cardId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; member_id: string; status: string; valid_until: string}>();
  if (!card || card.status !== "active" || card.valid_until < new Date().toISOString().slice(0, 10)) {
    go(translate("Seule une carte active et non expirée peut être réémise.", "Only an active, unexpired card can be reissued."), "error", "cards");
  }

  const {data: newCardId, error} = await admin.rpc("issue_vip_card", {
    p_member_id: card.member_id,
    p_actor_id: user.id,
    p_valid_from: new Date().toISOString().slice(0, 10),
    p_valid_until: card.valid_until,
    p_reason: reason,
  });
  if (error || !newCardId) {
    go(translate("Réémission impossible : ", "Unable to reissue: ") + (error?.message ?? "unknown error"), "error", "cards");
  }

  revalidatePath("/dashboard/vip");
  revalidatePath(`/dashboard/vip/card/${newCardId}`);
  redirect(`/dashboard/vip/card/${newCardId}?success=${encodeURIComponent(translate("Nouvelle carte émise. L’ancienne carte a été remplacée.", "New card issued. The previous card was replaced."))}`);
}

export async function revokeVipCardAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipRegistryRole} = await getContext();
  if (!VIP_REGISTRY_ROLES.has(membership.role) && !hasVipRegistryRole) {
    go(translate("Permission insuffisante pour révoquer une carte.", "Insufficient permission to revoke a card."), "error", "cards");
  }

  const cardId = text(formData.get("cardId"), 80);
  const reason = text(formData.get("reason"), 500);
  if (!cardId || reason.length < 5) {
    go(translate("Indique une raison de révocation.", "Provide a revocation reason."), "error", "cards");
  }

  const {data: card} = await admin
    .from("vip_cards")
    .select("id,member_id,status")
    .eq("id", cardId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; member_id: string; status: string}>();
  if (!card || card.status !== "active") {
    go(translate("Carte active introuvable.", "Active card not found."), "error", "cards");
  }

  const {error} = await admin
    .from("vip_cards")
    .update({
      status: "revoked",
      revoked_by: user.id,
      revoked_at: new Date().toISOString(),
      revocation_reason: reason,
    })
    .eq("id", cardId)
    .eq("organization_id", membership.organization_id);
  if (error) {
    go(translate("Révocation impossible : ", "Unable to revoke: ") + error.message, "error", "cards");
  }

  const {data: member} = await admin
    .from("vip_members")
    .select("status")
    .eq("id", card.member_id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{status: string}>();
  await admin
    .from("vip_members")
    .update({status: "suspended", updated_by: user.id})
    .eq("id", card.member_id)
    .eq("organization_id", membership.organization_id);

  await Promise.all([
    auditVip({
      organizationId: membership.organization_id,
      entityType: "card",
      entityId: cardId,
      actorId: user.id,
      action: "card_revoked",
      previousStatus: card.status,
      newStatus: "revoked",
      details: {reason, memberId: card.member_id},
      admin,
    }),
    auditVip({
      organizationId: membership.organization_id,
      entityType: "member",
      entityId: card.member_id,
      actorId: user.id,
      action: "member_status_changed",
      previousStatus: member?.status ?? null,
      newStatus: "suspended",
      details: {reason: "card_revoked", cardId},
      admin,
    }),
  ]);

  revalidatePath("/dashboard/vip");
  go(translate("Carte révoquée et adhésion suspendue.", "Card revoked and membership suspended."), "success", "cards");
}

