"use server";

import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createNotification} from "@/lib/notifications/service";
import {finalizeTemporaryAttachment, readPendingAttachment, removePrivateAttachment} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const reviewerRoles = new Set(["owner", "admin"]);
const categories = new Set(["operations", "marketing", "communication", "travel", "training", "supplies", "technology", "rent_utilities", "professional_services", "taxes_fees", "other"]);
const decisions = new Set(["approved", "correction_requested", "rejected"]);
const paymentMethods = new Set(["bank_transfer", "card", "cash", "mobile_money", "cheque", "other"]);

const clean = (value: FormDataEntryValue | null, max = 300) => String(value ?? "").trim().slice(0, max);
const amount = (value: FormDataEntryValue | null) => {
  const parsed = Number(clean(value).replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : Number.NaN;
};
const validDate = (value: FormDataEntryValue | null) => {
  const date = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : "";
};

function go(message: string, kind: "success" | "error" = "success", status = "all"): never {
  redirect(`/dashboard/finance/expenses?status=${encodeURIComponent(status)}&${kind}=${encodeURIComponent(message)}`);
}

async function context() {
  const supabase = await createClient();
  const {data: auth} = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", auth.user.id).eq("is_active", true).limit(1).maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  return {admin, user: auth.user, membership, canReview: reviewerRoles.has(membership.role)};
}

async function audit(input: {admin: ReturnType<typeof createAdminClient>; organizationId: string; expenseId: string; actorId: string; action: string; previousStatus?: string | null; newStatus?: string | null; note?: string | null; details?: Record<string, unknown>}) {
  const {error} = await input.admin.from("finance_expense_audit_log").insert({organization_id: input.organizationId, expense_id: input.expenseId, actor_id: input.actorId, action: input.action, previous_status: input.previousStatus ?? null, new_status: input.newStatus ?? null, note: input.note ?? null, details: input.details ?? {}});
  if (error) console.error("Expense audit failed", error);
}

async function reviewers(admin: ReturnType<typeof createAdminClient>, organizationId: string, excludedUserId: string) {
  const {data} = await admin.from("organization_members").select("user_id").eq("organization_id", organizationId).eq("is_active", true).in("role", ["owner", "admin"]);
  return (data ?? []).map(row => String(row.user_id)).filter(id => id !== excludedUserId);
}

async function notifyReviewers(input: {admin: ReturnType<typeof createAdminClient>; organizationId: string; actorId: string; expenseId: string; expenseNumber: string; title: string}) {
  const recipients = await reviewers(input.admin, input.organizationId, input.actorId);
  await Promise.allSettled(recipients.map(userId => createNotification({organizationId: input.organizationId, userId, actorId: input.actorId, category: "finance", eventType: "expense_submitted", titleFr: "Nouvelle dépense à contrôler", titleEn: "New expense to review", bodyFr: `${input.expenseNumber} · ${input.title}`, bodyEn: `${input.expenseNumber} · ${input.title}`, actionUrl: "/dashboard/finance/expenses?status=submitted", priority: "warning", requiresAction: true, dedupeKey: `expense:${input.expenseId}:submitted:${Date.now()}`})));
}

export async function submitExpenseAction(formData: FormData) {
  const {admin, user, membership} = await context();
  const title = clean(formData.get("title"), 220), category = clean(formData.get("category"), 50), vendorName = clean(formData.get("vendorName"), 220) || null, description = clean(formData.get("description"), 3000) || null, costCenter = clean(formData.get("costCenter"), 160) || null;
  const expenseDate = validDate(formData.get("expenseDate")), currency = clean(formData.get("currency"), 3).toUpperCase(), subtotal = amount(formData.get("subtotal")), taxAmount = amount(formData.get("taxAmount"));
  const pending = readPendingAttachment(formData, "expenseReceipt");
  if (title.length < 2 || !categories.has(category) || !expenseDate || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(taxAmount) || taxAmount < 0) go("Vérifiez le titre, la catégorie, la date et les montants.", "error");
  if (!pending) go("Le justificatif de la dépense est obligatoire.", "error");

  const id = randomUUID(), expenseNumber = `DEP-${expenseDate.replaceAll("-", "")}-${id.slice(-6).toUpperCase()}`;
  let receipt;
  try { receipt = await finalizeTemporaryAttachment({admin, organizationId: membership.organization_id, userId: user.id, purpose: "expense", recordId: id, pending}); }
  catch (error) { go(`Justificatif invalide : ${error instanceof Error ? error.message : "erreur inconnue"}`, "error"); }

  const {error} = await admin.from("finance_expenses").insert({id, organization_id: membership.organization_id, expense_number: expenseNumber, title, category, vendor_name: vendorName, description, cost_center: costCenter, expense_date: expenseDate, currency, subtotal, tax_amount: taxAmount, status: "submitted", receipt_storage_path: receipt.storagePath, receipt_file_name: receipt.fileName, receipt_mime_type: receipt.mimeType, receipt_size_bytes: receipt.sizeBytes, submitted_by: user.id});
  if (error) { await removePrivateAttachment(admin, receipt.storagePath); go(`Enregistrement impossible : ${error.message}`, "error"); }
  await audit({admin, organizationId: membership.organization_id, expenseId: id, actorId: user.id, action: "submitted", newStatus: "submitted", details: {expenseNumber, totalAmount: subtotal + taxAmount, currency}});
  await notifyReviewers({admin, organizationId: membership.organization_id, actorId: user.id, expenseId: id, expenseNumber, title});
  revalidatePath("/dashboard/finance/expenses");
  go("Dépense soumise au contrôle.", "success", "submitted");
}

export async function resubmitExpenseAction(formData: FormData) {
  const {admin, user, membership} = await context();
  const expenseId = clean(formData.get("expenseId"), 80);
  const {data: current} = await admin.from("finance_expenses").select("id,expense_number,title,status,submitted_by,receipt_storage_path").eq("id", expenseId).eq("organization_id", membership.organization_id).eq("submitted_by", user.id).maybeSingle<{id:string;expense_number:string;title:string;status:string;submitted_by:string;receipt_storage_path:string}>();
  if (!current || current.status !== "correction_requested") go("Cette dépense ne peut pas être corrigée.", "error");
  const title = clean(formData.get("title"), 220), category = clean(formData.get("category"), 50), vendorName = clean(formData.get("vendorName"), 220) || null, description = clean(formData.get("description"), 3000) || null, costCenter = clean(formData.get("costCenter"), 160) || null;
  const expenseDate = validDate(formData.get("expenseDate")), currency = clean(formData.get("currency"), 3).toUpperCase(), subtotal = amount(formData.get("subtotal")), taxAmount = amount(formData.get("taxAmount")), pending = readPendingAttachment(formData, "expenseReceipt");
  if (title.length < 2 || !categories.has(category) || !expenseDate || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(taxAmount) || taxAmount < 0) go("Les corrections sont incomplètes.", "error", "correction_requested");
  let receipt: Awaited<ReturnType<typeof finalizeTemporaryAttachment>> | null = null;
  if (pending) {
    try { receipt = await finalizeTemporaryAttachment({admin, organizationId: membership.organization_id, userId: user.id, purpose: "expense", recordId: expenseId, pending}); }
    catch (error) { go(`Nouveau justificatif invalide : ${error instanceof Error ? error.message : "erreur inconnue"}`, "error", "correction_requested"); }
  }
  const update: Record<string, unknown> = {title, category, vendor_name: vendorName, description, cost_center: costCenter, expense_date: expenseDate, currency, subtotal, tax_amount: taxAmount, status: "submitted", reviewed_by: null, reviewed_at: null, review_note: null, submitted_at: new Date().toISOString()};
  if (receipt) Object.assign(update, {receipt_storage_path: receipt.storagePath, receipt_file_name: receipt.fileName, receipt_mime_type: receipt.mimeType, receipt_size_bytes: receipt.sizeBytes});
  const {error} = await admin.from("finance_expenses").update(update).eq("id", expenseId).eq("organization_id", membership.organization_id).eq("submitted_by", user.id).eq("status", "correction_requested");
  if (error) { if (receipt) await removePrivateAttachment(admin, receipt.storagePath); go(`Correction impossible : ${error.message}`, "error", "correction_requested"); }
  if (receipt && current.receipt_storage_path !== receipt.storagePath) await removePrivateAttachment(admin, current.receipt_storage_path);
  await audit({admin, organizationId: membership.organization_id, expenseId, actorId: user.id, action: "resubmitted", previousStatus: "correction_requested", newStatus: "submitted"});
  await notifyReviewers({admin, organizationId: membership.organization_id, actorId: user.id, expenseId, expenseNumber: current.expense_number, title});
  revalidatePath("/dashboard/finance/expenses");
  go("Dépense corrigée et soumise de nouveau.", "success", "submitted");
}

export async function reviewExpenseAction(formData: FormData) {
  const {admin, user, membership, canReview} = await context();
  if (!canReview) go("Vous n’avez pas la permission de contrôler les dépenses.", "error");
  const expenseId = clean(formData.get("expenseId"), 80), decision = clean(formData.get("decision"), 30), note = clean(formData.get("note"), 1500) || null;
  if (!decisions.has(decision) || (["correction_requested", "rejected"].includes(decision) && !note)) go("Une décision valide et un motif sont requis.", "error", "submitted");
  const {data: expense} = await admin.from("finance_expenses").select("id,expense_number,title,status,submitted_by").eq("id", expenseId).eq("organization_id", membership.organization_id).maybeSingle<{id:string;expense_number:string;title:string;status:string;submitted_by:string}>();
  if (!expense || !["submitted", "correction_requested"].includes(expense.status)) go("Cette dépense a déjà été traitée.", "error");
  if (expense.submitted_by === user.id) go("Vous ne pouvez pas approuver votre propre dépense.", "error", expense.status);
  const {data: updated, error} = await admin.from("finance_expenses").update({status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_note: note}).eq("id", expenseId).eq("organization_id", membership.organization_id).in("status", ["submitted", "correction_requested"]).select("id").maybeSingle();
  if (error || !updated) go(`Décision impossible : ${error?.message ?? "la dépense a été modifiée par un autre utilisateur"}`, "error");
  await audit({admin, organizationId: membership.organization_id, expenseId, actorId: user.id, action: decision, previousStatus: expense.status, newStatus: decision, note});
  await createNotification({organizationId: membership.organization_id, userId: expense.submitted_by, actorId: user.id, category: "finance", eventType: `expense_${decision}`, titleFr: decision === "approved" ? "Dépense approuvée" : decision === "correction_requested" ? "Correction demandée sur une dépense" : "Dépense rejetée", titleEn: decision === "approved" ? "Expense approved" : decision === "correction_requested" ? "Expense correction requested" : "Expense rejected", bodyFr: `${expense.expense_number} · ${expense.title}${note ? ` · ${note}` : ""}`, bodyEn: `${expense.expense_number} · ${expense.title}${note ? ` · ${note}` : ""}`, actionUrl: `/dashboard/finance/expenses?status=${decision}`, priority: decision === "approved" ? "success" : "warning", requiresAction: decision === "correction_requested", dedupeKey: `expense:${expenseId}:${decision}:${Date.now()}`});
  revalidatePath("/dashboard/finance/expenses");
  go(decision === "approved" ? "Dépense approuvée." : decision === "correction_requested" ? "Correction demandée." : "Dépense rejetée.", "success", decision);
}

export async function markExpensePaidAction(formData: FormData) {
  const {admin, user, membership, canReview} = await context();
  if (!canReview) go("Vous n’avez pas la permission d’enregistrer ce paiement.", "error", "approved");
  const expenseId = clean(formData.get("expenseId"), 80), paymentMethod = clean(formData.get("paymentMethod"), 30), paidOn = validDate(formData.get("paidOn")), bankReference = clean(formData.get("bankReference"), 160), bankAccountLast4 = clean(formData.get("bankAccountLast4"), 4) || null, pending = readPendingAttachment(formData, "expensePaymentProof");
  if (!paymentMethods.has(paymentMethod) || !paidOn || !bankReference || (paymentMethod !== "cash" && !/^\d{4}$/.test(bankAccountLast4 ?? "")) || !pending) go("Renseignez le paiement et téléversez sa preuve.", "error", "approved");
  const {data: expense} = await admin.from("finance_expenses").select("id,expense_number,title,status,submitted_by").eq("id", expenseId).eq("organization_id", membership.organization_id).maybeSingle<{id:string;expense_number:string;title:string;status:string;submitted_by:string}>();
  if (!expense || expense.status !== "approved") go("Seule une dépense approuvée peut être payée.", "error", "approved");
  if (expense.submitted_by === user.id) go("Le demandeur ne peut pas confirmer lui-même le paiement.", "error", "approved");
  const {data: duplicate} = await admin.from("finance_expenses").select("id").eq("organization_id", membership.organization_id).ilike("bank_reference", bankReference).neq("id", expenseId).limit(1);
  if (duplicate?.length) go("Cette référence de paiement est déjà utilisée.", "error", "approved");
  let proof;
  try { proof = await finalizeTemporaryAttachment({admin, organizationId: membership.organization_id, userId: user.id, purpose: "expense", recordId: `${expenseId}-payment`, pending}); }
  catch (error) { go(`Preuve de paiement invalide : ${error instanceof Error ? error.message : "erreur inconnue"}`, "error", "approved"); }
  const {data: updated, error} = await admin.from("finance_expenses").update({status: "paid", payment_method: paymentMethod, paid_on: paidOn, bank_reference: bankReference, bank_account_last4: bankAccountLast4, payment_proof_storage_path: proof.storagePath, payment_proof_file_name: proof.fileName, payment_proof_mime_type: proof.mimeType, payment_proof_size_bytes: proof.sizeBytes, paid_by: user.id, paid_at: new Date().toISOString()}).eq("id", expenseId).eq("organization_id", membership.organization_id).eq("status", "approved").select("id").maybeSingle();
  if (error || !updated) { await removePrivateAttachment(admin, proof.storagePath); go(`Paiement impossible : ${error?.message ?? "la dépense a été modifiée par un autre utilisateur"}`, "error", "approved"); }
  await audit({admin, organizationId: membership.organization_id, expenseId, actorId: user.id, action: "paid", previousStatus: "approved", newStatus: "paid", details: {paymentMethod, paidOn, bankReference, bankAccountLast4}});
  await createNotification({organizationId: membership.organization_id, userId: expense.submitted_by, actorId: user.id, category: "finance", eventType: "expense_paid", titleFr: "Dépense payée", titleEn: "Expense paid", bodyFr: `${expense.expense_number} · ${expense.title}`, bodyEn: `${expense.expense_number} · ${expense.title}`, actionUrl: "/dashboard/finance/expenses?status=paid", priority: "success", dedupeKey: `expense:${expenseId}:paid`});
  revalidatePath("/dashboard/finance/expenses");
  go("Paiement de la dépense enregistré.", "success", "paid");
}

export async function cancelExpenseAction(formData: FormData) {
  const {admin, user, membership, canReview} = await context();
  const expenseId = clean(formData.get("expenseId"), 80);
  const {data: expense} = await admin.from("finance_expenses").select("id,status,submitted_by").eq("id", expenseId).eq("organization_id", membership.organization_id).maybeSingle<{id:string;status:string;submitted_by:string}>();
  if (!expense || !["submitted", "correction_requested", "approved"].includes(expense.status) || (!canReview && expense.submitted_by !== user.id) || (expense.status === "approved" && !canReview)) go("Cette dépense ne peut pas être annulée.", "error");
  const {data: updated, error} = await admin.from("finance_expenses").update({status: "cancelled"}).eq("id", expenseId).eq("organization_id", membership.organization_id).eq("status", expense.status).select("id").maybeSingle();
  if (error || !updated) go(`Annulation impossible : ${error?.message ?? "la dépense a été modifiée par un autre utilisateur"}`, "error");
  await audit({admin, organizationId: membership.organization_id, expenseId, actorId: user.id, action: "cancelled", previousStatus: expense.status, newStatus: "cancelled"});
  revalidatePath("/dashboard/finance/expenses");
  go("Dépense annulée.", "success", "cancelled");
}
