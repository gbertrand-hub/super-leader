"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requireAccessContext} from "@/lib/auth/access-control";

const VIEW_ROLES = new Set(["owner", "admin", "executive", "hr", "manager"]);
const EDIT_ROLES = new Set(["owner", "admin"]);
const USE_TEMPLATE_ROLES = new Set(["owner", "admin", "executive", "hr", "manager"]);
const OBLIGATION_TYPES = new Set(["activity","deliverable","reporting","compliance","payment","benefit","support","other"]);
const OBLIGATION_PARTIES = new Set(["provider","organization","both"]);
const OBLIGATION_RECURRENCES = new Set(["once","weekly","monthly","quarterly","annual","continuous"]);
const KPI_DIRECTIONS = new Set(["higher","lower","manual"]);
const COMP_RULE_TYPES = new Set(["fixed_periodic","fixed_event","percentage","threshold","benefit","other"]);
const COMP_CADENCES = new Set(["one_time","weekly","monthly","quarterly","annual","per_event","per_sale","other"]);

function text(formData: FormData, name: string, max = 5000) {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

function num(formData: FormData, name: string, fallback = 0) {
  const value = Number(text(formData, name, 80));
  return Number.isFinite(value) ? value : fallback;
}

function bool(formData: FormData, name: string) {
  return text(formData, name, 20) === "on";
}

function go(message: string, kind: "success" | "error", anchor = ""): never {
  redirect(`/dashboard/contracts/settings?${kind}=${encodeURIComponent(message)}${anchor ? `#${anchor}` : ""}`);
}

async function audit(context: Awaited<ReturnType<typeof requireAccessContext>>, action: string, details: Record<string, unknown> = {}) {
  const {error} = await context.admin.from("service_contract_audit_log").insert({
    organization_id: context.organizationId,
    actor_id: context.user.id,
    action,
    details,
  });
  if (error) console.error("Contract settings audit failed", error);
}

function requireView(role: string) {
  if (!VIEW_ROLES.has(role)) go("Accès refusé.", "error");
}

function requireEdit(role: string) {
  if (!EDIT_ROLES.has(role)) go("Seuls le Propriétaire et l’Administrateur peuvent modifier ces paramètres.", "error");
}

function slugCode(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
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

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function parseLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseObligations(value: string) {
  return parseLines(value).map((line) => {
    const [title = "", type = "activity", party = "provider", recurrence = "once", offset = "0"] = line.split("|").map((x) => x.trim());
    return {
      title: title.slice(0, 220),
      obligation_type: OBLIGATION_TYPES.has(type) ? type : "activity",
      responsible_party: OBLIGATION_PARTIES.has(party) ? party : "provider",
      recurrence: OBLIGATION_RECURRENCES.has(recurrence) ? recurrence : "once",
      due_offset_days: Math.max(0, Math.min(3650, Number(offset) || 0)),
    };
  }).filter((row) => row.title.length >= 2);
}

function parseDeliverables(value: string) {
  return parseLines(value).map((line) => {
    const [title = "", offset = "30", weight = "0"] = line.split("|").map((x) => x.trim());
    return {title: title.slice(0, 220), due_offset_days: Math.max(0, Math.min(3650, Number(offset) || 0)), weight: Math.max(0, Math.min(100, Number(weight) || 0))};
  }).filter((row) => row.title.length >= 2);
}

function parseKpis(value: string) {
  return parseLines(value).map((line) => {
    const [name = "", unit = "%", target = "100", weight = "0", direction = "higher"] = line.split("|").map((x) => x.trim());
    return {name: name.slice(0, 180), unit: unit.slice(0, 40) || "%", target_value: Number(target) || 0, weight: Math.max(0, Math.min(100, Number(weight) || 0)), direction: KPI_DIRECTIONS.has(direction) ? direction : "higher"};
  }).filter((row) => row.name.length >= 2);
}

function parseCompensation(value: string, currency: string) {
  return parseLines(value).map((line) => {
    const [label = "", ruleType = "other", cadence = "one_time", amount = "", percentage = ""] = line.split("|").map((x) => x.trim());
    return {
      label: label.slice(0, 220),
      rule_type: COMP_RULE_TYPES.has(ruleType) ? ruleType : "other",
      cadence: COMP_CADENCES.has(cadence) ? cadence : "one_time",
      amount: amount === "" ? null : Math.max(0, Number(amount) || 0),
      percentage: percentage === "" ? null : Math.max(0, Math.min(100, Number(percentage) || 0)),
      currency,
    };
  }).filter((row) => row.label.length >= 2);
}

function snapshotFromForm(formData: FormData) {
  const currency = (text(formData, "defaultCurrency", 8) || "USD").toUpperCase();
  return {
    contract: {
      service_scope: text(formData, "serviceScope", 8000),
      payment_terms: text(formData, "paymentTerms", 3000),
      notes: text(formData, "notes", 4000),
      default_duration_months: Math.max(1, Math.min(120, Math.round(num(formData, "defaultDurationMonths", 12)))),
      currency,
      value_amount: Math.max(0, num(formData, "defaultValueAmount", 0)),
      renewal_notice_days: Math.max(0, Math.min(730, Math.round(num(formData, "renewalNoticeDays", 90)))),
      non_renewal_notice_days: Math.max(0, Math.min(730, Math.round(num(formData, "nonRenewalNoticeDays", 30)))),
      termination_notice_days: Math.max(0, Math.min(730, Math.round(num(formData, "terminationNoticeDays", 30)))),
      performance_target: Math.max(0, Math.min(100, num(formData, "performanceTarget", 80))),
      clauses: parseLines(text(formData, "clauses", 12000)),
      required_documents: parseLines(text(formData, "requiredDocuments", 5000)),
    },
    obligations: parseObligations(text(formData, "obligations", 12000)),
    deliverables: parseDeliverables(text(formData, "deliverables", 12000)),
    kpis: parseKpis(text(formData, "kpis", 12000)),
    compensation_rules: parseCompensation(text(formData, "compensationRules", 12000), currency),
  };
}

export async function saveContractSettingsAction(formData: FormData) {
  const context = await requireAccessContext();
  requireEdit(context.role);

  const j90 = Math.round(num(formData, "renewalStageJ90Days", 90));
  const j60 = Math.round(num(formData, "renewalStageJ60Days", 60));
  const j30 = Math.round(num(formData, "renewalStageJ30Days", 30));
  if (!(j90 > j60 && j60 > j30 && j30 > 0)) go("Les jalons doivent respecter J-90 > J-60 > J-30.", "error", "general-settings");

  const patch = {
    organization_id: context.organizationId,
    default_currency: (text(formData, "defaultCurrency", 8) || "USD").toUpperCase(),
    default_performance_target: Math.max(0, Math.min(100, num(formData, "defaultPerformanceTarget", 80))),
    default_renewal_notice_days: Math.max(0, Math.min(730, Math.round(num(formData, "defaultRenewalNoticeDays", 90)))),
    renewal_stage_j90_days: j90,
    renewal_stage_j60_days: j60,
    renewal_stage_j30_days: j30,
    default_non_renewal_notice_days: Math.max(0, Math.min(730, Math.round(num(formData, "defaultNonRenewalNoticeDays", 30)))),
    default_termination_notice_days: Math.max(0, Math.min(730, Math.round(num(formData, "defaultTerminationNoticeDays", 30)))),
    require_source_document_before_activation: bool(formData, "requireSourceDocumentBeforeActivation"),
    require_internal_owner_before_activation: bool(formData, "requireInternalOwnerBeforeActivation"),
    require_performance_target_before_activation: bool(formData, "requirePerformanceTargetBeforeActivation"),
    updated_by: context.user.id,
    updated_at: new Date().toISOString(),
  };

  const {error} = await context.admin.from("service_contract_settings").upsert(patch, {onConflict: "organization_id"});
  if (error) go(`Enregistrement impossible : ${error.message}`, "error", "general-settings");
  await audit(context, "contract_settings_updated", patch);
  revalidatePath("/dashboard/contracts/settings");
  go("Paramètres contractuels enregistrés.", "success", "general-settings");
}

export async function createContractTypeAction(formData: FormData) {
  const context = await requireAccessContext();
  requireEdit(context.role);
  const name = text(formData, "name", 140);
  const code = slugCode(text(formData, "code", 60) || name);
  const description = text(formData, "description", 3000);
  if (name.length < 2 || code.length < 2) go("Nom ou code du type de contrat invalide.", "error", "contract-types");
  const now = new Date().toISOString();
  const {error} = await context.admin.from("service_contract_types").insert({organization_id: context.organizationId, code, name, description, is_active: true, created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now});
  if (error) go(`Création impossible : ${error.message}`, "error", "contract-types");
  await audit(context, "contract_type_created", {code, name});
  revalidatePath("/dashboard/contracts/settings");
  go("Type de contrat ajouté.", "success", "contract-types");
}

export async function setContractTypeStatusAction(formData: FormData) {
  const context = await requireAccessContext();
  requireEdit(context.role);
  const id = text(formData, "typeId", 80);
  const active = text(formData, "active", 10) === "true";
  const {error} = await context.admin.from("service_contract_types").update({is_active: active, updated_by: context.user.id, updated_at: new Date().toISOString()}).eq("id", id).eq("organization_id", context.organizationId);
  if (error) go(`Mise à jour impossible : ${error.message}`, "error", "contract-types");
  await audit(context, "contract_type_status_changed", {typeId: id, active});
  revalidatePath("/dashboard/contracts/settings");
  go(active ? "Type réactivé." : "Type désactivé.", "success", "contract-types");
}

export async function createContractTemplateAction(formData: FormData) {
  const context = await requireAccessContext();
  requireEdit(context.role);
  const name = text(formData, "name", 180);
  const description = text(formData, "description", 4000);
  const contractTypeId = text(formData, "contractTypeId", 80) || null;
  if (name.length < 2) go("Le nom du modèle est obligatoire.", "error", "templates");
  const snapshot = snapshotFromForm(formData);
  const now = new Date().toISOString();
  const {data: template, error} = await context.admin.from("service_contract_templates").insert({organization_id: context.organizationId, contract_type_id: contractTypeId, name, description, status: "active", current_version: 1, created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now}).select("id").single<{id: string}>();
  if (error || !template) go(`Création du modèle impossible : ${error?.message ?? "erreur inconnue"}`, "error", "templates");
  const {error: versionError} = await context.admin.from("service_contract_template_versions").insert({organization_id: context.organizationId, template_id: template.id, version_number: 1, snapshot, change_reason: "Version initiale", created_by: context.user.id, created_at: now});
  if (versionError) {
    await context.admin.from("service_contract_templates").delete().eq("id", template.id).eq("organization_id", context.organizationId);
    go(`Version initiale impossible : ${versionError.message}`, "error", "templates");
  }
  await audit(context, "contract_template_created", {templateId: template.id, name, version: 1});
  revalidatePath("/dashboard/contracts/settings");
  go("Modèle contractuel créé en V1.", "success", "templates");
}

export async function createContractTemplateVersionAction(formData: FormData) {
  const context = await requireAccessContext();
  requireEdit(context.role);
  const templateId = text(formData, "templateId", 80);
  const changeReason = text(formData, "changeReason", 2000);
  if (changeReason.length < 3) go("Indique un motif de changement d’au moins 3 caractères.", "error", "templates");
  const {data: template, error: readError} = await context.admin.from("service_contract_templates").select("id,current_version").eq("id", templateId).eq("organization_id", context.organizationId).maybeSingle<{id: string; current_version: number}>();
  if (readError || !template) go("Modèle introuvable.", "error", "templates");
  const version = Number(template.current_version || 1) + 1;
  const snapshot = snapshotFromForm(formData);
  const now = new Date().toISOString();
  const {error} = await context.admin.from("service_contract_template_versions").insert({organization_id: context.organizationId, template_id: templateId, version_number: version, snapshot, change_reason: changeReason, created_by: context.user.id, created_at: now});
  if (error) go(`Nouvelle version impossible : ${error.message}`, "error", "templates");
  const {error: updateError} = await context.admin.from("service_contract_templates").update({current_version: version, updated_by: context.user.id, updated_at: now}).eq("id", templateId).eq("organization_id", context.organizationId);
  if (updateError) go(`Version créée mais index du modèle non mis à jour : ${updateError.message}`, "error", "templates");
  await audit(context, "contract_template_version_created", {templateId, version, changeReason});
  revalidatePath("/dashboard/contracts/settings");
  go(`Version V${version} créée. Les contrats existants restent inchangés.`, "success", "templates");
}

export async function setContractTemplateStatusAction(formData: FormData) {
  const context = await requireAccessContext();
  requireEdit(context.role);
  const templateId = text(formData, "templateId", 80);
  const status = text(formData, "status", 20);
  if (!new Set(["active","archived"]).has(status)) go("Statut du modèle invalide.", "error", "templates");
  const {error} = await context.admin.from("service_contract_templates").update({status, updated_by: context.user.id, updated_at: new Date().toISOString()}).eq("id", templateId).eq("organization_id", context.organizationId);
  if (error) go(`Mise à jour impossible : ${error.message}`, "error", "templates");
  await audit(context, "contract_template_status_changed", {templateId, status});
  revalidatePath("/dashboard/contracts/settings");
  go(status === "active" ? "Modèle réactivé." : "Modèle archivé.", "success", "templates");
}

export async function duplicateContractTemplateAction(formData: FormData) {
  const context = await requireAccessContext();
  requireEdit(context.role);
  const templateId = text(formData, "templateId", 80);
  const newName = text(formData, "newName", 180);
  if (newName.length < 2) go("Indique le nom du nouveau modèle.", "error", "templates");
  const {data: template} = await context.admin.from("service_contract_templates").select("id,contract_type_id,description,current_version").eq("id", templateId).eq("organization_id", context.organizationId).maybeSingle<{id:string; contract_type_id:string|null; description:string; current_version:number}>();
  if (!template) go("Modèle introuvable.", "error", "templates");
  const {data: version} = await context.admin.from("service_contract_template_versions").select("snapshot").eq("template_id", templateId).eq("organization_id", context.organizationId).eq("version_number", template.current_version).maybeSingle<{snapshot: Record<string, unknown>}>();
  if (!version) go("Version courante du modèle introuvable.", "error", "templates");
  const now = new Date().toISOString();
  const {data: copy, error} = await context.admin.from("service_contract_templates").insert({organization_id: context.organizationId, contract_type_id: template.contract_type_id, name: newName, description: template.description, status: "active", current_version: 1, created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now}).select("id").single<{id:string}>();
  if (error || !copy) go(`Duplication impossible : ${error?.message ?? "erreur inconnue"}`, "error", "templates");
  const {error: vError} = await context.admin.from("service_contract_template_versions").insert({organization_id: context.organizationId, template_id: copy.id, version_number: 1, snapshot: version.snapshot, change_reason: `Copie du modèle ${templateId}`, created_by: context.user.id, created_at: now});
  if (vError) go(`Copie créée mais version impossible : ${vError.message}`, "error", "templates");
  await audit(context, "contract_template_duplicated", {sourceTemplateId: templateId, newTemplateId: copy.id, newName});
  revalidatePath("/dashboard/contracts/settings");
  go("Modèle dupliqué en V1.", "success", "templates");
}

export async function createClauseLibraryItemAction(formData: FormData) {
  const context = await requireAccessContext();
  requireEdit(context.role);
  const title = text(formData, "title", 180);
  const category = text(formData, "category", 80) || "general";
  const clauseText = text(formData, "clauseText", 12000);
  if (title.length < 2 || clauseText.length < 10) go("Titre ou texte de clause trop court.", "error", "clauses");
  const now = new Date().toISOString();
  const {error} = await context.admin.from("service_contract_clause_library").insert({organization_id: context.organizationId, title, category, clause_text: clauseText, status: "active", version_number: 1, created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now});
  if (error) go(`Ajout de clause impossible : ${error.message}`, "error", "clauses");
  await audit(context, "contract_clause_created", {title, category});
  revalidatePath("/dashboard/contracts/settings");
  go("Clause ajoutée à la bibliothèque.", "success", "clauses");
}

export async function createContractFromTemplateAction(formData: FormData) {
  const context = await requireAccessContext();
  requireView(context.role);
  if (!USE_TEMPLATE_ROLES.has(context.role)) go("Accès refusé.", "error", "use-template");

  const templateId = text(formData, "templateId", 80);
  const providerId = text(formData, "providerId", 80);
  const contractNumber = text(formData, "contractNumber", 80);
  const title = text(formData, "title", 220);
  const startDate = text(formData, "startDate", 20);
  const internalOwnerUserId = text(formData, "internalOwnerUserId", 80);
  if (!templateId || !providerId || contractNumber.length < 2 || title.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !internalOwnerUserId) go("Complète le modèle, prestataire, référence, titre, date et responsable.", "error", "use-template");
  if (context.role === "manager" && internalOwnerUserId !== context.user.id) go("Un manager peut utiliser un modèle uniquement pour un contrat dont il est responsable.", "error", "use-template");

  const {data: existingContract} = await context.admin.from("service_contracts")
    .select("id,title,status")
    .eq("organization_id", context.organizationId)
    .eq("contract_number", contractNumber)
    .maybeSingle<{id:string; title:string; status:string}>();
  if (existingContract) go(`La référence ${contractNumber} existe déjà (${existingContract.title}). Choisis une nouvelle référence avant de créer le brouillon.`, "error", "use-template");

  const [{data: template}, {data: provider}, {data: owner}] = await Promise.all([
    context.admin.from("service_contract_templates").select("id,current_version,status,name").eq("id", templateId).eq("organization_id", context.organizationId).eq("status", "active").maybeSingle<{id:string; current_version:number; status:string; name:string}>(),
    context.admin.from("service_providers").select("id").eq("id", providerId).eq("organization_id", context.organizationId).maybeSingle<{id:string}>(),
    context.admin.from("organization_members").select("user_id,role").eq("organization_id", context.organizationId).eq("user_id", internalOwnerUserId).eq("is_active", true).in("role", ["owner","admin","executive","hr","manager"]).maybeSingle<{user_id:string;role:string}>(),
  ]);
  if (!template) go("Modèle actif introuvable.", "error", "use-template");
  if (!provider) go("Prestataire introuvable.", "error", "use-template");
  if (!owner) go("Responsable interne invalide.", "error", "use-template");

  const {data: version} = await context.admin.from("service_contract_template_versions").select("snapshot").eq("template_id", template.id).eq("organization_id", context.organizationId).eq("version_number", template.current_version).maybeSingle<{snapshot:any}>();
  if (!version?.snapshot) go("Version courante du modèle introuvable.", "error", "use-template");
  const s = version.snapshot;
  const c = s.contract ?? {};
  const duration = Math.max(1, Math.min(120, Number(c.default_duration_months || 12)));
  const endDate = addMonths(startDate, duration);
  const now = new Date().toISOString();

  const {data: contract, error} = await context.admin.from("service_contracts").insert({
    organization_id: context.organizationId,
    provider_id: providerId,
    contract_number: contractNumber,
    title,
    service_scope: String(c.service_scope ?? ""),
    internal_owner_user_id: internalOwnerUserId,
    start_date: startDate,
    end_date: endDate,
    value_amount: Number(c.value_amount || 0),
    currency: String(c.currency || "USD").toUpperCase(),
    payment_terms: String(c.payment_terms ?? ""),
    status: "draft",
    renewal_notice_days: Number(c.renewal_notice_days || 90),
    performance_target: Number(c.performance_target || 80),
    notes: [String(c.notes ?? ""), `Créé depuis le modèle ${template.name} V${template.current_version}`].filter(Boolean).join("\n\n"),
    source_mode: "native",
    renewal_type: "manual",
    non_renewal_notice_days: Number(c.non_renewal_notice_days || 30),
    termination_notice_days: Number(c.termination_notice_days || 30),
    contract_clarity_status: "unchecked",
    created_by: context.user.id,
    updated_by: context.user.id,
    created_at: now,
    updated_at: now,
  }).select("id,status").single<{id:string; status:string}>();
  if (error || !contract) go(`Création du brouillon impossible : ${error?.message ?? "erreur inconnue"}`, "error", "use-template");

  if (contract.status !== "draft") {
    const {error: draftStatusError} = await context.admin.from("service_contracts")
      .update({status: "draft", activated_at: null, activated_by: null, updated_by: context.user.id, updated_at: now})
      .eq("id", contract.id)
      .eq("organization_id", context.organizationId);
    if (draftStatusError) go(`Le contrat a été créé mais son statut BROUILLON n’a pas pu être garanti : ${draftStatusError.message}`, "error", "use-template");
  }

  const obligations = Array.isArray(s.obligations) ? s.obligations : [];
  if (obligations.length) {
    const {error: obligationError} = await context.admin.from("service_contract_obligations").insert(obligations.map((row:any) => ({organization_id: context.organizationId, contract_id: contract.id, title: String(row.title), description: "", obligation_type: row.obligation_type || "activity", responsible_party: row.responsible_party || "provider", recurrence: row.recurrence || "once", evidence_required: true, start_date: startDate, end_date: endDate, first_due_date: addDays(startDate, Number(row.due_offset_days || 0)), status: "active", created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now})));
    if (obligationError) console.error("Template obligations creation failed", obligationError);
  }

  const deliverables = Array.isArray(s.deliverables) ? s.deliverables : [];
  if (deliverables.length) {
    const {error: deliverableError} = await context.admin.from("service_contract_deliverables").insert(deliverables.map((row:any) => ({organization_id: context.organizationId, contract_id: contract.id, title: String(row.title), description: "", due_date: addDays(startDate, Number(row.due_offset_days || 0)), weight: Number(row.weight || 0), status: "planned", created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now})));
    if (deliverableError) console.error("Template deliverables creation failed", deliverableError);
  }

  const kpis = Array.isArray(s.kpis) ? s.kpis : [];
  if (kpis.length) {
    const {error: kpiError} = await context.admin.from("service_contract_kpis").insert(kpis.map((row:any) => ({organization_id: context.organizationId, contract_id: contract.id, name: String(row.name), description: "", unit: String(row.unit || "%"), target_value: Number(row.target_value || 0), weight: Number(row.weight || 0), direction: row.direction || "higher", is_active: true, created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now})));
    if (kpiError) console.error("Template KPI creation failed", kpiError);
  }

  const compensation = Array.isArray(s.compensation_rules) ? s.compensation_rules : [];
  if (compensation.length) {
    const {error: compensationError} = await context.admin.from("service_contract_compensation_rules").insert(compensation.map((row:any) => ({organization_id: context.organizationId, contract_id: contract.id, label: String(row.label), rule_type: row.rule_type || "other", cadence: row.cadence || "one_time", amount: row.amount ?? null, percentage: row.percentage ?? null, currency: String(row.currency || c.currency || "USD").toUpperCase(), condition_text: "", clause_reference: "", is_active: true, created_by: context.user.id, updated_by: context.user.id, created_at: now, updated_at: now})));
    if (compensationError) console.error("Template compensation creation failed", compensationError);
  }

  await audit(context, "contract_created_from_template", {contractId: contract.id, templateId: template.id, templateVersion: template.current_version, contractNumber, title});
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/contracts/settings");
  redirect(`/dashboard/contracts/${contract.id}?success=${encodeURIComponent(`Brouillon créé depuis ${template.name} V${template.current_version}. Vérifie puis active le contrat.`)}`);
}
