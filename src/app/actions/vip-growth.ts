"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const VIP_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const CHANNELS = new Set([
  "referral", "private_event", "masterclass", "meta", "linkedin", "whatsapp",
  "partner", "ambassador", "sales", "personal_invitation", "other",
]);
const CAMPAIGN_STATUSES = new Set(["planned", "active", "paused", "completed", "cancelled"]);
const PROSPECT_STAGES = new Set(["new", "qualified", "invited", "application", "approved", "payment_pending", "member", "lost"]);

function text(value: FormDataEntryValue | null, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function money(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
}

function integer(value: FormDataEntryValue | null, max = 1_000_000) {
  const parsed = Math.trunc(Number(value ?? 0));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : 0;
}

function email(value: FormDataEntryValue | null) {
  const result = text(value, 254).toLowerCase();
  if (!result) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : "";
}

function phone(value: FormDataEntryValue | null) {
  const result = text(value, 60);
  return result || null;
}

function currency(value: FormDataEntryValue | null) {
  const result = text(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(result) ? result : "USD";
}

function date(value: FormDataEntryValue | null) {
  const result = text(value, 10);
  if (!result) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function datetime(value: FormDataEntryValue | null) {
  const result = text(value, 40);
  if (!result) return null;
  const parsed = new Date(result);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/vip/growth?${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");

  const {data: settings} = await admin
    .from("vip_program_settings")
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_growth_membership_manager_user_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{
      vip_manager_user_id: string | null;
      vip_assistant_manager_user_id: string | null;
      vip_growth_membership_manager_user_id: string | null;
    }>();

  const assigned = [
    settings?.vip_manager_user_id,
    settings?.vip_assistant_manager_user_id,
    settings?.vip_growth_membership_manager_user_id,
  ].includes(authData.user.id);

  if (!VIP_ROLES.has(membership.role) && !assigned) redirect("/dashboard/my-day");
  return {user: authData.user, membership, admin, governance: settings};
}

async function ensureActiveOrganizationMember(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  userId: string | null,
) {
  if (!userId) return true;
  const {data} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle<{user_id: string}>();
  return Boolean(data);
}

async function audit(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  actorId: string,
  entityType: "campaign" | "prospect" | "settings",
  action: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  const {error} = await admin.from("vip_growth_audit_log").insert({
    organization_id: organizationId,
    actor_id: actorId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    details,
  });
  if (error) console.error("VIP growth audit failed", error);
}

export async function updateVipGrowthSettingsAction(formData: FormData) {
  const {user, membership, admin, governance} = await getContext();
  const canManageSteering = ["owner", "admin"].includes(membership.role) || governance?.vip_manager_user_id === user.id;
  if (!canManageSteering) {
    go("Seuls le propriétaire, un administrateur ou le VIP Manager peuvent modifier le produit Finance, la devise et les objectifs globaux VIP.", "error");
  }
  const productId = text(formData.get("vipMembershipProductId"), 80) || null;
  const targetMembers = integer(formData.get("targetMembers"), 100_000);
  const targetRevenue = money(formData.get("targetRevenue"));
  const targetCurrency = currency(formData.get("currency"));

  if (productId) {
    const {data: product} = await admin
      .from("sales_products")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .eq("id", productId)
      .maybeSingle<{id: string}>();
    if (!product) go("Le produit d’adhésion VIP sélectionné n’appartient pas à cette organisation.", "error");
  }

  const {error} = await admin.from("vip_program_settings").upsert({
    organization_id: membership.organization_id,
    vip_membership_product_id: productId,
    vip_growth_target_members_month: targetMembers,
    vip_growth_target_revenue_month: targetRevenue,
    vip_growth_default_currency: targetCurrency,
    updated_by: user.id,
  }, {onConflict: "organization_id"});

  if (error) go(`Paramètres non enregistrés : ${error.message}`, "error");
  await audit(admin, membership.organization_id, user.id, "settings", "growth_targets_updated", null, {
    productId, targetMembers, targetRevenue, targetCurrency,
  });
  revalidatePath("/dashboard/vip/growth");
  go("Objectifs commerciaux VIP enregistrés.");
}

export async function createVipGrowthCampaignAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const name = text(formData.get("name"), 180);
  const channel = text(formData.get("channel"), 40);
  const ownerUserId = text(formData.get("ownerUserId"), 80) || user.id;
  const startsOn = date(formData.get("startsOn"));
  const endsOn = date(formData.get("endsOn"));

  if (name.length < 2 || !CHANNELS.has(channel)) go("Complète le nom et le canal de la campagne.", "error");
  if (startsOn && endsOn && endsOn < startsOn) go("La date de fin doit être postérieure à la date de début.", "error");
  if (!(await ensureActiveOrganizationMember(admin, membership.organization_id, ownerUserId))) {
    go("Le responsable de campagne sélectionné n’est pas un membre actif.", "error");
  }

  const {data: created, error} = await admin.from("vip_growth_campaigns").insert({
    organization_id: membership.organization_id,
    name,
    objective: text(formData.get("objective"), 1500) || null,
    channel,
    country: text(formData.get("country"), 120) || null,
    segment: text(formData.get("segment"), 180) || null,
    budget_amount: money(formData.get("budgetAmount")),
    spent_amount: money(formData.get("spentAmount")),
    currency: currency(formData.get("currency")),
    target_leads: integer(formData.get("targetLeads")),
    target_members: integer(formData.get("targetMembers")),
    starts_on: startsOn,
    ends_on: endsOn,
    status: "planned",
    owner_user_id: ownerUserId,
    notes: text(formData.get("notes"), 3000) || null,
    created_by: user.id,
    updated_by: user.id,
  }).select("id").single<{id: string}>();

  if (error || !created) go(`Campagne non créée : ${error?.message ?? "erreur inconnue"}`, "error");
  await audit(admin, membership.organization_id, user.id, "campaign", "campaign_created", created.id, {name, channel});
  revalidatePath("/dashboard/vip/growth");
  go("Campagne VIP créée.");
}


export async function updateVipGrowthCampaignSpendAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const campaignId = text(formData.get("campaignId"), 80);
  const spentAmount = money(formData.get("spentAmount"));
  if (!campaignId) go("Campagne invalide.", "error");

  const {data: campaign} = await admin.from("vip_growth_campaigns")
    .select("id,spent_amount")
    .eq("organization_id", membership.organization_id)
    .eq("id", campaignId)
    .maybeSingle<{id: string; spent_amount: number | string}>();
  if (!campaign) go("Campagne introuvable.", "error");

  const {error} = await admin.from("vip_growth_campaigns")
    .update({spent_amount: spentAmount, updated_by: user.id})
    .eq("organization_id", membership.organization_id)
    .eq("id", campaignId);
  if (error) go(`Dépenses non mises à jour : ${error.message}`, "error");
  await audit(admin, membership.organization_id, user.id, "campaign", "campaign_spend_updated", campaignId, {from: numSafe(campaign.spent_amount), to: spentAmount});
  revalidatePath("/dashboard/vip/growth");
  go("Dépenses réelles de campagne mises à jour.");
}

function numSafe(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function updateVipGrowthCampaignStatusAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const campaignId = text(formData.get("campaignId"), 80);
  const status = text(formData.get("status"), 30);
  if (!campaignId || !CAMPAIGN_STATUSES.has(status)) go("Mise à jour de campagne invalide.", "error");

  const {data: campaign} = await admin.from("vip_growth_campaigns")
    .select("id,status")
    .eq("organization_id", membership.organization_id)
    .eq("id", campaignId)
    .maybeSingle<{id: string; status: string}>();
  if (!campaign) go("Campagne introuvable.", "error");

  const {error} = await admin.from("vip_growth_campaigns")
    .update({status, updated_by: user.id})
    .eq("organization_id", membership.organization_id)
    .eq("id", campaignId);
  if (error) go(`Campagne non mise à jour : ${error.message}`, "error");
  await audit(admin, membership.organization_id, user.id, "campaign", "campaign_status_changed", campaignId, {from: campaign.status, to: status});
  revalidatePath("/dashboard/vip/growth");
  go("Statut de campagne mis à jour.");
}

function crmSource(channel: string) {
  if (channel === "referral") return "referral";
  if (["private_event", "masterclass"].includes(channel)) return "event";
  if (["meta", "linkedin", "whatsapp"].includes(channel)) return "website";
  return "other";
}

function makeCrmReference() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `VIP-${timestamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function createVipGrowthProspectAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const fullName = text(formData.get("fullName"), 200);
  const emailAddress = email(formData.get("email"));
  const phoneNumber = phone(formData.get("phone"));
  const channel = text(formData.get("sourceChannel"), 40);
  const campaignId = text(formData.get("campaignId"), 80) || null;
  const ownerUserId = text(formData.get("ownerUserId"), 80) || user.id;
  const expectedValue = money(formData.get("expectedValue"));
  const expectedCurrency = currency(formData.get("currency"));

  if (fullName.length < 2 || emailAddress === "" || (!emailAddress && !phoneNumber) || !CHANNELS.has(channel)) {
    go("Ajoute un nom valide, un e-mail ou téléphone, et une source d’acquisition.", "error");
  }
  if (!(await ensureActiveOrganizationMember(admin, membership.organization_id, ownerUserId))) {
    go("Le responsable commercial sélectionné n’est pas un membre actif.", "error");
  }

  let campaignName: string | null = null;
  if (campaignId) {
    const {data: campaign} = await admin.from("vip_growth_campaigns")
      .select("id,name")
      .eq("organization_id", membership.organization_id)
      .eq("id", campaignId)
      .maybeSingle<{id: string; name: string}>();
    if (!campaign) go("La campagne sélectionnée est introuvable.", "error");
    campaignName = campaign.name;
  }

  let crmClientId: string | null = null;
  if (emailAddress) {
    const {data: existingByEmail} = await admin.from("crm_clients")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .ilike("email", emailAddress)
      .limit(1)
      .maybeSingle<{id: string}>();
    crmClientId = existingByEmail?.id ?? null;
  }
  if (!crmClientId && phoneNumber) {
    const {data: existingByPhone} = await admin.from("crm_clients")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .or(`phone.eq.${phoneNumber},whatsapp_phone.eq.${phoneNumber}`)
      .limit(1)
      .maybeSingle<{id: string}>();
    crmClientId = existingByPhone?.id ?? null;
  }

  if (!crmClientId) {
    const preferredLanguage = text(formData.get("preferredLanguage"), 2) === "en" ? "en" : "fr";
    const {data: createdClient, error: clientError} = await admin.from("crm_clients").insert({
      organization_id: membership.organization_id,
      reference: makeCrmReference(),
      full_name: fullName,
      email: emailAddress || null,
      phone: phoneNumber,
      whatsapp_phone: phoneNumber,
      country: text(formData.get("country"), 120) || null,
      preferred_language: preferredLanguage,
      preferred_feedback_channel: "email",
      feedback_opt_in: false,
      marketing_opt_in: false,
      do_not_contact: false,
      owner_id: ownerUserId,
      follow_up_owner_id: ownerUserId,
      source: crmSource(channel),
      source_detail: channel,
      campaign_name: campaignName,
      product_interest: "Super Leader VIP",
      estimated_budget: expectedValue || null,
      budget_currency: expectedCurrency,
      lead_priority: "high",
      lead_status: "new",
      status: "prospect",
      next_action: text(formData.get("nextAction"), 500) || null,
      next_action_at: datetime(formData.get("nextActionAt")),
      notes: text(formData.get("notes"), 3000) || null,
      created_by: user.id,
    }).select("id").single<{id: string}>();
    if (clientError || !createdClient) {
      go(`Prospect CRM non créé : ${clientError?.message ?? "erreur inconnue"}`, "error");
    }
    crmClientId = createdClient.id;
  }

  const {data: existingGrowth} = await admin.from("vip_growth_prospects")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("crm_client_id", crmClientId)
    .maybeSingle<{id: string}>();
  if (existingGrowth) go("Cette personne est déjà suivie dans le pipeline VIP.", "error");

  const {data: createdGrowth, error: growthError} = await admin.from("vip_growth_prospects").insert({
    organization_id: membership.organization_id,
    crm_client_id: crmClientId,
    campaign_id: campaignId,
    source_channel: channel,
    stage: "new",
    owner_user_id: ownerUserId,
    expected_value: expectedValue,
    currency: expectedCurrency,
    next_action: text(formData.get("nextAction"), 500) || null,
    next_action_at: datetime(formData.get("nextActionAt")),
    created_by: user.id,
    updated_by: user.id,
  }).select("id").single<{id: string}>();

  if (growthError || !createdGrowth) go(`Suivi VIP non créé : ${growthError?.message ?? "erreur inconnue"}`, "error");
  await admin.from("vip_growth_stage_history").insert({
    organization_id: membership.organization_id,
    prospect_id: createdGrowth.id,
    from_stage: null,
    to_stage: "new",
    changed_by: user.id,
    note: "VIP growth prospect created",
  });
  await audit(admin, membership.organization_id, user.id, "prospect", "prospect_created", createdGrowth.id, {crmClientId, campaignId, channel});
  revalidatePath("/dashboard/vip/growth");
  go("Prospect ajouté au pipeline Super Leader VIP.");
}

async function findOfficialLinks(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  crmClientId: string,
) {
  const {data: client} = await admin.from("crm_clients")
    .select("email,phone,full_name")
    .eq("organization_id", organizationId)
    .eq("id", crmClientId)
    .maybeSingle<{email: string | null; phone: string | null; full_name: string}>();
  if (!client) return {nominationId: null, memberId: null};

  let nominationId: string | null = null;
  let memberId: string | null = null;
  if (client.email) {
    const [{data: nomination}, {data: member}] = await Promise.all([
      admin.from("vip_nominations").select("id").eq("organization_id", organizationId).ilike("email", client.email).order("submitted_at", {ascending: false}).limit(1).maybeSingle<{id: string}>(),
      admin.from("vip_members").select("id").eq("organization_id", organizationId).ilike("email", client.email).not("status", "eq", "withdrawn").order("created_at", {ascending: false}).limit(1).maybeSingle<{id: string}>(),
    ]);
    nominationId = nomination?.id ?? null;
    memberId = member?.id ?? null;
  }
  if (!memberId && client.phone) {
    const {data: member} = await admin.from("vip_members").select("id")
      .eq("organization_id", organizationId)
      .eq("phone", client.phone)
      .not("status", "eq", "withdrawn")
      .order("created_at", {ascending: false})
      .limit(1)
      .maybeSingle<{id: string}>();
    memberId = member?.id ?? null;
  }
  return {nominationId, memberId};
}

export async function updateVipGrowthProspectStageAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const prospectId = text(formData.get("prospectId"), 80);
  const nextStage = text(formData.get("stage"), 30);
  const note = text(formData.get("note"), 1000) || null;
  const nextAction = text(formData.get("nextAction"), 500) || null;
  const nextActionAt = datetime(formData.get("nextActionAt"));
  const lostReason = nextStage === "lost" ? text(formData.get("lostReason"), 1000) : "";
  if (!prospectId || !PROSPECT_STAGES.has(nextStage)) go("Étape de pipeline invalide.", "error");
  if (nextStage === "lost" && lostReason.length < 2) go("Indique la raison de perte du prospect.", "error");

  const {data: prospect} = await admin.from("vip_growth_prospects")
    .select("id,crm_client_id,stage,invited_at,application_at,approved_at,converted_at")
    .eq("organization_id", membership.organization_id)
    .eq("id", prospectId)
    .maybeSingle<{
      id: string;
      crm_client_id: string;
      stage: string;
      invited_at: string | null;
      application_at: string | null;
      approved_at: string | null;
      converted_at: string | null;
    }>();
  if (!prospect) go("Prospect VIP introuvable.", "error");

  const official = await findOfficialLinks(admin, membership.organization_id, prospect.crm_client_id);
  if (nextStage === "member" && !official.memberId) {
    go("Impossible de marquer ce prospect comme membre : aucune adhésion VIP officielle correspondante n’a été trouvée.", "error");
  }

  const now = new Date().toISOString();
  const changes: Record<string, unknown> = {
    stage: nextStage,
    next_action: nextAction,
    next_action_at: nextActionAt,
    lost_reason: nextStage === "lost" ? lostReason : null,
    nomination_id: official.nominationId,
    member_id: official.memberId,
    updated_by: user.id,
  };
  if (nextStage === "invited" && !prospect.invited_at) changes.invited_at = now;
  if (nextStage === "application" && !prospect.application_at) changes.application_at = now;
  if (nextStage === "approved" && !prospect.approved_at) changes.approved_at = now;
  if (nextStage === "member" && !prospect.converted_at) changes.converted_at = now;

  const {error} = await admin.from("vip_growth_prospects")
    .update(changes)
    .eq("organization_id", membership.organization_id)
    .eq("id", prospectId);
  if (error) go(`Pipeline non mis à jour : ${error.message}`, "error");

  const crmLeadStatus: Record<string, string> = {
    new: "new",
    qualified: "qualified",
    invited: "contacted",
    application: "appointment",
    approved: "follow_up",
    payment_pending: "follow_up",
    member: "converted",
    lost: "lost",
  };
  const crmChanges: Record<string, unknown> = {
    lead_status: crmLeadStatus[nextStage] ?? "follow_up",
    next_action: nextAction,
    next_action_at: nextActionAt,
  };
  if (nextStage === "member") crmChanges.converted_at = now;
  await admin.from("crm_clients").update(crmChanges)
    .eq("organization_id", membership.organization_id)
    .eq("id", prospect.crm_client_id);

  await admin.from("vip_growth_stage_history").insert({
    organization_id: membership.organization_id,
    prospect_id: prospectId,
    from_stage: prospect.stage,
    to_stage: nextStage,
    changed_by: user.id,
    note,
  });
  await audit(admin, membership.organization_id, user.id, "prospect", "prospect_stage_changed", prospectId, {from: prospect.stage, to: nextStage, note});
  revalidatePath("/dashboard/vip/growth");
  revalidatePath("/dashboard/vip");
  revalidatePath("/dashboard/crm/prospects");
  go("Étape du prospect VIP mise à jour.");
}
