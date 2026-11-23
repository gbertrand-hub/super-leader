"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {VIP_COMMUNICATION_CHANNELS, VIP_SERVICE_TYPES} from "@/lib/vip/settings";

const SETTINGS_ROLES = new Set(["owner", "admin"]);

function text(value: FormDataEntryValue | null, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function integer(value: FormDataEntryValue | null, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function bool(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function redirectWith(message: string, kind: "success" | "error", view = "program"): never {
  const query = new URLSearchParams({view, [kind]: message});
  redirect(`/dashboard/vip/settings?${query.toString()}`);
}

async function getContext() {
  const {locale} = await getI18n();
  const translate = (fr: string, en: string) => locale === "fr" ? fr : en;
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
  if (!SETTINGS_ROLES.has(membership.role)) redirect("/dashboard/vip");
  return {user: authData.user, membership, admin, translate};
}

async function audit(input: {
  organizationId: string;
  entityType: "program_settings" | "recognition_category";
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
  if (error) console.error("VIP settings audit failed", error);
}

export async function saveVipProgramSettingsAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();

  const programName = text(formData.get("programName"), 120);
  const circleTitleFr = text(formData.get("circleTitleFr"), 180);
  const circleTitleEn = text(formData.get("circleTitleEn"), 180);
  const cardSubtitleFr = text(formData.get("cardSubtitleFr"), 180);
  const cardSubtitleEn = text(formData.get("cardSubtitleEn"), 180);
  const cardValidityMonths = integer(formData.get("cardValidityMonths"), 1, 60);
  const renewalGraceDays = integer(formData.get("renewalGraceDays"), 0, 365);
  const travelMinNoticeDays = integer(formData.get("travelMinNoticeDays"), 0, 365);
  const annualMeetingDefaultDurationDays = integer(formData.get("annualMeetingDefaultDurationDays"), 1, 60);
  const benefitDefaultApprovalMode = text(formData.get("benefitDefaultApprovalMode"), 20);
  const vipManagerUserId = text(formData.get("vipManagerUserId"), 80) || null;
  const vipAssistantManagerUserId = text(formData.get("vipAssistantManagerUserId"), 80) || null;
  const vipGrowthMembershipManagerUserId = text(formData.get("vipGrowthMembershipManagerUserId"), 80) || null;
  const vipCommunicationsAssistantUserId = text(formData.get("vipCommunicationsAssistantUserId"), 80) || null;
  const vipEventsTravelAssistantUserId = text(formData.get("vipEventsTravelAssistantUserId"), 80) || null;
  const vipBenefitsPartnersAssistantUserId = text(formData.get("vipBenefitsPartnersAssistantUserId"), 80) || null;
  const vipMembershipConciergeAssistantUserId = text(formData.get("vipMembershipConciergeAssistantUserId"), 80) || null;
  const vipOperationsEscalationHours = integer(formData.get("vipOperationsEscalationHours"), 1, 168);

  const allowedNoticeDays = new Set([365, 180, 120, 90, 60, 45, 30, 21, 14, 7, 3, 1]);
  const renewalNoticeDays = [...new Set(formData.getAll("renewalNoticeDays")
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => allowedNoticeDays.has(value)))]
    .sort((a, b) => b - a);
  const enabledTravelServices = formData.getAll("enabledTravelServices")
    .map(String)
    .filter((value) => (VIP_SERVICE_TYPES as readonly string[]).includes(value));
  const communicationDefaultChannels = formData.getAll("communicationDefaultChannels")
    .map(String)
    .filter((value) => (VIP_COMMUNICATION_CHANNELS as readonly string[]).includes(value));

  async function ensureActiveOrganizationMember(userId: string | null, labelFr: string, labelEn: string) {
    if (!userId) return;
    const {data: selectedMember} = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle<{user_id: string}>();
    if (!selectedMember) {
      redirectWith(translate(`${labelFr} doit être un membre actif de cette organisation.`, `${labelEn} must be an active member of this organization.`), "error");
    }
  }

  await ensureActiveOrganizationMember(vipManagerUserId, "Le VIP Manager", "The VIP Manager");
  await ensureActiveOrganizationMember(vipAssistantManagerUserId, "Le VIP Assistant Manager", "The VIP Assistant Manager");
  await ensureActiveOrganizationMember(vipGrowthMembershipManagerUserId, "Le Responsable Croissance & Adhésions VIP", "The VIP Growth & Membership Manager");
  await ensureActiveOrganizationMember(vipCommunicationsAssistantUserId, "L’assistant Communications VIP", "The VIP Communications Assistant");
  await ensureActiveOrganizationMember(vipEventsTravelAssistantUserId, "L’assistant Events & Travel VIP", "The VIP Events & Travel Assistant");
  await ensureActiveOrganizationMember(vipBenefitsPartnersAssistantUserId, "L’assistant Benefits & Partners VIP", "The VIP Benefits & Partners Assistant");
  await ensureActiveOrganizationMember(vipMembershipConciergeAssistantUserId, "L’assistant Membership & Concierge VIP", "The VIP Membership & Concierge Assistant");
  if (vipManagerUserId && vipAssistantManagerUserId && vipManagerUserId === vipAssistantManagerUserId) {
    redirectWith(translate("Le VIP Manager et le VIP Assistant Manager doivent être deux personnes différentes.", "The VIP Manager and VIP Assistant Manager must be different people."), "error");
  }

  if (
    programName.length < 3 || circleTitleFr.length < 3 || circleTitleEn.length < 3 ||
    cardSubtitleFr.length < 3 || cardSubtitleEn.length < 3 || cardValidityMonths === null ||
    renewalGraceDays === null || travelMinNoticeDays === null || annualMeetingDefaultDurationDays === null ||
    vipOperationsEscalationHours === null ||
    renewalNoticeDays.length === 0 || enabledTravelServices.length === 0 || communicationDefaultChannels.length === 0 ||
    !["manual", "automatic"].includes(benefitDefaultApprovalMode)
  ) {
    redirectWith(translate("Vérifie les paramètres saisis.", "Check the entered settings."), "error");
  }

  const payload = {
    organization_id: membership.organization_id,
    program_name: programName,
    circle_title_fr: circleTitleFr,
    circle_title_en: circleTitleEn,
    card_subtitle_fr: cardSubtitleFr,
    card_subtitle_en: cardSubtitleEn,
    card_validity_months: cardValidityMonths,
    renewal_notice_days: renewalNoticeDays,
    renewal_grace_days: renewalGraceDays,
    nomination_requires_evidence: bool(formData, "nominationRequiresEvidence"),
    nomination_requires_committee_approval: bool(formData, "nominationRequiresCommitteeApproval"),
    travel_min_notice_days: travelMinNoticeDays,
    require_travel_consent: bool(formData, "requireTravelConsent"),
    auto_assign_country_representative: bool(formData, "autoAssignCountryRepresentative"),
    enabled_travel_services: enabledTravelServices,
    annual_meeting_default_duration_days: annualMeetingDefaultDurationDays,
    benefit_default_approval_mode: benefitDefaultApprovalMode,
    vip_manager_user_id: vipManagerUserId,
    vip_manager_assigned_at: vipManagerUserId ? new Date().toISOString() : null,
    vip_manager_assigned_by: vipManagerUserId ? user.id : null,
    vip_assistant_manager_user_id: vipAssistantManagerUserId,
    vip_assistant_manager_assigned_at: vipAssistantManagerUserId ? new Date().toISOString() : null,
    vip_assistant_manager_assigned_by: vipAssistantManagerUserId ? user.id : null,
    vip_growth_membership_manager_user_id: vipGrowthMembershipManagerUserId,
    vip_communications_assistant_user_id: vipCommunicationsAssistantUserId,
    vip_events_travel_assistant_user_id: vipEventsTravelAssistantUserId,
    vip_benefits_partners_assistant_user_id: vipBenefitsPartnersAssistantUserId,
    vip_membership_concierge_assistant_user_id: vipMembershipConciergeAssistantUserId,
    vip_operations_require_backup_for_critical: bool(formData, "vipOperationsRequireBackupForCritical"),
    vip_operations_escalation_hours: vipOperationsEscalationHours,
    communication_default_channels: communicationDefaultChannels,
    public_card_verification_enabled: bool(formData, "publicCardVerificationEnabled"),
    member_portal_enabled: bool(formData, "memberPortalEnabled"),
    updated_by: user.id,
  };

  const {error} = await admin.from("vip_program_settings").upsert(payload, {onConflict: "organization_id"});
  if (error) redirectWith(translate("Enregistrement impossible : ", "Unable to save: ") + error.message, "error");

  await audit({
    organizationId: membership.organization_id,
    entityType: "program_settings",
    entityId: membership.organization_id,
    actorId: user.id,
    action: "program_settings_updated",
    details: {
      cardValidityMonths,
      renewalNoticeDays,
      travelMinNoticeDays,
      enabledTravelServices,
      communicationDefaultChannels,
      vipManagerUserId,
      vipAssistantManagerUserId,
      vipGrowthMembershipManagerUserId,
      vipCommunicationsAssistantUserId,
      vipEventsTravelAssistantUserId,
      vipBenefitsPartnersAssistantUserId,
      vipMembershipConciergeAssistantUserId,
      vipOperationsEscalationHours,
      vipOperationsRequireBackupForCritical: bool(formData, "vipOperationsRequireBackupForCritical"),
    },
    admin,
  });

  revalidatePath("/dashboard/vip/settings");
  revalidatePath("/dashboard/vip");
  redirectWith(translate("Paramètres VIP enregistrés.", "VIP settings saved."), "success");
}

export async function saveVipRecognitionCategoryAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  const categoryId = text(formData.get("categoryId"), 80);
  const rawCode = text(formData.get("code"), 50).toLowerCase();
  const requestedCode = rawCode.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const nameFr = text(formData.get("nameFr"), 140);
  const nameEn = text(formData.get("nameEn"), 140);
  const descriptionFr = text(formData.get("descriptionFr"), 1000) || null;
  const descriptionEn = text(formData.get("descriptionEn"), 1000) || null;
  const sortOrder = integer(formData.get("sortOrder"), 0, 9999);
  const isHonorary = bool(formData, "isHonorary");
  const isActive = bool(formData, "isActive");

  if (!/^[a-z][a-z0-9_]{1,49}$/.test(requestedCode) || nameFr.length < 2 || nameEn.length < 2 || sortOrder === null) {
    redirectWith(translate("Catégorie invalide.", "Invalid category."), "error", "categories");
  }

  if (categoryId) {
    const {data: current} = await admin
      .from("vip_recognition_categories")
      .select("id,code,is_active")
      .eq("id", categoryId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string; code: string; is_active: boolean}>();
    if (!current) redirectWith(translate("Catégorie introuvable.", "Category not found."), "error", "categories");

    const code = current.code;
    const {error} = await admin.from("vip_recognition_categories").update({
      name_fr: nameFr,
      name_en: nameEn,
      description_fr: descriptionFr,
      description_en: descriptionEn,
      is_honorary: isHonorary,
      is_active: isActive,
      sort_order: sortOrder,
      updated_by: user.id,
    }).eq("id", categoryId).eq("organization_id", membership.organization_id);
    if (error) redirectWith(translate("Mise à jour impossible : ", "Unable to update: ") + error.message, "error", "categories");

    await audit({
      organizationId: membership.organization_id,
      entityType: "recognition_category",
      entityId: categoryId,
      actorId: user.id,
      action: current.is_active === isActive ? "recognition_category_updated" : "recognition_category_status_changed",
      previousStatus: current.is_active ? "active" : "inactive",
      newStatus: isActive ? "active" : "inactive",
      details: {previousCode: current.code, code, nameFr, nameEn, isHonorary, sortOrder},
      admin,
    });
    revalidatePath("/dashboard/vip/settings");
    revalidatePath("/dashboard/vip");
    redirectWith(translate("Catégorie mise à jour.", "Category updated."), "success", "categories");
  }

  const {data: created, error} = await admin.from("vip_recognition_categories").insert({
    organization_id: membership.organization_id,
    code: requestedCode,
    name_fr: nameFr,
    name_en: nameEn,
    description_fr: descriptionFr,
    description_en: descriptionEn,
    is_honorary: isHonorary,
    is_active: isActive,
    sort_order: sortOrder,
    created_by: user.id,
    updated_by: user.id,
  }).select("id").single<{id: string}>();
  if (error || !created) redirectWith(translate("Création impossible : ", "Unable to create: ") + (error?.message ?? ""), "error", "categories");

  await audit({
    organizationId: membership.organization_id,
    entityType: "recognition_category",
    entityId: created.id,
    actorId: user.id,
    action: "recognition_category_created",
    newStatus: isActive ? "active" : "inactive",
    details: {code: requestedCode, nameFr, nameEn, isHonorary, sortOrder},
    admin,
  });
  revalidatePath("/dashboard/vip/settings");
  revalidatePath("/dashboard/vip");
  redirectWith(translate("Catégorie créée.", "Category created."), "success", "categories");
}
