"use server";

import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requireAccessContext} from "@/lib/auth/access-control";
import {finalizeTemporaryAttachment, readPendingAttachment, removePrivateAttachment} from "@/lib/storage/private-attachments";

const ADMIN_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const PROVIDER_STATUSES = new Set(["active", "suspended", "inactive"]);
const CONTRACT_STATUSES = new Set(["draft", "active", "under_review", "renewed", "suspended", "completed", "terminated"]);
const DELIVERABLE_STATUSES = new Set(["planned", "in_progress", "submitted", "accepted", "rejected", "cancelled"]);
const REPORT_STATUSES = new Set(["accepted", "rejected"]);
const KPI_DIRECTIONS = new Set(["higher", "lower", "manual"]);
const KPI_RESULT_REVIEW_STATUSES = new Set(["accepted", "rejected"]);
const INCIDENT_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const INCIDENT_STATUSES = new Set(["open", "corrective_action", "resolved", "closed"]);
const RENEWAL_DECISIONS = new Set(["renew", "renew_with_conditions", "extend", "suspend", "do_not_renew", "terminate"]);
const RENEWAL_REVIEW_KINDS = new Set(["orientation", "checkpoint", "final"]);
const SOURCE_MODES = new Set(["native", "current_import", "historical_import"]);
const RENEWAL_TYPES = new Set(["manual", "tacit", "none"]);
const CLARITY_STATUSES = new Set(["unchecked", "clear", "review_required"]);
const OBLIGATION_TYPES = new Set(["activity", "deliverable", "reporting", "compliance", "payment", "benefit", "support", "other"]);
const OBLIGATION_PARTIES = new Set(["provider", "organization", "both"]);
const OBLIGATION_RECURRENCES = new Set(["once", "weekly", "monthly", "quarterly", "annual", "continuous"]);
const OBLIGATION_OCCURRENCE_REVIEW = new Set(["accepted", "partial", "rejected", "waived"]);
const COMPENSATION_RULE_TYPES = new Set(["fixed_periodic", "fixed_event", "percentage", "threshold", "benefit", "other"]);
const COMPENSATION_CADENCES = new Set(["one_time", "weekly", "monthly", "quarterly", "annual", "per_event", "per_sale", "other"]);
const FINANCIAL_REVIEW_DECISIONS = new Set(["approved", "held", "rejected"]);
const CONTRACT_DOCUMENT_TYPES = new Set(["original", "amendment", "annex", "exhibit", "nda", "insurance", "invoice", "receipt", "correspondence", "other"]);

function text(formData: FormData, name: string, max = 500) {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

function numberValue(formData: FormData, name: string, fallback = 0) {
  const value = Number(text(formData, name, 60));
  return Number.isFinite(value) ? value : fallback;
}

function optionalNumber(formData: FormData, name: string) {
  const raw = text(formData, name, 60);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function dateValue(formData: FormData, name: string) {
  const raw = text(formData, name, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function clampScore(value: number) {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

function daysUntilDate(date: string) {
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.ceil((target - start) / 86400000);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number) {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(day, lastDay));
  return value.toISOString().slice(0, 10);
}

function advanceDueDate(date: string, recurrence: string) {
  if (recurrence === "weekly") return addDays(date, 7);
  if (recurrence === "monthly") return addMonths(date, 1);
  if (recurrence === "quarterly") return addMonths(date, 3);
  if (recurrence === "annual") return addMonths(date, 12);
  return date;
}

function go(message: string, kind: "success" | "error", contractId?: string): never {
  const base = contractId ? `/dashboard/contracts/${contractId}` : "/dashboard/contracts";
  redirect(`${base}?${kind}=${encodeURIComponent(message)}`);
}

async function audit(
  context: Awaited<ReturnType<typeof requireAccessContext>>,
  input: {providerId?: string | null; contractId?: string | null; action: string; details?: Record<string, unknown>},
) {
  const {error} = await context.admin.from("service_contract_audit_log").insert({
    organization_id: context.organizationId,
    provider_id: input.providerId ?? null,
    contract_id: input.contractId ?? null,
    actor_id: context.user.id,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Service contract audit failed", error);
}

function ensureAdministrator(role: string) {
  if (!ADMIN_ROLES.has(role)) go("Accès refusé.", "error");
}

async function contractForExecution(
  context: Awaited<ReturnType<typeof requireAccessContext>>,
  contractId: string,
) {
  const {data, error} = await context.admin.from("service_contracts")
    .select("id,provider_id,internal_owner_user_id,status,activated_at,end_date,title")
    .eq("id", contractId)
    .eq("organization_id", context.organizationId)
    .maybeSingle<{id: string; provider_id: string; internal_owner_user_id: string; status: string; activated_at: string | null; end_date: string; title: string}>();
  if (error || !data) go("Contrat introuvable.", "error", contractId);
  if (!ADMIN_ROLES.has(context.role) && data.internal_owner_user_id !== context.user.id) {
    go("Accès refusé à l’exécution de ce contrat.", "error", contractId);
  }
  return data;
}

function revalidateContract(contractId: string) {
  revalidatePath("/dashboard/contracts");
  revalidatePath(`/dashboard/contracts/${contractId}`);
  revalidatePath("/dashboard/my-day");
}

export async function createServiceProviderAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);

  const legalName = text(formData, "legalName", 220);
  const tradingName = text(formData, "tradingName", 220) || null;
  const serviceCategory = text(formData, "serviceCategory", 120);
  const contactName = text(formData, "contactName", 180) || null;
  const contactEmail = text(formData, "contactEmail", 220) || null;
  const contactPhone = text(formData, "contactPhone", 80) || null;
  const country = text(formData, "country", 120) || null;
  const notes = text(formData, "notes", 5000);

  if (legalName.length < 2 || serviceCategory.length < 2) {
    go("Renseigne le nom légal du prestataire et la catégorie de service.", "error");
  }

  const now = new Date().toISOString();
  const {data, error} = await context.admin.from("service_providers").insert({
    organization_id: context.organizationId,
    legal_name: legalName,
    trading_name: tradingName,
    service_category: serviceCategory,
    contact_name: contactName,
    contact_email: contactEmail,
    contact_phone: contactPhone,
    country,
    status: "active",
    notes,
    created_by: context.user.id,
    updated_by: context.user.id,
    created_at: now,
    updated_at: now,
  }).select("id").single<{id: string}>();

  if (error || !data) go(`Création du prestataire impossible : ${error?.message ?? "erreur inconnue"}`, "error");
  await audit(context, {providerId: data.id, action: "provider_created", details: {legalName, serviceCategory}});
  revalidatePath("/dashboard/contracts");
  go("Prestataire ajouté.", "success");
}

export async function updateServiceProviderDetailsAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);

  const providerId = text(formData, "providerId", 80);
  const legalName = text(formData, "legalName", 220);
  const tradingName = text(formData, "tradingName", 220) || null;
  const serviceCategory = text(formData, "serviceCategory", 120);
  const contactName = text(formData, "contactName", 180) || null;
  const contactEmail = text(formData, "contactEmail", 220) || null;
  const contactPhone = text(formData, "contactPhone", 80) || null;
  const country = text(formData, "country", 120) || null;
  const notes = text(formData, "notes", 5000);

  if (!providerId || legalName.length < 2 || serviceCategory.length < 2) {
    go("Renseigne le nom légal du prestataire et la catégorie de service.", "error");
  }

  const {data: current, error: readError} = await context.admin.from("service_providers")
    .select("id,legal_name,trading_name,service_category,contact_name,contact_email,contact_phone,country,notes")
    .eq("id", providerId)
    .eq("organization_id", context.organizationId)
    .maybeSingle<{id: string; legal_name: string; trading_name: string | null; service_category: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null; country: string | null; notes: string}>();
  if (readError || !current) go("Prestataire introuvable.", "error");

  const next = {
    legal_name: legalName,
    trading_name: tradingName,
    service_category: serviceCategory,
    contact_name: contactName,
    contact_email: contactEmail,
    contact_phone: contactPhone,
    country,
    notes,
  };
  const {error} = await context.admin.from("service_providers").update({
    ...next,
    updated_by: context.user.id,
    updated_at: new Date().toISOString(),
  }).eq("id", providerId).eq("organization_id", context.organizationId);
  if (error) go(`Modification du prestataire impossible : ${error.message}`, "error");

  const changed: Record<string, {from: unknown; to: unknown}> = {};
  for (const [key, value] of Object.entries(next)) {
    const before = current[key as keyof typeof current];
    if ((before ?? null) !== (value ?? null)) changed[key] = {from: before ?? null, to: value ?? null};
  }
  await audit(context, {providerId, action: "provider_details_updated", details: {changed}});
  revalidatePath("/dashboard/contracts");
  go("Fiche prestataire mise à jour.", "success");
}

export async function updateServiceProviderStatusAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const providerId = text(formData, "providerId", 80);
  const status = text(formData, "status", 40);
  if (!providerId || !PROVIDER_STATUSES.has(status)) go("Statut du prestataire invalide.", "error");

  const {error} = await context.admin.from("service_providers").update({
    status,
    updated_by: context.user.id,
    updated_at: new Date().toISOString(),
  }).eq("id", providerId).eq("organization_id", context.organizationId);
  if (error) go(`Mise à jour impossible : ${error.message}`, "error");
  await audit(context, {providerId, action: "provider_status_changed", details: {status}});
  revalidatePath("/dashboard/contracts");
  go("Statut du prestataire mis à jour.", "success");
}

export async function createServiceContractAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);

  const providerId = text(formData, "providerId", 80);
  const contractNumber = text(formData, "contractNumber", 80);
  const title = text(formData, "title", 220);
  const serviceScope = text(formData, "serviceScope", 8000);
  const department = text(formData, "department", 160) || null;
  const internalOwnerUserId = text(formData, "internalOwnerUserId", 80);
  const startDate = dateValue(formData, "startDate");
  const endDate = dateValue(formData, "endDate");
  const valueAmount = Math.max(0, numberValue(formData, "valueAmount", 0));
  const currency = (text(formData, "currency", 8) || "USD").toUpperCase();
  const paymentTerms = text(formData, "paymentTerms", 2000);
  const renewalNoticeDays = Math.min(730, Math.max(0, Math.round(numberValue(formData, "renewalNoticeDays", 90))));
  const performanceTarget = Math.min(100, Math.max(0, numberValue(formData, "performanceTarget", 80)));
  const notes = text(formData, "notes", 5000);
  const sourceMode = text(formData, "sourceMode", 30) || "native";
  const requestedStatus = text(formData, "initialStatus", 40) || "draft";
  const renewalType = text(formData, "renewalType", 20) || "manual";
  const renewalPeriodMonths = optionalNumber(formData, "renewalPeriodMonths");
  const nonRenewalNoticeDays = optionalNumber(formData, "nonRenewalNoticeDays");
  const terminationNoticeDays = optionalNumber(formData, "terminationNoticeDays");
  const confidentialityMonths = optionalNumber(formData, "confidentialityPostTermMonths");
  const confidentialityIndefinite = text(formData, "confidentialityIndefinite", 10) === "on";
  const immediateTerminationTriggers = text(formData, "immediateTerminationTriggers", 5000);
  const clarityStatus = text(formData, "contractClarityStatus", 30) || "unchecked";
  const clarityNote = text(formData, "contractClarityNote", 5000);
  const legacyExecutionNote = text(formData, "legacyExecutionNote", 5000);
  const trackingStartDate = dateValue(formData, "trackingStartDate") || null;
  const pendingSource = readPendingAttachment(formData, "contractSource");

  if (!SOURCE_MODES.has(sourceMode) || !RENEWAL_TYPES.has(renewalType) || !CLARITY_STATUSES.has(clarityStatus)) {
    go("Métadonnées d’import du contrat invalides.", "error");
  }
  if (!providerId || contractNumber.length < 2 || title.length < 3 || !internalOwnerUserId || !startDate || !endDate) {
    go("Complète le prestataire, le numéro, le titre, le responsable interne et les dates du contrat.", "error");
  }
  if (endDate < startDate) go("La date d’expiration doit être postérieure ou égale à la date de début.", "error");
  if (sourceMode !== "native" && !CONTRACT_STATUSES.has(requestedStatus)) go("Statut initial importé invalide.", "error");

  const [{data: provider}, {data: owner}] = await Promise.all([
    context.admin.from("service_providers").select("id,status").eq("id", providerId).eq("organization_id", context.organizationId).maybeSingle<{id: string; status: string}>(),
    context.admin.from("organization_members").select("user_id,is_active,role").eq("organization_id", context.organizationId).eq("user_id", internalOwnerUserId).eq("is_active", true).in("role", ["owner","admin","executive","hr","manager"]).maybeSingle<{user_id: string; is_active: boolean; role: string}>(),
  ]);
  if (!provider) go("Prestataire introuvable dans cette organisation.", "error");
  if (!owner) go("Le responsable interne doit être un membre actif de l’organisation.", "error");

  const now = new Date().toISOString();
  const status = sourceMode === "native" ? "draft" : requestedStatus;
  const {data, error} = await context.admin.from("service_contracts").insert({
    organization_id: context.organizationId, provider_id: providerId, contract_number: contractNumber, title, service_scope: serviceScope, department,
    internal_owner_user_id: internalOwnerUserId, start_date: startDate, end_date: endDate, value_amount: valueAmount, currency, payment_terms: paymentTerms,
    status, renewal_notice_days: renewalNoticeDays, performance_target: performanceTarget, notes, source_mode: sourceMode,
    imported_at: sourceMode === "native" ? null : now, imported_by: sourceMode === "native" ? null : context.user.id, tracking_start_date: trackingStartDate,
    renewal_type: renewalType, renewal_period_months: renewalPeriodMonths === null ? null : Math.max(1, Math.min(120, Math.round(renewalPeriodMonths))),
    non_renewal_notice_days: nonRenewalNoticeDays === null ? null : Math.max(0, Math.min(730, Math.round(nonRenewalNoticeDays))),
    termination_notice_days: terminationNoticeDays === null ? null : Math.max(0, Math.min(730, Math.round(terminationNoticeDays))),
    confidentiality_post_term_months: confidentialityIndefinite || confidentialityMonths === null ? null : Math.max(0, Math.min(1200, Math.round(confidentialityMonths))),
    confidentiality_indefinite: confidentialityIndefinite, immediate_termination_triggers: immediateTerminationTriggers, contract_clarity_status: clarityStatus,
    contract_clarity_note: clarityNote, legacy_execution_note: legacyExecutionNote, created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now,
  }).select("id").single<{id: string}>();

  if (error || !data) go(`Création du contrat impossible : ${error?.message ?? "erreur inconnue"}`, "error");

  if (pendingSource) {
    try {
      const source = await finalizeTemporaryAttachment({admin: context.admin, organizationId: context.organizationId, userId: context.user.id, purpose: "contract", recordId: data.id, pending: pendingSource});
      const {error: sourceError} = await context.admin.from("service_contracts").update({
        source_document_storage_path: source.storagePath, source_document_file_name: source.fileName, source_document_mime_type: source.mimeType,
        source_document_size_bytes: source.sizeBytes, source_document_uploaded_at: now, source_document_uploaded_by: context.user.id,
      }).eq("id", data.id).eq("organization_id", context.organizationId);
      if (sourceError) throw sourceError;
    } catch (sourceError) {
      await context.admin.from("service_contracts").delete().eq("id", data.id).eq("organization_id", context.organizationId);
      await removePrivateAttachment(context.admin, pendingSource.storagePath);
      go(sourceError instanceof Error ? sourceError.message : "Document contractuel invalide.", "error");
    }
  }

  await audit(context, {providerId, contractId: data.id, action: sourceMode === "native" ? "contract_created" : "contract_imported", details: {contractNumber, title, startDate, endDate, valueAmount, currency, sourceMode, status, renewalType, clarityStatus, sourceDocument: Boolean(pendingSource)}});
  revalidatePath("/dashboard/contracts");
  go(sourceMode === "native" ? "Contrat créé en brouillon." : "Contrat existant importé. Les données antérieures sont identifiées comme historiques.", "success", data.id);
}

export async function updateServiceContractStatusAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const status = text(formData, "status", 40);
  const reason = text(formData, "reason", 1200);
  if (!contractId || !CONTRACT_STATUSES.has(status)) go("Statut du contrat invalide.", "error");
  if (["suspended", "terminated"].includes(status) && reason.length < 5) go("Indique le motif de cette décision.", "error", contractId);

  const {data: current, error: readError} = await context.admin.from("service_contracts")
    .select("id,provider_id,status,activated_at")
    .eq("id", contractId)
    .eq("organization_id", context.organizationId)
    .maybeSingle<{id: string; provider_id: string; status: string; activated_at: string | null}>();
  if (readError || !current) go("Contrat introuvable.", "error");

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status,
    updated_by: context.user.id,
    updated_at: now,
  };
  if (status === "active" && !current.activated_at) {
    patch.activated_at = now;
    patch.activated_by = context.user.id;
  }

  const {error} = await context.admin.from("service_contracts").update(patch).eq("id", contractId).eq("organization_id", context.organizationId);
  if (error) go(`Mise à jour impossible : ${error.message}`, "error", contractId);

  await audit(context, {
    providerId: current.provider_id,
    contractId,
    action: status === "active" && !current.activated_at ? "contract_activated" : "contract_status_changed",
    details: {from: current.status, to: status, reason},
  });
  revalidateContract(contractId);
  go(status === "active" && !current.activated_at ? "Contrat activé. Le suivi d’exécution peut commencer." : "Statut du contrat mis à jour.", "success", contractId);
}

export async function createContractDeliverableAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const contract = await contractForExecution(context, contractId);
  const title = text(formData, "title", 220);
  const description = text(formData, "description", 6000);
  const dueDate = dateValue(formData, "dueDate");
  const weight = Math.min(100, Math.max(0, numberValue(formData, "weight", 0)));
  if (title.length < 2 || !dueDate) go("Renseigne le livrable et son échéance.", "error", contractId);

  const now = new Date().toISOString();
  const {data, error} = await context.admin.from("service_contract_deliverables").insert({
    organization_id: context.organizationId,
    contract_id: contractId,
    title,
    description,
    due_date: dueDate,
    weight,
    status: "planned",
    created_by: context.user.id,
    updated_by: context.user.id,
    created_at: now,
    updated_at: now,
  }).select("id").single<{id: string}>();
  if (error || !data) go(`Création du livrable impossible : ${error?.message ?? "erreur inconnue"}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "deliverable_created", details: {deliverableId: data.id, title, dueDate, weight}});
  revalidateContract(contractId);
  go("Livrable ajouté au contrat.", "success", contractId);
}

export async function updateContractDeliverableAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const deliverableId = text(formData, "deliverableId", 80);
  const status = text(formData, "status", 40);
  const evidenceReference = text(formData, "evidenceReference", 2000);
  const note = text(formData, "note", 4000);
  const requestedReviewScore = optionalNumber(formData, "reviewScore");
  if (!deliverableId || !DELIVERABLE_STATUSES.has(status)) go("Mise à jour du livrable invalide.", "error", contractId);
  const contract = await contractForExecution(context, contractId);

  const {data: current, error: readError} = await context.admin.from("service_contract_deliverables")
    .select("id,status,evidence_reference,submission_note,review_note,review_score,review_outcome")
    .eq("id", deliverableId).eq("contract_id", contractId).eq("organization_id", context.organizationId)
    .maybeSingle<{id: string; status: string; evidence_reference: string; submission_note: string; review_note: string; review_score: number | string | null; review_outcome: string | null}>();
  if (readError || !current) go("Livrable introuvable.", "error", contractId);
  if (status === "rejected" && note.length < 3) go("Indique le motif du rejet.", "error", contractId);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status,
    evidence_reference: evidenceReference || current.evidence_reference,
    updated_by: context.user.id,
    updated_at: now,
  };
  let reviewScore: number | null = current.review_score === null ? null : Number(current.review_score);
  let reviewOutcome: string | null = current.review_outcome;
  if (["planned", "in_progress", "submitted", "cancelled"].includes(status)) {
    patch.review_score = null;
    patch.review_outcome = null;
    reviewScore = null;
    reviewOutcome = null;
  }
  if (status === "submitted") {
    patch.submission_note = note || current.submission_note;
    patch.submitted_at = now;
  }
  if (status === "accepted") {
    reviewScore = clampScore(requestedReviewScore ?? 100);
    reviewOutcome = reviewScore >= 99.995 ? "accepted" : "partial";
    patch.review_score = reviewScore;
    patch.review_outcome = reviewOutcome;
    patch.review_note = note || current.review_note;
    patch.reviewed_at = now;
    patch.reviewed_by = context.user.id;
  }
  if (status === "rejected") {
    reviewScore = 0;
    reviewOutcome = "rejected";
    patch.review_score = 0;
    patch.review_outcome = "rejected";
    patch.review_note = note || current.review_note;
    patch.reviewed_at = now;
    patch.reviewed_by = context.user.id;
  }

  const {error} = await context.admin.from("service_contract_deliverables").update(patch)
    .eq("id", deliverableId).eq("contract_id", contractId).eq("organization_id", context.organizationId);
  if (error) go(`Livrable non mis à jour : ${error.message}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "deliverable_status_changed", details: {deliverableId, from: current.status, to: status, evidenceReference, note, reviewScore, reviewOutcome}});
  revalidateContract(contractId);
  go("Livrable mis à jour.", "success", contractId);
}

export async function createContractExecutionReportAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const contract = await contractForExecution(context, contractId);
  const periodStart = dateValue(formData, "periodStart");
  const periodEnd = dateValue(formData, "periodEnd");
  const workCompleted = text(formData, "workCompleted", 8000);
  const challenges = text(formData, "challenges", 6000);
  const nextActions = text(formData, "nextActions", 6000);
  const evidenceReference = text(formData, "evidenceReference", 2000);
  if (!periodStart || !periodEnd || periodEnd < periodStart || workCompleted.length < 3) {
    go("Renseigne une période valide et le travail réalisé.", "error", contractId);
  }

  const now = new Date().toISOString();
  const {data, error} = await context.admin.from("service_contract_reports").insert({
    organization_id: context.organizationId,
    contract_id: contractId,
    period_start: periodStart,
    period_end: periodEnd,
    work_completed: workCompleted,
    challenges,
    next_actions: nextActions,
    evidence_reference: evidenceReference,
    status: "submitted",
    submitted_by: context.user.id,
    submitted_at: now,
    created_at: now,
  }).select("id").single<{id: string}>();
  if (error || !data) go(`Rapport impossible à enregistrer : ${error?.message ?? "erreur inconnue"}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "execution_report_submitted", details: {reportId: data.id, periodStart, periodEnd}});
  revalidateContract(contractId);
  go("Rapport d’exécution soumis.", "success", contractId);
}

export async function reviewContractExecutionReportAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const reportId = text(formData, "reportId", 80);
  const status = text(formData, "status", 40);
  const reviewNote = text(formData, "reviewNote", 4000);
  if (!reportId || !REPORT_STATUSES.has(status)) go("Décision de revue invalide.", "error", contractId);
  if (status === "rejected" && reviewNote.length < 3) go("Indique la raison du rejet.", "error", contractId);
  const contract = await contractForExecution(context, contractId);

  const {error} = await context.admin.from("service_contract_reports").update({
    status,
    review_note: reviewNote,
    reviewed_by: context.user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", reportId).eq("contract_id", contractId).eq("organization_id", context.organizationId);
  if (error) go(`Revue du rapport impossible : ${error.message}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "execution_report_reviewed", details: {reportId, status, reviewNote}});
  revalidateContract(contractId);
  go(status === "accepted" ? "Rapport d’exécution validé." : "Rapport d’exécution rejeté.", "success", contractId);
}

export async function createContractKpiAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const contract = await contractForExecution(context, contractId);
  const name = text(formData, "name", 180);
  const description = text(formData, "description", 3000);
  const unit = text(formData, "unit", 40) || "%";
  const targetValue = numberValue(formData, "targetValue", 100);
  const weight = Math.min(100, Math.max(0, numberValue(formData, "weight", 0)));
  const direction = text(formData, "direction", 20) || "higher";
  if (name.length < 2 || !KPI_DIRECTIONS.has(direction)) go("KPI invalide.", "error", contractId);
  if (direction !== "manual" && targetValue <= 0) go("La cible doit être supérieure à zéro pour ce mode de calcul.", "error", contractId);

  const now = new Date().toISOString();
  const {data, error} = await context.admin.from("service_contract_kpis").insert({
    organization_id: context.organizationId,
    contract_id: contractId,
    name,
    description,
    unit,
    target_value: targetValue,
    weight,
    direction,
    is_active: true,
    created_by: context.user.id,
    updated_by: context.user.id,
    created_at: now,
    updated_at: now,
  }).select("id").single<{id: string}>();
  if (error || !data) go(`KPI impossible à créer : ${error?.message ?? "erreur inconnue"}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "kpi_created", details: {kpiId: data.id, name, unit, targetValue, weight, direction}});
  revalidateContract(contractId);
  go("KPI ajouté au contrat.", "success", contractId);
}

export async function recordContractKpiResultAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const kpiId = text(formData, "kpiId", 80);
  const periodStart = dateValue(formData, "periodStart");
  const periodEnd = dateValue(formData, "periodEnd");
  const actualValue = optionalNumber(formData, "actualValue");
  const manualScore = optionalNumber(formData, "manualScore");
  const comment = text(formData, "comment", 4000);
  if (!kpiId || !periodStart || !periodEnd || periodEnd < periodStart) go("Période KPI invalide.", "error", contractId);
  const contract = await contractForExecution(context, contractId);

  const {data: kpi, error: kpiError} = await context.admin.from("service_contract_kpis")
    .select("id,name,target_value,direction,is_active")
    .eq("id", kpiId).eq("contract_id", contractId).eq("organization_id", context.organizationId)
    .maybeSingle<{id: string; name: string; target_value: number | string; direction: string; is_active: boolean}>();
  if (kpiError || !kpi || !kpi.is_active) go("KPI introuvable ou inactif.", "error", contractId);

  const target = Number(kpi.target_value);
  let score = 0;
  if (kpi.direction === "manual") {
    if (manualScore === null) go("Renseigne le score manuel entre 0 et 100.", "error", contractId);
    score = clampScore(manualScore);
  } else {
    if (actualValue === null) go("Renseigne la valeur réalisée.", "error", contractId);
    if (kpi.direction === "higher") {
      score = target > 0 ? clampScore((actualValue / target) * 100) : 0;
    } else {
      score = actualValue <= target ? 100 : actualValue > 0 ? clampScore((target / actualValue) * 100) : 100;
    }
  }

  const {data, error} = await context.admin.from("service_contract_kpi_results").insert({
    organization_id: context.organizationId,
    contract_id: contractId,
    kpi_id: kpiId,
    period_start: periodStart,
    period_end: periodEnd,
    actual_value: actualValue,
    score,
    comment,
    status: "submitted",
    review_note: "",
    recorded_by: context.user.id,
    created_at: new Date().toISOString(),
  }).select("id").single<{id: string}>();
  if (error || !data) go(`Résultat KPI impossible à enregistrer : ${error?.message ?? "erreur inconnue"}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "kpi_result_submitted", details: {resultId: data.id, kpiId, kpiName: kpi.name, periodStart, periodEnd, actualValue, score, comment}});
  revalidateContract(contractId);
  go(`Résultat KPI soumis pour validation : ${score.toFixed(1)} %.`, "success", contractId);
}

export async function reviewContractKpiResultAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const resultId = text(formData, "resultId", 80);
  const status = text(formData, "status", 40);
  const reviewNote = text(formData, "reviewNote", 4000);
  if (!resultId || !KPI_RESULT_REVIEW_STATUSES.has(status)) go("Décision de validation KPI invalide.", "error", contractId);
  if (status === "rejected" && reviewNote.length < 3) go("Indique la raison du rejet du résultat KPI.", "error", contractId);
  const contract = await contractForExecution(context, contractId);

  const {data: result, error: readError} = await context.admin.from("service_contract_kpi_results")
    .select("id,kpi_id,status,score,period_start,period_end")
    .eq("id", resultId).eq("contract_id", contractId).eq("organization_id", context.organizationId)
    .maybeSingle<{id: string; kpi_id: string; status: string; score: number | string; period_start: string; period_end: string}>();
  if (readError || !result) go("Résultat KPI introuvable.", "error", contractId);
  if (result.status !== "submitted") go("Ce résultat KPI a déjà été traité.", "error", contractId);

  const {data: kpi} = await context.admin.from("service_contract_kpis")
    .select("id,name")
    .eq("id", result.kpi_id).eq("contract_id", contractId).eq("organization_id", context.organizationId)
    .maybeSingle<{id: string; name: string}>();

  const now = new Date().toISOString();
  const {error} = await context.admin.from("service_contract_kpi_results").update({
    status,
    review_note: reviewNote,
    reviewed_by: context.user.id,
    reviewed_at: now,
  }).eq("id", resultId).eq("contract_id", contractId).eq("organization_id", context.organizationId).eq("status", "submitted");
  if (error) go(`Validation KPI impossible : ${error.message}`, "error", contractId);

  await audit(context, {
    providerId: contract.provider_id,
    contractId,
    action: "kpi_result_reviewed",
    details: {
      resultId,
      kpiId: result.kpi_id,
      kpiName: kpi?.name ?? null,
      periodStart: result.period_start,
      periodEnd: result.period_end,
      score: Number(result.score),
      status,
      reviewNote,
    },
  });
  revalidateContract(contractId);
  go(status === "accepted" ? "Résultat KPI validé et intégré au score de performance." : "Résultat KPI rejeté et exclu du score de performance.", "success", contractId);
}

async function contractGovernanceSnapshot(
  context: Awaited<ReturnType<typeof requireAccessContext>>,
  contractId: string,
) {
  const {data: contract, error: contractError} = await context.admin.from("service_contracts")
    .select("id,performance_target")
    .eq("id", contractId).eq("organization_id", context.organizationId)
    .maybeSingle<{id: string; performance_target: number | string}>();
  if (contractError || !contract) go("Contrat introuvable.", "error", contractId);

  const [kpiRes, resultRes, deliverableRes, incidentRes] = await Promise.all([
    context.admin.from("service_contract_kpis").select("id,weight").eq("organization_id", context.organizationId).eq("contract_id", contractId).eq("is_active", true),
    context.admin.from("service_contract_kpi_results").select("kpi_id,score,status").eq("organization_id", context.organizationId).eq("contract_id", contractId).eq("status", "accepted"),
    context.admin.from("service_contract_deliverables").select("id,weight,status,review_score").eq("organization_id", context.organizationId).eq("contract_id", contractId).in("status", ["accepted","rejected"]),
    context.admin.from("service_contract_incidents").select("id,severity,status").eq("organization_id", context.organizationId).eq("contract_id", contractId),
  ]);

  const kpis = (kpiRes.data ?? []) as {id: string; weight: number | string}[];
  const results = (resultRes.data ?? []) as {kpi_id: string; score: number | string; status: string}[];
  const scoresByKpi = new Map<string, number[]>();
  for (const row of results) {
    const list = scoresByKpi.get(row.kpi_id) ?? [];
    list.push(Number(row.score));
    scoresByKpi.set(row.kpi_id, list);
  }
  const kpiAverages = kpis.flatMap((kpi) => {
    const list = scoresByKpi.get(kpi.id) ?? [];
    if (!list.length) return [];
    return [{weight: Math.max(0, Number(kpi.weight)), score: list.reduce((sum, value) => sum + value, 0) / list.length}];
  });
  const kpiWeight = kpiAverages.reduce((sum, row) => sum + row.weight, 0);
  const kpiScore = kpiAverages.length
    ? kpiWeight > 0
      ? kpiAverages.reduce((sum, row) => sum + row.score * row.weight, 0) / kpiWeight
      : kpiAverages.reduce((sum, row) => sum + row.score, 0) / kpiAverages.length
    : null;

  const deliverables = (deliverableRes.data ?? []) as {id: string; weight: number | string; status: string; review_score: number | string | null}[];
  const reviewedDeliverables = deliverables.map((row) => ({
    weight: Math.max(0, Number(row.weight)),
    score: row.status === "rejected" ? 0 : row.review_score === null ? 100 : clampScore(Number(row.review_score)),
  }));
  const deliverableWeight = reviewedDeliverables.reduce((sum, row) => sum + row.weight, 0);
  const deliverableScore = reviewedDeliverables.length
    ? deliverableWeight > 0
      ? reviewedDeliverables.reduce((sum, row) => sum + row.score * row.weight, 0) / deliverableWeight
      : reviewedDeliverables.reduce((sum, row) => sum + row.score, 0) / reviewedDeliverables.length
    : null;

  const incidents = (incidentRes.data ?? []) as {id: string; severity: string; status: string}[];
  const openIncidents = incidents.filter((row) => !["resolved","closed"].includes(row.status));
  const severityPenalty: Record<string, number> = {low: 2, medium: 5, high: 10, critical: 20};
  const incidentPenalty = Math.min(30, openIncidents.reduce((sum, row) => sum + (severityPenalty[row.severity] ?? 0), 0));
  const criticalIncidents = openIncidents.filter((row) => row.severity === "critical").length;

  const componentScores = [kpiScore, deliverableScore].filter((value): value is number => value !== null);
  let baseScore: number | null = null;
  if (kpiScore !== null && deliverableScore !== null) baseScore = kpiScore * 0.7 + deliverableScore * 0.3;
  else if (componentScores.length) baseScore = componentScores[0];
  const performanceScore = baseScore === null ? null : clampScore(baseScore - incidentPenalty);
  const target = Number(contract.performance_target);
  const recommendedAction = criticalIncidents > 0
    ? "suspend_review"
    : performanceScore === null
      ? "insufficient_data"
      : performanceScore >= target
        ? "renew"
        : performanceScore >= Math.max(0, target - 10)
          ? "renew_with_conditions"
          : "do_not_renew_review";

  return {
    performanceScore,
    kpiScore: kpiScore === null ? null : clampScore(kpiScore),
    deliverableScore: deliverableScore === null ? null : clampScore(deliverableScore),
    incidentPenalty: clampScore(incidentPenalty),
    openIncidents: openIncidents.length,
    criticalIncidents,
    recommendedAction,
  };
}

export async function createContractIncidentAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const contract = await contractForExecution(context, contractId);
  const title = text(formData, "title", 220);
  const description = text(formData, "description", 6000);
  const severity = text(formData, "severity", 30) || "medium";
  const correctiveAction = text(formData, "correctiveAction", 6000);
  const ownerUserId = text(formData, "ownerUserId", 80) || null;
  const dueDate = dateValue(formData, "dueDate") || null;
  if (title.length < 3 || !INCIDENT_SEVERITIES.has(severity)) go("Incident invalide.", "error", contractId);

  const now = new Date().toISOString();
  const {data, error} = await context.admin.from("service_contract_incidents").insert({
    organization_id: context.organizationId,
    contract_id: contractId,
    title,
    description,
    severity,
    status: correctiveAction ? "corrective_action" : "open",
    corrective_action: correctiveAction,
    owner_user_id: ownerUserId,
    due_date: dueDate,
    resolution_note: "",
    created_by: context.user.id,
    updated_by: context.user.id,
    created_at: now,
    updated_at: now,
  }).select("id").single<{id: string}>();
  if (error || !data) go(`Incident impossible à enregistrer : ${error?.message ?? "erreur inconnue"}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "incident_created", details: {incidentId: data.id, title, severity, dueDate, correctiveAction}});
  revalidateContract(contractId);
  go("Incident / non-conformité enregistré.", "success", contractId);
}

export async function updateContractIncidentAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const incidentId = text(formData, "incidentId", 80);
  const status = text(formData, "status", 40);
  const correctiveAction = text(formData, "correctiveAction", 6000);
  const resolutionNote = text(formData, "resolutionNote", 4000);
  if (!incidentId || !INCIDENT_STATUSES.has(status)) go("Mise à jour de l’incident invalide.", "error", contractId);
  if (["resolved","closed"].includes(status) && resolutionNote.length < 3) go("Indique la résolution de l’incident.", "error", contractId);
  const contract = await contractForExecution(context, contractId);

  const {data: current, error: readError} = await context.admin.from("service_contract_incidents")
    .select("id,status,severity,title")
    .eq("id", incidentId).eq("contract_id", contractId).eq("organization_id", context.organizationId)
    .maybeSingle<{id: string; status: string; severity: string; title: string}>();
  if (readError || !current) go("Incident introuvable.", "error", contractId);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status,
    corrective_action: correctiveAction,
    resolution_note: resolutionNote,
    updated_by: context.user.id,
    updated_at: now,
  };
  if (["resolved","closed"].includes(status)) {
    patch.resolved_at = now;
    patch.resolved_by = context.user.id;
  } else {
    patch.resolved_at = null;
    patch.resolved_by = null;
  }
  const {error} = await context.admin.from("service_contract_incidents").update(patch)
    .eq("id", incidentId).eq("contract_id", contractId).eq("organization_id", context.organizationId);
  if (error) go(`Incident non mis à jour : ${error.message}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "incident_updated", details: {incidentId, title: current.title, severity: current.severity, from: current.status, to: status, correctiveAction, resolutionNote}});
  revalidateContract(contractId);
  go("Incident mis à jour.", "success", contractId);
}

export async function recordContractRenewalDecisionAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const finalDecision = text(formData, "finalDecision", 60);
  const decisionNote = text(formData, "decisionNote", 6000);
  const requestedKind = text(formData, "reviewKind", 30) || "orientation";
  if (!contractId || !RENEWAL_DECISIONS.has(finalDecision) || !RENEWAL_REVIEW_KINDS.has(requestedKind)) {
    go("Décision de renouvellement invalide.", "error", contractId);
  }
  if (["renew_with_conditions","suspend","do_not_renew","terminate"].includes(finalDecision) && decisionNote.length < 5) {
    go("Indique le motif ou les conditions de cette décision.", "error", contractId);
  }

  const contract = await contractForExecution(context, contractId);
  const daysRemaining = daysUntilDate(contract.end_date);
  const snapshot = await contractGovernanceSnapshot(context, contractId);

  let reviewKind = requestedKind;
  let reviewStage = "orientation";
  let isFinal = false;

  if (requestedKind === "final") {
    const urgentException = ["suspend", "terminate"].includes(finalDecision) || snapshot.criticalIncidents > 0;
    if (daysRemaining > 30 && !urgentException) {
      go(`La décision finale sera disponible à J-30. Il reste ${daysRemaining} jour(s). Enregistre plutôt une orientation provisoire.`, "error", contractId);
    }
    reviewStage = daysRemaining <= 30 ? "final" : "urgent";
    reviewKind = daysRemaining <= 30 ? "final" : "urgent";
    isFinal = daysRemaining <= 30 || ["terminate"].includes(finalDecision);
  } else if (requestedKind === "checkpoint") {
    if (daysRemaining <= 30) reviewStage = "j30";
    else if (daysRemaining <= 60) reviewStage = "j60";
    else if (daysRemaining <= 90) reviewStage = "j90";
    else {
      reviewStage = "orientation";
      reviewKind = "orientation";
    }
  }

  const now = new Date().toISOString();
  const {data, error} = await context.admin.from("service_contract_renewal_reviews").insert({
    organization_id: context.organizationId,
    contract_id: contractId,
    performance_score: snapshot.performanceScore,
    kpi_score: snapshot.kpiScore,
    deliverable_score: snapshot.deliverableScore,
    incident_penalty: snapshot.incidentPenalty,
    open_incidents: snapshot.openIncidents,
    critical_incidents: snapshot.criticalIncidents,
    recommended_action: snapshot.recommendedAction,
    final_decision: finalDecision,
    decision_note: decisionNote,
    review_stage: reviewStage,
    review_kind: reviewKind,
    days_remaining: daysRemaining,
    is_final: isFinal,
    decided_by: context.user.id,
    decided_at: now,
    created_at: now,
  }).select("id").single<{id: string}>();
  if (error || !data) go(`Décision impossible à enregistrer : ${error?.message ?? "erreur inconnue"}`, "error", contractId);

  if (finalDecision === "suspend" || finalDecision === "terminate") {
    await context.admin.from("service_contracts").update({
      status: finalDecision === "suspend" ? "suspended" : "terminated",
      updated_by: context.user.id,
      updated_at: now,
    }).eq("id", contractId).eq("organization_id", context.organizationId);
  } else if (isFinal && finalDecision === "renew") {
    await context.admin.from("service_contracts").update({
      status: "under_review",
      updated_by: context.user.id,
      updated_at: now,
    }).eq("id", contractId).eq("organization_id", context.organizationId);
  }

  await audit(context, {
    providerId: contract.provider_id,
    contractId,
    action: "renewal_decision_recorded",
    details: {reviewId: data.id, finalDecision, decisionNote, reviewStage, reviewKind, daysRemaining, isFinal, ...snapshot},
  });
  revalidateContract(contractId);

  const message = isFinal
    ? "Décision finale de renouvellement enregistrée et auditée."
    : reviewStage === "orientation"
      ? "Orientation provisoire enregistrée. Elle sera réévaluée aux jalons J-90, J-60 et J-30."
      : `Revue ${reviewStage.toUpperCase()} enregistrée. La prochaine étape restera visible dans le calendrier de renouvellement.`;
  go(message, "success", contractId);
}



export async function attachContractSourceDocumentAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const pending = readPendingAttachment(formData, "contractSource");
  if (!contractId || !pending) go("Sélectionne le document contractuel original.", "error", contractId);
  const contract = await contractForExecution(context, contractId);
  const {data: current} = await context.admin.from("service_contracts")
    .select("source_document_storage_path")
    .eq("id", contractId).eq("organization_id", context.organizationId)
    .maybeSingle<{source_document_storage_path: string | null}>();
  if (current?.source_document_storage_path) go("Le document source est déjà archivé et ne peut pas être remplacé silencieusement.", "error", contractId);
  const now = new Date().toISOString();
  try {
    const source = await finalizeTemporaryAttachment({admin: context.admin, organizationId: context.organizationId, userId: context.user.id, purpose: "contract", recordId: contractId, pending});
    const {error} = await context.admin.from("service_contracts").update({
      source_document_storage_path: source.storagePath,
      source_document_file_name: source.fileName,
      source_document_mime_type: source.mimeType,
      source_document_size_bytes: source.sizeBytes,
      source_document_uploaded_at: now,
      source_document_uploaded_by: context.user.id,
      updated_by: context.user.id,
      updated_at: now,
    }).eq("id", contractId).eq("organization_id", context.organizationId);
    if (error) throw error;
    await audit(context, {providerId: contract.provider_id, contractId, action: "contract_source_attached", details: {fileName: source.fileName, sizeBytes: source.sizeBytes}});
  } catch (error) {
    await removePrivateAttachment(context.admin, pending.storagePath);
    go(error instanceof Error ? error.message : "Impossible d’archiver le document source.", "error", contractId);
  }
  revalidateContract(contractId);
  go("Contrat signé archivé comme document source immuable.", "success", contractId);
}

export async function updateContractImportMetadataAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const sourceMode = text(formData, "sourceMode", 30) || "native";
  const renewalType = text(formData, "renewalType", 20) || "manual";
  const clarityStatus = text(formData, "contractClarityStatus", 30) || "unchecked";
  if (!contractId || !SOURCE_MODES.has(sourceMode) || !RENEWAL_TYPES.has(renewalType) || !CLARITY_STATUSES.has(clarityStatus)) go("Métadonnées contractuelles invalides.", "error", contractId);
  const contract = await contractForExecution(context, contractId);
  const renewalPeriodMonths = optionalNumber(formData, "renewalPeriodMonths");
  const nonRenewalNoticeDays = optionalNumber(formData, "nonRenewalNoticeDays");
  const terminationNoticeDays = optionalNumber(formData, "terminationNoticeDays");
  const confidentialityMonths = optionalNumber(formData, "confidentialityPostTermMonths");
  const confidentialityIndefinite = text(formData, "confidentialityIndefinite", 10) === "on";
  const immediateTerminationTriggers = text(formData, "immediateTerminationTriggers", 5000);
  const clarityNote = text(formData, "contractClarityNote", 5000);
  const legacyExecutionNote = text(formData, "legacyExecutionNote", 5000);
  const trackingStartDate = dateValue(formData, "trackingStartDate") || null;
  const now = new Date().toISOString();
  const patch = {
    source_mode: sourceMode,
    tracking_start_date: trackingStartDate,
    renewal_type: renewalType,
    renewal_period_months: renewalPeriodMonths === null ? null : Math.max(1, Math.min(120, Math.round(renewalPeriodMonths))),
    non_renewal_notice_days: nonRenewalNoticeDays === null ? null : Math.max(0, Math.min(730, Math.round(nonRenewalNoticeDays))),
    termination_notice_days: terminationNoticeDays === null ? null : Math.max(0, Math.min(730, Math.round(terminationNoticeDays))),
    confidentiality_post_term_months: confidentialityIndefinite || confidentialityMonths === null ? null : Math.max(0, Math.min(1200, Math.round(confidentialityMonths))),
    confidentiality_indefinite: confidentialityIndefinite,
    immediate_termination_triggers: immediateTerminationTriggers,
    contract_clarity_status: clarityStatus,
    contract_clarity_note: clarityNote,
    legacy_execution_note: legacyExecutionNote,
    updated_by: context.user.id,
    updated_at: now,
  };
  const {error} = await context.admin.from("service_contracts").update(patch).eq("id", contractId).eq("organization_id", context.organizationId);
  if (error) go(`Métadonnées non mises à jour : ${error.message}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_import_metadata_updated", details: {sourceMode, renewalType, clarityStatus, trackingStartDate}});
  revalidateContract(contractId);
  go("Métadonnées d’import et clauses de gouvernance mises à jour.", "success", contractId);
}

export async function createContractObligationAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const contract = await contractForExecution(context, contractId);
  const title = text(formData, "title", 220);
  const description = text(formData, "description", 6000);
  const obligationType = text(formData, "obligationType", 30) || "activity";
  const responsibleParty = text(formData, "responsibleParty", 30) || "provider";
  const recurrence = text(formData, "recurrence", 30) || "once";
  const targetQuantity = optionalNumber(formData, "targetQuantity");
  const unit = text(formData, "unit", 80);
  const evidenceRequired = text(formData, "evidenceRequired", 10) === "on";
  const clauseReference = text(formData, "clauseReference", 240);
  const startDate = dateValue(formData, "startDate") || null;
  const endDate = dateValue(formData, "endDate") || null;
  const firstDueDate = dateValue(formData, "firstDueDate") || null;
  if (title.length < 2 || !OBLIGATION_TYPES.has(obligationType) || !OBLIGATION_PARTIES.has(responsibleParty) || !OBLIGATION_RECURRENCES.has(recurrence)) go("Obligation contractuelle invalide.", "error", contractId);
  const now = new Date().toISOString();
  const {data, error} = await context.admin.from("service_contract_obligations").insert({
    organization_id: context.organizationId, contract_id: contractId, title, description, obligation_type: obligationType, responsible_party: responsibleParty,
    recurrence, target_quantity: targetQuantity, unit, evidence_required: evidenceRequired, clause_reference: clauseReference,
    start_date: startDate, end_date: endDate, first_due_date: firstDueDate, status: "active", created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now,
  }).select("id").single<{id: string}>();
  if (error || !data) go(`Obligation impossible à créer : ${error?.message ?? "erreur inconnue"}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_obligation_created", details: {obligationId: data.id, title, obligationType, responsibleParty, recurrence, targetQuantity, unit, clauseReference}});
  revalidateContract(contractId);
  go("Obligation contractuelle ajoutée.", "success", contractId);
}

export async function generateContractObligationOccurrencesAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const contract = await contractForExecution(context, contractId);
  const horizonDays = Math.max(0, Math.min(120, Math.round(numberValue(formData, "horizonDays", 35))));
  const {data: obligationsData, error: obligationsError} = await context.admin.from("service_contract_obligations")
    .select("id,title,recurrence,target_quantity,start_date,end_date,first_due_date,status")
    .eq("organization_id", context.organizationId).eq("contract_id", contractId).eq("status", "active");
  if (obligationsError) go(`Obligations indisponibles : ${obligationsError.message}`, "error", contractId);
  const obligations = (obligationsData ?? []) as {id:string;title:string;recurrence:string;target_quantity:number|string|null;start_date:string|null;end_date:string|null;first_due_date:string|null;status:string}[];
  const {data: existingData} = await context.admin.from("service_contract_obligation_occurrences")
    .select("obligation_id,due_date").eq("organization_id", context.organizationId).eq("contract_id", contractId);
  const existing = new Set(((existingData ?? []) as {obligation_id:string;due_date:string}[]).map((row) => `${row.obligation_id}:${row.due_date}`));
  const today = new Date().toISOString().slice(0,10);
  const horizon = addDays(today, horizonDays);
  const rows: Record<string, unknown>[] = [];
  for (const obligation of obligations) {
    if (obligation.recurrence === "continuous") continue;
    let due = obligation.first_due_date || obligation.start_date || contract.end_date;
    const stop = [obligation.end_date, contract.end_date, horizon].filter(Boolean).sort()[0] as string;
    let previousEnd = obligation.start_date || due;
    let guard = 0;
    while (due <= stop && guard++ < 200) {
      const key = `${obligation.id}:${due}`;
      if (!existing.has(key)) {
        let periodStart = obligation.start_date || due;
        if (obligation.recurrence === "weekly") periodStart = addDays(due, -6);
        else if (obligation.recurrence === "monthly") periodStart = addDays(addMonths(due, -1), 1);
        else if (obligation.recurrence === "quarterly") periodStart = addDays(addMonths(due, -3), 1);
        else if (obligation.recurrence === "annual") periodStart = addDays(addMonths(due, -12), 1);
        if (periodStart < (obligation.start_date || contract.end_date)) periodStart = obligation.start_date || periodStart;
        rows.push({organization_id: context.organizationId, contract_id: contractId, obligation_id: obligation.id, period_start: periodStart, period_end: due, due_date: due, expected_quantity: obligation.target_quantity, status: "planned", created_by: context.user.id});
      }
      if (obligation.recurrence === "once") break;
      previousEnd = due;
      due = advanceDueDate(due, obligation.recurrence);
      if (due === previousEnd) break;
    }
  }
  if (rows.length) {
    const {error} = await context.admin.from("service_contract_obligation_occurrences").upsert(rows, {onConflict: "obligation_id,due_date", ignoreDuplicates: true});
    if (error) go(`Échéances non générées : ${error.message}`, "error", contractId);
  }
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_obligation_occurrences_generated", details: {createdCount: rows.length, horizonDays}});
  revalidateContract(contractId);
  go(`${rows.length} échéance(s) d’obligation synchronisée(s).`, "success", contractId);
}

export async function submitContractObligationOccurrenceAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const occurrenceId = text(formData, "occurrenceId", 80);
  const actualQuantity = optionalNumber(formData, "actualQuantity");
  const evidenceReference = text(formData, "evidenceReference", 2000);
  const submissionNote = text(formData, "submissionNote", 4000);
  const contract = await contractForExecution(context, contractId);
  const {data: occurrence} = await context.admin.from("service_contract_obligation_occurrences").select("id,obligation_id,due_date,status").eq("id", occurrenceId).eq("contract_id", contractId).eq("organization_id", context.organizationId).maybeSingle<{id:string;obligation_id:string;due_date:string;status:string}>();
  if (!occurrence) go("Échéance d’obligation introuvable.", "error", contractId);
  const now = new Date().toISOString();
  const {error} = await context.admin.from("service_contract_obligation_occurrences").update({actual_quantity: actualQuantity, evidence_reference: evidenceReference, submission_note: submissionNote, status: "submitted", submitted_by: context.user.id, submitted_at: now, updated_at: now}).eq("id", occurrenceId).eq("contract_id", contractId).eq("organization_id", context.organizationId);
  if (error) go(`Soumission impossible : ${error.message}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_obligation_occurrence_submitted", details: {occurrenceId, obligationId: occurrence.obligation_id, dueDate: occurrence.due_date, actualQuantity, evidenceReference}});
  revalidateContract(contractId);
  go("Réalisation de l’obligation soumise pour validation.", "success", contractId);
}

export async function reviewContractObligationOccurrenceAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const occurrenceId = text(formData, "occurrenceId", 80);
  const status = text(formData, "status", 30);
  const requestedScore = optionalNumber(formData, "reviewScore");
  const reviewNote = text(formData, "reviewNote", 4000);
  if (!OBLIGATION_OCCURRENCE_REVIEW.has(status)) go("Décision d’obligation invalide.", "error", contractId);
  if (["partial","rejected"].includes(status) && reviewNote.length < 3) go("Indique le motif de la validation partielle ou du rejet.", "error", contractId);
  const contract = await contractForExecution(context, contractId);
  const {data: occurrence} = await context.admin.from("service_contract_obligation_occurrences").select("id,obligation_id,due_date,expected_quantity,actual_quantity,status").eq("id", occurrenceId).eq("contract_id", contractId).eq("organization_id", context.organizationId).maybeSingle<{id:string;obligation_id:string;due_date:string;expected_quantity:number|string|null;actual_quantity:number|string|null;status:string}>();
  if (!occurrence) go("Échéance d’obligation introuvable.", "error", contractId);
  const expected = occurrence.expected_quantity === null ? null : Number(occurrence.expected_quantity);
  const actual = occurrence.actual_quantity === null ? null : Number(occurrence.actual_quantity);
  let score = status === "rejected" ? 0 : status === "waived" ? 100 : requestedScore;
  if (score === null && expected !== null && expected > 0 && actual !== null) score = clampScore(actual / expected * 100);
  if (score === null) score = status === "accepted" ? 100 : 50;
  score = clampScore(score);
  const now = new Date().toISOString();
  const {error} = await context.admin.from("service_contract_obligation_occurrences").update({status, review_score: score, review_note: reviewNote, reviewed_by: context.user.id, reviewed_at: now, updated_at: now}).eq("id", occurrenceId).eq("contract_id", contractId).eq("organization_id", context.organizationId);
  if (error) go(`Validation impossible : ${error.message}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_obligation_occurrence_reviewed", details: {occurrenceId, obligationId: occurrence.obligation_id, dueDate: occurrence.due_date, status, score, reviewNote}});
  revalidateContract(contractId);
  go("Échéance d’obligation validée et auditée.", "success", contractId);
}

export async function createContractCompensationRuleAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const contract = await contractForExecution(context, contractId);
  const label = text(formData, "label", 220);
  const ruleType = text(formData, "ruleType", 40) || "other";
  const cadence = text(formData, "cadence", 40) || "one_time";
  const amount = optionalNumber(formData, "amount");
  const percentage = optionalNumber(formData, "percentage");
  const thresholdMin = optionalNumber(formData, "thresholdMin");
  const thresholdMax = optionalNumber(formData, "thresholdMax");
  const currency = (text(formData, "currency", 8) || "USD").toUpperCase();
  const conditionText = text(formData, "conditionText", 4000);
  const clauseReference = text(formData, "clauseReference", 240);
  if (label.length < 2 || !COMPENSATION_RULE_TYPES.has(ruleType) || !COMPENSATION_CADENCES.has(cadence)) go("Règle de rémunération invalide.", "error", contractId);
  const now = new Date().toISOString();
  const {data, error} = await context.admin.from("service_contract_compensation_rules").insert({organization_id: context.organizationId, contract_id: contractId, label, rule_type: ruleType, cadence, amount, percentage, threshold_min: thresholdMin, threshold_max: thresholdMax, currency, condition_text: conditionText, clause_reference: clauseReference, is_active: true, created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now}).select("id").single<{id:string}>();
  if (error || !data) go(`Règle impossible à créer : ${error?.message ?? "erreur inconnue"}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_compensation_rule_created", details: {ruleId: data.id, label, ruleType, cadence, amount, percentage, thresholdMin, thresholdMax, currency, clauseReference}});
  revalidateContract(contractId);
  go("Règle de rémunération / avantage ajoutée.", "success", contractId);
}

async function contractFinancialGate(
  context: Awaited<ReturnType<typeof requireAccessContext>>,
  contractId: string,
  periodStart: string,
  periodEnd: string,
) {
  const {data: obligationData, error: obligationError} = await context.admin
    .from("service_contract_obligations")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("contract_id", contractId)
    .eq("status", "active")
    .in("responsible_party", ["provider", "both"]);
  if (obligationError) return {status: "review" as const, note: `Obligations indisponibles : ${obligationError.message}`};
  const obligationIds = ((obligationData ?? []) as {id:string}[]).map((row) => row.id);
  if (!obligationIds.length) return {status: "ready" as const, note: "Aucune obligation prestataire structurée applicable."};

  let occurrenceQuery = context.admin
    .from("service_contract_obligation_occurrences")
    .select("id,status,due_date")
    .eq("organization_id", context.organizationId)
    .eq("contract_id", contractId)
    .in("obligation_id", obligationIds);
  if (periodStart) occurrenceQuery = occurrenceQuery.gte("due_date", periodStart);
  if (periodEnd) occurrenceQuery = occurrenceQuery.lte("due_date", periodEnd);
  const {data: occurrenceData, error: occurrenceError} = await occurrenceQuery;
  if (occurrenceError) return {status: "review" as const, note: `Échéances indisponibles : ${occurrenceError.message}`};
  const occurrences = (occurrenceData ?? []) as {id:string;status:string;due_date:string}[];
  if (!occurrences.length) return {status: "review" as const, note: "Aucune échéance d’obligation générée pour cette période : validation humaine requise."};

  const blocking = occurrences.filter((row) => ["planned", "submitted", "rejected"].includes(row.status));
  if (blocking.length) return {status: "blocked" as const, note: `${blocking.length} obligation(s) non validée(s) ou rejetée(s) sur la période.`};
  const partial = occurrences.filter((row) => row.status === "partial");
  if (partial.length) return {status: "review" as const, note: `${partial.length} obligation(s) partiellement validée(s) : revue humaine requise.`};
  return {status: "ready" as const, note: `${occurrences.length} obligation(s) de la période validée(s) ou dispensée(s).`};
}

export async function createContractFinancialItemAction(formData: FormData) {
  const context = await requireAccessContext();
  const contractId = text(formData, "contractId", 80);
  const ruleId = text(formData, "ruleId", 80);
  const periodStart = dateValue(formData, "periodStart");
  const periodEnd = dateValue(formData, "periodEnd");
  const dueDate = dateValue(formData, "dueDate") || periodEnd || null;
  const baseAmount = optionalNumber(formData, "baseAmount");
  const quantity = Math.max(0, optionalNumber(formData, "quantity") ?? 1);
  const sourceReference = text(formData, "sourceReference", 2000);
  const requestNote = text(formData, "requestNote", 4000);
  if (periodStart && periodEnd && periodEnd < periodStart) go("Période financière invalide.", "error", contractId);
  const contract = await contractForExecution(context, contractId);
  const {data: rule, error: ruleError} = await context.admin.from("service_contract_compensation_rules")
    .select("id,label,rule_type,cadence,amount,percentage,threshold_min,threshold_max,currency,is_active")
    .eq("id", ruleId).eq("contract_id", contractId).eq("organization_id", context.organizationId).maybeSingle<{
      id:string;label:string;rule_type:string;cadence:string;amount:number|string|null;percentage:number|string|null;threshold_min:number|string|null;threshold_max:number|string|null;currency:string;is_active:boolean
    }>();
  if (ruleError || !rule || !rule.is_active) go("Règle de rémunération introuvable ou inactive.", "error", contractId);

  const amount = rule.amount === null ? 0 : Number(rule.amount);
  const percentage = rule.percentage === null ? 0 : Number(rule.percentage);
  const base = baseAmount ?? 0;
  let calculatedAmount = 0;
  if (rule.rule_type === "fixed_periodic") calculatedAmount = amount;
  else if (rule.rule_type === "fixed_event") calculatedAmount = amount * quantity;
  else if (rule.rule_type === "percentage") {
    if (baseAmount === null) go("Indique le montant de base pour calculer la commission en pourcentage.", "error", contractId);
    calculatedAmount = base * percentage / 100;
  } else if (rule.rule_type === "threshold") {
    if (baseAmount === null) go("Indique le montant de base pour tester le seuil contractuel.", "error", contractId);
    const min = rule.threshold_min === null ? null : Number(rule.threshold_min);
    const max = rule.threshold_max === null ? null : Number(rule.threshold_max);
    if ((min !== null && base < min) || (max !== null && base > max)) go("Le montant de base ne satisfait pas le seuil de cette règle.", "error", contractId);
    calculatedAmount = amount + (percentage ? base * percentage / 100 : 0);
  } else if (rule.rule_type === "benefit") calculatedAmount = amount;
  else calculatedAmount = amount + (percentage && baseAmount !== null ? base * percentage / 100 : 0);
  calculatedAmount = Math.round(Math.max(0, calculatedAmount) * 100) / 100;
  if (rule.rule_type !== "benefit" && calculatedAmount <= 0) go("Le calcul produit un montant nul. Vérifie la règle et les données de base.", "error", contractId);

  const gate = await contractFinancialGate(context, contractId, periodStart, periodEnd);
  const now = new Date().toISOString();
  const {data, error} = await context.admin.from("service_contract_financial_items").insert({
    organization_id: context.organizationId, contract_id: contractId, compensation_rule_id: rule.id,
    item_type: rule.rule_type === "benefit" ? "benefit" : "compensation", period_start: periodStart || null, period_end: periodEnd || null,
    due_date: dueDate, base_amount: baseAmount, quantity, calculated_amount: calculatedAmount, currency: rule.currency,
    gate_status: gate.status, gate_note: gate.note, status: "pending", source_reference: sourceReference, request_note: requestNote,
    created_by: context.user.id, created_at: now, updated_at: now,
  }).select("id").single<{id:string}>();
  if (error || !data) go(`Échéance financière impossible à créer : ${error?.message ?? "erreur inconnue"}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_financial_item_created", details: {financialItemId: data.id, ruleId: rule.id, label: rule.label, ruleType: rule.rule_type, periodStart, periodEnd, baseAmount, quantity, calculatedAmount, currency: rule.currency, gateStatus: gate.status}});
  revalidateContract(contractId);
  go(gate.status === "blocked" ? "Échéance calculée mais bloquée par des obligations non validées." : "Échéance financière calculée et envoyée pour validation.", "success", contractId);
}

export async function reviewContractFinancialItemAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const itemId = text(formData, "itemId", 80);
  const decision = text(formData, "decision", 30);
  const reviewNote = text(formData, "reviewNote", 4000);
  if (!FINANCIAL_REVIEW_DECISIONS.has(decision)) go("Décision financière invalide.", "error", contractId);
  const contract = await contractForExecution(context, contractId);
  const {data: item} = await context.admin.from("service_contract_financial_items")
    .select("id,period_start,period_end,status,calculated_amount,item_type")
    .eq("id", itemId).eq("contract_id", contractId).eq("organization_id", context.organizationId).maybeSingle<{id:string;period_start:string|null;period_end:string|null;status:string;calculated_amount:number|string;item_type:string}>();
  if (!item || !["pending","held"].includes(item.status)) go("Échéance financière non disponible pour cette décision.", "error", contractId);
  const gate = await contractFinancialGate(context, contractId, item.period_start ?? "", item.period_end ?? "");
  if (decision === "approved" && gate.status === "blocked") go(`Approbation impossible : ${gate.note}`, "error", contractId);
  if (decision === "approved" && gate.status === "review" && reviewNote.length < 3) go("Ajoute une justification pour approuver malgré une situation nécessitant une revue.", "error", contractId);
  if (["held","rejected"].includes(decision) && reviewNote.length < 3) go("Indique le motif de la mise en attente ou du rejet.", "error", contractId);
  const now = new Date().toISOString();
  const {error} = await context.admin.from("service_contract_financial_items").update({status: decision, gate_status: gate.status, gate_note: gate.note, review_note: reviewNote, reviewed_by: context.user.id, reviewed_at: now, updated_at: now}).eq("id", itemId).eq("contract_id", contractId).eq("organization_id", context.organizationId);
  if (error) go(`Décision financière impossible : ${error.message}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_financial_item_reviewed", details: {financialItemId: itemId, decision, calculatedAmount: Number(item.calculated_amount), gateStatus: gate.status, reviewNote}});
  revalidateContract(contractId);
  go(decision === "approved" ? "Échéance contractuelle approuvée. Elle peut maintenant être réglée hors du moteur contractuel." : decision === "held" ? "Échéance mise en attente." : "Échéance rejetée.", "success", contractId);
}

export async function settleContractFinancialItemAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const itemId = text(formData, "itemId", 80);
  const settlementReference = text(formData, "settlementReference", 2000);
  const requestedAmount = optionalNumber(formData, "settledAmount");
  const contract = await contractForExecution(context, contractId);
  const {data: item} = await context.admin.from("service_contract_financial_items")
    .select("id,status,item_type,calculated_amount,currency")
    .eq("id", itemId).eq("contract_id", contractId).eq("organization_id", context.organizationId).maybeSingle<{id:string;status:string;item_type:string;calculated_amount:number|string;currency:string}>();
  if (!item || item.status !== "approved") go("Seule une échéance approuvée peut être marquée comme réglée.", "error", contractId);
  if (settlementReference.length < 3) go("Indique une référence de paiement, reçu, avantage remis ou preuve de règlement.", "error", contractId);
  const settledAmount = item.item_type === "benefit" ? (requestedAmount ?? Number(item.calculated_amount)) : (requestedAmount ?? Number(item.calculated_amount));
  if (!Number.isFinite(settledAmount) || settledAmount < 0) go("Montant réglé invalide.", "error", contractId);
  const status = item.item_type === "benefit" ? "delivered" : "paid";
  const now = new Date().toISOString();
  const {error} = await context.admin.from("service_contract_financial_items").update({status, settlement_reference: settlementReference, settled_amount: settledAmount, settled_by: context.user.id, settled_at: now, updated_at: now}).eq("id", itemId).eq("contract_id", contractId).eq("organization_id", context.organizationId);
  if (error) go(`Règlement impossible à enregistrer : ${error.message}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_financial_item_settled", details: {financialItemId: itemId, status, settledAmount, currency: item.currency, settlementReference}});
  revalidateContract(contractId);
  go(item.item_type === "benefit" ? "Avantage contractuel marqué comme remis." : "Paiement contractuel marqué comme effectué.", "success", contractId);
}

export async function createContractDocumentAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const documentType = text(formData, "documentType", 40) || "other";
  const title = text(formData, "title", 240);
  const description = text(formData, "description", 5000);
  const documentDate = dateValue(formData, "documentDate") || null;
  const pending = readPendingAttachment(formData, "contractDocument");
  if (!contractId || !CONTRACT_DOCUMENT_TYPES.has(documentType) || title.length < 2 || !pending) {
    go("Document contractuel incomplet.", "error", contractId);
  }
  const contract = await contractForExecution(context, contractId);
  const documentId = randomUUID();
  try {
    const file = await finalizeTemporaryAttachment({
      admin: context.admin,
      organizationId: context.organizationId,
      userId: context.user.id,
      purpose: "contract",
      recordId: documentId,
      pending,
    });
    const {error} = await context.admin.from("service_contract_documents").insert({
      id: documentId,
      organization_id: context.organizationId,
      contract_id: contractId,
      document_type: documentType,
      title,
      description,
      document_date: documentDate,
      storage_path: file.storagePath,
      file_name: file.fileName,
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
      is_immutable: true,
      created_by: context.user.id,
    });
    if (error) throw error;
    await audit(context, {
      providerId: contract.provider_id,
      contractId,
      action: "contract_document_added",
      details: {documentId, documentType, title, documentDate, fileName: file.fileName, sizeBytes: file.sizeBytes},
    });
  } catch (error) {
    await removePrivateAttachment(context.admin, pending.storagePath);
    go(error instanceof Error ? error.message : "Impossible d’archiver le document contractuel.", "error", contractId);
  }
  revalidateContract(contractId);
  revalidatePath("/dashboard/contracts/documents");
  go("Document contractuel archivé. Il est désormais immuable.", "success", contractId);
}

export async function createContractAmendmentAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const title = text(formData, "title", 240);
  const reason = text(formData, "reason", 5000);
  const effectiveDate = dateValue(formData, "effectiveDate");
  if (!contractId || title.length < 2 || reason.length < 3 || !effectiveDate) {
    go("Titre, motif et date d’effet de l’avenant sont obligatoires.", "error", contractId);
  }
  const contract = await contractForExecution(context, contractId);
  const {data: current, error: currentError} = await context.admin.from("service_contracts")
    .select("id,current_version,end_date,value_amount,currency,service_scope,payment_terms,performance_target,renewal_notice_days")
    .eq("id", contractId).eq("organization_id", context.organizationId)
    .maybeSingle<{id:string;current_version:number;end_date:string;value_amount:number|string;currency:string;service_scope:string;payment_terms:string;performance_target:number|string;renewal_notice_days:number}>();
  if (currentError || !current) go("Contrat introuvable pour préparer l’avenant.", "error", contractId);

  const changes: Record<string, {from: string | number; to: string | number}> = {};
  const newEndDate = dateValue(formData, "newEndDate");
  const rawValue = text(formData, "newValueAmount", 80);
  const newValueAmount = rawValue ? Number(rawValue) : null;
  const newCurrency = text(formData, "newCurrency", 8).toUpperCase();
  const newServiceScope = text(formData, "newServiceScope", 6000);
  const newPaymentTerms = text(formData, "newPaymentTerms", 5000);
  const rawTarget = text(formData, "newPerformanceTarget", 80);
  const newPerformanceTarget = rawTarget ? Number(rawTarget) : null;
  const rawNotice = text(formData, "newRenewalNoticeDays", 40);
  const newRenewalNoticeDays = rawNotice ? Number(rawNotice) : null;

  if (newEndDate && newEndDate !== current.end_date) changes.end_date = {from: current.end_date, to: newEndDate};
  if (newValueAmount !== null && Number.isFinite(newValueAmount) && newValueAmount >= 0 && newValueAmount !== Number(current.value_amount)) changes.value_amount = {from: Number(current.value_amount), to: newValueAmount};
  if (newCurrency && newCurrency !== current.currency) changes.currency = {from: current.currency, to: newCurrency};
  if (newServiceScope && newServiceScope !== current.service_scope) changes.service_scope = {from: current.service_scope, to: newServiceScope};
  if (newPaymentTerms && newPaymentTerms !== current.payment_terms) changes.payment_terms = {from: current.payment_terms, to: newPaymentTerms};
  if (newPerformanceTarget !== null && Number.isFinite(newPerformanceTarget) && newPerformanceTarget >= 0 && newPerformanceTarget <= 100 && newPerformanceTarget !== Number(current.performance_target)) changes.performance_target = {from: Number(current.performance_target), to: newPerformanceTarget};
  if (newRenewalNoticeDays !== null && Number.isFinite(newRenewalNoticeDays) && newRenewalNoticeDays >= 0 && newRenewalNoticeDays <= 730 && Math.round(newRenewalNoticeDays) !== current.renewal_notice_days) changes.renewal_notice_days = {from: current.renewal_notice_days, to: Math.round(newRenewalNoticeDays)};
  if (!Object.keys(changes).length) go("Aucune modification contractuelle n’a été renseignée.", "error", contractId);

  const {data: last} = await context.admin.from("service_contract_amendments")
    .select("amendment_number")
    .eq("organization_id", context.organizationId).eq("contract_id", contractId)
    .order("amendment_number", {ascending: false}).limit(1).maybeSingle<{amendment_number:number}>();
  const amendmentNumber = (last?.amendment_number ?? 0) + 1;
  const amendmentId = randomUUID();
  const pending = readPendingAttachment(formData, "amendmentDocument");
  let documentId: string | null = null;
  let finalizedPath: string | null = null;
  try {
    if (pending) {
      documentId = randomUUID();
      const file = await finalizeTemporaryAttachment({
        admin: context.admin,
        organizationId: context.organizationId,
        userId: context.user.id,
        purpose: "contract",
        recordId: documentId,
        pending,
      });
      finalizedPath = file.storagePath;
      const {error: docError} = await context.admin.from("service_contract_documents").insert({
        id: documentId,
        organization_id: context.organizationId,
        contract_id: contractId,
        document_type: "amendment",
        title: `Avenant n°${amendmentNumber} — ${title}`,
        description: reason,
        document_date: effectiveDate,
        storage_path: file.storagePath,
        file_name: file.fileName,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
        is_immutable: true,
        created_by: context.user.id,
      });
      if (docError) throw docError;
    }
    const now = new Date().toISOString();
    const {error} = await context.admin.from("service_contract_amendments").insert({
      id: amendmentId,
      organization_id: context.organizationId,
      contract_id: contractId,
      amendment_number: amendmentNumber,
      title,
      reason,
      effective_date: effectiveDate,
      status: documentId ? "ready" : "draft",
      changes,
      previous_version: current.current_version,
      resulting_version: current.current_version + 1,
      document_id: documentId,
      created_by: context.user.id,
      updated_by: context.user.id,
      created_at: now,
      updated_at: now,
    });
    if (error) throw error;
    await audit(context, {
      providerId: contract.provider_id,
      contractId,
      action: "contract_amendment_created",
      details: {amendmentId, amendmentNumber, title, effectiveDate, previousVersion: current.current_version, resultingVersion: current.current_version + 1, changes, hasSignedDocument: Boolean(documentId)},
    });
  } catch (error) {
    if (finalizedPath) await removePrivateAttachment(context.admin, finalizedPath);
    else if (pending) await removePrivateAttachment(context.admin, pending.storagePath);
    if (documentId) await context.admin.from("service_contract_documents").delete().eq("id", documentId).eq("organization_id", context.organizationId);
    go(error instanceof Error ? error.message : "Impossible de préparer l’avenant.", "error", contractId);
  }
  revalidateContract(contractId);
  revalidatePath("/dashboard/contracts/documents");
  go(documentId ? "Avenant préparé avec document signé. Il est prêt à être appliqué." : "Projet d’avenant créé. Ajoute le document signé avant application.", "success", contractId);
}

export async function attachContractAmendmentDocumentAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const amendmentId = text(formData, "amendmentId", 80);
  const pending = readPendingAttachment(formData, "amendmentDocument");
  if (!contractId || !amendmentId || !pending) go("Document d’avenant manquant.", "error", contractId);
  const contract = await contractForExecution(context, contractId);
  const {data: amendment} = await context.admin.from("service_contract_amendments")
    .select("id,amendment_number,title,reason,effective_date,status,document_id")
    .eq("id", amendmentId).eq("contract_id", contractId).eq("organization_id", context.organizationId)
    .maybeSingle<{id:string;amendment_number:number;title:string;reason:string;effective_date:string;status:string;document_id:string|null}>();
  if (!amendment || amendment.status !== "draft" || amendment.document_id) go("Cet avenant n’accepte plus de nouveau document.", "error", contractId);
  const documentId = randomUUID();
  let finalizedPath: string | null = null;
  try {
    const file = await finalizeTemporaryAttachment({admin: context.admin, organizationId: context.organizationId, userId: context.user.id, purpose: "contract", recordId: documentId, pending});
    finalizedPath = file.storagePath;
    const {error: docError} = await context.admin.from("service_contract_documents").insert({
      id: documentId, organization_id: context.organizationId, contract_id: contractId, document_type: "amendment",
      title: `Avenant n°${amendment.amendment_number} — ${amendment.title}`, description: amendment.reason,
      document_date: amendment.effective_date, storage_path: file.storagePath, file_name: file.fileName, mime_type: file.mimeType,
      size_bytes: file.sizeBytes, is_immutable: true, created_by: context.user.id,
    });
    if (docError) throw docError;
    const {error} = await context.admin.from("service_contract_amendments").update({document_id: documentId, status: "ready", updated_by: context.user.id, updated_at: new Date().toISOString()})
      .eq("id", amendmentId).eq("contract_id", contractId).eq("organization_id", context.organizationId);
    if (error) throw error;
    await audit(context, {providerId: contract.provider_id, contractId, action: "contract_amendment_document_attached", details: {amendmentId, amendmentNumber: amendment.amendment_number, documentId, fileName: file.fileName}});
  } catch (error) {
    if (finalizedPath) await removePrivateAttachment(context.admin, finalizedPath); else await removePrivateAttachment(context.admin, pending.storagePath);
    await context.admin.from("service_contract_documents").delete().eq("id", documentId).eq("organization_id", context.organizationId);
    go(error instanceof Error ? error.message : "Impossible d’attacher le document signé.", "error", contractId);
  }
  revalidateContract(contractId);
  revalidatePath("/dashboard/contracts/documents");
  go("Document signé attaché. L’avenant est prêt à être appliqué.", "success", contractId);
}

export async function applyContractAmendmentAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const amendmentId = text(formData, "amendmentId", 80);
  const confirmation = text(formData, "confirmation", 20);
  if (confirmation !== "APPLY") go("Confirmation d’application de l’avenant manquante.", "error", contractId);
  const contract = await contractForExecution(context, contractId);
  const {data: amendment} = await context.admin.from("service_contract_amendments")
    .select("id,amendment_number,title,effective_date,status,changes,previous_version,resulting_version,document_id")
    .eq("id", amendmentId).eq("contract_id", contractId).eq("organization_id", context.organizationId)
    .maybeSingle<{id:string;amendment_number:number;title:string;effective_date:string;status:string;changes:Record<string,{from:unknown;to:unknown}>;previous_version:number;resulting_version:number;document_id:string|null}>();
  if (!amendment || amendment.status !== "ready" || !amendment.document_id) go("L’avenant doit être prêt et accompagné de son document signé.", "error", contractId);
  const todayIso = new Date().toISOString().slice(0, 10);
  if (amendment.effective_date > todayIso) {
    go(`Cet avenant prend effet le ${amendment.effective_date}. Il ne peut pas être appliqué avant sa date d’effet.`, "error", contractId);
  }
  const {data: current} = await context.admin.from("service_contracts").select("current_version")
    .eq("id", contractId).eq("organization_id", context.organizationId).maybeSingle<{current_version:number}>();
  if (!current || current.current_version !== amendment.previous_version) go("Une autre version du contrat a été appliquée depuis la création de cet avenant. Crée un nouvel avenant rebasé sur la version actuelle.", "error", contractId);
  const allowed = new Set(["end_date", "value_amount", "currency", "service_scope", "payment_terms", "performance_target", "renewal_notice_days"]);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(amendment.changes ?? {})) {
    if (allowed.has(key) && value && typeof value === "object" && "to" in value) patch[key] = value.to;
  }
  if (!Object.keys(patch).length) go("Aucune modification applicable dans cet avenant.", "error", contractId);
  const now = new Date().toISOString();
  const {error: contractError} = await context.admin.from("service_contracts").update({
    ...patch,
    current_version: amendment.resulting_version,
    last_amendment_at: now,
    updated_by: context.user.id,
    updated_at: now,
  }).eq("id", contractId).eq("organization_id", context.organizationId).eq("current_version", amendment.previous_version);
  if (contractError) go(`Application de l’avenant impossible : ${contractError.message}`, "error", contractId);
  const {error: amendmentError} = await context.admin.from("service_contract_amendments").update({
    status: "applied", applied_by: context.user.id, applied_at: now, updated_by: context.user.id, updated_at: now,
  }).eq("id", amendmentId).eq("contract_id", contractId).eq("organization_id", context.organizationId);
  if (amendmentError) go(`Le contrat a été mis à jour mais la clôture de l’avenant a échoué : ${amendmentError.message}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_amendment_applied", details: {amendmentId, amendmentNumber: amendment.amendment_number, title: amendment.title, effectiveDate: amendment.effective_date, previousVersion: amendment.previous_version, resultingVersion: amendment.resulting_version, changes: amendment.changes}});
  revalidateContract(contractId);
  revalidatePath("/dashboard/contracts/documents");
  go(`Avenant n°${amendment.amendment_number} appliqué. Le contrat est maintenant en version V${amendment.resulting_version}.`, "success", contractId);
}

export async function cancelContractAmendmentAction(formData: FormData) {
  const context = await requireAccessContext();
  ensureAdministrator(context.role);
  const contractId = text(formData, "contractId", 80);
  const amendmentId = text(formData, "amendmentId", 80);
  const reason = text(formData, "reason", 3000);
  if (reason.length < 3) go("Indique le motif d’annulation de l’avenant.", "error", contractId);
  const contract = await contractForExecution(context, contractId);
  const {data: amendment} = await context.admin.from("service_contract_amendments").select("id,amendment_number,status")
    .eq("id", amendmentId).eq("contract_id", contractId).eq("organization_id", context.organizationId).maybeSingle<{id:string;amendment_number:number;status:string}>();
  if (!amendment || !["draft","ready"].includes(amendment.status)) go("Cet avenant ne peut plus être annulé.", "error", contractId);
  const now = new Date().toISOString();
  const {error} = await context.admin.from("service_contract_amendments").update({status: "cancelled", cancellation_reason: reason, cancelled_by: context.user.id, cancelled_at: now, updated_by: context.user.id, updated_at: now})
    .eq("id", amendmentId).eq("organization_id", context.organizationId);
  if (error) go(`Annulation impossible : ${error.message}`, "error", contractId);
  await audit(context, {providerId: contract.provider_id, contractId, action: "contract_amendment_cancelled", details: {amendmentId, amendmentNumber: amendment.amendment_number, reason}});
  revalidateContract(contractId);
  revalidatePath("/dashboard/contracts/documents");
  go(`Avenant n°${amendment.amendment_number} annulé et conservé dans l’historique.`, "success", contractId);
}

