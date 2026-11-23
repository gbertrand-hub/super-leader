"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {finalizeTemporaryAttachment, readPendingAttachment, removePrivateAttachment} from "@/lib/storage/private-attachments";
import {canAccessCustomer,getCustomerServiceContext} from "@/lib/customer-service/server";

const methods = new Set(["bank_transfer","card","cash","mobile_money","cheque","other"]);
const channels = new Set(["phone","whatsapp","email","sms","in_person","other"]);
const outcomes = new Set(["no_answer","reminder_sent","client_reached","promise_received","dispute","escalated","other"]);
const clean = (value: FormDataEntryValue | null, max = 1500) => String(value ?? "").trim().slice(0, max);
const money = (value: FormDataEntryValue | null) => Number(String(value ?? "").replace(",", "."));
function go(path: string, message: string, error = false): never { const query = new URLSearchParams({[error ? "error" : "success"]: message}); redirect(`${path}?${query}`); }
function refresh() { ["/dashboard/customer-service","/dashboard/customer-service/clients","/dashboard/customer-service/installments","/dashboard/customer-service/follow-up"].forEach(path => revalidatePath(path)); }

export async function assignCustomerServiceClientAction(formData: FormData) {
  const context = await getCustomerServiceContext(); const {admin, user, membership, leader, organizationWide, visibleOwnerIds} = context;
  if (!leader) go("/dashboard/customer-service/clients", "Seul un responsable peut attribuer un client.", true);
  const clientId = clean(formData.get("clientId"), 80);
  const ownerId = clean(formData.get("ownerId"), 80) || null;
  const status = clean(formData.get("status"), 30);
  if (!clientId || !new Set(["not_transferred","active","attention","suspended","completed"]).has(status)) go("/dashboard/customer-service/clients", "Attribution invalide.", true);
  if (!organizationWide && !(await canAccessCustomer(context,clientId))) go("/dashboard/customer-service/clients", "Accès refusé à ce client.", true);
  if (ownerId && !organizationWide && !visibleOwnerIds.includes(ownerId)) go("/dashboard/customer-service/clients", "Vous ne pouvez attribuer un client qu'à votre équipe.", true);
  const {data: previous}=await admin.from("crm_clients").select("customer_service_owner_id").eq("id",clientId).eq("organization_id",membership.organization_id).maybeSingle<{customer_service_owner_id:string|null}>();
  const {error} = await admin.from("crm_clients").update({customer_service_owner_id: ownerId, customer_service_status: status, customer_service_since: status === "not_transferred" ? null : new Date().toISOString().slice(0,10),customer_service_assigned_by:user.id,customer_service_assigned_at:new Date().toISOString()}).eq("id", clientId).eq("organization_id", membership.organization_id);
  if (error) go("/dashboard/customer-service/clients", error.message, true);
  await admin.from("crm_client_assignment_history").insert({organization_id:membership.organization_id,client_id:clientId,previous_owner_id:previous?.customer_service_owner_id??null,new_owner_id:ownerId,assigned_by:user.id,reason:clean(formData.get("reason"),500)||"Réattribution depuis le portefeuille"});
  refresh(); go("/dashboard/customer-service/clients", "Portefeuille mis à jour.");
}

export async function createCustomerServiceInstallmentAction(formData: FormData) {
  const context=await getCustomerServiceContext(); const {admin, user, membership} = context;
  const clientId = clean(formData.get("clientId"), 80); const contractId = clean(formData.get("contractId"), 80) || null;
  const expectedAmount = money(formData.get("expectedAmount")); const dueDate = clean(formData.get("dueDate"), 10);
  const sequenceNumber = Number(clean(formData.get("sequenceNumber"), 8)); const currency = clean(formData.get("currency"), 3).toUpperCase();
  const assignedTo = clean(formData.get("assignedTo"), 80) || null;
  if (!clientId || !dueDate || !Number.isInteger(sequenceNumber) || sequenceNumber < 1 || !Number.isFinite(expectedAmount) || expectedAmount <= 0 || !/^[A-Z]{3}$/.test(currency)) go("/dashboard/customer-service/installments", "Données de mensualité invalides.", true);
  if(!(await canAccessCustomer(context,clientId))) go("/dashboard/customer-service/installments", "Accès refusé à ce client.", true);
  const {data: client} = await admin.from("crm_clients").select("id").eq("id", clientId).eq("organization_id", membership.organization_id).maybeSingle();
  if (!client) go("/dashboard/customer-service/installments", "Client introuvable.", true);
  const {error} = await admin.from("customer_service_installments").insert({organization_id: membership.organization_id, client_id: clientId, contract_id: contractId, sequence_number: sequenceNumber, due_date: dueDate, expected_amount: expectedAmount, currency, assigned_to: assignedTo, created_by: user.id, updated_by: user.id});
  if (error) go("/dashboard/customer-service/installments", error.code === "23505" ? "Cette mensualité existe déjà pour ce contrat." : error.message, true);
  refresh(); go("/dashboard/customer-service/installments", "Mensualité ajoutée.");
}

export async function recordCustomerServicePaymentAction(formData: FormData) {
  const context=await getCustomerServiceContext(); const {admin, user, membership} = context;
  const installmentId = clean(formData.get("installmentId"), 80); const amount = money(formData.get("amountReceived"));
  const receivedOn = clean(formData.get("receivedOn"), 10); const method = clean(formData.get("paymentMethod"), 30);
  const reference = clean(formData.get("transactionReference"), 160) || null; const notes = clean(formData.get("notes")) || null;
  const pending = readPendingAttachment(formData, "proof");
  if (!installmentId || !receivedOn || !Number.isFinite(amount) || amount <= 0 || !methods.has(method) || !pending) go("/dashboard/customer-service/installments", "Montant, moyen de paiement et preuve sont obligatoires.", true);
  const {data: installment} = await admin.from("customer_service_installments").select("id,client_id,currency,expected_amount").eq("id", installmentId).eq("organization_id", membership.organization_id).maybeSingle<{id:string;client_id:string;currency:string;expected_amount:number}>();
  if (!installment) go("/dashboard/customer-service/installments", "Mensualité introuvable.", true);
  if(!(await canAccessCustomer(context,installment.client_id))) go("/dashboard/customer-service/installments", "Accès refusé à ce dossier.", true);
  const {data: payment, error} = await admin.from("customer_service_installment_payments").insert({organization_id: membership.organization_id, installment_id: installmentId, amount_received: amount, currency: installment.currency, received_on: receivedOn, payment_method: method, transaction_reference: reference, proof_storage_path: pending.storagePath, proof_file_name: pending.fileName, proof_mime_type: pending.mimeType, proof_size_bytes: pending.sizeBytes, recorded_by: user.id, notes}).select("id").single<{id:string}>();
  if (error || !payment) go("/dashboard/customer-service/installments", error?.message ?? "Enregistrement impossible.", true);
  let finalPath: string | null = null;
  try {
    const final = await finalizeTemporaryAttachment({admin, organizationId: membership.organization_id, userId: user.id, purpose: "payment", recordId: payment.id, pending}); finalPath = final.storagePath;
    await admin.from("customer_service_installment_payments").update({proof_storage_path: final.storagePath, proof_file_name: final.fileName, proof_mime_type: final.mimeType, proof_size_bytes: final.sizeBytes}).eq("id", payment.id);
  } catch (cause) {
    await removePrivateAttachment(admin, finalPath ?? pending.storagePath); await admin.from("customer_service_installment_payments").delete().eq("id", payment.id);
    go("/dashboard/customer-service/installments", cause instanceof Error ? cause.message : "La preuve n’a pas pu être sécurisée.", true);
  }
  const {data: totals} = await admin.from("customer_service_installment_payments").select("amount_received").eq("installment_id", installmentId).eq("finance_status", "validated");
  const received = (totals ?? []).reduce((sum,row) => sum + Number(row.amount_received), 0);
  await admin.from("customer_service_installments").update({status: received >= Number(installment.expected_amount) ? "paid" : "partial", updated_by: user.id}).eq("id", installmentId);
  refresh(); go("/dashboard/customer-service/installments", "Paiement enregistré et transmis à Finance pour validation.");
}

export async function addCustomerServiceFollowUpAction(formData: FormData) {
  const context=await getCustomerServiceContext(); const {admin, user, membership} = context;
  const installmentId = clean(formData.get("installmentId"),80); const channel = clean(formData.get("channel"),30); const outcome = clean(formData.get("outcome"),40); const note = clean(formData.get("note"),3000);
  const promisedDate = clean(formData.get("promisedDate"),10) || null; const nextActionAt = clean(formData.get("nextActionAt"),40) || null;
  if (!installmentId || !channels.has(channel) || !outcomes.has(outcome) || note.length < 2) go("/dashboard/customer-service/follow-up", "Compte rendu invalide.", true);
  const {data:installment}=await admin.from("customer_service_installments").select("client_id").eq("id",installmentId).eq("organization_id",membership.organization_id).maybeSingle<{client_id:string}>();
  if(!installment || !(await canAccessCustomer(context,installment.client_id))) go("/dashboard/customer-service/follow-up", "Accès refusé à ce dossier.", true);
  const {error} = await admin.from("customer_service_follow_ups").insert({organization_id: membership.organization_id, installment_id: installmentId, agent_id: user.id, channel, outcome, note, promised_date: promisedDate, next_action_at: nextActionAt});
  if (error) go("/dashboard/customer-service/follow-up", error.message, true);
  if (outcome === "promise_received" && promisedDate) await admin.from("customer_service_installments").update({status:"promised",promise_date:promisedDate,promise_note:note,updated_by:user.id}).eq("id",installmentId);
  refresh(); go("/dashboard/customer-service/follow-up", "Relance ajoutée à l’historique.");
}
