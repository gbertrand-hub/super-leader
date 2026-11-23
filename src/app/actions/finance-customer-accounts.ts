"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const clean=(value:FormDataEntryValue|null,max=120)=>String(value??"").trim().slice(0,max);
function go(message:string,kind:"success"|"error"="success"):never{redirect(`/dashboard/finance/customer-accounts?${kind}=${encodeURIComponent(message)}`)}

async function context(){
  const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
  const admin=createAdminClient(),{data:member}=await admin.from("organization_members").select("organization_id,role").eq("user_id",data.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if(!member||!["owner","admin"].includes(member.role))redirect("/dashboard?error=access-denied");
  return{admin,user:data.user,member};
}

export async function linkFinanceDocumentToSaleAction(formData:FormData){
  const c=await context(),documentId=clean(formData.get("documentId")),saleId=clean(formData.get("saleId"));
  if(!documentId||!saleId)go("Sélectionnez un document et une vente.","error");
  const[{data:document},{data:sale}]=await Promise.all([
    c.admin.from("finance_documents").select("id,sale_id,document_number,document_type,currency").eq("id",documentId).eq("organization_id",c.member.organization_id).maybeSingle<{id:string;sale_id:string|null;document_number:string;document_type:string;currency:string}>(),
    c.admin.from("sales_records").select("id,customer_name,product_name,currency").eq("id",saleId).eq("organization_id",c.member.organization_id).maybeSingle<{id:string;customer_name:string;product_name:string;currency:string}>(),
  ]);
  if(!document||!sale)go("Document ou vente introuvable.","error");
  if(!["proforma","invoice","receipt","credit_note"].includes(document.document_type))go("Ce type de document ne peut pas être rapproché d’une vente.","error");
  if(document.currency!==sale.currency)go(`Devise incompatible : ${document.currency} / ${sale.currency}.`,"error");
  const previousSaleId=document.sale_id;
  const{error}=await c.admin.from("finance_documents").update({sale_id:sale.id}).eq("id",document.id).eq("organization_id",c.member.organization_id);
  if(error)go(`Rapprochement impossible : ${error.message}`,"error");
  await c.admin.from("finance_reconciliation_audit_log").insert({organization_id:c.member.organization_id,document_id:document.id,sale_id:sale.id,previous_sale_id:previousSaleId,actor_id:c.user.id,action:previousSaleId&&previousSaleId!==sale.id?"relinked":"linked",details:{document_number:document.document_number,customer_name:sale.customer_name,product_name:sale.product_name}});
  revalidatePath("/dashboard/finance/customer-accounts");go("Document rapproché de la vente.");
}

export async function unlinkFinanceDocumentFromSaleAction(formData:FormData){
  const c=await context(),documentId=clean(formData.get("documentId"));if(!documentId)go("Document invalide.","error");
  const{data:document}=await c.admin.from("finance_documents").select("id,sale_id,document_number").eq("id",documentId).eq("organization_id",c.member.organization_id).maybeSingle<{id:string;sale_id:string|null;document_number:string}>();
  if(!document?.sale_id)go("Ce document n’est pas rapproché.","error");
  const{error}=await c.admin.from("finance_documents").update({sale_id:null}).eq("id",document.id).eq("organization_id",c.member.organization_id);
  if(error)go(`Dissociation impossible : ${error.message}`,"error");
  await c.admin.from("finance_reconciliation_audit_log").insert({organization_id:c.member.organization_id,document_id:document.id,previous_sale_id:document.sale_id,actor_id:c.user.id,action:"unlinked",details:{document_number:document.document_number}});
  revalidatePath("/dashboard/finance/customer-accounts");go("Document dissocié de la vente.");
}
