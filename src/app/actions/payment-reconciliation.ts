"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getPaymentReconciliationAccess} from "@/lib/auth/payment-reconciliation-access";
import {syncSaleInvoiceAndReceipt} from "@/lib/finance/sale-documents";
import {promoteCrmClientForConfirmedSale} from "@/lib/crm/customer-lifecycle";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string};
type Decision = "confirmed" | "correction_requested" | "rejected";

const decisions = new Set<Decision>(["confirmed", "correction_requested", "rejected"]);
const assignmentRoles = new Set(["agent", "supervisor"]);

function clean(value: FormDataEntryValue | null, max = 1500) {
  return String(value ?? "").trim().slice(0, max);
}

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/finance/payments?${kind}=${encodeURIComponent(message)}`);
}

async function context() {
  const supabase = await createClient();
  const {data} = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (error || !membership) redirect("/dashboard/company");
  const access = await getPaymentReconciliationAccess(admin, membership.organization_id, data.user.id, membership.role);
  if (!access.allowed) redirect("/dashboard?error=access-denied");
  return {admin, user: data.user, membership, access};
}

function refresh() {
  ["/dashboard/finance/payments", "/dashboard/finance/documents", "/dashboard/finance/customer-accounts", "/dashboard/finance/receivables", "/dashboard/sales", "/dashboard/collections", "/dashboard/customer-service/installments", "/dashboard/crm/prospects", "/dashboard/crm", "/dashboard"].forEach((path) => revalidatePath(path));
}

async function bankReferenceExists(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  bankReference: string,
  paymentId: string,
) {
  const normalized = bankReference.trim();
  const [{data: saleMatch}, {data: serviceMatch}] = await Promise.all([
    admin.from("sales_payments").select("id").eq("organization_id", organizationId).ilike("bank_reference", normalized).neq("id", paymentId).limit(1),
    admin.from("customer_service_installment_payments").select("id").eq("organization_id", organizationId).ilike("bank_reference", normalized).neq("id", paymentId).limit(1),
  ]);
  return Boolean(saleMatch?.length || serviceMatch?.length);
}

async function audit(input: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  source: "sale" | "customer_service" | "assignment";
  paymentId: string;
  actorId: string;
  action: Decision | "assignment_created" | "assignment_updated" | "assignment_revoked";
  oldStatus?: string | null;
  newStatus?: string | null;
  bankPostedOn?: string | null;
  bankReference?: string | null;
  bankAccountLast4?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const {error} = await input.admin.from("payment_reconciliation_audit_log").insert({
    organization_id: input.organizationId,
    payment_source: input.source,
    payment_id: input.paymentId,
    actor_id: input.actorId,
    action: input.action,
    old_status: input.oldStatus ?? null,
    new_status: input.newStatus ?? null,
    bank_posted_on: input.bankPostedOn ?? null,
    bank_reference: input.bankReference ?? null,
    bank_account_last4: input.bankAccountLast4 ?? null,
    note: input.note ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) throw new Error(error.message);
}

export async function assignReceiptAgentAction(formData: FormData) {
  const {admin, user, membership, access} = await context();
  if (!access.canManageTeam) go("Seuls le propriétaire et l’administrateur peuvent gérer l’équipe des reçus.", "error");
  const userId = clean(formData.get("userId"), 80);
  const assignmentRole = clean(formData.get("assignmentRole"), 30);
  if (!userId || !assignmentRoles.has(assignmentRole)) go("Affectation invalide.", "error");

  const {data: member} = await admin.from("organization_members").select("user_id").eq("organization_id", membership.organization_id).eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (!member) go("Ce membre actif est introuvable.", "error");

  const {data: previous} = await admin.from("payment_reconciliation_assignments").select("id,is_active").eq("organization_id", membership.organization_id).eq("user_id", userId).maybeSingle<{id: string; is_active: boolean}>();
  const {error} = await admin.from("payment_reconciliation_assignments").upsert({
    organization_id: membership.organization_id,
    user_id: userId,
    assignment_role: assignmentRole,
    is_active: true,
    assigned_by: user.id,
    assigned_at: new Date().toISOString(),
    revoked_by: null,
    revoked_at: null,
  }, {onConflict: "organization_id,user_id"});
  if (error) go(`Affectation impossible : ${error.message}`, "error");
  await audit({admin, organizationId: membership.organization_id, source: "assignment", paymentId: previous?.id ?? userId, actorId: user.id, action: previous ? "assignment_updated" : "assignment_created", metadata: {userId, assignmentRole}});
  refresh();
  go("Membre affecté à l’équipe des reçus.");
}

export async function revokeReceiptAgentAction(formData: FormData) {
  const {admin, user, membership, access} = await context();
  if (!access.canManageTeam) go("Seuls le propriétaire et l’administrateur peuvent gérer l’équipe des reçus.", "error");
  const assignmentId = clean(formData.get("assignmentId"), 80);
  if (!assignmentId) go("Affectation introuvable.", "error");
  const {data: assignment, error} = await admin.from("payment_reconciliation_assignments").update({is_active: false, revoked_by: user.id, revoked_at: new Date().toISOString()}).eq("id", assignmentId).eq("organization_id", membership.organization_id).select("id,user_id").maybeSingle<{id: string; user_id: string}>();
  if (error || !assignment) go("Retrait impossible.", "error");
  await audit({admin, organizationId: membership.organization_id, source: "assignment", paymentId: assignment.id, actorId: user.id, action: "assignment_revoked", metadata: {userId: assignment.user_id}});
  refresh();
  go("Accès au contrôle des encaissements retiré.");
}

export async function reconcileSalePaymentAction(formData: FormData) {
  const {admin, user, membership} = await context();
  const paymentId = clean(formData.get("paymentId"), 80);
  const decision = clean(formData.get("decision"), 30) as Decision;
  const bankPostedOn = clean(formData.get("bankPostedOn"), 10) || null;
  const bankReference = clean(formData.get("bankReference"), 160) || null;
  const bankAccountLast4 = clean(formData.get("bankAccountLast4"), 4) || null;
  const note = clean(formData.get("note"), 1500) || null;
  if (!paymentId || !decisions.has(decision)) go("Décision invalide.", "error");
  if (decision === "confirmed" && (!bankPostedOn || !bankReference || !/^\d{4}$/.test(bankAccountLast4 ?? ""))) go("La date bancaire, la référence et les 4 derniers chiffres du compte sont obligatoires.", "error");
  if (decision !== "confirmed" && !note) go("Un motif est obligatoire pour demander une correction ou rejeter un paiement.", "error");
  if (bankReference && await bankReferenceExists(admin, membership.organization_id, bankReference, paymentId)) go("Cette référence bancaire est déjà utilisée par un autre paiement.", "error");

  const {data: payment} = await admin.from("sales_payments").select("id,sale_id,status,amount,currency,recorded_by").eq("id", paymentId).eq("organization_id", membership.organization_id).maybeSingle<{id:string;sale_id:string;status:string;amount:number|string;currency:string;recorded_by:string}>();
  if (!payment || !["pending", "correction_requested"].includes(payment.status)) go("Ce paiement n’est plus en attente de contrôle.", "error");
  if (payment.recorded_by === user.id) go("Vous ne pouvez pas valider un paiement que vous avez vous-même enregistré.", "error");

  const {data: sale} = await admin.from("sales_records").select("total_amount,currency,initial_payment_type,initial_payment_value,commission_trigger_payment_id").eq("id", payment.sale_id).eq("organization_id", membership.organization_id).maybeSingle<{total_amount:number|string;currency:string;initial_payment_type:string;initial_payment_value:number|string;commission_trigger_payment_id:string|null}>();
  if (!sale) go("Vente associée introuvable.", "error");
  if (decision === "confirmed" && !sale.commission_trigger_payment_id) {
    const minimum = sale.initial_payment_type === "percentage" ? Math.round(Number(sale.total_amount) * Number(sale.initial_payment_value) / 100 * 100) / 100 : Number(sale.initial_payment_value);
    if (Number(payment.amount) < minimum) go(`Le premier paiement doit être au moins de ${minimum.toFixed(2)} ${sale.currency}.`, "error");
  }

  const status = decision;
  const now = new Date().toISOString();
  const {error} = await admin.from("sales_payments").update({
    status,
    confirmed_by: decision === "confirmed" ? user.id : null,
    confirmed_at: decision === "confirmed" ? now : null,
    reconciled_by: user.id,
    reconciled_at: now,
    bank_posted_on: decision === "confirmed" ? bankPostedOn : null,
    bank_reference: decision === "confirmed" ? bankReference : null,
    bank_account_last4: decision === "confirmed" ? bankAccountLast4 : null,
    reconciliation_note: note,
  }).eq("id", paymentId).eq("organization_id", membership.organization_id);
  if (error) go(`Validation impossible : ${error.message}`, "error");
  const {error: refreshError} = await admin.rpc("refresh_sales_payment_summary", {p_sale_id: payment.sale_id});
  if (refreshError) go(`Paiement mis à jour, mais le solde n’a pas été recalculé : ${refreshError.message}`, "error");
  if (decision === "confirmed") {
    await promoteCrmClientForConfirmedSale({admin, organizationId: membership.organization_id, saleId: payment.sale_id, actorId: user.id, source: "bank_reconciliation"});
    try {
      await syncSaleInvoiceAndReceipt({admin, organizationId: membership.organization_id, saleId: payment.sale_id, actorId: user.id});
    } catch (documentError) {
      console.error("Automatic invoice/receipt sync failed after bank confirmation", documentError);
    }
  }
  await audit({admin, organizationId: membership.organization_id, source: "sale", paymentId, actorId: user.id, action: decision, oldStatus: payment.status, newStatus: status, bankPostedOn, bankReference, bankAccountLast4, note, metadata: {saleId: payment.sale_id, amount: payment.amount, currency: payment.currency}});
  refresh();
  go(decision === "confirmed" ? "Encaissement confirmé sur le relevé bancaire." : decision === "correction_requested" ? "Correction demandée au déclarant." : "Paiement rejeté.");
}

export async function reconcileCustomerServicePaymentAction(formData: FormData) {
  const {admin, user, membership} = await context();
  const paymentId = clean(formData.get("paymentId"), 80);
  const decision = clean(formData.get("decision"), 30) as Decision;
  const bankPostedOn = clean(formData.get("bankPostedOn"), 10) || null;
  const bankReference = clean(formData.get("bankReference"), 160) || null;
  const bankAccountLast4 = clean(formData.get("bankAccountLast4"), 4) || null;
  const note = clean(formData.get("note"), 1500) || null;
  if (!paymentId || !decisions.has(decision)) go("Décision invalide.", "error");
  if (decision === "confirmed" && (!bankPostedOn || !bankReference || !/^\d{4}$/.test(bankAccountLast4 ?? ""))) go("La date bancaire, la référence et les 4 derniers chiffres du compte sont obligatoires.", "error");
  if (decision !== "confirmed" && !note) go("Un motif est obligatoire.", "error");
  if (bankReference && await bankReferenceExists(admin, membership.organization_id, bankReference, paymentId)) go("Cette référence bancaire est déjà utilisée.", "error");

  const {data: payment} = await admin.from("customer_service_installment_payments").select("id,installment_id,finance_status,amount_received,currency,recorded_by").eq("id", paymentId).eq("organization_id", membership.organization_id).maybeSingle<{id:string;installment_id:string;finance_status:string;amount_received:number|string;currency:string;recorded_by:string}>();
  if (!payment || !["pending", "correction_requested"].includes(payment.finance_status)) go("Ce versement n’est plus en attente.", "error");
  if (payment.recorded_by === user.id) go("Vous ne pouvez pas valider un versement que vous avez enregistré.", "error");
  const financeStatus = decision === "confirmed" ? "validated" : decision;
  const now = new Date().toISOString();
  const {error} = await admin.from("customer_service_installment_payments").update({finance_status: financeStatus, finance_reviewed_by: user.id, finance_reviewed_at: now, finance_note: note, bank_posted_on: decision === "confirmed" ? bankPostedOn : null, bank_reference: decision === "confirmed" ? bankReference : null, bank_account_last4: decision === "confirmed" ? bankAccountLast4 : null}).eq("id", paymentId).eq("organization_id", membership.organization_id);
  if (error) go(`Validation impossible : ${error.message}`, "error");

  const [{data: installment}, {data: validated}] = await Promise.all([
    admin.from("customer_service_installments").select("expected_amount").eq("id", payment.installment_id).maybeSingle<{expected_amount:number|string}>(),
    admin.from("customer_service_installment_payments").select("amount_received").eq("installment_id", payment.installment_id).eq("finance_status", "validated"),
  ]);
  const received = (validated ?? []).reduce((sum, row) => sum + Number(row.amount_received), 0);
  const nextStatus = received <= 0 ? "pending" : received >= Number(installment?.expected_amount ?? 0) ? "paid" : "partial";
  await admin.from("customer_service_installments").update({status: nextStatus, updated_by: user.id}).eq("id", payment.installment_id);
  await audit({admin, organizationId: membership.organization_id, source: "customer_service", paymentId, actorId: user.id, action: decision, oldStatus: payment.finance_status, newStatus: financeStatus, bankPostedOn, bankReference, bankAccountLast4, note, metadata: {installmentId: payment.installment_id, amount: payment.amount_received, currency: payment.currency}});

  await admin.from("notifications").insert({organization_id: membership.organization_id, user_id: payment.recorded_by, actor_id: user.id, category: "collections", event_type: `installment_payment_${financeStatus}`, priority: decision === "confirmed" ? "success" : "warning", title_fr: decision === "confirmed" ? "Versement confirmé" : "Versement à corriger", title_en: decision === "confirmed" ? "Instalment confirmed" : "Instalment needs attention", body_fr: `Le versement de ${payment.amount_received} ${payment.currency} a été ${decision === "confirmed" ? "confirmé" : "mis à jour"} par l’équipe des reçus.`, body_en: `The ${payment.amount_received} ${payment.currency} instalment was ${decision === "confirmed" ? "confirmed" : "updated"} by the receipts team.`, action_url: "/dashboard/customer-service/installments", requires_action: decision !== "confirmed", dedupe_key: `installment-payment:${paymentId}:${financeStatus}`, metadata: {paymentId, installmentId: payment.installment_id}});
  refresh();
  go(decision === "confirmed" ? "Versement confirmé sur le relevé bancaire." : decision === "correction_requested" ? "Correction demandée." : "Versement rejeté.");
}
