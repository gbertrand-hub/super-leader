import Link from "next/link";
import {redirect} from "next/navigation";
import {
  createContractDeliverableAction,
  createContractExecutionReportAction,
  createContractKpiAction,
  createContractIncidentAction,
  createContractObligationAction,
  createContractCompensationRuleAction,
  createContractFinancialItemAction,
  createContractDocumentAction,
  createContractAmendmentAction,
  attachContractAmendmentDocumentAction,
  applyContractAmendmentAction,
  cancelContractAmendmentAction,
  reviewContractFinancialItemAction,
  settleContractFinancialItemAction,
  generateContractObligationOccurrencesAction,
  submitContractObligationOccurrenceAction,
  reviewContractObligationOccurrenceAction,
  attachContractSourceDocumentAction,
  updateContractImportMetadataAction,
  recordContractKpiResultAction,
  recordContractRenewalDecisionAction,
  reviewContractExecutionReportAction,
  reviewContractKpiResultAction,
  updateContractDeliverableAction,
  updateContractIncidentAction,
  updateServiceContractStatusAction,
} from "@/app/actions/service-contracts";
import {getI18n} from "@/i18n/server";
import {SecureAttachmentUpload} from "@/components/forms/secure-attachment-upload";
import {requireAccessContext} from "@/lib/auth/access-control";

type ContractRow = {
  id: string; provider_id: string; contract_number: string; title: string; service_scope: string; department: string | null;
  internal_owner_user_id: string; start_date: string; end_date: string; value_amount: number | string; currency: string;
  payment_terms: string; status: string; renewal_notice_days: number; performance_target: number | string; notes: string;
  activated_at: string | null; activated_by: string | null; created_at: string; updated_at: string; current_version: number; last_amendment_at: string | null;
  source_mode: string; source_document_storage_path: string | null; source_document_file_name: string | null; source_document_mime_type: string | null; source_document_size_bytes: number | null; source_document_uploaded_at: string | null; source_document_uploaded_by: string | null;
  imported_at: string | null; imported_by: string | null; tracking_start_date: string | null; renewal_type: string; renewal_period_months: number | null; non_renewal_notice_days: number | null; termination_notice_days: number | null; confidentiality_post_term_months: number | null; confidentiality_indefinite: boolean; immediate_termination_triggers: string; contract_clarity_status: string; contract_clarity_note: string; legacy_execution_note: string;
};
type ProviderRow = {id: string; legal_name: string; trading_name: string | null; service_category: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null; country: string | null; status: string};
type AuditRow = {id: string; actor_id: string | null; action: string; details: Record<string, unknown>; created_at: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type DeliverableRow = {id: string; title: string; description: string; due_date: string; weight: number | string; status: string; evidence_reference: string; submission_note: string; review_note: string; review_score: number | string | null; review_outcome: string | null; submitted_at: string | null; reviewed_at: string | null; reviewed_by: string | null; created_at: string};
type ReportRow = {id: string; period_start: string; period_end: string; work_completed: string; challenges: string; next_actions: string; evidence_reference: string; status: string; review_note: string; submitted_by: string; submitted_at: string; reviewed_by: string | null; reviewed_at: string | null};
type KpiRow = {id: string; name: string; description: string; unit: string; target_value: number | string; weight: number | string; direction: string; is_active: boolean; created_at: string};
type KpiResultRow = {id: string; kpi_id: string; period_start: string; period_end: string; actual_value: number | string | null; score: number | string; comment: string; status: string; review_note: string; recorded_by: string; reviewed_by: string | null; reviewed_at: string | null; created_at: string};
type IncidentRow = {id: string; title: string; description: string; severity: string; status: string; corrective_action: string; owner_user_id: string | null; due_date: string | null; resolution_note: string; resolved_at: string | null; resolved_by: string | null; created_by: string; created_at: string; updated_at: string};
type RenewalReviewRow = {id: string; performance_score: number | string | null; kpi_score: number | string | null; deliverable_score: number | string | null; incident_penalty: number | string; open_incidents: number; critical_incidents: number; recommended_action: string; final_decision: string; decision_note: string; review_stage: string; review_kind: string; days_remaining: number | null; is_final: boolean; decided_by: string; decided_at: string};
type ObligationRow = {id: string; title: string; description: string; obligation_type: string; responsible_party: string; recurrence: string; target_quantity: number | string | null; unit: string; evidence_required: boolean; clause_reference: string; start_date: string | null; end_date: string | null; first_due_date: string | null; status: string; created_at: string};
type ObligationOccurrenceRow = {id: string; obligation_id: string; period_start: string | null; period_end: string | null; due_date: string; expected_quantity: number | string | null; actual_quantity: number | string | null; status: string; evidence_reference: string; submission_note: string; review_note: string; review_score: number | string | null; submitted_by: string | null; submitted_at: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string};
type CompensationRuleRow = {id: string; label: string; rule_type: string; cadence: string; amount: number | string | null; percentage: number | string | null; threshold_min: number | string | null; threshold_max: number | string | null; currency: string; condition_text: string; clause_reference: string; is_active: boolean; created_at: string};
type FinancialItemRow = {id:string; compensation_rule_id:string; item_type:string; period_start:string|null; period_end:string|null; due_date:string|null; base_amount:number|string|null; quantity:number|string; calculated_amount:number|string; currency:string; gate_status:string; gate_note:string; status:string; source_reference:string; request_note:string; review_note:string; settlement_reference:string; settled_amount:number|string|null; created_by:string; reviewed_by:string|null; reviewed_at:string|null; settled_by:string|null; settled_at:string|null; created_at:string};
type ContractDocumentRow = {id:string; document_type:string; title:string; description:string; document_date:string|null; file_name:string; mime_type:string; size_bytes:number|string; is_immutable:boolean; created_by:string; created_at:string};
type ContractAmendmentRow = {id:string; amendment_number:number; title:string; reason:string; effective_date:string; status:string; changes:Record<string,{from:unknown;to:unknown}>; previous_version:number; resulting_version:number; document_id:string|null; created_by:string; created_at:string; updated_by:string; updated_at:string; applied_by:string|null; applied_at:string|null; cancelled_by:string|null; cancelled_at:string|null; cancellation_reason:string};

const ADMIN_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const DONE_DELIVERABLES = new Set(["accepted", "cancelled"]);
type ContractPassportTab = "overview" | "contract" | "execution" | "performance" | "finance" | "documents" | "risks" | "history";
const CONTRACT_PASSPORT_TABS: ContractPassportTab[] = ["overview", "contract", "execution", "performance", "finance", "documents", "risks", "history"];

function daysUntil(date: string) {
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.ceil((target - start) / 86400000);
}
function money(value: number | string, currency: string, locale: string) {
  const amount = Number(value || 0);
  try { return new Intl.NumberFormat(locale, {style: "currency", currency}).format(amount); }
  catch { return `${amount.toLocaleString(locale)} ${currency}`; }
}
function statusTone(status: string) {return ["active","renewed"].includes(status) ? "bg-emerald-100 text-emerald-800" : ["suspended","terminated"].includes(status) ? "bg-red-100 text-red-800" : status === "under_review" ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700";}
function deliverableTone(status: string, overdue: boolean) {
  if (overdue) return "bg-red-100 text-red-800";
  if (status === "accepted") return "bg-emerald-100 text-emerald-800";
  if (status === "rejected") return "bg-red-100 text-red-800";
  if (status === "submitted") return "bg-indigo-100 text-indigo-800";
  if (status === "in_progress") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}
function fieldClass() {return "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500";}
function pct(value: number | null) {return value === null ? "—" : `${value.toFixed(1)} %`;}
function dateTime(value: string | null, locale: string) {return value ? new Intl.DateTimeFormat(locale, {dateStyle: "medium", timeStyle: "short"}).format(new Date(value)) : "—";}
function kpiResultTone(status: string) {
  if (status === "accepted") return "bg-emerald-100 text-emerald-800";
  if (status === "rejected") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-900";
}
function incidentTone(severity: string) {
  if (severity === "critical") return "bg-red-700 text-white";
  if (severity === "high") return "bg-red-100 text-red-800";
  if (severity === "medium") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}
function dateMinusDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
function reviewStageLabel(value: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    orientation: ["Orientation provisoire", "Provisional orientation"],
    j90: ["Revue J-90", "D-90 review"],
    j60: ["Revue J-60", "D-60 review"],
    j30: ["Revue J-30", "D-30 review"],
    final: ["Décision finale", "Final decision"],
    urgent: ["Décision urgente", "Urgent decision"],
  };
  const label = labels[value];
  return label ? (fr ? label[0] : label[1]) : value;
}
function renewalDecisionLabel(value: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    renew: ["Renouveler", "Renew"],
    renew_with_conditions: ["Renouveler sous conditions", "Renew with conditions"],
    extend: ["Prolonger temporairement", "Extend temporarily"],
    suspend: ["Suspendre", "Suspend"],
    do_not_renew: ["Ne pas renouveler", "Do not renew"],
    terminate: ["Résilier", "Terminate"],
    insufficient_data: ["Données insuffisantes", "Insufficient data"],
    suspend_review: ["Revue de suspension urgente", "Urgent suspension review"],
    do_not_renew_review: ["Revue de non-renouvellement", "Non-renewal review"],
  };
  const label = labels[value];
  return label ? (fr ? label[0] : label[1]) : value.replaceAll("_", " ");
}
function detailText(details: Record<string, unknown>, key: string) {
  const value = details?.[key];
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}
function auditPresentation(row: AuditRow, fr: boolean) {
  const d = row.details || {};
  const action = row.action;
  const period = [detailText(d, "periodStart"), detailText(d, "periodEnd")].filter(Boolean).join(" → ");
  const status = detailText(d, "status");
  const score = detailText(d, "score");
  const mapping: Record<string, {titleFr: string; titleEn: string; summary: string; tone: string}> = {
    contract_created: {titleFr: "Contrat créé", titleEn: "Contract created", summary: [detailText(d, "title"), detailText(d, "contractNumber")].filter(Boolean).join(" · "), tone: "border-slate-200 bg-slate-50"},
    contract_imported: {titleFr: "Contrat existant importé", titleEn: "Existing contract imported", summary: [detailText(d, "title"), detailText(d, "sourceMode"), detailText(d, "status")].filter(Boolean).join(" · "), tone: "border-cyan-200 bg-cyan-50"},
    contract_source_attached: {titleFr: "Document contractuel source archivé", titleEn: "Source contract document archived", summary: detailText(d, "fileName"), tone: "border-cyan-200 bg-cyan-50"},
    contract_import_metadata_updated: {titleFr: "Métadonnées contractuelles mises à jour", titleEn: "Contract metadata updated", summary: [detailText(d, "sourceMode"), detailText(d, "renewalType"), detailText(d, "clarityStatus")].filter(Boolean).join(" · "), tone: "border-cyan-200 bg-cyan-50"},
    contract_obligation_created: {titleFr: "Obligation contractuelle ajoutée", titleEn: "Contract obligation added", summary: [detailText(d, "title"), detailText(d, "recurrence"), detailText(d, "clauseReference")].filter(Boolean).join(" · "), tone: "border-blue-200 bg-blue-50"},
    contract_obligation_occurrences_generated: {titleFr: "Échéances d’obligations synchronisées", titleEn: "Obligation due items synchronized", summary: `${detailText(d, "createdCount")} ${fr ? "échéance(s)" : "due item(s)"}`, tone: "border-blue-200 bg-blue-50"},
    contract_obligation_occurrence_submitted: {titleFr: "Réalisation d’obligation soumise", titleEn: "Obligation execution submitted", summary: [detailText(d, "dueDate"), detailText(d, "actualQuantity")].filter(Boolean).join(" · "), tone: "border-blue-200 bg-blue-50"},
    contract_obligation_occurrence_reviewed: {titleFr: "Réalisation d’obligation validée", titleEn: "Obligation execution reviewed", summary: [detailText(d, "dueDate"), detailText(d, "status"), detailText(d, "score") ? `Score: ${detailText(d, "score")}%` : ""].filter(Boolean).join(" · "), tone: "border-blue-200 bg-blue-50"},
    contract_compensation_rule_created: {titleFr: "Règle de rémunération / avantage ajoutée", titleEn: "Compensation / benefit rule added", summary: [detailText(d, "label"), detailText(d, "ruleType"), detailText(d, "cadence")].filter(Boolean).join(" · "), tone: "border-fuchsia-200 bg-fuchsia-50"},
    contract_financial_item_created: {titleFr: "Échéance financière calculée", titleEn: "Financial item calculated", summary: [detailText(d, "label"), detailText(d, "calculatedAmount") ? `${detailText(d, "calculatedAmount")} ${detailText(d, "currency")}` : "", detailText(d, "gateStatus") ? `Gate: ${detailText(d, "gateStatus")}` : ""].filter(Boolean).join(" · "), tone: "border-cyan-200 bg-cyan-50"},
    contract_financial_item_reviewed: {titleFr: "Échéance financière revue", titleEn: "Financial item reviewed", summary: [detailText(d, "decision"), detailText(d, "calculatedAmount"), detailText(d, "gateStatus"), detailText(d, "reviewNote")].filter(Boolean).join(" · "), tone: detailText(d, "decision") === "approved" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"},
    contract_financial_item_settled: {titleFr: "Règlement contractuel enregistré", titleEn: "Contract settlement recorded", summary: [detailText(d, "status"), detailText(d, "settledAmount") ? `${detailText(d, "settledAmount")} ${detailText(d, "currency")}` : "", detailText(d, "settlementReference")].filter(Boolean).join(" · "), tone: "border-emerald-200 bg-emerald-50"},
    contract_activated: {titleFr: "Contrat activé", titleEn: "Contract activated", summary: fr ? "Le suivi d’exécution officiel a commencé." : "Official execution monitoring has started.", tone: "border-emerald-200 bg-emerald-50"},
    contract_status_changed: {titleFr: "Statut du contrat modifié", titleEn: "Contract status changed", summary: [detailText(d, "from"), detailText(d, "to")].filter(Boolean).join(" → "), tone: "border-amber-200 bg-amber-50"},
    deliverable_created: {titleFr: "Livrable ajouté", titleEn: "Deliverable added", summary: [detailText(d, "title"), detailText(d, "dueDate") ? `${fr ? "Échéance" : "Due"}: ${detailText(d, "dueDate")}` : "", detailText(d, "weight") ? `${fr ? "Poids" : "Weight"}: ${detailText(d, "weight")}%` : ""].filter(Boolean).join(" · "), tone: "border-violet-200 bg-violet-50"},
    deliverable_status_changed: {titleFr: "Livrable mis à jour", titleEn: "Deliverable updated", summary: [detailText(d, "from"), detailText(d, "to"), detailText(d, "reviewScore") ? `${fr ? "Score" : "Score"}: ${detailText(d, "reviewScore")}%` : "", detailText(d, "reviewOutcome") === "partial" ? (fr ? "Acceptation partielle" : "Partial acceptance") : ""].filter(Boolean).join(" · "), tone: "border-violet-200 bg-violet-50"},
    execution_report_submitted: {titleFr: "Rapport d’exécution soumis", titleEn: "Execution report submitted", summary: period, tone: "border-indigo-200 bg-indigo-50"},
    execution_report_reviewed: {titleFr: status === "accepted" ? "Rapport d’exécution validé" : "Rapport d’exécution rejeté", titleEn: status === "accepted" ? "Execution report accepted" : "Execution report rejected", summary: detailText(d, "reviewNote"), tone: status === "accepted" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"},
    kpi_created: {titleFr: "KPI ajouté", titleEn: "KPI added", summary: [detailText(d, "name"), detailText(d, "targetValue") ? `${fr ? "Cible" : "Target"}: ${detailText(d, "targetValue")} ${detailText(d, "unit")}` : "", detailText(d, "weight") ? `${fr ? "Poids" : "Weight"}: ${detailText(d, "weight")}%` : ""].filter(Boolean).join(" · "), tone: "border-emerald-200 bg-emerald-50"},
    kpi_result_recorded: {titleFr: "Résultat KPI enregistré", titleEn: "KPI result recorded", summary: [detailText(d, "kpiName"), period, score ? `${fr ? "Score" : "Score"}: ${Number(score).toFixed(1)}%` : ""].filter(Boolean).join(" · "), tone: "border-slate-200 bg-slate-50"},
    kpi_result_submitted: {titleFr: "Résultat KPI soumis", titleEn: "KPI result submitted", summary: [detailText(d, "kpiName"), period, score ? `${fr ? "Score proposé" : "Proposed score"}: ${Number(score).toFixed(1)}%` : ""].filter(Boolean).join(" · "), tone: "border-amber-200 bg-amber-50"},
    kpi_result_reviewed: {titleFr: status === "accepted" ? "Résultat KPI validé" : "Résultat KPI rejeté", titleEn: status === "accepted" ? "KPI result accepted" : "KPI result rejected", summary: [detailText(d, "kpiName"), period, score ? `${fr ? "Score" : "Score"}: ${Number(score).toFixed(1)}%` : "", detailText(d, "reviewNote")].filter(Boolean).join(" · "), tone: status === "accepted" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"},
    incident_created: {titleFr: "Incident / non-conformité enregistré", titleEn: "Incident / non-conformity recorded", summary: [detailText(d, "title"), detailText(d, "severity") ? `${fr ? "Gravité" : "Severity"}: ${detailText(d, "severity")}` : "", detailText(d, "dueDate") ? `${fr ? "Échéance" : "Due"}: ${detailText(d, "dueDate")}` : ""].filter(Boolean).join(" · "), tone: detailText(d, "severity") === "critical" ? "border-red-300 bg-red-50" : "border-amber-200 bg-amber-50"},
    incident_updated: {titleFr: "Incident mis à jour", titleEn: "Incident updated", summary: [detailText(d, "title"), detailText(d, "from"), detailText(d, "to")].filter(Boolean).join(" · "), tone: ["resolved","closed"].includes(detailText(d, "to")) ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"},
    contract_document_added: {titleFr: "Document contractuel archivé", titleEn: "Contract document archived", summary: [detailText(d, "title"), detailText(d, "documentType"), detailText(d, "fileName")].filter(Boolean).join(" · "), tone: "border-cyan-200 bg-cyan-50"},
    contract_document_opened: {titleFr: "Document contractuel consulté", titleEn: "Contract document opened", summary: [detailText(d, "fileName")].filter(Boolean).join(" · "), tone: "border-slate-200 bg-slate-50"},
    contract_amendment_created: {titleFr: "Avenant préparé", titleEn: "Amendment prepared", summary: [detailText(d, "amendmentNumber") ? `Avenant n°${detailText(d, "amendmentNumber")}` : "", detailText(d, "title"), detailText(d, "effectiveDate") ? `Effet: ${detailText(d, "effectiveDate")}` : ""].filter(Boolean).join(" · "), tone: "border-indigo-200 bg-indigo-50"},
    contract_amendment_document_attached: {titleFr: "Document signé de l’avenant archivé", titleEn: "Signed amendment document archived", summary: [detailText(d, "amendmentNumber") ? `Avenant n°${detailText(d, "amendmentNumber")}` : "", detailText(d, "fileName")].filter(Boolean).join(" · "), tone: "border-indigo-200 bg-indigo-50"},
    contract_amendment_applied: {titleFr: "Avenant appliqué au contrat", titleEn: "Amendment applied to contract", summary: [detailText(d, "amendmentNumber") ? `Avenant n°${detailText(d, "amendmentNumber")}` : "", detailText(d, "previousVersion") && detailText(d, "resultingVersion") ? `V${detailText(d, "previousVersion")} → V${detailText(d, "resultingVersion")}` : ""].filter(Boolean).join(" · "), tone: "border-emerald-200 bg-emerald-50"},
    contract_amendment_cancelled: {titleFr: "Avenant annulé", titleEn: "Amendment cancelled", summary: [detailText(d, "amendmentNumber") ? `Avenant n°${detailText(d, "amendmentNumber")}` : "", detailText(d, "reason")].filter(Boolean).join(" · "), tone: "border-slate-200 bg-slate-50"},
    renewal_decision_recorded: {titleFr: detailText(d, "isFinal") === "true" ? "Décision finale enregistrée" : "Revue de renouvellement enregistrée", titleEn: detailText(d, "isFinal") === "true" ? "Final renewal decision recorded" : "Renewal review recorded", summary: [reviewStageLabel(detailText(d, "reviewStage") || "orientation", fr), renewalDecisionLabel(detailText(d, "finalDecision"), fr), detailText(d, "performanceScore") ? `${fr ? "Score contractuel" : "Contract score"}: ${Number(detailText(d, "performanceScore")).toFixed(1)}%` : "", detailText(d, "daysRemaining") ? `${fr ? "Jours restants" : "Days remaining"}: ${detailText(d, "daysRemaining")}` : "", detailText(d, "decisionNote")].filter(Boolean).join(" · "), tone: ["renew","renew_with_conditions","extend"].includes(detailText(d, "finalDecision")) ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"},
  };
  const item = mapping[action];
  return item ?? {titleFr: action.replaceAll("_", " "), titleEn: action.replaceAll("_", " "), summary: "", tone: "border-slate-200 bg-slate-50"};
}

export default async function ContractPassportPage({params, searchParams}: {params: Promise<{contractId: string}>; searchParams: Promise<{success?: string; error?: string; tab?: string}>}) {
  const [{contractId}, query] = await Promise.all([params, searchParams]);
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const dateLocale = fr ? "fr-FR" : "en-GB";
  const context = await requireAccessContext();
  const canManage = ADMIN_ROLES.has(context.role);
  const requestedTab = query.tab ?? "overview";
  const activeTab: ContractPassportTab = CONTRACT_PASSPORT_TABS.includes(requestedTab as ContractPassportTab) ? requestedTab as ContractPassportTab : "overview";
  const passportTabs: Array<{key: ContractPassportTab; label: string}> = [
    {key: "overview", label: fr ? "Vue d’ensemble" : "Overview"},
    {key: "contract", label: fr ? "Contrat" : "Contract"},
    {key: "execution", label: fr ? "Exécution" : "Execution"},
    {key: "performance", label: fr ? "KPI & livrables" : "KPIs & deliverables"},
    {key: "finance", label: fr ? "Finance" : "Finance"},
    {key: "documents", label: fr ? "Documents & avenants" : "Documents & amendments"},
    {key: "risks", label: fr ? "Incidents & risques" : "Incidents & risks"},
    {key: "history", label: fr ? "Historique" : "History"},
  ];
  if (![...ADMIN_ROLES, "manager"].includes(context.role)) redirect("/dashboard/my-day");

  const {data: contractData, error: contractError} = await context.admin.from("service_contracts").select("id,provider_id,contract_number,title,service_scope,department,internal_owner_user_id,start_date,end_date,value_amount,currency,payment_terms,status,renewal_notice_days,performance_target,notes,activated_at,activated_by,created_at,updated_at,current_version,last_amendment_at,source_mode,source_document_storage_path,source_document_file_name,source_document_mime_type,source_document_size_bytes,source_document_uploaded_at,source_document_uploaded_by,imported_at,imported_by,tracking_start_date,renewal_type,renewal_period_months,non_renewal_notice_days,termination_notice_days,confidentiality_post_term_months,confidentiality_indefinite,immediate_termination_triggers,contract_clarity_status,contract_clarity_note,legacy_execution_note")
    .eq("id", contractId).eq("organization_id", context.organizationId).maybeSingle<ContractRow>();
  if (contractError || !contractData) redirect("/dashboard/contracts?error=Contrat%20introuvable");
  if (context.role === "manager" && contractData.internal_owner_user_id !== context.user.id) redirect("/dashboard/contracts?error=Acc%C3%A8s%20refus%C3%A9");
  const contract = contractData;

  const [providerRes, ownerRes, auditRes, deliverableRes, reportRes, kpiRes, resultRes, incidentRes, renewalRes, obligationRes, occurrenceRes, compensationRes, financialRes, documentRes, amendmentRes] = await Promise.all([
    context.admin.from("service_providers").select("id,legal_name,trading_name,service_category,contact_name,contact_email,contact_phone,country,status").eq("id", contract.provider_id).maybeSingle<ProviderRow>(),
    context.admin.from("profiles").select("id,full_name,email").eq("id", contract.internal_owner_user_id).maybeSingle<ProfileRow>(),
    context.admin.from("service_contract_audit_log").select("id,actor_id,action,details,created_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("created_at", {ascending: false}).limit(40),
    context.admin.from("service_contract_deliverables").select("id,title,description,due_date,weight,status,evidence_reference,submission_note,review_note,review_score,review_outcome,submitted_at,reviewed_at,reviewed_by,created_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("due_date", {ascending: true}),
    context.admin.from("service_contract_reports").select("id,period_start,period_end,work_completed,challenges,next_actions,evidence_reference,status,review_note,submitted_by,submitted_at,reviewed_by,reviewed_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("period_end", {ascending: false}),
    context.admin.from("service_contract_kpis").select("id,name,description,unit,target_value,weight,direction,is_active,created_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).eq("is_active", true).order("created_at", {ascending: true}),
    context.admin.from("service_contract_kpi_results").select("id,kpi_id,period_start,period_end,actual_value,score,comment,status,review_note,recorded_by,reviewed_by,reviewed_at,created_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("period_end", {ascending: false}),
    context.admin.from("service_contract_incidents").select("id,title,description,severity,status,corrective_action,owner_user_id,due_date,resolution_note,resolved_at,resolved_by,created_by,created_at,updated_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("created_at", {ascending: false}),
    context.admin.from("service_contract_renewal_reviews").select("id,performance_score,kpi_score,deliverable_score,incident_penalty,open_incidents,critical_incidents,recommended_action,final_decision,decision_note,review_stage,review_kind,days_remaining,is_final,decided_by,decided_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("decided_at", {ascending: false}).limit(10),
    context.admin.from("service_contract_obligations").select("id,title,description,obligation_type,responsible_party,recurrence,target_quantity,unit,evidence_required,clause_reference,start_date,end_date,first_due_date,status,created_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("created_at", {ascending: true}),
    context.admin.from("service_contract_obligation_occurrences").select("id,obligation_id,period_start,period_end,due_date,expected_quantity,actual_quantity,status,evidence_reference,submission_note,review_note,review_score,submitted_by,submitted_at,reviewed_by,reviewed_at,created_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("due_date", {ascending: false}).limit(120),
    context.admin.from("service_contract_compensation_rules").select("id,label,rule_type,cadence,amount,percentage,threshold_min,threshold_max,currency,condition_text,clause_reference,is_active,created_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).eq("is_active", true).order("created_at", {ascending: true}),
    context.admin.from("service_contract_financial_items").select("id,compensation_rule_id,item_type,period_start,period_end,due_date,base_amount,quantity,calculated_amount,currency,gate_status,gate_note,status,source_reference,request_note,review_note,settlement_reference,settled_amount,created_by,reviewed_by,reviewed_at,settled_by,settled_at,created_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("created_at", {ascending: false}).limit(80),
    context.admin.from("service_contract_documents").select("id,document_type,title,description,document_date,file_name,mime_type,size_bytes,is_immutable,created_by,created_at").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("created_at", {ascending: false}).limit(100),
    context.admin.from("service_contract_amendments").select("id,amendment_number,title,reason,effective_date,status,changes,previous_version,resulting_version,document_id,created_by,created_at,updated_by,updated_at,applied_by,applied_at,cancelled_by,cancelled_at,cancellation_reason").eq("organization_id", context.organizationId).eq("contract_id", contract.id).order("amendment_number", {ascending: false}).limit(100),
  ]);

  const provider = providerRes.data as ProviderRow | null;
  const ownerProfile = ownerRes.data as ProfileRow | null;
  const audits = (auditRes.data ?? []) as AuditRow[];
  const deliverables = (deliverableRes.data ?? []) as DeliverableRow[];
  const reports = (reportRes.data ?? []) as ReportRow[];
  const kpis = (kpiRes.data ?? []) as KpiRow[];
  const kpiResults = (resultRes.data ?? []) as KpiResultRow[];
  const incidents = (incidentRes.data ?? []) as IncidentRow[];
  const renewalReviews = (renewalRes.data ?? []) as RenewalReviewRow[];
  const obligations = (obligationRes.data ?? []) as ObligationRow[];
  const obligationOccurrences = (occurrenceRes.data ?? []) as ObligationOccurrenceRow[];
  const compensationRules = (compensationRes.data ?? []) as CompensationRuleRow[];
  const financialItems = (financialRes.data ?? []) as FinancialItemRow[];
  const contractDocuments = (documentRes.data ?? []) as ContractDocumentRow[];
  const contractAmendments = (amendmentRes.data ?? []) as ContractAmendmentRow[];
  const documentById = new Map(contractDocuments.map((row) => [row.id, row]));
  const compensationRuleById = new Map(compensationRules.map((row) => [row.id, row]));

  const actorIds = [...new Set([
    ...audits.flatMap((row) => row.actor_id ? [row.actor_id] : []),
    ...reports.flatMap((row) => [row.submitted_by, ...(row.reviewed_by ? [row.reviewed_by] : [])]),
    ...kpiResults.flatMap((row) => [row.recorded_by, ...(row.reviewed_by ? [row.reviewed_by] : [])]),
    ...incidents.flatMap((row) => [row.created_by, ...(row.owner_user_id ? [row.owner_user_id] : []), ...(row.resolved_by ? [row.resolved_by] : [])]),
    ...renewalReviews.map((row) => row.decided_by),
    ...obligationOccurrences.flatMap((row) => [...(row.submitted_by ? [row.submitted_by] : []), ...(row.reviewed_by ? [row.reviewed_by] : [])]),
    ...financialItems.flatMap((row) => [row.created_by, ...(row.reviewed_by ? [row.reviewed_by] : []), ...(row.settled_by ? [row.settled_by] : [])]),
    ...contractDocuments.map((row) => row.created_by),
    ...contractAmendments.flatMap((row) => [row.created_by, row.updated_by, ...(row.applied_by ? [row.applied_by] : []), ...(row.cancelled_by ? [row.cancelled_by] : [])]),
  ])];
  const {data: actorProfilesData} = actorIds.length ? await context.admin.from("profiles").select("id,full_name,email").in("id", actorIds) : {data: [] as ProfileRow[]};
  const actorById = new Map(((actorProfilesData ?? []) as ProfileRow[]).map((row) => [row.id, row]));

  const days = daysUntil(contract.end_date);
  const completedReviewStages = new Set(renewalReviews.map((row) => row.review_stage || "orientation"));
  const hasFinalDecision = renewalReviews.some((row) => row.is_final || row.review_stage === "final");
  const currentCheckpointStage = days <= 30 ? "j30" : days <= 60 ? "j60" : days <= 90 ? "j90" : "orientation";
  const currentReviewKind = currentCheckpointStage === "orientation" ? "orientation" : "checkpoint";
  const reviewTimeline = [
    {stage: "j90", days: 90, date: dateMinusDays(contract.end_date, 90)},
    {stage: "j60", days: 60, date: dateMinusDays(contract.end_date, 60)},
    {stage: "j30", days: 30, date: dateMinusDays(contract.end_date, 30)},
    {stage: "final", days: 0, date: contract.end_date},
  ];
  const alert = days < 0
    ? {label: fr ? `Expiré depuis ${Math.abs(days)} jour(s)` : `Expired ${Math.abs(days)} day(s) ago`, tone: "border-red-300 bg-red-50 text-red-900"}
    : days <= 7 ? {label: fr ? `Expiration critique : ${days} jour(s)` : `Critical expiry: ${days} day(s)`, tone: "border-red-300 bg-red-50 text-red-900"}
    : days <= 30 ? {label: fr ? `Expiration proche : ${days} jour(s)` : `Expiring soon: ${days} day(s)`, tone: "border-amber-300 bg-amber-50 text-amber-900"}
    : days <= contract.renewal_notice_days ? {label: fr ? `Revue de renouvellement à préparer : ${days} jour(s)` : `Prepare renewal review: ${days} day(s)`, tone: "border-indigo-300 bg-indigo-50 text-indigo-900"}
    : {label: fr ? `${days} jour(s) avant expiration` : `${days} day(s) until expiry`, tone: "border-emerald-300 bg-emerald-50 text-emerald-900"};

  const today = new Date().toISOString().slice(0, 10);
  const acceptedDeliverables = deliverables.filter((row) => row.status === "accepted").length;
  const overdueDeliverables = deliverables.filter((row) => !DONE_DELIVERABLES.has(row.status) && row.due_date < today).length;
  const acceptedReports = reports.filter((row) => row.status === "accepted").length;
  const obligationById = new Map(obligations.map((row) => [row.id, row]));
  const pendingObligationOccurrences = obligationOccurrences.filter((row) => ["planned","submitted"].includes(row.status));
  const overdueObligationOccurrences = obligationOccurrences.filter((row) => ["planned","submitted"].includes(row.status) && row.due_date < today);
  const reviewedObligationOccurrences = obligationOccurrences.filter((row) => ["accepted","partial","rejected","waived"].includes(row.status));
  const obligationScore = reviewedObligationOccurrences.length ? reviewedObligationOccurrences.reduce((sum, row) => sum + Number(row.review_score ?? (row.status === "accepted" || row.status === "waived" ? 100 : row.status === "rejected" ? 0 : 50)), 0) / reviewedObligationOccurrences.length : null;

  const acceptedKpiResults = kpiResults.filter((row) => row.status === "accepted");
  const submittedKpiResults = kpiResults.filter((row) => row.status === "submitted");
  const rejectedKpiResults = kpiResults.filter((row) => row.status === "rejected");
  const resultScoresByKpi = new Map<string, number[]>();
  for (const result of acceptedKpiResults) {
    const list = resultScoresByKpi.get(result.kpi_id) ?? [];
    list.push(Number(result.score));
    resultScoresByKpi.set(result.kpi_id, list);
  }
  const averages = kpis.flatMap((kpi) => {
    const scores = resultScoresByKpi.get(kpi.id) ?? [];
    if (!scores.length) return [];
    const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    return [{kpi, average}];
  });
  const weightedDenominator = averages.reduce((sum, item) => sum + Math.max(0, Number(item.kpi.weight)), 0);
  const kpiScore = averages.length
    ? weightedDenominator > 0
      ? averages.reduce((sum, item) => sum + item.average * Math.max(0, Number(item.kpi.weight)), 0) / weightedDenominator
      : averages.reduce((sum, item) => sum + item.average, 0) / averages.length
    : null;

  const reviewedDeliverables = deliverables.filter((row) => ["accepted","rejected"].includes(row.status)).map((row) => ({
    weight: Math.max(0, Number(row.weight)),
    score: row.status === "rejected" ? 0 : row.review_score === null ? 100 : Number(row.review_score),
  }));
  const deliverableWeight = reviewedDeliverables.reduce((sum, item) => sum + item.weight, 0);
  const deliverableScore = reviewedDeliverables.length
    ? deliverableWeight > 0
      ? reviewedDeliverables.reduce((sum, item) => sum + item.score * item.weight, 0) / deliverableWeight
      : reviewedDeliverables.reduce((sum, item) => sum + item.score, 0) / reviewedDeliverables.length
    : null;

  const openIncidents = incidents.filter((row) => !["resolved","closed"].includes(row.status));
  const criticalOpenIncidents = openIncidents.filter((row) => row.severity === "critical");
  const severityPenalty: Record<string, number> = {low: 2, medium: 5, high: 10, critical: 20};
  const incidentPenalty = Math.min(30, openIncidents.reduce((sum, row) => sum + (severityPenalty[row.severity] ?? 0), 0));
  const baseContractScore = kpiScore !== null && deliverableScore !== null
    ? kpiScore * 0.7 + deliverableScore * 0.3
    : kpiScore ?? deliverableScore;
  const contractScore = baseContractScore === null ? null : Math.max(0, Math.min(100, baseContractScore - incidentPenalty));

  const performanceTarget = Number(contract.performance_target);
  const recommendedAction = criticalOpenIncidents.length
    ? "suspend_review"
    : contractScore === null
      ? "insufficient_data"
      : contractScore >= performanceTarget
        ? "renew"
        : contractScore >= Math.max(0, performanceTarget - 10)
          ? "renew_with_conditions"
          : "do_not_renew_review";
  const financialPending = financialItems.filter((row) => row.status === "pending").length;
  const financialHeld = financialItems.filter((row) => row.status === "held" || row.gate_status === "blocked").length;
  const financialApproved = financialItems.filter((row) => row.status === "approved").length;
  const financialSettled = financialItems.filter((row) => ["paid","delivered"].includes(row.status)).length;
  const approvedAmount = financialItems.filter((row) => row.status === "approved" && row.item_type === "compensation" && row.currency === contract.currency).reduce((sum,row) => sum + Number(row.calculated_amount || 0), 0);
  const paidAmount = financialItems.filter((row) => row.status === "paid" && row.currency === contract.currency).reduce((sum,row) => sum + Number(row.settled_amount ?? row.calculated_amount ?? 0), 0);

  const recommendation = recommendedAction === "suspend_review"
    ? {label: fr ? "Incident critique ouvert — revue de suspension urgente" : "Critical incident open — urgent suspension review", tone: "border-red-300 bg-red-50 text-red-900", help: fr ? "Un incident critique actif prime sur le score : traite-le avant toute décision de renouvellement." : "An active critical incident overrides the score: resolve it before any renewal decision."}
    : recommendedAction === "insufficient_data"
      ? {label: fr ? "Données de performance insuffisantes" : "Insufficient performance data", tone: "border-slate-300 bg-slate-50 text-slate-800", help: fr ? "Valide des KPI ou des livrables pour obtenir une recommandation contractuelle." : "Validate KPIs or deliverables to generate a contract recommendation."}
      : recommendedAction === "renew"
        ? {label: fr ? "Performance conforme — renouvellement favorable" : "On-target performance — renewal favourable", tone: "border-emerald-300 bg-emerald-50 text-emerald-900", help: fr ? "Le score contractuel atteint ou dépasse la cible et aucun incident critique n’est ouvert." : "The contract score meets or exceeds target and no critical incident is open."}
        : recommendedAction === "renew_with_conditions"
          ? {label: fr ? "Renouvellement sous conditions à envisager" : "Consider renewal under conditions", tone: "border-amber-300 bg-amber-50 text-amber-900", help: fr ? "La performance est proche de la cible : exige un plan correctif et des engagements mesurables." : "Performance is close to target: require a corrective plan and measurable commitments."}
          : {label: fr ? "Contrat à risque — revue de non-renouvellement / suspension" : "Contract at risk — non-renewal / suspension review", tone: "border-red-300 bg-red-50 text-red-900", help: fr ? "Le score contractuel est nettement sous la cible après prise en compte des livrables et incidents." : "The contract score is materially below target after deliverables and incidents are considered."};

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6"><div className="mx-auto max-w-7xl">
    <Link href="/dashboard/contracts" className="font-black text-indigo-700">← {fr ? "Prestataires & Contrats" : "Providers & Contracts"}</Link>
    <section className="mt-5 overflow-hidden rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">{fr ? "PASSEPORT DU CONTRAT" : "CONTRACT PASSPORT"}</p><h1 className="mt-3 text-3xl font-black sm:text-5xl">{contract.title}</h1><p className="mt-2 text-slate-300">{contract.contract_number} · {provider?.legal_name ?? "—"}</p></div><span className={`rounded-full px-4 py-2 text-sm font-black ${statusTone(contract.status)}`}>{contract.status.replaceAll("_", " ")}</span></div>
    </section>

    {query.success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-800">{query.success}</p> : null}
    {query.error ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{query.error}</p> : null}

    <nav aria-label={fr ? "Sections du passeport contractuel" : "Contract passport sections"} className="sticky top-2 z-20 mt-5 overflow-x-auto rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
      <div className="flex min-w-max gap-2">
        {passportTabs.map((tab) => <Link key={tab.key} href={`/dashboard/contracts/${contract.id}?tab=${tab.key}`} className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${activeTab === tab.key ? "bg-slate-950 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{tab.label}</Link>)}
      </div>
    </nav>
    {activeTab === "overview" ? <>
    <div className={`mt-5 rounded-2xl border p-4 font-black ${alert.tone}`}>{alert.label}</div>

    {contract.status === "draft" && canManage ? <section className="mt-5 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{fr ? "CONTRAT EN BROUILLON" : "DRAFT CONTRACT"}</p><h2 className="mt-1 text-xl font-black">{fr ? "Active le contrat pour démarrer l’exécution officielle" : "Activate the contract to begin official execution"}</h2><p className="mt-1 text-sm text-amber-900">{fr ? "L’activation est horodatée et enregistrée dans l’audit." : "Activation is timestamped and recorded in the audit trail."}</p></div><form action={updateServiceContractStatusAction}><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="status" value="active"/><input type="hidden" name="reason" value="Activation du contrat"/><button className="rounded-xl bg-amber-500 px-5 py-3 font-black text-amber-950">{fr ? "Activer le contrat" : "Activate contract"}</button></form></div>
    </section> : null}

    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-2xl border bg-white p-5"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Prestataire" : "Provider"}</p><p className="mt-2 text-xl font-black">{provider?.legal_name ?? "—"}</p><p className="text-sm text-slate-500">{provider?.service_category ?? ""}</p></article>
      <article className="rounded-2xl border bg-white p-5"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Responsable interne" : "Internal owner"}</p><p className="mt-2 text-xl font-black">{ownerProfile?.full_name || ownerProfile?.email || "—"}</p><p className="text-sm text-slate-500">{contract.department || "—"}</p></article>
      <article className="rounded-2xl border bg-white p-5"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Durée" : "Term"}</p><p className="mt-2 text-lg font-black">{contract.start_date} → {contract.end_date}</p><p className="text-sm text-slate-500">{contract.activated_at ? (fr ? `Activé le ${dateTime(contract.activated_at, dateLocale)}` : `Activated ${dateTime(contract.activated_at, dateLocale)}`) : (fr ? "Pas encore activé" : "Not activated yet")}</p></article>
      <article className="rounded-2xl border bg-white p-5"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Valeur contractuelle" : "Contract value"}</p><p className="mt-2 text-xl font-black">{money(contract.value_amount, contract.currency, dateLocale)}</p><p className="text-sm text-slate-500">{fr ? `Cible performance : ${performanceTarget} %` : `Performance target: ${performanceTarget}%`}</p></article>
    </section>

    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><p className="text-xs font-black uppercase text-violet-700">{fr ? "Livrables validés" : "Accepted deliverables"}</p><p className="mt-2 text-3xl font-black">{acceptedDeliverables}/{deliverables.length}</p></article>
      <article className={`rounded-2xl border p-5 ${overdueDeliverables ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}><p className="text-xs font-black uppercase text-slate-600">{fr ? "Livrables en retard" : "Overdue deliverables"}</p><p className="mt-2 text-3xl font-black">{overdueDeliverables}</p></article>
      <article className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><p className="text-xs font-black uppercase text-indigo-700">{fr ? "Rapports validés" : "Accepted reports"}</p><p className="mt-2 text-3xl font-black">{acceptedReports}/{reports.length}</p></article>
      <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-xs font-black uppercase text-emerald-700">{fr ? "Score contractuel" : "Contract score"}</p><p className="mt-2 text-3xl font-black">{pct(contractScore)}</p><p className="text-xs text-emerald-800">{fr ? `Cible ${performanceTarget}% · pénalité incidents ${incidentPenalty.toFixed(0)} pts` : `Target ${performanceTarget}% · incident penalty ${incidentPenalty.toFixed(0)} pts`}</p></article>
    </section>

    <section className={`mt-6 rounded-3xl border p-6 ${recommendation.tone}`}>
      <p className="text-xs font-black uppercase tracking-[0.18em]">{fr ? "RECOMMANDATION DE GOUVERNANCE" : "GOVERNANCE RECOMMENDATION"}</p>
      <h2 className="mt-2 text-2xl font-black">{recommendation.label}</h2>
      <p className="mt-2 text-sm">{recommendation.help}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-white/70 p-3"><p className="text-xs font-black uppercase opacity-70">KPI</p><p className="mt-1 text-xl font-black">{pct(kpiScore)}</p></div>
        <div className="rounded-xl bg-white/70 p-3"><p className="text-xs font-black uppercase opacity-70">{fr ? "Livrables" : "Deliverables"}</p><p className="mt-1 text-xl font-black">{pct(deliverableScore)}</p></div>
        <div className="rounded-xl bg-white/70 p-3"><p className="text-xs font-black uppercase opacity-70">{fr ? "Incidents ouverts" : "Open incidents"}</p><p className="mt-1 text-xl font-black">{openIncidents.length}</p></div>
        <div className="rounded-xl bg-white/70 p-3"><p className="text-xs font-black uppercase opacity-70">{fr ? "Pénalité" : "Penalty"}</p><p className="mt-1 text-xl font-black">-{incidentPenalty.toFixed(0)} pts</p></div>
      </div>
      <p className="mt-4 text-xs font-bold opacity-75">{fr ? "Méthode : KPI 70 % + livrables 30 %, puis pénalité des incidents ouverts (max. 30 points). La recommandation aide la décision mais ne la remplace pas." : "Method: KPIs 70% + deliverables 30%, then open-incident penalty (max. 30 points). The recommendation supports but does not replace the final decision."}</p>
    </section>
    </> : null}

    {activeTab === "contract" ? <>
    <section className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_.7fr]">
      <article className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{fr ? "Objet & conditions" : "Scope & terms"}</h2><h3 className="mt-5 text-sm font-black uppercase text-slate-500">{fr ? "Périmètre de la prestation" : "Scope of service"}</h3><p className="mt-2 whitespace-pre-wrap leading-7 text-slate-700">{contract.service_scope || "—"}</p><h3 className="mt-5 text-sm font-black uppercase text-slate-500">{fr ? "Conditions de paiement" : "Payment terms"}</h3><p className="mt-2 whitespace-pre-wrap leading-7 text-slate-700">{contract.payment_terms || "—"}</p>{contract.notes ? <><h3 className="mt-5 text-sm font-black uppercase text-slate-500">Notes</h3><p className="mt-2 whitespace-pre-wrap leading-7 text-slate-700">{contract.notes}</p></> : null}</article>
      <article className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{fr ? "Contact prestataire" : "Provider contact"}</h2><div className="mt-5 space-y-3 text-sm"><p><b>Contact:</b><br/>{provider?.contact_name || "—"}</p><p><b>Email:</b><br/>{provider?.contact_email || "—"}</p><p><b>{fr ? "Téléphone" : "Phone"}:</b><br/>{provider?.contact_phone || "—"}</p><p><b>{fr ? "Pays" : "Country"}:</b><br/>{provider?.country || "—"}</p></div></article>
    </section>

    <section className={`mt-7 rounded-3xl border p-6 shadow-sm ${contract.contract_clarity_status === "review_required" ? "border-red-300 bg-red-50" : "border-cyan-200 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">{fr ? "SOURCE & IMPORT CONTRACTUEL" : "CONTRACT SOURCE & IMPORT"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Contrat source & clauses structurées" : "Source contract & structured clauses"}</h2><p className="mt-2 max-w-4xl text-sm text-slate-600">{fr ? "Le document signé reste la source de vérité. Les champs ci-dessous servent au pilotage et ne remplacent pas l’interprétation juridique du contrat." : "The signed document remains the source of truth. The fields below support monitoring and do not replace legal interpretation of the contract."}</p></div>
        <span className={`rounded-full px-3 py-2 text-xs font-black uppercase ${contract.contract_clarity_status === "review_required" ? "bg-red-700 text-white" : contract.contract_clarity_status === "clear" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{contract.contract_clarity_status.replaceAll("_", " ")}</span>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Mode" : "Mode"}</p><p className="mt-1 font-black">{contract.source_mode.replaceAll("_", " ")}</p>{contract.imported_at ? <p className="mt-1 text-xs text-slate-500">{fr ? "Importé" : "Imported"}: {dateTime(contract.imported_at, dateLocale)}</p> : null}</div>
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Renouvellement" : "Renewal"}</p><p className="mt-1 font-black">{contract.renewal_type}{contract.renewal_period_months ? ` · ${contract.renewal_period_months} ${fr ? "mois" : "months"}` : ""}</p><p className="mt-1 text-xs text-slate-500">{fr ? "Préavis non-renouvellement" : "Non-renewal notice"}: {contract.non_renewal_notice_days ?? "—"} j</p></div>
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Résiliation" : "Termination"}</p><p className="mt-1 font-black">{contract.termination_notice_days === null ? "—" : `${contract.termination_notice_days} ${fr ? "jours" : "days"}`}</p><p className="mt-1 text-xs text-slate-500">{contract.immediate_termination_triggers || (fr ? "Aucune cause immédiate transcrite" : "No immediate trigger recorded")}</p></div>
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Confidentialité après fin" : "Post-term confidentiality"}</p><p className="mt-1 font-black">{contract.confidentiality_indefinite ? (fr ? "Indéfinie" : "Indefinite") : contract.confidentiality_post_term_months === null ? "—" : `${contract.confidentiality_post_term_months} ${fr ? "mois" : "months"}`}</p><p className="mt-1 text-xs text-slate-500">{fr ? "Suivi Super Leader" : "Super Leader tracking"}: {contract.tracking_start_date || "—"}</p></div>
      </div>
      {contract.contract_clarity_note ? <p className={`mt-4 rounded-xl p-4 text-sm font-bold ${contract.contract_clarity_status === "review_required" ? "bg-red-100 text-red-900" : "bg-amber-50 text-amber-900"}`}>⚠ {contract.contract_clarity_note}</p> : null}
      {contract.legacy_execution_note ? <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Historique reconstitué" : "Reconstructed history"}</p><p className="mt-1 whitespace-pre-wrap text-sm">{contract.legacy_execution_note}</p></div> : null}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {contract.source_document_storage_path ? <Link href={`/api/attachments/contract-source/${contract.id}`} target="_blank" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">📎 {contract.source_document_file_name || (fr ? "Ouvrir le contrat signé" : "Open signed contract")}</Link> : <span className="rounded-full bg-amber-100 px-3 py-2 text-xs font-black text-amber-900">{fr ? "Document source non archivé" : "Source document not archived"}</span>}
      </div>
      {canManage && !contract.source_document_storage_path ? <form action={attachContractSourceDocumentAction} className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 p-4"><input type="hidden" name="contractId" value={contract.id}/><SecureAttachmentUpload purpose="contract" prefix="contractSource" label={fr ? "Archiver le contrat signé original" : "Archive original signed contract"} help={fr ? "PDF / Word privé · 10 Mo max. Le fichier devient la pièce source immuable du passeport." : "Private PDF / Word · 10 MB max. The file becomes the immutable source document for the passport."} chooseLabel={fr ? "Choisir le contrat" : "Choose contract"} uploadingLabel={fr ? "Téléversement sécurisé…" : "Secure upload…"} uploadedLabel={fr ? "Document prêt" : "Document ready"} removeLabel={fr ? "Retirer" : "Remove"} errorLabel={fr ? "Document invalide." : "Invalid document."} required/><button className="mt-3 rounded-xl bg-cyan-700 px-4 py-2 font-black text-white">{fr ? "Archiver comme source" : "Archive as source"}</button></form> : null}
      {canManage ? <details className="mt-5 rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-black">{fr ? "Corriger la transcription des clauses" : "Correct structured clause transcription"}</summary><form action={updateContractImportMetadataAction} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="contractId" value={contract.id}/><label className="text-sm font-bold">{fr ? "Mode" : "Mode"}<select name="sourceMode" defaultValue={contract.source_mode} className={fieldClass()}><option value="native">Native</option><option value="current_import">Current import</option><option value="historical_import">Historical import</option></select></label><label className="text-sm font-bold">{fr ? "Début suivi Super Leader" : "Tracking start"}<input name="trackingStartDate" type="date" defaultValue={contract.tracking_start_date ?? ""} className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Renouvellement" : "Renewal"}<select name="renewalType" defaultValue={contract.renewal_type} className={fieldClass()}><option value="manual">Manual</option><option value="tacit">Tacit</option><option value="none">None</option></select></label><label className="text-sm font-bold">{fr ? "Période renouvellement (mois)" : "Renewal period (months)"}<input name="renewalPeriodMonths" type="number" min="1" max="120" defaultValue={contract.renewal_period_months ?? ""} className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Préavis non-renouvellement" : "Non-renewal notice"}<input name="nonRenewalNoticeDays" type="number" min="0" max="730" defaultValue={contract.non_renewal_notice_days ?? ""} className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Préavis résiliation" : "Termination notice"}<input name="terminationNoticeDays" type="number" min="0" max="730" defaultValue={contract.termination_notice_days ?? ""} className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Confidentialité post-fin (mois)" : "Post-term confidentiality (months)"}<input name="confidentialityPostTermMonths" type="number" min="0" max="1200" defaultValue={contract.confidentiality_post_term_months ?? ""} className={fieldClass()}/></label><label className="mt-6 flex items-center gap-2 text-sm font-bold"><input name="confidentialityIndefinite" type="checkbox" defaultChecked={contract.confidentiality_indefinite}/>{fr ? "Indéfinie" : "Indefinite"}</label><label className="text-sm font-bold sm:col-span-2">{fr ? "Causes résiliation immédiate" : "Immediate termination triggers"}<textarea name="immediateTerminationTriggers" rows={2} defaultValue={contract.immediate_termination_triggers} className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Cohérence" : "Clarity"}<select name="contractClarityStatus" defaultValue={contract.contract_clarity_status} className={fieldClass()}><option value="unchecked">Unchecked</option><option value="clear">Clear</option><option value="review_required">Review required</option></select></label><label className="text-sm font-bold">{fr ? "Note de cohérence" : "Clarity note"}<input name="contractClarityNote" defaultValue={contract.contract_clarity_note} className={fieldClass()}/></label><label className="text-sm font-bold sm:col-span-2">{fr ? "Historique d’exécution antérieure" : "Legacy execution history"}<textarea name="legacyExecutionNote" rows={3} defaultValue={contract.legacy_execution_note} className={fieldClass()}/></label><div className="sm:col-span-2"><button className="rounded-xl bg-cyan-700 px-4 py-2 font-black text-white">{fr ? "Enregistrer la transcription" : "Save transcription"}</button></div></form></details> : null}
    </section>
    </> : null}

    {activeTab === "execution" ? <>
    <section className="mt-7 rounded-3xl border border-blue-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">{fr ? "MOTEUR D’OBLIGATIONS" : "OBLIGATION ENGINE"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Obligations contractuelles récurrentes" : "Recurring contractual obligations"}</h2><p className="mt-2 text-sm text-slate-600">{fr ? "Traduis les clauses du contrat en obligations mesurables : activités, rapports, conformité, paiements, avantages ou soutien du mandant." : "Translate contract clauses into measurable duties: activities, reports, compliance, payments, benefits or mandator support."}</p></div><div className="flex flex-wrap gap-2 text-xs font-black"><span className="rounded-full bg-blue-100 px-3 py-2 text-blue-800">{obligations.length} {fr ? "obligation(s)" : "obligations"}</span><span className={`rounded-full px-3 py-2 ${overdueObligationOccurrences.length ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>{overdueObligationOccurrences.length} {fr ? "en retard" : "overdue"}</span><span className="rounded-full bg-emerald-100 px-3 py-2 text-emerald-800">{fr ? "Score obligations" : "Obligation score"}: {pct(obligationScore)}</span></div></div>
      {obligations.length ? <form action={generateContractObligationOccurrencesAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl bg-blue-50 p-4"><input type="hidden" name="contractId" value={contract.id}/><label className="text-xs font-black uppercase text-blue-800">{fr ? "Horizon de génération" : "Generation horizon"}<select name="horizonDays" defaultValue="35" className={fieldClass()}><option value="0">{fr ? "À aujourd’hui" : "Through today"}</option><option value="35">35 {fr ? "jours" : "days"}</option><option value="60">60 {fr ? "jours" : "days"}</option><option value="90">90 {fr ? "jours" : "days"}</option></select></label><button className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white">{fr ? "Synchroniser les échéances" : "Synchronize due items"}</button><p className="text-xs text-blue-900">{fr ? "Cette version génère les échéances à la demande. L’automatisation CRON viendra dans le centre global d’exécution." : "This version generates due items on demand. CRON automation will be added in the global execution centre."}</p></form> : null}
      <div className="mt-5 space-y-4">{obligations.map((obligation) => {const occurrences = obligationOccurrences.filter((row) => row.obligation_id === obligation.id).slice(0,8); return <article key={obligation.id} className="rounded-2xl border border-blue-100 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black">{obligation.title}</h3><p className="mt-1 text-sm text-slate-500">{obligation.obligation_type} · {obligation.responsible_party} · {obligation.recurrence}{obligation.target_quantity !== null ? ` · ${Number(obligation.target_quantity)} ${obligation.unit}` : ""}</p>{obligation.clause_reference ? <p className="mt-1 text-xs font-bold text-blue-700">{fr ? "Clause" : "Clause"}: {obligation.clause_reference}</p> : null}</div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase">{obligation.status}</span></div>{obligation.description ? <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{obligation.description}</p> : null}<div className="mt-4 space-y-3">{occurrences.map((occurrence) => {const submitter = occurrence.submitted_by ? actorById.get(occurrence.submitted_by) : null; return <div key={occurrence.id} className={`rounded-xl border p-4 ${occurrence.due_date < today && ["planned","submitted"].includes(occurrence.status) ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black">{occurrence.period_start || "—"} → {occurrence.period_end || occurrence.due_date} · {fr ? "Échéance" : "Due"}: {occurrence.due_date}</p><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black uppercase">{occurrence.status}</span></div><p className="mt-1 text-sm">{fr ? "Attendu" : "Expected"}: {occurrence.expected_quantity ?? "—"} {obligation.unit} · {fr ? "Réalisé" : "Actual"}: {occurrence.actual_quantity ?? "—"} {obligation.unit}{occurrence.review_score !== null ? ` · Score ${Number(occurrence.review_score).toFixed(1)}%` : ""}</p>{occurrence.evidence_reference ? <p className="mt-1 text-xs"><b>{fr ? "Preuve" : "Evidence"}:</b> {occurrence.evidence_reference}</p> : null}{occurrence.status === "planned" ? <form action={submitContractObligationOccurrenceAction} className="mt-3 grid gap-2 lg:grid-cols-[160px_1fr_1fr_auto]"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="occurrenceId" value={occurrence.id}/><input name="actualQuantity" type="number" step="0.0001" placeholder={fr ? "Réalisé" : "Actual"} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/><input name="evidenceReference" placeholder={fr ? "Lien / référence preuve" : "Evidence link / reference"} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/><input name="submissionNote" placeholder={fr ? "Commentaire" : "Comment"} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/><button className="rounded-xl bg-blue-700 px-3 py-2 text-sm font-black text-white">{fr ? "Soumettre" : "Submit"}</button></form> : null}{occurrence.status === "submitted" ? <form action={reviewContractObligationOccurrenceAction} className="mt-3 grid gap-2 lg:grid-cols-[160px_140px_1fr_auto]"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="occurrenceId" value={occurrence.id}/><select name="status" defaultValue="accepted" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold"><option value="accepted">Accepted</option><option value="partial">Partial</option><option value="rejected">Rejected</option><option value="waived">Waived</option></select><input name="reviewScore" type="number" min="0" max="100" step="0.1" placeholder="Score" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/><input name="reviewNote" placeholder={fr ? "Note de revue" : "Review note"} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/><button className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-black text-white">{fr ? "Valider" : "Review"}</button></form> : null}{submitter ? <p className="mt-2 text-xs text-slate-500">{fr ? "Soumis par" : "Submitted by"}: {submitter.full_name || submitter.email}</p> : null}</div>;})}{!occurrences.length ? <p className="text-sm text-slate-500">{fr ? "Aucune échéance générée pour cette obligation." : "No due item generated for this obligation."}</p> : null}</div></article>;})}{!obligations.length ? <p className="rounded-2xl bg-slate-50 p-6 text-center text-slate-500">{fr ? "Aucune obligation structurée. Ajoute les clauses mesurables du contrat ci-dessous." : "No structured obligations. Add measurable contract clauses below."}</p> : null}</div>
      <form action={createContractObligationAction} className="mt-6 rounded-2xl bg-blue-50 p-5"><input type="hidden" name="contractId" value={contract.id}/><h3 className="font-black">{fr ? "Ajouter une obligation issue du contrat" : "Add obligation from contract"}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="text-sm font-bold lg:col-span-2">{fr ? "Obligation *" : "Obligation *"}<input name="title" required className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Référence clause" : "Clause reference"}<input name="clauseReference" placeholder={fr ? "Ex. Article 4" : "e.g. Clause 4"} className={fieldClass()}/></label><label className="text-sm font-bold">Type<select name="obligationType" defaultValue="activity" className={fieldClass()}><option value="activity">Activity</option><option value="deliverable">Deliverable</option><option value="reporting">Reporting</option><option value="compliance">Compliance</option><option value="payment">Payment</option><option value="benefit">Benefit</option><option value="support">Support</option><option value="other">Other</option></select></label><label className="text-sm font-bold">{fr ? "Partie responsable" : "Responsible party"}<select name="responsibleParty" defaultValue="provider" className={fieldClass()}><option value="provider">Provider</option><option value="organization">Organization</option><option value="both">Both</option></select></label><label className="text-sm font-bold">{fr ? "Récurrence" : "Recurrence"}<select name="recurrence" defaultValue="weekly" className={fieldClass()}><option value="once">Once</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="continuous">Continuous</option></select></label><label className="text-sm font-bold">{fr ? "Quantité cible" : "Target quantity"}<input name="targetQuantity" type="number" step="0.0001" className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Unité" : "Unit"}<input name="unit" placeholder={fr ? "live, reel, rapport, prospect…" : "live, reel, report, prospect…"} className={fieldClass()}/></label><label className="mt-6 flex items-center gap-2 text-sm font-bold"><input name="evidenceRequired" type="checkbox" defaultChecked/>{fr ? "Preuve requise" : "Evidence required"}</label><label className="text-sm font-bold">{fr ? "Début obligation" : "Obligation start"}<input name="startDate" type="date" defaultValue={contract.start_date} className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Fin obligation" : "Obligation end"}<input name="endDate" type="date" defaultValue={contract.end_date} className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Première échéance" : "First due date"}<input name="firstDueDate" type="date" className={fieldClass()}/></label><label className="text-sm font-bold lg:col-span-3">Description<textarea name="description" rows={2} className={fieldClass()}/></label></div><button className="mt-4 rounded-xl bg-blue-700 px-5 py-3 font-black text-white">{fr ? "Ajouter l’obligation" : "Add obligation"}</button></form>
    </section>
    </> : null}

    {activeTab === "finance" ? <>
    <section className="mt-7 rounded-3xl border border-fuchsia-200 bg-white p-6 shadow-sm">
      <div><p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-700">{fr ? "RÉMUNÉRATION & AVANTAGES" : "COMPENSATION & BENEFITS"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Règles contractuelles de rémunération" : "Contractual compensation rules"}</h2><p className="mt-2 text-sm text-slate-600">{fr ? "Ces règles décrivent ce que prévoit le contrat. Elles n’autorisent pas encore un paiement Finance." : "These rules describe what the contract provides. They do not yet authorize a Finance payment."}</p></div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">{compensationRules.map((rule) => <article key={rule.id} className="rounded-2xl border border-fuchsia-100 bg-fuchsia-50 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{rule.label}</h3><p className="mt-1 text-xs text-slate-500">{rule.rule_type} · {rule.cadence}{rule.clause_reference ? ` · ${rule.clause_reference}` : ""}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black">{rule.is_active ? "ACTIVE" : "INACTIVE"}</span></div><p className="mt-3 text-sm font-bold">{rule.amount !== null ? money(rule.amount, rule.currency, dateLocale) : ""}{rule.percentage !== null ? `${rule.amount !== null ? " · " : ""}${Number(rule.percentage)}%` : ""}{rule.threshold_min !== null || rule.threshold_max !== null ? ` · ${fr ? "Seuil" : "Threshold"}: ${rule.threshold_min ?? "—"} → ${rule.threshold_max ?? "—"}` : ""}</p>{rule.condition_text ? <p className="mt-2 text-sm text-slate-700">{rule.condition_text}</p> : null}</article>)}{!compensationRules.length ? <p className="rounded-2xl bg-slate-50 p-6 text-center text-slate-500 md:col-span-2">{fr ? "Aucune règle de rémunération ou avantage structurée." : "No structured compensation or benefit rule."}</p> : null}</div>
      {canManage ? <form action={createContractCompensationRuleAction} className="mt-6 rounded-2xl bg-fuchsia-50 p-5"><input type="hidden" name="contractId" value={contract.id}/><h3 className="font-black">{fr ? "Ajouter une règle contractuelle" : "Add contractual rule"}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-bold lg:col-span-2">{fr ? "Libellé *" : "Label *"}<input name="label" required className={fieldClass()}/></label><label className="text-sm font-bold">Type<select name="ruleType" defaultValue="fixed_periodic" className={fieldClass()}><option value="fixed_periodic">Fixed periodic</option><option value="fixed_event">Fixed event</option><option value="percentage">Percentage</option><option value="threshold">Threshold</option><option value="benefit">Benefit</option><option value="other">Other</option></select></label><label className="text-sm font-bold">{fr ? "Cadence" : "Cadence"}<select name="cadence" defaultValue="monthly" className={fieldClass()}><option value="one_time">One time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="per_event">Per event</option><option value="per_sale">Per sale</option><option value="other">Other</option></select></label><label className="text-sm font-bold">{fr ? "Montant" : "Amount"}<input name="amount" type="number" min="0" step="0.01" className={fieldClass()}/></label><label className="text-sm font-bold">%</label><input name="percentage" type="number" min="0" max="100" step="0.0001" className={fieldClass()}/><label className="text-sm font-bold">{fr ? "Seuil min" : "Min threshold"}<input name="thresholdMin" type="number" step="0.01" className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Seuil max" : "Max threshold"}<input name="thresholdMax" type="number" step="0.01" className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Devise" : "Currency"}<input name="currency" defaultValue={contract.currency} maxLength={8} className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Référence clause" : "Clause reference"}<input name="clauseReference" className={fieldClass()}/></label><label className="text-sm font-bold lg:col-span-2">{fr ? "Condition / avantage" : "Condition / benefit"}<textarea name="conditionText" rows={2} className={fieldClass()}/></label></div><button className="mt-4 rounded-xl bg-fuchsia-700 px-5 py-3 font-black text-white">{fr ? "Ajouter la règle" : "Add rule"}</button></form> : null}
      <div className="mt-7 border-t border-fuchsia-200 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">{fr ? "MOTEUR FINANCIER CONTRACTUEL" : "CONTRACT FINANCIAL ENGINE"}</p><h3 className="mt-2 text-xl font-black">{fr ? "Du droit contractuel au montant à régler" : "From contractual entitlement to amount due"}</h3><p className="mt-2 text-sm text-slate-600">{fr ? "Super Leader calcule le montant prévu par la règle, vérifie les obligations de la période et exige une approbation humaine. Aucun virement bancaire n’est exécuté ici." : "Super Leader calculates the contractual amount, checks period obligations and requires human approval. No bank transfer is executed here."}</p></div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><div className="rounded-xl bg-amber-50 p-3"><p className="text-xs font-black uppercase text-amber-800">{fr ? "À valider" : "Pending"}</p><p className="mt-1 text-2xl font-black">{financialPending}</p></div><div className="rounded-xl bg-red-50 p-3"><p className="text-xs font-black uppercase text-red-800">{fr ? "Bloqués / attente" : "Blocked / held"}</p><p className="mt-1 text-2xl font-black">{financialHeld}</p></div><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-black uppercase text-emerald-800">{fr ? "Approuvés" : "Approved"}</p><p className="mt-1 text-2xl font-black">{financialApproved}</p></div><div className="rounded-xl bg-cyan-50 p-3"><p className="text-xs font-black uppercase text-cyan-800">{fr ? "Réglés / remis" : "Settled"}</p><p className="mt-1 text-2xl font-black">{financialSettled}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-600">{fr ? "Approuvé à payer" : "Approved due"}</p><p className="mt-1 text-lg font-black">{money(approvedAmount, contract.currency, dateLocale)}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-600">{fr ? "Payé enregistré" : "Paid recorded"}</p><p className="mt-1 text-lg font-black">{money(paidAmount, contract.currency, dateLocale)}</p></div></div>
        {compensationRules.length ? <form action={createContractFinancialItemAction} className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 p-5"><input type="hidden" name="contractId" value={contract.id}/><h4 className="font-black">{fr ? "Calculer une échéance de rémunération / avantage" : "Calculate compensation / benefit item"}</h4><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-bold lg:col-span-2">{fr ? "Règle contractuelle *" : "Contract rule *"}<select name="ruleId" required className={fieldClass()}>{compensationRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.label} · {rule.rule_type}</option>)}</select></label><label className="text-sm font-bold">{fr ? "Début période" : "Period start"}<input name="periodStart" type="date" className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Fin période" : "Period end"}<input name="periodEnd" type="date" className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Échéance paiement" : "Payment due"}<input name="dueDate" type="date" className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Montant de base" : "Base amount"}<input name="baseAmount" type="number" min="0" step="0.01" placeholder={fr ? "Pour % / seuil" : "For % / threshold"} className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Quantité / événements" : "Quantity / events"}<input name="quantity" type="number" min="0" step="0.0001" defaultValue="1" className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Référence source" : "Source reference"}<input name="sourceReference" placeholder={fr ? "Facture, vente, reçu, rapport…" : "Invoice, sale, receipt, report…"} className={fieldClass()}/></label><label className="text-sm font-bold lg:col-span-4">{fr ? "Note de calcul / contexte" : "Calculation / context note"}<textarea name="requestNote" rows={2} className={fieldClass()}/></label></div><button className="mt-4 rounded-xl bg-cyan-700 px-5 py-3 font-black text-white">{fr ? "Calculer et soumettre" : "Calculate and submit"}</button></form> : null}
        <div className="mt-5 space-y-3">{financialItems.map((item) => {const rule = compensationRuleById.get(item.compensation_rule_id); const creator = actorById.get(item.created_by); const reviewer = item.reviewed_by ? actorById.get(item.reviewed_by) : null; const settler = item.settled_by ? actorById.get(item.settled_by) : null; const gateTone = item.gate_status === "ready" ? "bg-emerald-100 text-emerald-800" : item.gate_status === "blocked" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"; return <article key={item.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-black">{rule?.label || (fr ? "Règle contractuelle" : "Contract rule")}</h4><p className="mt-1 text-xs text-slate-500">{item.period_start || "—"} → {item.period_end || "—"}{item.due_date ? ` · ${fr ? "Échéance" : "Due"}: ${item.due_date}` : ""}</p></div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${gateTone}`}>Gate: {item.gate_status}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase">{item.status}</span></div></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><div><p className="text-xs font-black uppercase text-slate-500">{fr ? "Calcul contractuel" : "Contract calculation"}</p><p className="mt-1 text-xl font-black">{item.item_type === "benefit" && Number(item.calculated_amount) === 0 ? (fr ? "Avantage en nature" : "In-kind benefit") : money(item.calculated_amount, item.currency, dateLocale)}</p></div><div><p className="text-xs font-black uppercase text-slate-500">{fr ? "Base / quantité" : "Base / quantity"}</p><p className="mt-1 text-sm font-bold">{item.base_amount !== null ? money(item.base_amount, item.currency, dateLocale) : "—"} · × {Number(item.quantity)}</p></div><div><p className="text-xs font-black uppercase text-slate-500">{fr ? "Contrôle exécution" : "Execution gate"}</p><p className="mt-1 text-sm">{item.gate_note || "—"}</p></div></div>{item.source_reference ? <p className="mt-3 text-sm"><b>{fr ? "Référence" : "Reference"}:</b> {item.source_reference}</p> : null}{item.request_note ? <p className="mt-2 text-sm text-slate-600">{item.request_note}</p> : null}{item.review_note ? <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm"><b>{fr ? "Revue" : "Review"}:</b> {item.review_note}{reviewer ? ` · ${reviewer.full_name || reviewer.email || ""}` : ""}</p> : null}{item.settlement_reference ? <p className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm"><b>{fr ? "Règlement" : "Settlement"}:</b> {item.settlement_reference}{item.settled_amount !== null ? ` · ${money(item.settled_amount,item.currency,dateLocale)}` : ""}{settler ? ` · ${settler.full_name || settler.email || ""}` : ""}</p> : null}<p className="mt-2 text-xs text-slate-500">{fr ? "Créé par" : "Created by"}: {creator?.full_name || creator?.email || "—"} · {dateTime(item.created_at, dateLocale)}</p>{canManage && ["pending","held"].includes(item.status) ? <form action={reviewContractFinancialItemAction} className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto]"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="itemId" value={item.id}/><select name="decision" defaultValue={item.gate_status === "blocked" ? "held" : "approved"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"><option value="approved">{fr ? "Approuver" : "Approve"}</option><option value="held">{fr ? "Mettre en attente" : "Hold"}</option><option value="rejected">{fr ? "Rejeter" : "Reject"}</option></select><input name="reviewNote" placeholder={fr ? "Motif / justification" : "Reason / justification"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/><button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr ? "Enregistrer la décision" : "Save decision"}</button></form> : null}{canManage && item.status === "approved" ? <form action={settleContractFinancialItemAction} className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto]"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="itemId" value={item.id}/><input name="settledAmount" type="number" min="0" step="0.01" defaultValue={Number(item.calculated_amount)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/><input name="settlementReference" required placeholder={item.item_type === "benefit" ? (fr ? "Preuve de remise / référence" : "Delivery proof / reference") : (fr ? "Référence de paiement / reçu" : "Payment / receipt reference")} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white">{item.item_type === "benefit" ? (fr ? "Marquer remis" : "Mark delivered") : (fr ? "Marquer payé" : "Mark paid")}</button></form> : null}</article>;})}{!financialItems.length ? <p className="rounded-2xl bg-slate-50 p-6 text-center text-slate-500">{fr ? "Aucune échéance financière calculée pour ce contrat." : "No financial item calculated for this contract."}</p> : null}</div>
      </div>
    </section>
    </> : null}

    {activeTab === "documents" ? <>
    <section id="contract-documents" className="mt-7 rounded-3xl border border-blue-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">{fr ? "DOCUMENTS & AVENANTS" : "DOCUMENTS & AMENDMENTS"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Version contractuelle & registre documentaire" : "Contract version & document register"}</h2><p className="mt-2 max-w-4xl text-sm text-slate-600">{fr ? "Le contrat original et chaque document archivé restent immuables. Les conditions actives ne changent que lorsqu’un avenant signé est explicitement appliqué." : "The original contract and each archived document remain immutable. Active terms change only when a signed amendment is explicitly applied."}</p></div>
        <div className="rounded-2xl bg-slate-950 px-5 py-3 text-white"><p className="text-xs font-black uppercase text-slate-300">{fr ? "Version actuelle" : "Current version"}</p><p className="text-2xl font-black">V{contract.current_version}</p>{contract.last_amendment_at ? <p className="text-xs text-slate-300">{dateTime(contract.last_amendment_at, dateLocale)}</p> : null}</div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase text-slate-500">{fr ? "Document original" : "Original document"}</p><h3 className="mt-1 font-black">{contract.source_document_file_name || (fr ? "Contrat signé non archivé" : "Signed contract not archived")}</h3></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">V1</span></div>
          {contract.source_document_storage_path ? <Link href={`/api/attachments/contract-source/${contract.id}`} target="_blank" className="mt-3 inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr ? "Ouvrir l’original" : "Open original"}</Link> : null}
        </article>
        <article className="rounded-2xl border border-blue-100 bg-blue-50 p-4"><p className="text-xs font-black uppercase text-blue-700">{fr ? "Gouvernance" : "Governance"}</p><p className="mt-1 text-sm font-bold">{fr ? `${contractAmendments.filter((row) => row.status === "applied").length} avenant(s) appliqué(s) · ${contractDocuments.length} document(s) au registre` : `${contractAmendments.filter((row) => row.status === "applied").length} applied amendment(s) · ${contractDocuments.length} registered document(s)`}</p><Link href="/dashboard/contracts/documents" className="mt-3 inline-flex text-sm font-black text-blue-800 underline">{fr ? "Ouvrir le centre documentaire global" : "Open global document centre"}</Link></article>
      </div>

      <div className="mt-6 space-y-4">
        {contractAmendments.map((amendment) => {
          const document = amendment.document_id ? documentById.get(amendment.document_id) : null;
          const creator = actorById.get(amendment.created_by);
          const changeEntries = Object.entries(amendment.changes ?? {});
          return <article key={amendment.id} className={`rounded-2xl border p-5 ${amendment.status === "applied" ? "border-emerald-200 bg-emerald-50" : amendment.status === "ready" ? "border-indigo-200 bg-indigo-50" : amendment.status === "cancelled" ? "border-slate-200 bg-slate-50 opacity-80" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-slate-500">{fr ? `Avenant n°${amendment.amendment_number}` : `Amendment #${amendment.amendment_number}`} · V{amendment.previous_version} → V{amendment.resulting_version}</p><h3 className="mt-1 text-lg font-black">{amendment.title}</h3><p className="mt-1 text-xs text-slate-500">{fr ? "Effet" : "Effective"}: {amendment.effective_date} · {creator?.full_name || creator?.email || "—"}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-black uppercase shadow-sm">{amendment.status}</span></div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{amendment.reason}</p>
            <div className="mt-4 grid gap-2 md:grid-cols-2">{changeEntries.map(([key, change]) => <div key={key} className="rounded-xl bg-white/80 p-3 text-sm"><p className="text-xs font-black uppercase text-slate-500">{key.replaceAll("_", " ")}</p><p className="mt-1"><span className="line-through opacity-60">{String(change?.from ?? "—")}</span> <b>→ {String(change?.to ?? "—")}</b></p></div>)}</div>
            <div className="mt-4 flex flex-wrap gap-2">{document ? <Link href={`/api/attachments/contract-document/${document.id}`} target="_blank" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">📎 {document.file_name}</Link> : <span className="rounded-full bg-amber-100 px-3 py-2 text-xs font-black text-amber-900">{fr ? "Document signé requis" : "Signed document required"}</span>}</div>
            {canManage && amendment.status === "draft" && !document ? <form action={attachContractAmendmentDocumentAction} className="mt-4 rounded-xl border border-indigo-200 bg-white p-4"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="amendmentId" value={amendment.id}/><SecureAttachmentUpload purpose="contract" prefix="amendmentDocument" label={fr ? "Joindre l’avenant signé" : "Attach signed amendment"} help={fr ? "PDF / Word privé · 10 Mo max." : "Private PDF / Word · 10 MB max."} chooseLabel={fr ? "Choisir le document" : "Choose document"} uploadingLabel={fr ? "Téléversement sécurisé…" : "Secure upload…"} uploadedLabel={fr ? "Document prêt" : "Document ready"} removeLabel={fr ? "Retirer" : "Remove"} errorLabel={fr ? "Document invalide." : "Invalid document."} required/><button className="mt-3 rounded-xl bg-indigo-700 px-4 py-2 text-sm font-black text-white">{fr ? "Archiver le document signé" : "Archive signed document"}</button></form> : null}
            {canManage && amendment.status === "ready" ? amendment.effective_date > today ? <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><div className="mr-auto"><p className="text-sm font-black text-amber-950">{fr ? `Avenant à effet futur : ${amendment.effective_date}` : `Future-effective amendment: ${amendment.effective_date}`}</p><p className="mt-1 text-sm text-amber-900">{fr ? "Le document signé reste archivé, mais les conditions actives et la version du contrat ne doivent pas changer avant cette date." : "The signed document remains archived, but active terms and the contract version must not change before this date."}</p></div><button type="button" disabled className="cursor-not-allowed rounded-xl bg-amber-200 px-4 py-2 text-sm font-black text-amber-800">{fr ? `Application disponible le ${amendment.effective_date}` : `Available on ${amendment.effective_date}`}</button></div> : <form action={applyContractAmendmentAction} className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-white p-4"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="amendmentId" value={amendment.id}/><input type="hidden" name="confirmation" value="APPLY"/><p className="mr-auto text-sm font-bold text-emerald-900">{fr ? `Le document signé est archivé. Date d’effet vérifiée : ${amendment.effective_date}. L’application mettra à jour les conditions actives et créera une nouvelle version.` : `The signed document is archived. Effective date verified: ${amendment.effective_date}. Applying it updates active terms and creates a new version.`}</p><button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white">{fr ? `Appliquer l’avenant · V${amendment.resulting_version}` : `Apply amendment · V${amendment.resulting_version}`}</button></form> : null}
            {canManage && ["draft","ready"].includes(amendment.status) ? <details className="mt-3"><summary className="cursor-pointer text-xs font-black text-red-700">{fr ? "Annuler cet avenant" : "Cancel this amendment"}</summary><form action={cancelContractAmendmentAction} className="mt-2 flex gap-2"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="amendmentId" value={amendment.id}/><input name="reason" required minLength={3} placeholder={fr ? "Motif d’annulation" : "Cancellation reason"} className="min-w-0 flex-1 rounded-xl border border-red-200 px-3 py-2 text-sm"/><button className="rounded-xl bg-red-700 px-4 py-2 text-sm font-black text-white">{fr ? "Annuler" : "Cancel"}</button></form></details> : null}
          </article>;
        })}
        {!contractAmendments.length ? <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500">{fr ? "Aucun avenant enregistré." : "No amendment recorded."}</p> : null}
      </div>

      {canManage ? <details className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><summary className="cursor-pointer text-lg font-black">{fr ? "Préparer un nouvel avenant" : "Prepare a new amendment"}</summary><form action={createContractAmendmentAction} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="contractId" value={contract.id}/><label className="text-sm font-bold">{fr ? "Titre *" : "Title *"}<input name="title" required className={fieldClass()} placeholder={fr ? "Ex. Extension du périmètre" : "E.g. Scope extension"}/></label><label className="text-sm font-bold">{fr ? "Date d’effet *" : "Effective date *"}<input name="effectiveDate" type="date" required className={fieldClass()}/></label><label className="text-sm font-bold sm:col-span-2">{fr ? "Motif / justification *" : "Reason / justification *"}<textarea name="reason" rows={3} required className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Nouvelle date de fin" : "New end date"}<input name="newEndDate" type="date" className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Nouvelle valeur contractuelle" : "New contract value"}<input name="newValueAmount" type="number" min="0" step="0.01" className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Nouvelle devise" : "New currency"}<input name="newCurrency" maxLength={8} className={fieldClass()} placeholder={contract.currency}/></label><label className="text-sm font-bold">{fr ? "Nouvelle cible performance (%)" : "New performance target (%)"}<input name="newPerformanceTarget" type="number" min="0" max="100" step="0.1" className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Nouveau préavis renouvellement (jours)" : "New renewal notice (days)"}<input name="newRenewalNoticeDays" type="number" min="0" max="730" className={fieldClass()}/></label><label className="text-sm font-bold sm:col-span-2">{fr ? "Nouveau périmètre" : "New scope"}<textarea name="newServiceScope" rows={4} className={fieldClass()} placeholder={fr ? "Laisser vide si inchangé" : "Leave blank if unchanged"}/></label><label className="text-sm font-bold sm:col-span-2">{fr ? "Nouvelles conditions de paiement" : "New payment terms"}<textarea name="newPaymentTerms" rows={4} className={fieldClass()} placeholder={fr ? "Laisser vide si inchangé" : "Leave blank if unchanged"}/></label><div className="sm:col-span-2"><SecureAttachmentUpload purpose="contract" prefix="amendmentDocument" label={fr ? "Avenant signé (optionnel à cette étape)" : "Signed amendment (optional at this stage)"} help={fr ? "Tu peux créer le projet maintenant et joindre le document signé plus tard." : "You may create the draft now and attach the signed document later."} chooseLabel={fr ? "Choisir le document" : "Choose document"} uploadingLabel={fr ? "Téléversement sécurisé…" : "Secure upload…"} uploadedLabel={fr ? "Document prêt" : "Document ready"} removeLabel={fr ? "Retirer" : "Remove"} errorLabel={fr ? "Document invalide." : "Invalid document."}/></div><button className="sm:col-span-2 rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{fr ? "Créer l’avenant" : "Create amendment"}</button></form></details> : null}

      {canManage ? <details className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5"><summary className="cursor-pointer font-black">{fr ? "Archiver un autre document contractuel" : "Archive another contract document"}</summary><form action={createContractDocumentAction} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="contractId" value={contract.id}/><label className="text-sm font-bold">{fr ? "Type" : "Type"}<select name="documentType" defaultValue="annex" className={fieldClass()}><option value="annex">Annex</option><option value="exhibit">Exhibit</option><option value="nda">NDA</option><option value="insurance">Insurance</option><option value="invoice">Invoice</option><option value="receipt">Receipt</option><option value="correspondence">Correspondence</option><option value="other">Other</option></select></label><label className="text-sm font-bold">{fr ? "Date du document" : "Document date"}<input name="documentDate" type="date" className={fieldClass()}/></label><label className="text-sm font-bold sm:col-span-2">{fr ? "Titre *" : "Title *"}<input name="title" required className={fieldClass()}/></label><label className="text-sm font-bold sm:col-span-2">Description<textarea name="description" rows={3} className={fieldClass()}/></label><div className="sm:col-span-2"><SecureAttachmentUpload purpose="contract" prefix="contractDocument" label={fr ? "Document privé" : "Private document"} help={fr ? "PDF / Word · 10 Mo max. Le fichier archivé devient immuable." : "PDF / Word · 10 MB max. Archived files become immutable."} chooseLabel={fr ? "Choisir le document" : "Choose document"} uploadingLabel={fr ? "Téléversement sécurisé…" : "Secure upload…"} uploadedLabel={fr ? "Document prêt" : "Document ready"} removeLabel={fr ? "Retirer" : "Remove"} errorLabel={fr ? "Document invalide." : "Invalid document."} required/></div><button className="sm:col-span-2 rounded-xl bg-blue-700 px-5 py-3 font-black text-white">{fr ? "Archiver le document" : "Archive document"}</button></form></details> : null}

      {contractDocuments.filter((doc) => doc.document_type !== "amendment").length ? <div className="mt-6"><h3 className="font-black">{fr ? "Autres documents contractuels" : "Other contract documents"}</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{contractDocuments.filter((doc) => doc.document_type !== "amendment").map((doc) => <Link key={doc.id} href={`/api/attachments/contract-document/${doc.id}`} target="_blank" className="rounded-2xl border border-slate-200 p-4 hover:border-blue-300"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-blue-700">{doc.document_type}</p><p className="mt-1 font-black">{doc.title}</p><p className="mt-1 text-xs text-slate-500">{doc.document_date || doc.created_at.slice(0,10)} · {doc.file_name}</p></div><span className="text-lg">📎</span></div>{doc.description ? <p className="mt-2 text-sm text-slate-600">{doc.description}</p> : null}</Link>)}</div></div> : null}
    </section>
    </> : null}

    {activeTab === "performance" ? <>
    <section className="mt-7 rounded-3xl border border-violet-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">{fr ? "EXÉCUTION DU CONTRAT" : "CONTRACT EXECUTION"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Livrables & jalons" : "Deliverables & milestones"}</h2></div><span className="rounded-full bg-violet-100 px-4 py-2 text-sm font-black">{deliverables.length}</span></div>
      <div className="mt-5 space-y-4">{deliverables.map((item) => {
        const overdue = !DONE_DELIVERABLES.has(item.status) && item.due_date < today;
        return <article key={item.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black">{item.title}</h3><p className="mt-1 text-sm text-slate-500">{fr ? "Échéance" : "Due"}: {item.due_date} · {fr ? "Poids" : "Weight"}: {Number(item.weight)}%</p></div><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${deliverableTone(item.status, overdue)}`}>{overdue ? (fr ? "EN RETARD" : "OVERDUE") : item.status.replaceAll("_", " ")}</span></div>{item.description ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.description}</p> : null}{item.evidence_reference ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><b>{fr ? "Preuve" : "Evidence"}:</b> {item.evidence_reference}</p> : null}{item.review_note ? <p className="mt-2 text-sm text-slate-600"><b>{fr ? "Revue" : "Review"}:</b> {item.review_note}</p> : null}{item.review_score !== null ? <p className="mt-2 text-sm font-bold text-violet-800">{item.review_outcome === "partial" ? (fr ? "Acceptation partielle" : "Partial acceptance") : item.review_outcome === "rejected" ? (fr ? "Rejeté" : "Rejected") : (fr ? "Accepté" : "Accepted")} · {Number(item.review_score).toFixed(1)}%</p> : null}<form action={updateContractDeliverableAction} className="mt-4 grid gap-2 xl:grid-cols-[170px_150px_1fr_1fr_auto]"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="deliverableId" value={item.id}/><select name="status" defaultValue={item.status} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="submitted">Submitted</option><option value="accepted">{fr ? "Accepté / partiel" : "Accepted / partial"}</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select><input name="reviewScore" type="number" min="0" max="100" step="0.1" defaultValue={item.review_score ?? ""} placeholder={fr ? "Score revue 0-100" : "Review score 0-100"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/><input name="evidenceReference" defaultValue={item.evidence_reference} placeholder={fr ? "Lien / référence de preuve" : "Evidence link / reference"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/><input name="note" placeholder={fr ? "Note de soumission / revue" : "Submission / review note"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/><button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr ? "Mettre à jour" : "Update"}</button></form></article>;
      })}{!deliverables.length ? <p className="rounded-2xl bg-slate-50 p-6 text-center text-slate-500">{fr ? "Aucun livrable défini." : "No deliverables defined."}</p> : null}</div>
      <form action={createContractDeliverableAction} className="mt-6 rounded-2xl bg-violet-50 p-5"><input type="hidden" name="contractId" value={contract.id}/><h3 className="font-black">{fr ? "Ajouter un livrable" : "Add deliverable"}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">{fr ? "Livrable *" : "Deliverable *"}<input name="title" required className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Échéance *" : "Due date *"}<input name="dueDate" type="date" required className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Poids (%)" : "Weight (%)"}<input name="weight" type="number" min="0" max="100" step="0.1" defaultValue="0" className={fieldClass()}/></label><label className="text-sm font-bold sm:col-span-2">Description<textarea name="description" rows={3} className={fieldClass()}/></label></div><button className="mt-4 rounded-xl bg-violet-700 px-5 py-3 font-black text-white">{fr ? "Ajouter le livrable" : "Add deliverable"}</button></form>
    </section>
    </> : null}

    {activeTab === "execution" ? <>
    <section className="mt-7 rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm">
      <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">{fr ? "REPORTING PÉRIODIQUE" : "PERIODIC REPORTING"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Rapports d’exécution" : "Execution reports"}</h2></div>
      <div className="mt-5 space-y-4">{reports.map((report) => {const submitter = actorById.get(report.submitted_by); return <article key={report.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-black">{report.period_start} → {report.period_end}</h3><p className="text-xs text-slate-500">{submitter?.full_name || submitter?.email || "—"} · {dateTime(report.submitted_at, dateLocale)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${report.status === "accepted" ? "bg-emerald-100 text-emerald-800" : report.status === "rejected" ? "bg-red-100 text-red-800" : "bg-indigo-100 text-indigo-800"}`}>{report.status}</span></div><div className="mt-4 grid gap-4 lg:grid-cols-3"><div><p className="text-xs font-black uppercase text-slate-500">{fr ? "Travail réalisé" : "Work completed"}</p><p className="mt-1 whitespace-pre-wrap text-sm">{report.work_completed}</p></div><div><p className="text-xs font-black uppercase text-slate-500">{fr ? "Difficultés" : "Challenges"}</p><p className="mt-1 whitespace-pre-wrap text-sm">{report.challenges || "—"}</p></div><div><p className="text-xs font-black uppercase text-slate-500">{fr ? "Actions suivantes" : "Next actions"}</p><p className="mt-1 whitespace-pre-wrap text-sm">{report.next_actions || "—"}</p></div></div>{report.evidence_reference ? <p className="mt-3 text-sm"><b>{fr ? "Preuve" : "Evidence"}:</b> {report.evidence_reference}</p> : null}{report.review_note ? <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm"><b>{fr ? "Note de revue" : "Review note"}:</b> {report.review_note}</p> : null}{report.status === "submitted" ? <form action={reviewContractExecutionReportAction} className="mt-4 grid gap-2 md:grid-cols-[180px_1fr_auto]"><input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="reportId" value={report.id}/><select name="status" defaultValue="accepted" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select><input name="reviewNote" placeholder={fr ? "Commentaire de validation / rejet" : "Validation / rejection comment"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/><button className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-black text-white">{fr ? "Valider la revue" : "Submit review"}</button></form> : null}</article>;})}{!reports.length ? <p className="rounded-2xl bg-slate-50 p-6 text-center text-slate-500">{fr ? "Aucun rapport d’exécution." : "No execution reports."}</p> : null}</div>
      <form action={createContractExecutionReportAction} className="mt-6 rounded-2xl bg-indigo-50 p-5"><input type="hidden" name="contractId" value={contract.id}/><h3 className="font-black">{fr ? "Soumettre un rapport d’exécution" : "Submit execution report"}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">{fr ? "Début période *" : "Period start *"}<input name="periodStart" type="date" required className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Fin période *" : "Period end *"}<input name="periodEnd" type="date" required className={fieldClass()}/></label><label className="text-sm font-bold sm:col-span-2">{fr ? "Travail réalisé *" : "Work completed *"}<textarea name="workCompleted" rows={4} required className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Difficultés / écarts" : "Challenges / gaps"}<textarea name="challenges" rows={3} className={fieldClass()}/></label><label className="text-sm font-bold">{fr ? "Prochaines actions" : "Next actions"}<textarea name="nextActions" rows={3} className={fieldClass()}/></label><label className="text-sm font-bold sm:col-span-2">{fr ? "Lien / référence de preuve" : "Evidence link / reference"}<input name="evidenceReference" className={fieldClass()}/></label></div><button className="mt-4 rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{fr ? "Soumettre le rapport" : "Submit report"}</button></form>
    </section>
    </> : null}

    {activeTab === "risks" ? <>
    <section className="mt-7 rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">{fr ? "RISQUES & NON-CONFORMITÉS" : "RISKS & NON-CONFORMITIES"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Incidents du contrat" : "Contract incidents"}</h2><p className="mt-2 text-sm text-slate-600">{fr ? "Les incidents ouverts réduisent le score contractuel. Un incident critique déclenche une revue de suspension urgente." : "Open incidents reduce the contract score. A critical incident triggers an urgent suspension review."}</p></div>
        <div className="flex gap-2 text-xs font-black"><span className="rounded-full bg-red-100 px-3 py-2 text-red-800">{openIncidents.length} {fr ? "ouvert(s)" : "open"}</span><span className="rounded-full bg-red-700 px-3 py-2 text-white">{criticalOpenIncidents.length} {fr ? "critique(s)" : "critical"}</span></div>
      </div>
      <div className="mt-5 space-y-4">
        {incidents.map((incident) => {
          const creator = actorById.get(incident.created_by);
          const resolvedBy = incident.resolved_by ? actorById.get(incident.resolved_by) : null;
          return <article key={incident.id} className="rounded-2xl border border-slate-200 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black">{incident.title}</h3><p className="mt-1 text-xs text-slate-500">{fr ? "Créé par" : "Created by"}: {creator?.full_name || creator?.email || "—"} · {dateTime(incident.created_at, dateLocale)}{incident.due_date ? ` · ${fr ? "Échéance" : "Due"}: ${incident.due_date}` : ""}</p></div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${incidentTone(incident.severity)}`}>{incident.severity}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase text-slate-700">{incident.status.replaceAll("_", " ")}</span></div></div>
            {incident.description ? <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{incident.description}</p> : null}
            {incident.corrective_action ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm"><b>{fr ? "Action corrective" : "Corrective action"}:</b> {incident.corrective_action}</p> : null}
            {incident.resolution_note ? <p className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm"><b>{fr ? "Résolution" : "Resolution"}:</b> {incident.resolution_note}{resolvedBy ? ` · ${resolvedBy.full_name || resolvedBy.email || ""}` : ""}</p> : null}
            <form action={updateContractIncidentAction} className="mt-4 grid gap-2 lg:grid-cols-[180px_1fr_1fr_auto]">
              <input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="incidentId" value={incident.id}/>
              <select name="status" defaultValue={incident.status} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold"><option value="open">Open</option><option value="corrective_action">Corrective action</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select>
              <input name="correctiveAction" defaultValue={incident.corrective_action} placeholder={fr ? "Action corrective" : "Corrective action"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/>
              <input name="resolutionNote" placeholder={fr ? "Note de résolution (requise pour clôturer)" : "Resolution note (required to resolve)"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/>
              <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr ? "Mettre à jour" : "Update"}</button>
            </form>
          </article>;
        })}
        {!incidents.length ? <p className="rounded-2xl bg-slate-50 p-6 text-center text-slate-500">{fr ? "Aucun incident enregistré." : "No incidents recorded."}</p> : null}
      </div>
      <form action={createContractIncidentAction} className="mt-6 rounded-2xl bg-red-50 p-5">
        <input type="hidden" name="contractId" value={contract.id}/><input type="hidden" name="ownerUserId" value={contract.internal_owner_user_id}/>
        <h3 className="font-black">{fr ? "Enregistrer un incident / une non-conformité" : "Record incident / non-conformity"}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-bold lg:col-span-2">{fr ? "Incident *" : "Incident *"}<input name="title" required className={fieldClass()}/></label>
          <label className="text-sm font-bold">{fr ? "Gravité" : "Severity"}<select name="severity" defaultValue="medium" className={fieldClass()}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
          <label className="text-sm font-bold lg:col-span-2">Description<textarea name="description" rows={3} className={fieldClass()}/></label>
          <label className="text-sm font-bold">{fr ? "Échéance corrective" : "Corrective due date"}<input name="dueDate" type="date" className={fieldClass()}/></label>
          <label className="text-sm font-bold lg:col-span-3">{fr ? "Action corrective initiale" : "Initial corrective action"}<textarea name="correctiveAction" rows={2} className={fieldClass()}/></label>
        </div>
        <button className="mt-4 rounded-xl bg-red-700 px-5 py-3 font-black text-white">{fr ? "Enregistrer l’incident" : "Record incident"}</button>
      </form>
    </section>
    </> : null}

    {activeTab === "performance" ? <>
    <section className="mt-7 rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{fr ? "KPI & PERFORMANCE" : "KPIs & PERFORMANCE"}</p>
          <h2 className="mt-2 text-2xl font-black">{fr ? "Indicateurs contractuels" : "Contract performance indicators"}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">{fr ? "Un résultat KPI est d’abord soumis, puis validé. Seuls les résultats validés entrent dans le score global pondéré du contrat." : "A KPI result is first submitted, then reviewed. Only accepted results contribute to the contract's weighted overall score."}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-full bg-amber-100 px-3 py-2 text-amber-900">{fr ? `${submittedKpiResults.length} en attente` : `${submittedKpiResults.length} pending`}</span>
          <span className="rounded-full bg-emerald-100 px-3 py-2 text-emerald-800">{fr ? `${acceptedKpiResults.length} validé(s)` : `${acceptedKpiResults.length} accepted`}</span>
          <span className="rounded-full bg-red-100 px-3 py-2 text-red-800">{fr ? `${rejectedKpiResults.length} rejeté(s)` : `${rejectedKpiResults.length} rejected`}</span>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {kpis.map((kpi) => {
          const results = kpiResults.filter((row) => row.kpi_id === kpi.id);
          const acceptedResults = results.filter((row) => row.status === "accepted");
          const avg = acceptedResults.length ? acceptedResults.reduce((sum, row) => sum + Number(row.score), 0) / acceptedResults.length : null;
          const latest = results[0];
          return <article key={kpi.id} className="rounded-2xl border border-slate-200 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black">{kpi.name}</h3>
                <p className="text-sm text-slate-500">{fr ? "Cible" : "Target"}: {Number(kpi.target_value)} {kpi.unit} · {fr ? "Poids" : "Weight"}: {Number(kpi.weight)}% · {kpi.direction}</p>
              </div>
              <div className="text-right">
                <span className={`inline-flex rounded-full px-3 py-1 text-sm font-black ${avg === null ? "bg-slate-100 text-slate-700" : avg >= performanceTarget ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{pct(avg)}</span>
                <p className="mt-1 text-[11px] text-slate-500">{fr ? "Moyenne des résultats validés" : "Accepted-results average"}</p>
              </div>
            </div>
            {kpi.description ? <p className="mt-2 text-sm text-slate-600">{kpi.description}</p> : null}
            {latest ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>{fr ? "Dernier résultat" : "Latest result"}: {latest.period_start} → {latest.period_end} · {latest.actual_value ?? "—"} {kpi.unit} · {Number(latest.score).toFixed(1)}%</span><span className={`rounded-full px-2 py-1 font-black ${kpiResultTone(latest.status)}`}>{latest.status === "accepted" ? (fr ? "VALIDÉ" : "ACCEPTED") : latest.status === "rejected" ? (fr ? "REJETÉ" : "REJECTED") : (fr ? "À VALIDER" : "PENDING")}</span></div> : null}

            {results.length ? <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{fr ? "Derniers résultats" : "Recent results"}</p>
              {results.slice(0, 4).map((result) => {
                const recorder = actorById.get(result.recorded_by);
                const reviewer = result.reviewed_by ? actorById.get(result.reviewed_by) : null;
                return <div key={result.id} className="rounded-xl bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-black">{result.period_start} → {result.period_end}</p>
                      <p className="mt-1 text-sm text-slate-600">{fr ? "Réalisé" : "Actual"}: {result.actual_value ?? "—"} {kpi.unit} · {fr ? "Score calculé" : "Calculated score"}: <b>{Number(result.score).toFixed(1)}%</b></p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${kpiResultTone(result.status)}`}>{result.status === "accepted" ? (fr ? "VALIDÉ" : "ACCEPTED") : result.status === "rejected" ? (fr ? "REJETÉ" : "REJECTED") : (fr ? "EN ATTENTE" : "PENDING")}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{fr ? "Saisi par" : "Recorded by"}: {recorder?.full_name || recorder?.email || "—"} · {dateTime(result.created_at, dateLocale)}</p>
                  {result.comment ? <p className="mt-2 text-sm text-slate-700">{result.comment}</p> : null}
                  {result.review_note ? <p className="mt-2 rounded-lg bg-white p-3 text-sm"><b>{fr ? "Note de validation" : "Review note"}:</b> {result.review_note}{reviewer ? ` · ${reviewer.full_name || reviewer.email || ""}` : ""}</p> : null}
                  {result.status === "submitted" ? <form action={reviewContractKpiResultAction} className="mt-3 grid gap-2 md:grid-cols-[170px_1fr_auto]">
                    <input type="hidden" name="contractId" value={contract.id}/>
                    <input type="hidden" name="resultId" value={result.id}/>
                    <select name="status" defaultValue="accepted" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold"><option value="accepted">{fr ? "Valider" : "Accept"}</option><option value="rejected">{fr ? "Rejeter" : "Reject"}</option></select>
                    <input name="reviewNote" placeholder={fr ? "Commentaire de validation / motif du rejet" : "Review comment / rejection reason"} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"/>
                    <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr ? "Décider" : "Review"}</button>
                  </form> : null}
                </div>;
              })}
            </div> : null}

            <form action={recordContractKpiResultAction} className="mt-4 grid gap-2 border-t border-slate-200 pt-4 lg:grid-cols-[150px_150px_170px_1fr_auto]">
              <input type="hidden" name="contractId" value={contract.id}/>
              <input type="hidden" name="kpiId" value={kpi.id}/>
              <input name="periodStart" type="date" required aria-label={fr ? "Début période" : "Period start"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/>
              <input name="periodEnd" type="date" required aria-label={fr ? "Fin période" : "Period end"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/>
              {kpi.direction === "manual" ? <input name="manualScore" type="number" min="0" max="100" step="0.1" placeholder={fr ? "Score 0-100" : "Score 0-100"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/> : <input name="actualValue" type="number" step="0.0001" placeholder={`${fr ? "Réalisé" : "Actual"} (${kpi.unit})`} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/>}
              <input name="comment" placeholder={fr ? "Commentaire / référence de preuve" : "Comment / evidence reference"} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/>
              <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white">{fr ? "Soumettre" : "Submit"}</button>
            </form>
          </article>;
        })}
        {!kpis.length ? <p className="rounded-2xl bg-slate-50 p-6 text-center text-slate-500">{fr ? "Aucun KPI défini." : "No KPIs defined."}</p> : null}
      </div>

      <form action={createContractKpiAction} className="mt-6 rounded-2xl bg-emerald-50 p-5">
        <input type="hidden" name="contractId" value={contract.id}/>
        <h3 className="font-black">{fr ? "Ajouter un KPI" : "Add KPI"}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-bold">{fr ? "Nom du KPI *" : "KPI name *"}<input name="name" required className={fieldClass()}/></label>
          <label className="text-sm font-bold">{fr ? "Unité" : "Unit"}<input name="unit" defaultValue="%" className={fieldClass()}/></label>
          <label className="text-sm font-bold">{fr ? "Cible" : "Target"}<input name="targetValue" type="number" step="0.0001" defaultValue="100" className={fieldClass()}/></label>
          <label className="text-sm font-bold">{fr ? "Poids (%)" : "Weight (%)"}<input name="weight" type="number" min="0" max="100" step="0.1" defaultValue="0" className={fieldClass()}/></label>
          <label className="text-sm font-bold">{fr ? "Mode de calcul" : "Scoring mode"}<select name="direction" defaultValue="higher" className={fieldClass()}><option value="higher">{fr ? "Plus haut = meilleur" : "Higher is better"}</option><option value="lower">{fr ? "Plus bas = meilleur" : "Lower is better"}</option><option value="manual">{fr ? "Score manuel 0-100" : "Manual score 0-100"}</option></select></label>
          <label className="text-sm font-bold lg:col-span-3">Description<textarea name="description" rows={2} className={fieldClass()}/></label>
        </div>
        <button className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">{fr ? "Ajouter le KPI" : "Add KPI"}</button>
      </form>
    </section>
    </> : null}

    {activeTab === "risks" ? <>
    <section className="mt-7 rounded-3xl border border-cyan-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">{fr ? "REVUE & RENOUVELLEMENT" : "REVIEW & RENEWAL"}</p>
          <h2 className="mt-2 text-2xl font-black">{fr ? "Cycle de renouvellement" : "Renewal workflow"}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">{fr ? "Les orientations prises pendant le contrat restent provisoires. Super Leader impose ensuite des revues J-90, J-60 et J-30 avant la décision finale." : "Orientations recorded during the contract remain provisional. Super Leader then requires D-90, D-60 and D-30 reviews before the final decision."}</p>
        </div>
        <span className={`rounded-full px-4 py-2 text-sm font-black ${recommendation.tone}`}>{renewalDecisionLabel(recommendedAction, fr)}</span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Score contrat" : "Contract score"}</p><p className="mt-1 text-xl font-black">{pct(contractScore)}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">KPI</p><p className="mt-1 text-xl font-black">{pct(kpiScore)}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Livrables" : "Deliverables"}</p><p className="mt-1 text-xl font-black">{pct(deliverableScore)}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Incidents" : "Incidents"}</p><p className="mt-1 text-xl font-black">{openIncidents.length}</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Jours restants" : "Days left"}</p><p className="mt-1 text-xl font-black">{Math.max(0, days)}</p></div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{fr ? "CALENDRIER DE REVUE" : "REVIEW CALENDAR"}</p><h3 className="mt-1 text-lg font-black">J-90 → J-60 → J-30 → {fr ? "Décision finale" : "Final decision"}</h3></div>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${hasFinalDecision ? "bg-emerald-100 text-emerald-800" : days <= 30 ? "bg-red-100 text-red-800" : days <= 90 ? "bg-amber-100 text-amber-900" : "bg-indigo-100 text-indigo-800"}`}>{hasFinalDecision ? (fr ? "Cycle finalisé" : "Cycle completed") : days <= 30 ? (fr ? "Décision finale disponible" : "Final decision available") : currentCheckpointStage === "orientation" ? (fr ? "Orientation provisoire" : "Provisional orientation") : reviewStageLabel(currentCheckpointStage, fr)}</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {reviewTimeline.map((item) => {
            const completed = item.stage === "final" ? hasFinalDecision : completedReviewStages.has(item.stage);
            const due = item.stage === "j90" ? days <= 90 : item.stage === "j60" ? days <= 60 : item.stage === "j30" ? days <= 30 : days <= 30;
            return <article key={item.stage} className={`rounded-xl border p-4 ${completed ? "border-emerald-200 bg-emerald-50" : due ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
              <div className="flex items-center justify-between gap-2"><p className="font-black">{reviewStageLabel(item.stage, fr)}</p><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${completed ? "bg-emerald-700 text-white" : due ? "bg-amber-400 text-amber-950" : "bg-slate-200 text-slate-600"}`}>{completed ? (fr ? "Fait" : "Done") : due ? (fr ? "À traiter" : "Due") : (fr ? "À venir" : "Upcoming")}</span></div>
              <p className="mt-2 text-xs text-slate-500">{new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium"}).format(new Date(`${item.date}T12:00:00Z`))}</p>
            </article>;
          })}
        </div>
      </div>

      {canManage ? <form action={recordContractRenewalDecisionAction} className="mt-6 rounded-2xl bg-cyan-50 p-5">
        <input type="hidden" name="contractId" value={contract.id}/>
        <input type="hidden" name="reviewKind" value={currentReviewKind}/>
        <h3 className="font-black">{currentCheckpointStage === "orientation" ? (fr ? "Enregistrer une orientation provisoire" : "Record a provisional orientation") : (fr ? `Enregistrer la ${reviewStageLabel(currentCheckpointStage, true)}` : `Record the ${reviewStageLabel(currentCheckpointStage, false)}`)}</h3>
        <p className="mt-1 text-xs text-cyan-800">{currentCheckpointStage === "orientation" ? (fr ? "Cette orientation n’est pas une décision finale. Elle sera réévaluée automatiquement à J-90." : "This orientation is not a final decision. It will be reassessed at D-90.") : (fr ? "Cette revue capture la situation actuelle du contrat et la recommandation de Super Leader." : "This review captures the current contract position and Super Leader recommendation.")}</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-[260px_1fr_auto]">
          <select name="finalDecision" defaultValue={recommendedAction === "renew" ? "renew" : recommendedAction === "renew_with_conditions" ? "renew_with_conditions" : recommendedAction === "suspend_review" ? "suspend" : recommendedAction === "insufficient_data" ? "extend" : "do_not_renew"} className="rounded-xl border border-cyan-300 bg-white px-3 py-3 font-bold"><option value="renew">{fr ? "Orientation : renouveler" : "Orientation: renew"}</option><option value="renew_with_conditions">{fr ? "Renouveler sous conditions" : "Renew with conditions"}</option><option value="extend">{fr ? "Prolonger temporairement" : "Extend temporarily"}</option><option value="suspend">{fr ? "Suspendre" : "Suspend"}</option><option value="do_not_renew">{fr ? "Ne pas renouveler" : "Do not renew"}</option><option value="terminate">{fr ? "Résilier" : "Terminate"}</option></select>
          <input name="decisionNote" placeholder={fr ? "Motif, conditions ou plan d’action" : "Reason, conditions, or action plan"} className="rounded-xl border border-cyan-300 bg-white px-3 py-3"/>
          <button className="rounded-xl bg-cyan-700 px-5 py-3 font-black text-white">{fr ? "Enregistrer la revue" : "Record review"}</button>
        </div>
      </form> : null}

      {canManage && (days <= 30 || recommendedAction === "suspend_review") ? <form action={recordContractRenewalDecisionAction} className="mt-4 rounded-2xl border-2 border-slate-950 bg-slate-950 p-5 text-white">
        <input type="hidden" name="contractId" value={contract.id}/>
        <input type="hidden" name="reviewKind" value="final"/>
        <h3 className="font-black">{days <= 30 ? (fr ? "Décision finale de fin de contrat" : "Final end-of-contract decision") : (fr ? "Décision urgente de gouvernance" : "Urgent governance decision")}</h3>
        <p className="mt-1 text-xs text-slate-300">{days <= 30 ? (fr ? "La fenêtre finale est ouverte. La décision sera enregistrée séparément des orientations précédentes." : "The final window is open. This decision is recorded separately from previous orientations.") : (fr ? "Une situation critique autorise une décision urgente avant J-30." : "A critical situation allows an urgent decision before D-30.")}</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-[260px_1fr_auto]">
          <select name="finalDecision" defaultValue={recommendedAction === "renew" ? "renew" : recommendedAction === "renew_with_conditions" ? "renew_with_conditions" : recommendedAction === "suspend_review" ? "suspend" : "do_not_renew"} className="rounded-xl border border-slate-600 bg-white px-3 py-3 font-bold text-slate-950"><option value="renew">{fr ? "Renouveler" : "Renew"}</option><option value="renew_with_conditions">{fr ? "Renouveler sous conditions" : "Renew with conditions"}</option><option value="extend">{fr ? "Prolonger temporairement" : "Extend temporarily"}</option><option value="suspend">{fr ? "Suspendre" : "Suspend"}</option><option value="do_not_renew">{fr ? "Ne pas renouveler" : "Do not renew"}</option><option value="terminate">{fr ? "Résilier" : "Terminate"}</option></select>
          <input name="decisionNote" placeholder={fr ? "Motif final, conditions ou plan de transition" : "Final reason, conditions, or transition plan"} className="rounded-xl border border-slate-600 bg-white px-3 py-3 text-slate-950"/>
          <button className="rounded-xl bg-amber-400 px-5 py-3 font-black text-slate-950">{fr ? "Enregistrer la décision finale" : "Record final decision"}</button>
        </div>
      </form> : null}

      <div className="mt-5 space-y-3">
        {renewalReviews.map((review) => {const decider = actorById.get(review.decided_by); return <article key={review.id} className={`rounded-2xl border p-4 ${review.is_final ? "border-slate-950 bg-slate-50" : "border-slate-200"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-black">{renewalDecisionLabel(review.final_decision, fr)}</p><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${review.is_final ? "bg-slate-950 text-white" : "bg-cyan-100 text-cyan-800"}`}>{reviewStageLabel(review.review_stage || "orientation", fr)}</span></div><p className="mt-1 text-sm text-slate-600">{fr ? "Recommandation système" : "System recommendation"}: {renewalDecisionLabel(review.recommended_action, fr)} · {fr ? "Score" : "Score"}: {review.performance_score === null ? "—" : `${Number(review.performance_score).toFixed(1)}%`}{review.days_remaining === null ? "" : ` · ${review.days_remaining} ${fr ? "jour(s) restant(s)" : "day(s) left"}`}</p>{review.decision_note ? <p className="mt-2 text-sm">{review.decision_note}</p> : null}</div><p className="text-xs text-slate-500">{decider?.full_name || decider?.email || "—"}<br/>{dateTime(review.decided_at, dateLocale)}</p></div></article>;})}
        {!renewalReviews.length ? <p className="text-sm text-slate-500">{fr ? "Aucune orientation ou revue de renouvellement enregistrée." : "No renewal orientation or review recorded yet."}</p> : null}
      </div>
    </section>
    </> : null}

    {activeTab === "risks" ? <>
    {canManage ? <section className="mt-7 rounded-3xl border border-amber-200 bg-amber-50 p-6"><h2 className="text-2xl font-black">{fr ? "Gouvernance du contrat" : "Contract governance"}</h2><p className="mt-2 text-sm text-amber-900">{fr ? "Les décisions de statut sont réservées à la gouvernance. Chaque changement est audité." : "Status decisions are reserved for governance. Every change is audited."}</p><form action={updateServiceContractStatusAction} className="mt-5 grid gap-3 md:grid-cols-[220px_1fr_auto]"><input type="hidden" name="contractId" value={contract.id}/><select name="status" defaultValue={contract.status} className="rounded-xl border border-amber-300 bg-white px-3 py-3 font-bold"><option value="draft">Draft</option><option value="active">Active</option><option value="under_review">Under review</option><option value="renewed">Renewed</option><option value="suspended">Suspended</option><option value="completed">Completed</option><option value="terminated">Terminated</option></select><input name="reason" placeholder={fr ? "Motif / note de décision (obligatoire pour suspension ou résiliation)" : "Decision reason / note (required for suspension or termination)"} className="rounded-xl border border-amber-300 bg-white px-3 py-3"/><button className="rounded-xl bg-amber-500 px-5 py-3 font-black text-amber-950">{fr ? "Enregistrer" : "Save"}</button></form></section> : null}
    </> : null}

    {activeTab === "history" ? <>
    <section className="mt-7 rounded-3xl border bg-white p-6 shadow-sm">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{fr ? "TRAÇABILITÉ" : "TRACEABILITY"}</p>
        <h2 className="mt-2 text-2xl font-black">{fr ? "Historique & audit" : "History & audit"}</h2>
        <p className="mt-2 text-sm text-slate-600">{fr ? "Le journal présente les événements en langage métier. Les données techniques complètes restent accessibles pour contrôle." : "The journal presents events in business language. Full technical details remain available for audit purposes."}</p>
      </div>
      <div className="mt-5 space-y-3">
        {audits.map((row) => {
          const actor = row.actor_id ? actorById.get(row.actor_id) : null;
          const presentation = auditPresentation(row, fr);
          return <article key={row.id} className={`rounded-2xl border p-4 ${presentation.tone}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-black">{fr ? presentation.titleFr : presentation.titleEn}</p>
                {presentation.summary ? <p className="mt-1 text-sm text-slate-700">{presentation.summary}</p> : null}
                <p className="mt-2 text-xs text-slate-500">{actor?.full_name || actor?.email || (fr ? "Système" : "System")}</p>
              </div>
              <p className="text-xs font-bold text-slate-500">{dateTime(row.created_at, dateLocale)}</p>
            </div>
            {Object.keys(row.details || {}).length ? <details className="mt-3">
              <summary className="cursor-pointer text-xs font-black text-indigo-700">{fr ? "Voir les détails techniques" : "View technical details"}</summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(row.details, null, 2)}</pre>
            </details> : null}
          </article>;
        })}
        {!audits.length ? <p className="text-slate-500">{fr ? "Aucun événement d’audit pour le moment." : "No audit events yet."}</p> : null}
      </div>
    </section>
    </> : null}
  </div></main>;
}
