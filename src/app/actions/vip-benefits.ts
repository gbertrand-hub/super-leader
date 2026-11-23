"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const VIP_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const VIP_SETTINGS_ROLES = new Set(["owner", "admin"]);
const VIP_BENEFIT_ROLES = new Set(["owner", "admin", "executive"]);
const VIP_OPERATIONS_ROLES = new Set(["owner", "admin", "hr"]);
const VIP_DECISION_ROLES = new Set(["owner", "admin", "executive"]);
const PARTNER_TYPES = new Set(["hotel", "transport", "restaurant", "healthcare", "coworking", "retail", "professional_services", "education", "other"]);
const PARTNER_STATUSES = new Set(["active", "suspended", "expired", "archived"]);
const BENEFIT_TYPES = new Set(["discount", "complimentary", "priority", "upgrade", "exclusive_access", "assistance", "gift", "other"]);
const BENEFIT_STATUSES = new Set(["draft", "active", "suspended", "expired", "archived"]);
const ELIGIBILITY_SCOPES = new Set(["all_members", "active_members", "honorary_only", "internal_only", "external_only", "custom"]);
const REDEMPTION_STATUSES = new Set(["approved", "redeemed", "rejected", "cancelled"]);

function text(value: FormDataEntryValue | null, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function dateValue(value: FormDataEntryValue | null) {
  const result = text(value, 10);
  if (!result) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return "";
  return Number.isNaN(new Date(`${result}T00:00:00Z`).getTime()) ? "" : result;
}

function integerValue(value: FormDataEntryValue | null) {
  const raw = text(value, 12);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function decimalValue(value: FormDataEntryValue | null) {
  const raw = text(value, 30).replace(",", ".");
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function stringList(value: FormDataEntryValue | null, maxItems = 30) {
  return text(value, 3000)
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function validUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function go(message: string, kind: "success" | "error", view = "overview"): never {
  const query = new URLSearchParams({view, [kind]: message});
  redirect(`/dashboard/vip/benefits?${query.toString()}`);
}

async function getContext() {
  const {locale} = await getI18n();
  const translate = (frText: string, enText: string) => locale === "fr" ? frText : enText;
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();

  if (error || !membership) redirect("/dashboard/company");

  const {data: vipSettings} = await admin
    .from("vip_program_settings")
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_benefits_partners_assistant_user_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{vip_manager_user_id: string | null; vip_assistant_manager_user_id: string | null; vip_benefits_partners_assistant_user_id: string | null}>();
  const isVipManager = vipSettings?.vip_manager_user_id === authData.user.id;
  const isVipAssistantManager = vipSettings?.vip_assistant_manager_user_id === authData.user.id;
  const isVipBenefitsPartnersAssistant = vipSettings?.vip_benefits_partners_assistant_user_id === authData.user.id;
  const hasVipLeadershipRole = isVipManager || isVipAssistantManager;
  const hasVipOperationalRole = hasVipLeadershipRole || isVipBenefitsPartnersAssistant;

  if (!VIP_ROLES.has(membership.role) && !hasVipOperationalRole) redirect("/dashboard/my-day");
  return {user: authData.user, membership, admin, translate, isVipManager, isVipAssistantManager, isVipBenefitsPartnersAssistant, hasVipLeadershipRole, hasVipOperationalRole};
}

async function audit(input: {
  organizationId: string;
  entityType: "partner" | "benefit" | "benefit_redemption";
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
  if (error) console.error("VIP benefits audit failed", error);
}

export async function saveVipPartnerAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipOperationalRole} = await getContext();
  if (!VIP_SETTINGS_ROLES.has(membership.role) && !hasVipOperationalRole) {
    go(translate("Seuls le Propriétaire et les Administrateurs peuvent gérer les partenaires.", "Only the Owner and Administrators can manage partners."), "error", "partners");
  }

  const partnerId = text(formData.get("partnerId"), 80);
  const name = text(formData.get("name"), 220);
  const partnerType = text(formData.get("partnerType"), 60);
  const country = text(formData.get("country"), 120);
  const city = text(formData.get("city"), 120) || null;
  const websiteUrl = text(formData.get("websiteUrl"), 500) || null;
  const agreementStart = dateValue(formData.get("agreementStart")) || null;
  const agreementEnd = dateValue(formData.get("agreementEnd")) || null;
  const status = text(formData.get("status"), 40) || "active";

  if (name.length < 2 || !PARTNER_TYPES.has(partnerType) || country.length < 2 || !PARTNER_STATUSES.has(status)) {
    go(translate("Vérifie le nom, le type, le pays et le statut du partenaire.", "Check the partner name, type, country and status."), "error", "partners");
  }
  if (websiteUrl && !validUrl(websiteUrl)) {
    go(translate("L’adresse du site web doit commencer par http:// ou https://.", "The website address must start with http:// or https://."), "error", "partners");
  }
  if (agreementStart && agreementEnd && agreementEnd < agreementStart) {
    go(translate("La date de fin de l’accord ne peut pas précéder la date de début.", "The agreement end date cannot be before the start date."), "error", "partners");
  }

  const payload = {
    name,
    partner_type: partnerType,
    country,
    city,
    website_url: websiteUrl,
    contact_name: text(formData.get("contactName"), 220) || null,
    contact_email: text(formData.get("contactEmail"), 320) || null,
    contact_phone: text(formData.get("contactPhone"), 80) || null,
    agreement_start: agreementStart,
    agreement_end: agreementEnd,
    status,
    notes: text(formData.get("notes"), 4000) || null,
    updated_by: user.id,
  };

  if (partnerId) {
    const {data: current, error: currentError} = await admin
      .from("vip_partners")
      .select("id,status,name")
      .eq("id", partnerId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string; status: string; name: string}>();
    if (currentError || !current) go(translate("Partenaire introuvable.", "Partner not found."), "error", "partners");

    const {error} = await admin
      .from("vip_partners")
      .update(payload)
      .eq("id", partnerId)
      .eq("organization_id", membership.organization_id);
    if (error) go(translate("Le partenaire n’a pas pu être mis à jour : ", "The partner could not be updated: ") + error.message, "error", "partners");

    await audit({
      organizationId: membership.organization_id,
      entityType: "partner",
      entityId: partnerId,
      actorId: user.id,
      action: current.status === status ? "partner_updated" : "partner_status_changed",
      previousStatus: current.status,
      newStatus: status,
      details: {name, partnerType, country, city, previousName: current.name},
      admin,
    });
    revalidatePath("/dashboard/vip/benefits");
    go(translate("Partenaire mis à jour.", "Partner updated."), "success", "partners");
  }

  const {data: created, error} = await admin
    .from("vip_partners")
    .insert({organization_id: membership.organization_id, ...payload, created_by: user.id})
    .select("id")
    .single<{id: string}>();
  if (error || !created) {
    const duplicate = String(error?.code ?? "") === "23505";
    go(duplicate
      ? translate("Ce partenaire existe déjà pour cette ville et ce pays.", "This partner already exists for this city and country.")
      : translate("Le partenaire n’a pas pu être créé : ", "The partner could not be created: ") + (error?.message ?? "unknown error"), "error", "partners");
  }

  await audit({
    organizationId: membership.organization_id,
    entityType: "partner",
    entityId: created.id,
    actorId: user.id,
    action: "partner_created",
    newStatus: status,
    details: {name, partnerType, country, city},
    admin,
  });

  revalidatePath("/dashboard/vip/benefits");
  go(translate("Partenaire VIP ajouté.", "VIP partner added."), "success", "partners");
}

export async function saveVipBenefitAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipOperationalRole} = await getContext();
  if (!VIP_BENEFIT_ROLES.has(membership.role) && !hasVipOperationalRole) {
    go(translate("Tu n’as pas l’autorisation de gérer les avantages VIP.", "You are not allowed to manage VIP benefits."), "error", "benefits");
  }

  const benefitId = text(formData.get("benefitId"), 80);
  const partnerId = text(formData.get("partnerId"), 80) || null;
  const title = text(formData.get("title"), 220);
  const description = text(formData.get("description"), 5000);
  const benefitType = text(formData.get("benefitType"), 60);
  const eligibilityScope = text(formData.get("eligibilityScope"), 60) || "active_members";
  const redemptionInstructions = text(formData.get("redemptionInstructions"), 5000);
  const validFrom = dateValue(formData.get("validFrom")) || null;
  const validUntil = dateValue(formData.get("validUntil")) || null;
  const status = text(formData.get("status"), 40) || "draft";

  if (title.length < 3 || description.length < 5 || redemptionInstructions.length < 3 || !BENEFIT_TYPES.has(benefitType) || !ELIGIBILITY_SCOPES.has(eligibilityScope) || !BENEFIT_STATUSES.has(status)) {
    go(translate("Vérifie le titre, la description, le type, l’éligibilité et les instructions.", "Check the title, description, type, eligibility and instructions."), "error", "benefits");
  }
  if (validFrom && validUntil && validUntil < validFrom) {
    go(translate("La date de fin de l’avantage ne peut pas précéder la date de début.", "The benefit end date cannot be before the start date."), "error", "benefits");
  }

  if (partnerId) {
    const {data: partner} = await admin
      .from("vip_partners")
      .select("id")
      .eq("id", partnerId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string}>();
    if (!partner) go(translate("Le partenaire sélectionné est introuvable.", "The selected partner was not found."), "error", "benefits");
  }

  const payload = {
    partner_id: partnerId,
    title,
    description,
    benefit_type: benefitType,
    value_label: text(formData.get("valueLabel"), 180) || null,
    country: text(formData.get("country"), 120) || null,
    city: text(formData.get("city"), 120) || null,
    eligibility_scope: eligibilityScope,
    eligible_categories: stringList(formData.get("eligibleCategories")),
    redemption_instructions: redemptionInstructions,
    terms_and_conditions: text(formData.get("termsAndConditions"), 8000) || null,
    valid_from: validFrom,
    valid_until: validUntil,
    status,
    requires_approval: formData.get("requiresApproval") === "yes",
    usage_limit_per_member: integerValue(formData.get("usageLimitPerMember")),
    total_usage_limit: integerValue(formData.get("totalUsageLimit")),
    guest_allowed: formData.get("guestAllowed") === "on",
    transferable: formData.get("transferable") === "on",
    updated_by: user.id,
  };

  if (benefitId) {
    const {data: current, error: currentError} = await admin
      .from("vip_benefits")
      .select("id,status,title")
      .eq("id", benefitId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string; status: string; title: string}>();
    if (currentError || !current) go(translate("Avantage introuvable.", "Benefit not found."), "error", "benefits");

    const {error} = await admin
      .from("vip_benefits")
      .update(payload)
      .eq("id", benefitId)
      .eq("organization_id", membership.organization_id);
    if (error) go(translate("L’avantage n’a pas pu être mis à jour : ", "The benefit could not be updated: ") + error.message, "error", "benefits");

    await audit({
      organizationId: membership.organization_id,
      entityType: "benefit",
      entityId: benefitId,
      actorId: user.id,
      action: current.status === status ? "benefit_updated" : "benefit_status_changed",
      previousStatus: current.status,
      newStatus: status,
      details: {title, benefitType, eligibilityScope, partnerId, previousTitle: current.title},
      admin,
    });
    revalidatePath("/dashboard/vip/benefits");
    go(translate("Avantage VIP mis à jour.", "VIP benefit updated."), "success", "benefits");
  }

  const {data: created, error} = await admin
    .from("vip_benefits")
    .insert({organization_id: membership.organization_id, ...payload, created_by: user.id})
    .select("id")
    .single<{id: string}>();
  if (error || !created) go(translate("L’avantage n’a pas pu être créé : ", "The benefit could not be created: ") + (error?.message ?? "unknown error"), "error", "benefits");

  await audit({
    organizationId: membership.organization_id,
    entityType: "benefit",
    entityId: created.id,
    actorId: user.id,
    action: "benefit_created",
    newStatus: status,
    details: {title, benefitType, eligibilityScope, partnerId},
    admin,
  });

  revalidatePath("/dashboard/vip/benefits");
  go(translate("Avantage VIP créé.", "VIP benefit created."), "success", "benefits");
}

export async function duplicateVipBenefitAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipOperationalRole} = await getContext();
  if (!VIP_BENEFIT_ROLES.has(membership.role) && !hasVipOperationalRole) {
    go(translate("Tu n’as pas l’autorisation de dupliquer les avantages VIP.", "You are not allowed to duplicate VIP benefits."), "error", "benefits");
  }

  const benefitId = text(formData.get("benefitId"), 80);
  const {data: current, error} = await admin
    .from("vip_benefits")
    .select("partner_id,title,description,benefit_type,value_label,country,city,eligibility_scope,eligible_categories,redemption_instructions,terms_and_conditions,valid_from,valid_until,requires_approval,usage_limit_per_member,total_usage_limit,guest_allowed,transferable")
    .eq("id", benefitId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();
  if (error || !current) go(translate("Avantage introuvable.", "Benefit not found."), "error", "benefits");

  const copyTitle = `${current.title} ${translate("— Copie", "— Copy")}`.slice(0, 220);
  const {data: created, error: createError} = await admin
    .from("vip_benefits")
    .insert({
      organization_id: membership.organization_id,
      ...current,
      title: copyTitle,
      status: "draft",
      seed_code: null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single<{id: string}>();
  if (createError || !created) go(translate("La copie n’a pas pu être créée : ", "The copy could not be created: ") + (createError?.message ?? "unknown error"), "error", "benefits");

  await audit({
    organizationId: membership.organization_id,
    entityType: "benefit",
    entityId: created.id,
    actorId: user.id,
    action: "benefit_created",
    newStatus: "draft",
    details: {duplicatedFrom: benefitId, title: copyTitle},
    admin,
  });
  revalidatePath("/dashboard/vip/benefits");
  go(translate("Avantage dupliqué en brouillon.", "Benefit duplicated as a draft."), "success", "benefits");
}

export async function setVipBenefitStatusAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipOperationalRole} = await getContext();
  if (!VIP_BENEFIT_ROLES.has(membership.role) && !hasVipOperationalRole) {
    go(translate("Tu n’as pas l’autorisation de modifier le statut des avantages VIP.", "You are not allowed to change VIP benefit status."), "error", "benefits");
  }

  const benefitId = text(formData.get("benefitId"), 80);
  const status = text(formData.get("status"), 40);
  if (!benefitId || !BENEFIT_STATUSES.has(status)) go(translate("Statut invalide.", "Invalid status."), "error", "benefits");

  const {data: current, error: currentError} = await admin
    .from("vip_benefits")
    .select("id,status,title")
    .eq("id", benefitId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string; title: string}>();
  if (currentError || !current) go(translate("Avantage introuvable.", "Benefit not found."), "error", "benefits");

  const {error} = await admin
    .from("vip_benefits")
    .update({status, updated_by: user.id})
    .eq("id", benefitId)
    .eq("organization_id", membership.organization_id);
  if (error) go(translate("Le statut n’a pas pu être modifié : ", "The status could not be changed: ") + error.message, "error", "benefits");

  await audit({
    organizationId: membership.organization_id,
    entityType: "benefit",
    entityId: benefitId,
    actorId: user.id,
    action: "benefit_status_changed",
    previousStatus: current.status,
    newStatus: status,
    details: {title: current.title},
    admin,
  });
  revalidatePath("/dashboard/vip/benefits");
  go(translate("Statut de l’avantage mis à jour.", "Benefit status updated."), "success", "benefits");
}

function memberIsEligible(member: {member_type: string; recognition_category: string; status: string}, benefit: {eligibility_scope: string; eligible_categories: string[]}) {
  const statusAllowed = ["active", "honorary", "pending_renewal"].includes(member.status);
  if (!statusAllowed) return false;
  if (benefit.eligibility_scope === "honorary_only" && member.status !== "honorary") return false;
  if (benefit.eligibility_scope === "internal_only" && member.member_type !== "internal") return false;
  if (benefit.eligibility_scope === "external_only" && member.member_type !== "external") return false;
  if (benefit.eligible_categories.length > 0 && !benefit.eligible_categories.includes(member.recognition_category)) return false;
  return true;
}

export async function createVipBenefitRedemptionAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipOperationalRole} = await getContext();
  if (!VIP_OPERATIONS_ROLES.has(membership.role) && !hasVipOperationalRole) {
    go(translate("Tu n’as pas l’autorisation d’enregistrer une utilisation d’avantage.", "You are not allowed to record a benefit redemption."), "error", "redemptions");
  }

  const benefitId = text(formData.get("benefitId"), 80);
  const memberId = text(formData.get("memberId"), 80);
  if (!benefitId || !memberId) go(translate("Sélectionne un membre et un avantage.", "Select a member and a benefit."), "error", "redemptions");

  const [benefitResult, memberResult] = await Promise.all([
    admin
      .from("vip_benefits")
      .select("id,title,status,valid_from,valid_until,requires_approval,eligibility_scope,eligible_categories,usage_limit_per_member,total_usage_limit")
      .eq("id", benefitId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string; title: string; status: string; valid_from: string | null; valid_until: string | null; requires_approval: boolean; eligibility_scope: string; eligible_categories: string[]; usage_limit_per_member: number | null; total_usage_limit: number | null}>(),
    admin
      .from("vip_members")
      .select("id,full_name,member_type,recognition_category,status")
      .eq("id", memberId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string; full_name: string; member_type: string; recognition_category: string; status: string}>(),
  ]);
  if (benefitResult.error || !benefitResult.data) go(translate("Avantage introuvable.", "Benefit not found."), "error", "redemptions");
  if (memberResult.error || !memberResult.data) go(translate("Membre VIP introuvable.", "VIP member not found."), "error", "redemptions");

  const benefit = benefitResult.data;
  const member = memberResult.data;
  const today = new Date().toISOString().slice(0, 10);
  if (benefit.status !== "active" || (benefit.valid_from && today < benefit.valid_from) || (benefit.valid_until && today > benefit.valid_until)) {
    go(translate("Cet avantage n’est pas actif ou n’est pas dans sa période de validité.", "This benefit is not active or is outside its validity period."), "error", "redemptions");
  }
  if (!memberIsEligible(member, benefit)) {
    go(translate("Ce membre ne remplit pas les critères de cet avantage.", "This member does not meet the eligibility criteria for this benefit."), "error", "redemptions");
  }

  const [memberUsageResult, totalUsageResult] = await Promise.all([
    admin
      .from("vip_benefit_redemptions")
      .select("id", {head: true, count: "exact"})
      .eq("organization_id", membership.organization_id)
      .eq("benefit_id", benefitId)
      .eq("member_id", memberId)
      .in("status", ["approved", "redeemed"]),
    admin
      .from("vip_benefit_redemptions")
      .select("id", {head: true, count: "exact"})
      .eq("organization_id", membership.organization_id)
      .eq("benefit_id", benefitId)
      .in("status", ["approved", "redeemed"]),
  ]);
  if (memberUsageResult.error || totalUsageResult.error) go(translate("Impossible de vérifier les limites d’utilisation.", "Unable to verify usage limits."), "error", "redemptions");
  if (benefit.usage_limit_per_member && (memberUsageResult.count ?? 0) >= benefit.usage_limit_per_member) {
    go(translate("Ce membre a déjà atteint sa limite d’utilisation pour cet avantage.", "This member has already reached the usage limit for this benefit."), "error", "redemptions");
  }
  if (benefit.total_usage_limit && (totalUsageResult.count ?? 0) >= benefit.total_usage_limit) {
    go(translate("La limite globale de cet avantage est atteinte.", "The total limit for this benefit has been reached."), "error", "redemptions");
  }

  const initialStatus = benefit.requires_approval ? "requested" : "approved";
  const now = new Date().toISOString();
  const {data: created, error} = await admin
    .from("vip_benefit_redemptions")
    .insert({
      organization_id: membership.organization_id,
      benefit_id: benefitId,
      member_id: memberId,
      status: initialStatus,
      request_notes: text(formData.get("requestNotes"), 3000) || null,
      requested_by: user.id,
      approved_by: benefit.requires_approval ? null : user.id,
      approved_at: benefit.requires_approval ? null : now,
      updated_by: user.id,
    })
    .select("id,reference_number")
    .single<{id: string; reference_number: string}>();
  if (error || !created) go(translate("La demande d’avantage n’a pas pu être créée : ", "The benefit request could not be created: ") + (error?.message ?? "unknown error"), "error", "redemptions");

  await audit({
    organizationId: membership.organization_id,
    entityType: "benefit_redemption",
    entityId: created.id,
    actorId: user.id,
    action: benefit.requires_approval ? "benefit_redemption_requested" : "benefit_redemption_approved",
    newStatus: initialStatus,
    details: {benefitId, benefitTitle: benefit.title, memberId, memberName: member.full_name, referenceNumber: created.reference_number},
    admin,
  });

  revalidatePath("/dashboard/vip/benefits");
  go(benefit.requires_approval
    ? translate("Demande d’avantage enregistrée pour approbation.", "Benefit request recorded for approval.")
    : translate("Avantage approuvé automatiquement.", "Benefit approved automatically."), "success", "redemptions");
}

export async function updateVipBenefitRedemptionAction(formData: FormData) {
  const {user, membership, admin, translate, hasVipOperationalRole} = await getContext();
  const redemptionId = text(formData.get("redemptionId"), 80);
  const nextStatus = text(formData.get("nextStatus"), 40);
  if (!REDEMPTION_STATUSES.has(nextStatus)) go(translate("Statut d’utilisation invalide.", "Invalid redemption status."), "error", "redemptions");

  if (["approved", "rejected"].includes(nextStatus) && !VIP_DECISION_ROLES.has(membership.role) && !hasVipOperationalRole) {
    go(translate("Seuls les décideurs VIP peuvent approuver ou refuser cette demande.", "Only VIP decision-makers can approve or reject this request."), "error", "redemptions");
  }
  if (["redeemed", "cancelled"].includes(nextStatus) && !VIP_ROLES.has(membership.role) && !hasVipOperationalRole) {
    go(translate("Tu n’as pas l’autorisation de modifier cette utilisation.", "You are not allowed to update this redemption."), "error", "redemptions");
  }

  const {data: current, error: currentError} = await admin
    .from("vip_benefit_redemptions")
    .select("id,status,benefit_id,member_id,approved_by,approved_at")
    .eq("id", redemptionId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string; benefit_id: string; member_id: string; approved_by: string | null; approved_at: string | null}>();
  if (currentError || !current) go(translate("Demande d’avantage introuvable.", "Benefit request not found."), "error", "redemptions");

  const allowedTransitions: Record<string, string[]> = {
    requested: ["approved", "rejected", "cancelled"],
    approved: ["redeemed", "cancelled"],
    redeemed: [],
    rejected: [],
    cancelled: [],
  };
  if (!(allowedTransitions[current.status] ?? []).includes(nextStatus)) {
    go(translate("Cette transition de statut n’est pas autorisée.", "This status transition is not allowed."), "error", "redemptions");
  }

  if (nextStatus === "approved") {
    const {data: benefit} = await admin
      .from("vip_benefits")
      .select("usage_limit_per_member,total_usage_limit")
      .eq("id", current.benefit_id)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{usage_limit_per_member: number | null; total_usage_limit: number | null}>();
    if (!benefit) go(translate("Avantage introuvable.", "Benefit not found."), "error", "redemptions");

    const [memberUsage, totalUsage] = await Promise.all([
      admin
        .from("vip_benefit_redemptions")
        .select("id", {head: true, count: "exact"})
        .eq("organization_id", membership.organization_id)
        .eq("benefit_id", current.benefit_id)
        .eq("member_id", current.member_id)
        .in("status", ["approved", "redeemed"]),
      admin
        .from("vip_benefit_redemptions")
        .select("id", {head: true, count: "exact"})
        .eq("organization_id", membership.organization_id)
        .eq("benefit_id", current.benefit_id)
        .in("status", ["approved", "redeemed"]),
    ]);
    if (memberUsage.error || totalUsage.error) go(translate("Impossible de vérifier les limites d’utilisation.", "Unable to verify usage limits."), "error", "redemptions");
    if (benefit.usage_limit_per_member && (memberUsage.count ?? 0) >= benefit.usage_limit_per_member) {
      go(translate("La limite de ce membre est déjà atteinte.", "This member's limit has already been reached."), "error", "redemptions");
    }
    if (benefit.total_usage_limit && (totalUsage.count ?? 0) >= benefit.total_usage_limit) {
      go(translate("La limite globale est déjà atteinte.", "The total limit has already been reached."), "error", "redemptions");
    }
  }

  const now = new Date().toISOString();
  const updates = {
    status: nextStatus,
    approved_by: nextStatus === "approved" ? user.id : current.approved_by,
    approved_at: nextStatus === "approved" ? now : current.approved_at,
    redeemed_at: nextStatus === "redeemed" ? now : null,
    partner_reference: text(formData.get("partnerReference"), 220) || null,
    value_realized: decimalValue(formData.get("valueRealized")),
    decision_notes: text(formData.get("decisionNotes"), 4000) || null,
    updated_by: user.id,
  };

  const {error} = await admin
    .from("vip_benefit_redemptions")
    .update(updates)
    .eq("id", redemptionId)
    .eq("organization_id", membership.organization_id);
  if (error) go(translate("La demande n’a pas pu être mise à jour : ", "The request could not be updated: ") + error.message, "error", "redemptions");

  const action = nextStatus === "approved"
    ? "benefit_redemption_approved"
    : nextStatus === "rejected"
      ? "benefit_redemption_rejected"
      : nextStatus === "redeemed"
        ? "benefit_redeemed"
        : "benefit_redemption_cancelled";

  await audit({
    organizationId: membership.organization_id,
    entityType: "benefit_redemption",
    entityId: redemptionId,
    actorId: user.id,
    action,
    previousStatus: current.status,
    newStatus: nextStatus,
    details: {partnerReference: updates.partner_reference, valueRealized: updates.value_realized},
    admin,
  });

  revalidatePath("/dashboard/vip/benefits");
  go(translate("Utilisation de l’avantage mise à jour.", "Benefit redemption updated."), "success", "redemptions");
}
