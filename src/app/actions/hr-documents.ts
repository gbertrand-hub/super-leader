"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {finalizeHrDocument, readPendingHrDocument, removeHrDocument} from "@/lib/hr/document-storage";
import {isPeopleAdministrator, requireAccessContext} from "@/lib/auth/access-control";

const CATEGORIES = new Set(["handbook","policy","contract","amendment","job_description","identity","diploma","certificate","evaluation","disciplinary","leave_support","other"]);
const STATUSES = new Set(["draft","to_review","to_acknowledge","active","expired","archived"]);
const REQUIREMENT_ROLES = new Set(["admin","executive","hr","manager","employee"]);

function clean(value: FormDataEntryValue | null, max = 500) { return String(value ?? "").trim().slice(0, max); }
function date(value: FormDataEntryValue | null) { const v = clean(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/hr/documents?${kind}=${encodeURIComponent(message)}`);
}

async function hrContext() {
  const context = await requireAccessContext();
  if (!isPeopleAdministrator(context.role)) go("Accès réservé aux Ressources humaines.", "error");
  return context;
}

async function audit(context: Awaited<ReturnType<typeof requireAccessContext>>, documentId: string, action: string, employeeUserId: string | null, details: Record<string, unknown> = {}) {
  const {error} = await context.admin.from("hr_document_audit_log").insert({organization_id: context.organizationId, document_id: documentId, employee_user_id: employeeUserId, actor_id: context.user.id, action, details});
  if (error) console.error("HR document audit failed", error);
}

async function activeMemberIds(context: Awaited<ReturnType<typeof requireAccessContext>>) {
  const {data, error} = await context.admin.from("organization_members").select("user_id").eq("organization_id", context.organizationId).eq("is_active", true).in("role", ["owner","admin","executive","hr","manager","employee"]);
  if (error) throw error;
  return (data ?? []).map(row => String(row.user_id));
}

async function assignRecipients(context: Awaited<ReturnType<typeof requireAccessContext>>, documentId: string, scope: string, employeeUserId: string | null, dueOn: string | null) {
  const ids = scope === "collective" ? await activeMemberIds(context) : employeeUserId ? [employeeUserId] : [];
  if (!ids.length) return;
  const rows = ids.map(id => ({organization_id: context.organizationId, document_id: documentId, employee_user_id: id, acknowledgement_due_on: dueOn}));
  const {error} = await context.admin.from("hr_document_recipients").upsert(rows, {onConflict: "document_id,employee_user_id", ignoreDuplicates: true});
  if (error) throw error;
}

export async function createHrDocumentAction(formData: FormData) {
  const context = await hrContext();
  const title = clean(formData.get("title"), 240);
  const description = clean(formData.get("description"), 3000) || null;
  const category = clean(formData.get("category"), 40);
  const scope = clean(formData.get("scope"), 20) === "individual" ? "individual" : "collective";
  const employeeUserId = scope === "individual" ? clean(formData.get("employeeUserId"), 80) || null : null;
  const versionLabel = clean(formData.get("versionLabel"), 80) || null;
  const issuedOn = date(formData.get("issuedOn"));
  const effectiveDate = date(formData.get("effectiveDate"));
  const expiresOn = date(formData.get("expiresOn"));
  const reviewDueOn = date(formData.get("reviewDueOn"));
  const acknowledgementDueOn = date(formData.get("acknowledgementDueOn"));
  const confidential = formData.get("confidential") === "on";
  const acknowledgementRequired = formData.get("acknowledgementRequired") === "on";
  const publishNow = formData.get("publishNow") === "on";
  const pending = readPendingHrDocument(formData);
  if (title.length < 2 || !CATEGORIES.has(category) || !pending || (scope === "individual" && !employeeUserId)) go("Complétez le titre, la catégorie, le destinataire et le fichier.", "error");
  if (effectiveDate && expiresOn && expiresOn < effectiveDate) go("La date d’expiration doit suivre la date d’entrée en vigueur.", "error");
  if (employeeUserId) {
    const {data: member} = await context.admin.from("organization_members").select("user_id").eq("organization_id", context.organizationId).eq("user_id", employeeUserId).eq("is_active", true).in("role", ["owner","admin","executive","hr","manager","employee"]).maybeSingle();
    if (!member) go("Employé introuvable dans cette organisation.", "error");
  }
  const status = publishNow ? (acknowledgementRequired ? "to_acknowledge" : "active") : "draft";
  const {data: created, error} = await context.admin.from("hr_documents").insert({
    organization_id: context.organizationId, title, description, category, document_scope: scope,
    employee_user_id: employeeUserId, confidential, acknowledgement_required: acknowledgementRequired,
    version_label: versionLabel, issued_on: issuedOn, effective_date: effectiveDate, expires_on: expiresOn, review_due_on: reviewDueOn,
    status, storage_path: pending.storagePath, file_name: pending.fileName, mime_type: pending.mimeType,
    size_bytes: pending.sizeBytes, created_by: context.user.id, published_at: publishNow ? new Date().toISOString() : null,
  }).select("id").single<{id: string}>();
  if (error || !created) go(error?.message ?? "Création impossible.", "error");
  try {
    const file = await finalizeHrDocument({admin: context.admin, organizationId: context.organizationId, userId: context.user.id, documentId: created.id, pending});
    const {error: updateError} = await context.admin.from("hr_documents").update(file).eq("id", created.id).eq("organization_id", context.organizationId);
    if (updateError) throw updateError;
    await assignRecipients(context, created.id, scope, employeeUserId, acknowledgementRequired ? acknowledgementDueOn : null);
  } catch (uploadError) {
    await context.admin.from("hr_documents").delete().eq("id", created.id).eq("organization_id", context.organizationId);
    await removeHrDocument(context.admin, pending.storagePath);
    go(uploadError instanceof Error ? uploadError.message : "Enregistrement du fichier impossible.", "error");
  }
  await audit(context, created.id, publishNow ? "created_and_published" : "created", employeeUserId, {title, category, scope, acknowledgementRequired});
  revalidatePath("/dashboard/hr/documents");
  go(publishNow ? "Document publié et attribué." : "Brouillon RH enregistré.");
}

export async function updateHrDocumentAction(formData: FormData) {
  const context = await hrContext();
  const documentId = clean(formData.get("documentId"), 80);
  const title = clean(formData.get("title"), 240);
  const description = clean(formData.get("description"), 3000) || null;
  const category = clean(formData.get("category"), 40);
  const versionLabel = clean(formData.get("versionLabel"), 80) || null;
  const issuedOn = date(formData.get("issuedOn"));
  const effectiveDate = date(formData.get("effectiveDate"));
  const expiresOn = date(formData.get("expiresOn"));
  const reviewDueOn = date(formData.get("reviewDueOn"));
  const acknowledgementDueOn = date(formData.get("acknowledgementDueOn"));
  const confidential = formData.get("confidential") === "on";
  const acknowledgementRequired = formData.get("acknowledgementRequired") === "on";
  if (!documentId || title.length < 2 || !CATEGORIES.has(category)) go("Modification invalide.", "error");
  if (effectiveDate && expiresOn && expiresOn < effectiveDate) go("La date d’expiration doit suivre la date d’entrée en vigueur.", "error");
  const {data: current} = await context.admin.from("hr_documents").select("id,employee_user_id").eq("id", documentId).eq("organization_id", context.organizationId).maybeSingle<{id: string; employee_user_id: string | null}>();
  if (!current) go("Document introuvable.", "error");
  const {error} = await context.admin.from("hr_documents").update({title, description, category, version_label: versionLabel, issued_on: issuedOn, effective_date: effectiveDate, expires_on: expiresOn, review_due_on: reviewDueOn, confidential, acknowledgement_required: acknowledgementRequired, updated_at: new Date().toISOString()}).eq("id", documentId).eq("organization_id", context.organizationId);
  if (error) go(error.message, "error");
  await context.admin.from("hr_document_recipients").update({acknowledgement_due_on: acknowledgementRequired ? acknowledgementDueOn : null, updated_at: new Date().toISOString()}).eq("document_id", documentId).eq("organization_id", context.organizationId);
  await audit(context, documentId, "metadata_updated", current.employee_user_id, {title, category, acknowledgementRequired});
  revalidatePath("/dashboard/hr/documents");
  go("Document RH mis à jour.");
}

export async function changeHrDocumentStatusAction(formData: FormData) {
  const context = await hrContext();
  const documentId = clean(formData.get("documentId"), 80);
  const status = clean(formData.get("status"), 20);
  if (!documentId || !STATUSES.has(status)) go("Statut invalide.", "error");
  const {data: document} = await context.admin.from("hr_documents").select("id,status,document_scope,employee_user_id,acknowledgement_required").eq("id", documentId).eq("organization_id", context.organizationId).maybeSingle<{id: string; status: string; document_scope: string; employee_user_id: string | null; acknowledgement_required: boolean}>();
  if (!document) go("Document introuvable.", "error");
  if (document.status === "archived" && status !== "archived") go("Un document archivé ne peut pas être republié. Créez une nouvelle version.", "error");
  const patch: Record<string, unknown> = {status, updated_at: new Date().toISOString()};
  if (["to_acknowledge","active"].includes(status)) patch.published_at = new Date().toISOString();
  if (status === "archived") patch.archived_at = new Date().toISOString();
  const {error} = await context.admin.from("hr_documents").update(patch).eq("id", documentId).eq("organization_id", context.organizationId);
  if (error) go(error.message, "error");
  if (["to_acknowledge","active"].includes(status)) await assignRecipients(context, documentId, document.document_scope, document.employee_user_id, null);
  await audit(context, documentId, "status_changed", document.employee_user_id, {from: document.status, to: status});
  revalidatePath("/dashboard/hr/documents");
  go("Statut du document mis à jour.");
}

export async function acknowledgeHrDocumentAction(formData: FormData) {
  const context = await requireAccessContext();
  const documentId = clean(formData.get("documentId"), 80);
  if (!documentId) go("Document invalide.", "error");
  const {data: document} = await context.admin.from("hr_documents").select("id,title,status,acknowledgement_required").eq("id", documentId).eq("organization_id", context.organizationId).maybeSingle<{id: string; title: string; status: string; acknowledgement_required: boolean}>();
  if (!document || document.status !== "published" || !document.acknowledgement_required) go("Ce document ne peut pas être confirmé.", "error");
  const now = new Date().toISOString();
  const acknowledgementText = "Je confirme avoir lu et compris ce document.";
  const {data: recipient, error} = await context.admin.from("hr_document_recipients").update({acknowledged_at: now, acknowledgement_text: acknowledgementText, updated_at: now}).eq("document_id", documentId).eq("organization_id", context.organizationId).eq("employee_user_id", context.user.id).is("acknowledged_at", null).select("id").maybeSingle();
  if (error) go(error.message, "error");
  if (!recipient) go("Confirmation déjà enregistrée ou document non attribué.", "error");
  const {count: pendingCount} = await context.admin.from("hr_document_recipients").select("id", {count: "exact", head: true}).eq("document_id", documentId).eq("organization_id", context.organizationId).is("acknowledged_at", null);
  if ((pendingCount ?? 0) === 0) {
    await context.admin.from("hr_documents").update({status: "active", updated_at: now}).eq("id", documentId).eq("organization_id", context.organizationId).eq("status", "to_acknowledge");
  }
  await audit(context, documentId, "acknowledged", context.user.id, {text: acknowledgementText});
  revalidatePath("/dashboard/hr/documents");
  go("Votre confirmation de lecture a été enregistrée.");
}

export async function createHrDocumentRequirementAction(formData: FormData) {
  const context = await hrContext();
  const title = clean(formData.get("title"), 160);
  const category = clean(formData.get("category"), 40);
  const applicableRoles = formData.getAll("applicableRoles").map(value => clean(value, 30)).filter(role => REQUIREMENT_ROLES.has(role));
  const expiryRequired = formData.get("expiryRequired") === "on";
  if (title.length < 2 || !CATEGORIES.has(category) || !applicableRoles.length) go("Définissez le document obligatoire et au moins un rôle concerné.", "error");
  const {error} = await context.admin.from("hr_document_requirements").insert({organization_id: context.organizationId, title, category, applicable_roles: applicableRoles, expiry_required: expiryRequired, created_by: context.user.id});
  if (error) go(error.message, "error");
  revalidatePath("/dashboard/hr/documents");
  go("Exigence documentaire ajoutée.");
}

export async function toggleHrDocumentRequirementAction(formData: FormData) {
  const context = await hrContext();
  const requirementId = clean(formData.get("requirementId"), 80);
  const active = clean(formData.get("active"), 10) === "true";
  if (!requirementId) go("Exigence invalide.", "error");
  const {error} = await context.admin.from("hr_document_requirements").update({is_active: active, updated_at: new Date().toISOString()}).eq("id", requirementId).eq("organization_id", context.organizationId);
  if (error) go(error.message, "error");
  revalidatePath("/dashboard/hr/documents");
  go(active ? "Exigence réactivée." : "Exigence désactivée.");
}
