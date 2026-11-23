"use server";

import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getCustomerServiceContext} from "@/lib/customer-service/server";

type ImportRow = Record<string, string | number | null | undefined>;
const currencies = new Set(["USD","EUR","GBP","XAF","CAD"]);
const statuses = new Set(["active","attention","suspended","completed"]);
const clean = (value: unknown, max = 5000) => String(value ?? "").trim().slice(0, max) || null;
const email = (value: unknown) => String(value ?? "").trim().toLowerCase().slice(0, 320) || null;
const phone = (value: unknown) => String(value ?? "").trim().replace(/[^\d+]/g, "").slice(0, 40) || null;
const amount = (value: unknown) => { const parsed = Number(String(value ?? "").replace(",", ".")); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; };
const date = (value: unknown) => { const result = String(value ?? "").trim().slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null; };
const reference = () => `HCL-${new Date().getUTCFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
function go(message: string, kind: "success"|"error" = "success"): never { redirect(`/dashboard/customer-service/clients?${kind}=${encodeURIComponent(message)}`); }
function refresh() { revalidatePath("/dashboard/customer-service/clients"); revalidatePath("/dashboard/crm"); }

async function activeMember(admin: Awaited<ReturnType<typeof getCustomerServiceContext>>["admin"], organizationId: string, userId: string|null) {
  if (!userId) return true;
  const {data} = await admin.from("organization_members").select("user_id").eq("organization_id", organizationId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  return Boolean(data);
}

async function duplicate(admin: Awaited<ReturnType<typeof getCustomerServiceContext>>["admin"], organizationId: string, normalizedEmail: string|null, normalizedPhone: string|null) {
  const parts: string[] = [];
  if (normalizedEmail) parts.push(`email.eq.${normalizedEmail}`);
  if (normalizedPhone) parts.push(`phone.eq.${normalizedPhone}`, `whatsapp_phone.eq.${normalizedPhone}`);
  if (!parts.length) return null;
  const {data} = await admin.from("crm_clients").select("id,full_name,reference").eq("organization_id", organizationId).or(parts.join(",")).limit(1).maybeSingle<{id:string;full_name:string;reference:string}>();
  return data;
}

async function insertHistoricalClient(params: {row: ImportRow; organizationId: string; actorId: string; defaultOwnerId: string|null; batchId: string|null; admin: Awaited<ReturnType<typeof getCustomerServiceContext>>["admin"]}) {
  const {row, organizationId, actorId, defaultOwnerId, batchId, admin} = params;
  const fullName = clean(row.full_name ?? row.name ?? row.nom, 200);
  const normalizedEmail = email(row.email);
  const normalizedPhone = phone(row.phone ?? row.telephone ?? row.téléphone);
  if (!fullName || fullName.length < 2 || (!normalizedEmail && !normalizedPhone)) return {status:"rejected" as const, reason:"Nom et téléphone ou e-mail obligatoires"};
  const found = await duplicate(admin, organizationId, normalizedEmail, normalizedPhone);
  if (found) return {status:"duplicate" as const, reason:`${found.full_name} (${found.reference})`};
  const ownerId = clean(row.follow_up_owner_id ?? row.owner_id, 80) || defaultOwnerId;
  if (!(await activeMember(admin, organizationId, ownerId))) return {status:"rejected" as const, reason:"Responsable de suivi invalide"};
  const currencyRaw = String(row.currency ?? row.devise ?? "USD").toUpperCase();
  const currency = currencies.has(currencyRaw) ? currencyRaw : "USD";
  const serviceStatusRaw = String(row.customer_service_status ?? row.statut ?? "active");
  const serviceStatus = statuses.has(serviceStatusRaw) ? serviceStatusRaw : "active";
  const {data: client, error} = await admin.from("crm_clients").insert({
    organization_id: organizationId, reference: reference(), full_name: fullName, email: normalizedEmail,
    phone: normalizedPhone, whatsapp_phone: phone(row.whatsapp ?? row.whatsapp_phone), country: clean(row.country ?? row.pays, 120),
    city: clean(row.city ?? row.ville, 120), company_name: clean(row.company ?? row.entreprise, 200), preferred_language: "fr",
    preferred_feedback_channel: normalizedEmail ? "email" : "whatsapp", feedback_opt_in: false, marketing_opt_in: false,
    do_not_contact: false, owner_id: null, follow_up_owner_id: ownerId, source: "other", status: "active",
    notes: clean(row.notes, 5000), created_by: actorId, customer_service_owner_id: ownerId,
    customer_service_status: serviceStatus, customer_service_since: new Date().toISOString().slice(0,10), customer_service_assigned_by: actorId, customer_service_assigned_at: new Date().toISOString(),
    is_historical: true, historical_import_batch_id: batchId,
  }).select("id").single<{id:string}>();
  if (error || !client) return {status:"rejected" as const, reason:error?.message ?? "Création impossible"};
  const total = amount(row.total_amount ?? row.montant_total ?? row.montant);
  const paid = amount(row.amount_paid ?? row.montant_paye ?? row.montant_payé) ?? 0;
  const balance = amount(row.balance_amount ?? row.solde_restant) ?? (total === null ? null : Math.max(0,total-paid));
  const {error: detailsError} = await admin.from("crm_historical_client_details").insert({
    organization_id: organizationId, client_id: client.id, product_name: clean(row.product ?? row.produit ?? row.service, 240),
    original_sale_date: date(row.sale_date ?? row.date_vente), total_amount: total, amount_paid: paid, balance_amount: balance,
    currency, original_seller: clean(row.seller ?? row.commercial, 200), original_ambassador: clean(row.ambassador ?? row.ambassadeur, 200),
    contract_reference: clean(row.contract_reference ?? row.reference_contrat, 200), last_interaction_at: date(row.last_interaction ?? row.derniere_interaction),
    next_follow_up_at: date(row.next_follow_up ?? row.prochaine_relance), notes: clean(row.purchase_notes ?? row.notes_achat, 5000), created_by: actorId,
  });
  if (detailsError) { await admin.from("crm_clients").delete().eq("id", client.id); return {status:"rejected" as const, reason:detailsError.message}; }
  await admin.from("crm_audit_log").insert({organization_id: organizationId, actor_id: actorId, entity_type:"historical_client", entity_id:client.id, action:"historical_client_created", details:{batchId, noSaleCreated:true, noCommissionCreated:true}});
  return {status:"imported" as const, clientId:client.id};
}

export async function createHistoricalClientAction(formData: FormData) {
  const {admin,user,membership,leader,organizationWide,visibleOwnerIds}=await getCustomerServiceContext();
  const row: ImportRow = Object.fromEntries(formData.entries()) as ImportRow;
  let ownerId=clean(formData.get("follow_up_owner_id"),80); if(!leader) ownerId=user.id;
  if(ownerId&&!organizationWide&&!visibleOwnerIds.includes(ownerId)) go("Responsable de suivi hors de votre périmètre.","error");
  const result=await insertHistoricalClient({row,organizationId:membership.organization_id,actorId:user.id,defaultOwnerId:ownerId,batchId:null,admin});
  if(result.status!=="imported") go(result.status==="duplicate"?`Client déjà présent : ${result.reason}`:`Impossible d'intégrer le client : ${result.reason}`,"error");
  refresh(); go("Ancien client intégré au portefeuille, sans vente ni commission rétroactive.");
}

export async function importHistoricalClientsAction(formData: FormData) {
  const {admin,user,membership,leader,organizationWide,visibleOwnerIds}=await getCustomerServiceContext();
  if(!leader) go("Seul un responsable peut lancer un import en masse.","error");
  let rows: ImportRow[]=[]; try { rows=JSON.parse(String(formData.get("rows")??"[]")); } catch { go("Le fichier importé est illisible.","error"); }
  if(!Array.isArray(rows)||rows.length<1||rows.length>1000) go("L'import doit contenir entre 1 et 1 000 lignes.","error");
  const ownerId=clean(formData.get("follow_up_owner_id"),80); if(!(await activeMember(admin,membership.organization_id,ownerId))||Boolean(ownerId&&!organizationWide&&!visibleOwnerIds.includes(ownerId))) go("Responsable de suivi invalide ou hors de votre équipe.","error");
  const {data:batch,error}=await admin.from("crm_historical_client_import_batches").insert({organization_id:membership.organization_id,file_name:clean(formData.get("fileName"),240)||"import",total_rows:rows.length,created_by:user.id}).select("id").single<{id:string}>();
  if(error||!batch) go(error?.message??"Impossible de démarrer l'import.","error");
  let imported=0,duplicates=0,rejected=0; const issues:Record<string,unknown>[]=[];
  for(let index=0;index<rows.length;index++){
    const result=await insertHistoricalClient({row:rows[index],organizationId:membership.organization_id,actorId:user.id,defaultOwnerId:ownerId,batchId:batch.id,admin});
    if(result.status==="imported") imported++; else { if(result.status==="duplicate") duplicates++; else rejected++; if(issues.length<100) issues.push({line:index+2,status:result.status,reason:result.reason}); }
  }
  await admin.from("crm_historical_client_import_batches").update({imported_rows:imported,duplicate_rows:duplicates,rejected_rows:rejected,issues,completed_at:new Date().toISOString()}).eq("id",batch.id);
  await admin.from("crm_audit_log").insert({organization_id:membership.organization_id,actor_id:user.id,entity_type:"historical_client_import",entity_id:batch.id,action:"historical_clients_imported",details:{imported,duplicates,rejected}});
  refresh(); go(`Import terminé : ${imported} intégré(s), ${duplicates} doublon(s), ${rejected} rejeté(s).`);
}
