"use server";

import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {getCrmPipelineText} from "@/i18n/crm-pipeline";
import {canManageCommercialData, canManageProducts, canUseCommercialModules} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {CRM_LOSS_REASONS, CRM_SOURCES, SECTOR_HANDOFF, type CrmSector} from "@/lib/crm/pipeline";
import {normalizeTimeZone} from "@/lib/timezone";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string};
type ClientRow = {id: string; owner_id: string | null; follow_up_owner_id: string | null; full_name: string};
type OpportunityRow = {
  id: string;
  organization_id: string;
  reference: string;
  client_id: string;
  product_id: string | null;
  sector: CrmSector;
  title: string;
  owner_id: string;
  stage_id: string;
  status: "open" | "won" | "lost" | "on_hold";
  next_action: string | null;
  next_action_at: string | null;
  first_payment_confirmed_at: string | null;
  handoff_status: "not_ready" | "ready" | "transferred";
  handoff_destination: string | null;
};
type StageRow = {id: string; sector: CrmSector; probability: number; stage_kind: "open" | "won" | "lost"; name_fr: string; name_en: string};

const currencies = new Set(["USD", "EUR", "GBP", "XAF", "CAD"]);
const fulfillmentDestinations = new Set(["real_estate", "academy", "livestock_operations", "collections", "other"]);

function text(value: FormDataEntryValue | null, max = 3000) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

function required(value: FormDataEntryValue | null, max = 3000) {
  return String(value ?? "").trim().slice(0, max);
}

function money(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : Number.NaN;
}

function dateValue(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function dateTimeValue(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function safeReturnTo(formData: FormData, fallback = "/dashboard/crm/pipeline") {
  const raw = String(formData.get("returnTo") ?? fallback).trim();
  return raw.startsWith("/dashboard/crm") ? raw : fallback;
}

function go(returnTo: string, message: string, kind: "success" | "error" = "success"): never {
  const separator = returnTo.includes("?") ? "&" : "?";
  redirect(`${returnTo}${separator}${kind}=${encodeURIComponent(message)}`);
}

function reference() {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `OPP-${stamp}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

async function context() {
  const {locale} = await getI18n();
  const copy = getCrmPipelineText(locale);
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
    .maybeSingle<Membership>();
  if (error) throw new Error(error.message);
  if (!membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "crm_sales");
  if (!canUseCommercialModules(membership.role)) redirect("/dashboard/performance?error=access-denied");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });

  return {admin, user: authData.user, membership, visibleUserIds, locale, copy};
}

function canAccessOpportunity(role: string, actorId: string, ownerId: string, visibleUserIds: string[]) {
  if (role === "owner" || role === "admin") return true;
  if (role === "manager") return visibleUserIds.includes(ownerId);
  return actorId === ownerId;
}

async function activeMember(admin: ReturnType<typeof createAdminClient>, organizationId: string, userId: string) {
  const {data} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}

async function activeSectorConfig(admin: ReturnType<typeof createAdminClient>, organizationId: string, sector: string) {
  if (!sector) return null;
  const {data} = await admin
    .from("crm_sectors")
    .select("code, fulfillment_destination")
    .eq("organization_id", organizationId)
    .eq("code", sector)
    .eq("is_active", true)
    .maybeSingle<{code: string; fulfillment_destination: string}>();
  return data ?? null;
}

async function audit(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  actorId: string,
  entityType: string,
  entityId: string | null,
  action: string,
  details: Record<string, unknown> = {},
) {
  await admin.from("crm_audit_log").insert({
    organization_id: organizationId,
    actor_id: actorId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    details,
  });
}

async function loadOpportunity(admin: ReturnType<typeof createAdminClient>, organizationId: string, opportunityId: string) {
  return admin
    .from("crm_opportunities")
    .select("id, organization_id, reference, client_id, product_id, sector, title, owner_id, stage_id, status, next_action, next_action_at, first_payment_confirmed_at, handoff_status, handoff_destination")
    .eq("organization_id", organizationId)
    .eq("id", opportunityId)
    .maybeSingle<OpportunityRow>();
}

async function loadStage(admin: ReturnType<typeof createAdminClient>, organizationId: string, stageId: string) {
  return admin
    .from("crm_pipeline_stages")
    .select("id, sector, probability, stage_kind, name_fr, name_en")
    .eq("organization_id", organizationId)
    .eq("id", stageId)
    .eq("is_active", true)
    .maybeSingle<StageRow>();
}

export async function createCrmProductAction(formData: FormData) {
  const {admin, user, membership, copy} = await context();
  const returnTo = safeReturnTo(formData, "/dashboard/crm/catalog");
  if (!canManageProducts(membership.role)) go(returnTo, copy.accessDenied, "error");

  const code = required(formData.get("code"), 60).toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
  const nameFr = required(formData.get("nameFr"), 160);
  const nameEn = text(formData.get("nameEn"), 160);
  const sector = String(formData.get("sector") ?? "") as CrmSector;
  const productType = required(formData.get("productType"), 80) || "standard";
  const currency = String(formData.get("currency") ?? "USD").toUpperCase();
  const basePrice = money(formData.get("basePrice"));
  const minimumType = String(formData.get("minimumFirstPaymentType") ?? "percentage");
  const minimumValue = money(formData.get("minimumFirstPaymentValue"));
  const commissionType = String(formData.get("commissionType") ?? "percentage");
  const commissionValue = money(formData.get("commissionValue"));
  const fulfillment = String(formData.get("fulfillmentDestination") ?? "collections");
  const sectorConfig = await activeSectorConfig(admin, membership.organization_id, sector);

  if (!code || nameFr.length < 2 || !sectorConfig || !currencies.has(currency)
    || !Number.isFinite(basePrice) || basePrice < 0 || !["percentage", "fixed"].includes(minimumType)
    || !Number.isFinite(minimumValue) || minimumValue < 0 || (minimumType === "percentage" && minimumValue > 100)
    || !["percentage", "fixed"].includes(commissionType) || !Number.isFinite(commissionValue) || commissionValue < 0
    || (commissionType === "percentage" && commissionValue > 100) || !fulfillmentDestinations.has(fulfillment)) {
    go(returnTo, copy.invalidData, "error");
  }

  const {data, error} = await admin.from("sales_products").insert({
    organization_id: membership.organization_id,
    code,
    name: nameFr,
    name_en: nameEn,
    sector,
    product_type: productType,
    description: text(formData.get("descriptionFr"), 1500),
    description_en: text(formData.get("descriptionEn"), 3000),
    currency,
    default_price: basePrice,
    minimum_first_payment_type: minimumType,
    minimum_first_payment_value: minimumValue,
    commission_type: commissionType,
    commission_value: commissionValue,
    fulfillment_destination: fulfillment,
    metadata: {},
    created_by: user.id,
    updated_by: user.id,
  }).select("id").single<{id: string}>();

  if (error || !data) go(returnTo, error?.message || copy.invalidData, "error");
  await audit(admin, membership.organization_id, user.id, "crm_product", data.id, "product_created", {sector, code});
  revalidatePath("/dashboard/crm/catalog");
  revalidatePath("/dashboard/crm/pipeline");
  go(returnTo, copy.productCreated);
}

export async function toggleCrmProductAction(formData: FormData) {
  const {admin, user, membership, copy} = await context();
  const returnTo = safeReturnTo(formData, "/dashboard/crm/catalog");
  if (!canManageProducts(membership.role)) go(returnTo, copy.accessDenied, "error");
  const productId = String(formData.get("productId") ?? "");
  const isActive = String(formData.get("isActive") ?? "false") === "true";
  const {error} = await admin.from("sales_products").update({is_active: isActive, updated_by: user.id})
    .eq("organization_id", membership.organization_id).eq("id", productId);
  if (error) go(returnTo, error.message, "error");
  await audit(admin, membership.organization_id, user.id, "crm_product", productId, isActive ? "product_activated" : "product_deactivated");
  revalidatePath("/dashboard/crm/catalog");
  revalidatePath("/dashboard/crm/pipeline");
  go(returnTo, copy.productUpdated);
}

export async function createCrmOpportunityAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds, copy} = await context();
  const returnTo = safeReturnTo(formData);
  const clientId = String(formData.get("clientId") ?? "");
  const productId = String(formData.get("productId") ?? "").trim() || null;
  const sector = String(formData.get("sector") ?? "") as CrmSector;
  const title = required(formData.get("title"), 220);
  const requestedOwner = String(formData.get("ownerId") ?? "").trim();
  const ownerId = canManageCommercialData(membership.role) ? (requestedOwner || user.id) : user.id;
  const source = String(formData.get("source") ?? "manual");
  const valueAmount = money(formData.get("valueAmount"));
  const currency = String(formData.get("currency") ?? "USD").toUpperCase();
  const expectedCloseDate = dateValue(formData.get("expectedCloseDate"));
  const nextAction = required(formData.get("nextAction"), 500);
  const nextActionAt = dateTimeValue(formData.get("nextActionAt"));
  const budgetAmountRaw = text(formData.get("budgetAmount"), 40);
  const budgetAmount = budgetAmountRaw ? money(formData.get("budgetAmount")) : null;
  const firstPaymentRaw = text(formData.get("firstPaymentExpected"), 40);
  const firstPaymentExpected = firstPaymentRaw ? money(formData.get("firstPaymentExpected")) : null;
  const firstPaymentDueDate = dateValue(formData.get("firstPaymentDueDate"));
  const sectorConfig = await activeSectorConfig(admin, membership.organization_id, sector);

  if (!clientId || !sectorConfig || title.length < 2 || !CRM_SOURCES.some((item) => item === source)
    || !currencies.has(currency) || !Number.isFinite(valueAmount) || valueAmount < 0 || !nextAction
    || !nextActionAt || nextActionAt === "" || expectedCloseDate === "" || firstPaymentDueDate === ""
    || (budgetAmount !== null && (!Number.isFinite(budgetAmount) || budgetAmount < 0))
    || (firstPaymentExpected !== null && (!Number.isFinite(firstPaymentExpected) || firstPaymentExpected < 0))) {
    go(returnTo, copy.invalidData, "error");
  }

  const {data: client} = await admin.from("crm_clients").select("id, owner_id, follow_up_owner_id, full_name")
    .eq("organization_id", membership.organization_id).eq("id", clientId).maybeSingle<ClientRow>();
  if (!client) go(returnTo, copy.invalidData, "error");
  if (membership.role === "manager") {
    const clientInScope = Boolean(
      (client.owner_id && visibleUserIds.includes(client.owner_id))
      || (client.follow_up_owner_id && visibleUserIds.includes(client.follow_up_owner_id))
      || (!client.owner_id && !client.follow_up_owner_id),
    );
    if (!clientInScope) go(returnTo, copy.accessDenied, "error");
  }
  if (membership.role === "employee" && client.owner_id !== user.id && client.follow_up_owner_id !== user.id) {
    go(returnTo, copy.accessDenied, "error");
  }
  if (!visibleUserIds.includes(ownerId) || !(await activeMember(admin, membership.organization_id, ownerId))) {
    go(returnTo, copy.accessDenied, "error");
  }

  let handoffDestination: string = sectorConfig.fulfillment_destination || SECTOR_HANDOFF[sector] || "other";
  if (productId) {
    const {data: product} = await admin.from("sales_products").select("id, sector, fulfillment_destination")
      .eq("organization_id", membership.organization_id).eq("id", productId).eq("is_active", true).maybeSingle<{id: string; sector: CrmSector; fulfillment_destination: string}>();
    if (!product || product.sector !== sector) go(returnTo, copy.productSectorMismatch, "error");
    if (fulfillmentDestinations.has(product.fulfillment_destination)) {
      handoffDestination = product.fulfillment_destination;
    }
  }

  const {data: firstStage} = await admin.from("crm_pipeline_stages")
    .select("id, probability")
    .eq("organization_id", membership.organization_id)
    .eq("sector", sector)
    .eq("stage_kind", "open")
    .eq("is_active", true)
    .order("position")
    .limit(1)
    .maybeSingle<{id: string; probability: number}>();
  if (!firstStage) go(returnTo, copy.migrationHelp, "error");

  const sectorDetails: Record<string, string> = {};
  for (let index = 0; index < 6; index += 1) {
    const detail = text(formData.get(`detail${index}`), 500);
    if (detail) sectorDetails[`field_${index + 1}`] = detail;
  }

  const {data: opportunity, error} = await admin.from("crm_opportunities").insert({
    organization_id: membership.organization_id,
    reference: reference(),
    client_id: clientId,
    product_id: productId,
    sector,
    title,
    owner_id: ownerId,
    stage_id: firstStage.id,
    status: "open",
    source,
    value_amount: valueAmount,
    currency,
    probability: firstStage.probability,
    expected_close_date: expectedCloseDate,
    need_summary: text(formData.get("needSummary"), 3000),
    budget_amount: budgetAmount,
    first_payment_expected: firstPaymentExpected,
    first_payment_due_date: firstPaymentDueDate,
    next_action: nextAction,
    next_action_at: nextActionAt,
    sector_details: sectorDetails,
    handoff_status: "not_ready",
    handoff_destination: handoffDestination,
    created_by: user.id,
    updated_by: user.id,
  }).select("id, reference").single<{id: string; reference: string}>();

  if (error || !opportunity) go(returnTo, error?.message || copy.invalidData, "error");
  await admin.from("crm_opportunity_stage_history").insert({
    organization_id: membership.organization_id,
    opportunity_id: opportunity.id,
    to_stage_id: firstStage.id,
    changed_by: user.id,
    note: "Opportunity created",
  });
  await admin.from("crm_clients").update({status: "prospect", owner_id: ownerId, follow_up_owner_id: ownerId})
    .eq("organization_id", membership.organization_id).eq("id", clientId).neq("status", "active");
  await audit(admin, membership.organization_id, user.id, "crm_opportunity", opportunity.id, "opportunity_created", {sector, reference: opportunity.reference});

  revalidatePath("/dashboard/crm");
  revalidatePath("/dashboard/crm/pipeline");
  revalidatePath("/dashboard/crm/my-sales-day");
  revalidatePath("/dashboard/crm/analytics");
  go(`/dashboard/crm/opportunities/${opportunity.id}`, copy.opportunityCreated);
}

export async function updateOpportunityNextActionAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds, copy} = await context();
  const returnTo = safeReturnTo(formData);
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const nextAction = required(formData.get("nextAction"), 500);
  const nextActionAt = dateTimeValue(formData.get("nextActionAt"));
  const expectedCloseDate = dateValue(formData.get("expectedCloseDate"));
  const {data: opportunity} = await loadOpportunity(admin, membership.organization_id, opportunityId);
  if (!opportunity || opportunity.status !== "open" || !canAccessOpportunity(membership.role, user.id, opportunity.owner_id, visibleUserIds)) go(returnTo, copy.accessDenied, "error");
  if (!nextAction || !nextActionAt || nextActionAt === "" || expectedCloseDate === "") go(returnTo, copy.nextActionRequired, "error");

  const {error} = await admin.from("crm_opportunities").update({
    next_action: nextAction,
    next_action_at: nextActionAt,
    expected_close_date: expectedCloseDate,
    need_summary: text(formData.get("needSummary"), 3000),
    updated_by: user.id,
  }).eq("organization_id", membership.organization_id).eq("id", opportunityId);
  if (error) go(returnTo, error.message, "error");
  await audit(admin, membership.organization_id, user.id, "crm_opportunity", opportunityId, "next_action_updated", {nextActionAt});
  revalidatePath("/dashboard/crm/pipeline");
  revalidatePath("/dashboard/crm/my-sales-day");
  revalidatePath(`/dashboard/crm/opportunities/${opportunityId}`);
  go(returnTo, copy.opportunityUpdated);
}

export async function moveCrmOpportunityStageAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds, locale, copy} = await context();
  const returnTo = safeReturnTo(formData);
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const stageId = String(formData.get("stageId") ?? "");
  const firstPaymentConfirmedAt = dateTimeValue(formData.get("firstPaymentConfirmedAt"));
  const {data: opportunity} = await loadOpportunity(admin, membership.organization_id, opportunityId);
  const {data: stage} = await loadStage(admin, membership.organization_id, stageId);
  if (!opportunity || opportunity.status !== "open" || !stage || opportunity.sector !== stage.sector || !canAccessOpportunity(membership.role, user.id, opportunity.owner_id, visibleUserIds)) {
    go(returnTo, copy.accessDenied, "error");
  }

  if (stage.stage_kind === "lost") go(returnTo, copy.lossReasonRequired, "error");
  if (stage.stage_kind === "open" && (!opportunity.next_action || !opportunity.next_action_at)) go(returnTo, copy.nextActionRequired, "error");
  if (stage.stage_kind === "won" && (!firstPaymentConfirmedAt || firstPaymentConfirmedAt === "")) go(returnTo, copy.firstPaymentRequired, "error");
  if (stage.stage_kind === "won" && new Date(firstPaymentConfirmedAt as string).getTime() > Date.now() + 300000) go(returnTo, copy.invalidData, "error");

  const status = stage.stage_kind === "won" ? "won" : "open";
  const updatePayload: Record<string, unknown> = {
    stage_id: stage.id,
    status,
    probability: stage.probability,
    updated_by: user.id,
  };
  if (stage.stage_kind === "won") {
    updatePayload.first_payment_confirmed_at = firstPaymentConfirmedAt;
    updatePayload.handoff_status = "ready";
    updatePayload.next_action = null;
    updatePayload.next_action_at = null;
  }

  const {error} = await admin.from("crm_opportunities").update(updatePayload)
    .eq("organization_id", membership.organization_id).eq("id", opportunityId);
  if (error) go(returnTo, error.message, "error");

  await admin.from("crm_opportunity_stage_history").insert({
    organization_id: membership.organization_id,
    opportunity_id: opportunityId,
    from_stage_id: opportunity.stage_id,
    to_stage_id: stage.id,
    changed_by: user.id,
    note: stage.stage_kind === "won" ? "First payment confirmed" : null,
  });
  if (stage.stage_kind === "won") {
    await admin.from("crm_clients").update({status: "active"})
      .eq("organization_id", membership.organization_id).eq("id", opportunity.client_id);
  }
  await audit(admin, membership.organization_id, user.id, "crm_opportunity", opportunityId, "stage_changed", {
    fromStageId: opportunity.stage_id,
    toStageId: stage.id,
    toStage: locale === "fr" ? stage.name_fr : stage.name_en,
  });
  revalidatePath("/dashboard/crm/pipeline");
  revalidatePath("/dashboard/crm/my-sales-day");
  revalidatePath("/dashboard/crm/analytics");
  revalidatePath(`/dashboard/crm/opportunities/${opportunityId}`);
  go(returnTo, copy.opportunityUpdated);
}

export async function closeLostCrmOpportunityAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds, copy} = await context();
  const returnTo = safeReturnTo(formData);
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const reason = String(formData.get("lossReason") ?? "");
  const notes = text(formData.get("lossNotes"), 3000);
  const {data: opportunity} = await loadOpportunity(admin, membership.organization_id, opportunityId);
  if (!opportunity || opportunity.status !== "open" || !canAccessOpportunity(membership.role, user.id, opportunity.owner_id, visibleUserIds)) go(returnTo, copy.accessDenied, "error");
  if (!CRM_LOSS_REASONS.some((item) => item === reason)) go(returnTo, copy.lossReasonRequired, "error");
  const {data: lostStage} = await admin.from("crm_pipeline_stages").select("id, probability")
    .eq("organization_id", membership.organization_id).eq("sector", opportunity.sector).eq("stage_kind", "lost").eq("is_active", true).limit(1).maybeSingle<{id: string; probability: number}>();
  if (!lostStage) go(returnTo, copy.migrationHelp, "error");
  const {error} = await admin.from("crm_opportunities").update({
    stage_id: lostStage.id,
    status: "lost",
    probability: 0,
    loss_reason: reason,
    loss_notes: notes,
    next_action: null,
    next_action_at: null,
    updated_by: user.id,
  }).eq("organization_id", membership.organization_id).eq("id", opportunityId);
  if (error) go(returnTo, error.message, "error");
  await admin.from("crm_opportunity_stage_history").insert({
    organization_id: membership.organization_id,
    opportunity_id: opportunityId,
    from_stage_id: opportunity.stage_id,
    to_stage_id: lostStage.id,
    changed_by: user.id,
    note: notes,
  });
  await audit(admin, membership.organization_id, user.id, "crm_opportunity", opportunityId, "opportunity_lost", {reason});
  revalidatePath("/dashboard/crm/pipeline");
  revalidatePath("/dashboard/crm/analytics");
  revalidatePath(`/dashboard/crm/opportunities/${opportunityId}`);
  go(returnTo, copy.opportunityUpdated);
}

export async function reopenCrmOpportunityAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds, copy} = await context();
  const returnTo = safeReturnTo(formData);
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const nextAction = required(formData.get("nextAction"), 500);
  const nextActionAt = dateTimeValue(formData.get("nextActionAt"));
  const {data: opportunity} = await loadOpportunity(admin, membership.organization_id, opportunityId);
  if (!opportunity || opportunity.status !== "lost" || !canAccessOpportunity(membership.role, user.id, opportunity.owner_id, visibleUserIds)) go(returnTo, copy.accessDenied, "error");
  if (!nextAction || !nextActionAt || nextActionAt === "") go(returnTo, copy.nextActionRequired, "error");
  const {data: firstStage} = await admin.from("crm_pipeline_stages").select("id, probability")
    .eq("organization_id", membership.organization_id).eq("sector", opportunity.sector).eq("stage_kind", "open").eq("is_active", true).order("position").limit(1).maybeSingle<{id: string; probability: number}>();
  if (!firstStage) go(returnTo, copy.migrationHelp, "error");
  const {error} = await admin.from("crm_opportunities").update({
    stage_id: firstStage.id,
    status: "open",
    probability: firstStage.probability,
    loss_reason: null,
    loss_notes: null,
    next_action: nextAction,
    next_action_at: nextActionAt,
    handoff_status: "not_ready",
    first_payment_confirmed_at: null,
    updated_by: user.id,
  }).eq("organization_id", membership.organization_id).eq("id", opportunityId);
  if (error) go(returnTo, error.message, "error");
  await admin.from("crm_opportunity_stage_history").insert({organization_id: membership.organization_id, opportunity_id: opportunityId, from_stage_id: opportunity.stage_id, to_stage_id: firstStage.id, changed_by: user.id, note: "Opportunity reopened"});
  await audit(admin, membership.organization_id, user.id, "crm_opportunity", opportunityId, "opportunity_reopened");
  revalidatePath("/dashboard/crm/pipeline");
  revalidatePath("/dashboard/crm/my-sales-day");
  revalidatePath(`/dashboard/crm/opportunities/${opportunityId}`);
  go(returnTo, copy.opportunityUpdated);
}

function zonedDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {timeZone: normalizeTimeZone(timezone), year: "numeric", month: "2-digit", day: "2-digit"}).format(date);
}

export async function addCrmOpportunityToDailyPlanAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds, copy, locale} = await context();
  const returnTo = safeReturnTo(formData, "/dashboard/crm/my-sales-day");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const {data: opportunity} = await loadOpportunity(admin, membership.organization_id, opportunityId);
  if (!opportunity || opportunity.status !== "open" || !canAccessOpportunity(membership.role, user.id, opportunity.owner_id, visibleUserIds)) go(returnTo, copy.accessDenied, "error");

  const [{data: schedule}, {data: performanceSettings}, {data: executionSettings}] = await Promise.all([
    admin.from("member_work_schedules").select("timezone").eq("organization_id", membership.organization_id).eq("user_id", user.id).eq("is_active", true).maybeSingle<{timezone: string}>(),
    admin.from("performance_settings").select("timezone").eq("organization_id", membership.organization_id).maybeSingle<{timezone: string}>(),
    admin.from("daily_execution_settings").select("minimum_tasks, maximum_tasks").eq("organization_id", membership.organization_id).maybeSingle<{minimum_tasks: number; maximum_tasks: number}>(),
  ]);
  const timezone = normalizeTimeZone(schedule?.timezone || performanceSettings?.timezone || "UTC");
  const today = zonedDate(new Date(), timezone);
  const minimumTasks = executionSettings?.minimum_tasks ?? 6;
  const maximumTasks = executionSettings?.maximum_tasks ?? 12;

  let {data: plan} = await admin.from("daily_work_plans").select("id, status")
    .eq("organization_id", membership.organization_id).eq("user_id", user.id).eq("work_date", today).maybeSingle<{id: string; status: string}>();
  if (!plan) {
    const {data: created, error} = await admin.from("daily_work_plans").insert({
      organization_id: membership.organization_id,
      user_id: user.id,
      work_date: today,
      status: "draft",
      minimum_tasks_snapshot: minimumTasks,
      created_by: user.id,
      updated_by: user.id,
    }).select("id, status").single<{id: string; status: string}>();
    if (error || !created) go(returnTo, error?.message || copy.invalidData, "error");
    plan = created;
  }
  if (["locked", "completed"].includes(plan.status)) go(returnTo, copy.accessDenied, "error");

  const {data: tasks} = await admin.from("daily_work_tasks").select("id, position, title, expected_outcome")
    .eq("plan_id", plan.id).order("position");
  const existing = tasks ?? [];
  if (existing.length >= maximumTasks) go(returnTo, copy.maxDailyTasks, "error");
  if (existing.some((item) => item.expected_outcome?.includes(opportunity.reference))) go(returnTo, copy.priorityAdded);
  const used = new Set(existing.map((item) => Number(item.position)));
  let position = 1;
  while (used.has(position) && position <= maximumTasks) position += 1;

  const {data: client} = await admin.from("crm_clients").select("full_name").eq("id", opportunity.client_id).maybeSingle<{full_name: string}>();
  const action = opportunity.next_action || (locale === "fr" ? "Relancer le prospect" : "Follow up with the prospect");
  const taskTitle = `CRM: ${action} - ${client?.full_name || opportunity.title}`.slice(0, 240);
  const expectedOutcome = locale === "fr"
    ? `Faire avancer l'opportunite ${opportunity.reference} (${opportunity.title}) et enregistrer le resultat dans le CRM.`
    : `Advance opportunity ${opportunity.reference} (${opportunity.title}) and record the outcome in the CRM.`;
  const dueTime = opportunity.next_action_at ? new Date(opportunity.next_action_at).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone}) : null;

  const {error} = await admin.from("daily_work_tasks").insert({
    plan_id: plan.id,
    organization_id: membership.organization_id,
    user_id: user.id,
    work_date: today,
    position,
    title: taskTitle,
    expected_outcome: expectedOutcome,
    priority: opportunity.first_payment_confirmed_at ? "normal" : "high",
    due_time: dueTime,
    category: "CRM",
    progress_status: "todo",
  });
  if (error) go(returnTo, error.message, "error");
  await audit(admin, membership.organization_id, user.id, "crm_opportunity", opportunityId, "added_to_daily_plan", {workDate: today, position});
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/crm/my-sales-day");
  revalidatePath(`/dashboard/crm/opportunities/${opportunityId}`);
  go(returnTo, copy.priorityAdded);
}

export async function markOpportunityHandoffTransferredAction(formData: FormData) {
  const {admin, user, membership, copy} = await context();
  const returnTo = safeReturnTo(formData);
  if (!canManageCommercialData(membership.role)) go(returnTo, copy.accessDenied, "error");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const {data: opportunity} = await loadOpportunity(admin, membership.organization_id, opportunityId);
  if (!opportunity || opportunity.status !== "won" || opportunity.handoff_status !== "ready") go(returnTo, copy.invalidData, "error");
  const {error} = await admin.from("crm_opportunities").update({handoff_status: "transferred", handoff_at: new Date().toISOString(), updated_by: user.id})
    .eq("organization_id", membership.organization_id).eq("id", opportunityId);
  if (error) go(returnTo, error.message, "error");
  await audit(admin, membership.organization_id, user.id, "crm_opportunity", opportunityId, "handoff_transferred", {destination: opportunity.handoff_destination || SECTOR_HANDOFF[opportunity.sector] || "other"});
  revalidatePath("/dashboard/crm/pipeline");
  revalidatePath(`/dashboard/crm/opportunities/${opportunityId}`);
  go(returnTo, copy.opportunityUpdated);
}

export async function updateCrmProductAction(formData: FormData) {
  const {admin, user, membership, copy} = await context();
  const returnTo = safeReturnTo(formData, "/dashboard/crm/catalog");
  if (!canManageProducts(membership.role)) go(returnTo, copy.accessDenied, "error");
  const productId = String(formData.get("productId") ?? "");
  const nameFr = required(formData.get("nameFr"), 160);
  const nameEn = text(formData.get("nameEn"), 160);
  const sector = String(formData.get("sector") ?? "") as CrmSector;
  const productType = required(formData.get("productType"), 80) || "standard";
  const currency = String(formData.get("currency") ?? "USD").toUpperCase();
  const basePrice = money(formData.get("basePrice"));
  const minimumType = String(formData.get("minimumFirstPaymentType") ?? "percentage");
  const minimumValue = money(formData.get("minimumFirstPaymentValue"));
  const commissionType = String(formData.get("commissionType") ?? "percentage");
  const commissionValue = money(formData.get("commissionValue"));
  const fulfillment = String(formData.get("fulfillmentDestination") ?? "collections");
  const sectorConfig = await activeSectorConfig(admin, membership.organization_id, sector);
  if (!productId || nameFr.length < 2 || !sectorConfig || !currencies.has(currency) || !Number.isFinite(basePrice) || basePrice < 0
    || !["percentage", "fixed"].includes(minimumType) || !Number.isFinite(minimumValue) || minimumValue < 0
    || (minimumType === "percentage" && minimumValue > 100)
    || !["percentage", "fixed"].includes(commissionType) || !Number.isFinite(commissionValue) || commissionValue < 0
    || (commissionType === "percentage" && commissionValue > 100)
    || !fulfillmentDestinations.has(fulfillment)) go(returnTo, copy.invalidData, "error");
  const {error} = await admin.from("sales_products").update({
    name: nameFr,
    name_en: nameEn,
    sector,
    product_type: productType,
    description: text(formData.get("descriptionFr"), 1500),
    description_en: text(formData.get("descriptionEn"), 3000),
    currency,
    default_price: basePrice,
    minimum_first_payment_type: minimumType,
    minimum_first_payment_value: minimumValue,
    commission_type: commissionType,
    commission_value: commissionValue,
    fulfillment_destination: fulfillment,
    updated_by: user.id,
  }).eq("organization_id", membership.organization_id).eq("id", productId);
  if (error) go(returnTo, error.message, "error");
  await audit(admin, membership.organization_id, user.id, "crm_product", productId, "product_updated", {basePrice, currency});
  revalidatePath("/dashboard/crm/catalog");
  revalidatePath("/dashboard/crm/pipeline");
  go(returnTo, copy.productUpdated);
}
