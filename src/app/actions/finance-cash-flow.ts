"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const clean=(value:FormDataEntryValue|null,max=500)=>String(value??"").trim().slice(0,max);
const amount=(value:FormDataEntryValue|null)=>Math.round((Number(clean(value).replace(",","."))||0)*100)/100;
const integer=(value:FormDataEntryValue|null)=>Math.round(Number(clean(value))||0);
const go=(message:string,kind:"success"|"error"="success"):never=>redirect(`/dashboard/finance/cash-flow?${kind}=${encodeURIComponent(message)}`);

async function context(){
  const supabase=await createClient();
  const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)redirect("/login");
  const admin=createAdminClient();
  const {data:member}=await admin.from("organization_members").select("organization_id,role").eq("user_id",auth.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if(!member||!["owner","admin"].includes(member.role))redirect("/dashboard?error=access-denied");
  return {admin,user:auth.user,member};
}

async function audit(c:Awaited<ReturnType<typeof context>>,action:string,details:Record<string,unknown>,adjustmentId:string|null=null){
  await c.admin.from("finance_cash_flow_audit_log").insert({organization_id:c.member.organization_id,actor_id:c.user.id,adjustment_id:adjustmentId,action,details});
}

export async function saveCashFlowSettingsAction(formData:FormData){
  const c=await context();
  const currency=clean(formData.get("currency"),3).toUpperCase();
  const asOfDate=clean(formData.get("asOfDate"),10);
  const openingBalance=amount(formData.get("openingBalance"));
  const minimumBalance=amount(formData.get("minimumBalance"));
  const receiptConfidence=integer(formData.get("receiptConfidence"));
  const expenseContingency=integer(formData.get("expenseContingency"));
  const horizonMonths=integer(formData.get("horizonMonths"));
  if(!/^[A-Z]{3}$/.test(currency)||!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)||minimumBalance<0||receiptConfidence<0||receiptConfidence>100||expenseContingency<100||expenseContingency>200||horizonMonths<3||horizonMonths>18)go("Paramètres de trésorerie invalides.","error");
  const {error}=await c.admin.from("finance_cash_flow_settings").upsert({organization_id:c.member.organization_id,currency,as_of_date:asOfDate,opening_balance:openingBalance,minimum_balance:minimumBalance,receipt_confidence_pct:receiptConfidence,expense_contingency_pct:expenseContingency,horizon_months:horizonMonths,updated_by:c.user.id,updated_at:new Date().toISOString()},{onConflict:"organization_id,currency"});
  if(error)go(error.message,"error");
  await audit(c,"settings_updated",{currency,asOfDate,openingBalance,minimumBalance,receiptConfidence,expenseContingency,horizonMonths});
  revalidatePath("/dashboard/finance/cash-flow");
  go("Hypothèses de trésorerie enregistrées.");
}

export async function addCashFlowAdjustmentAction(formData:FormData){
  const c=await context();
  const currency=clean(formData.get("currency"),3).toUpperCase();
  const direction=clean(formData.get("direction"),10);
  const title=clean(formData.get("title"),220);
  const category=clean(formData.get("category"),100)||"other";
  const expectedDate=clean(formData.get("expectedDate"),10);
  const value=amount(formData.get("amount"));
  const probability=integer(formData.get("probability"));
  const notes=clean(formData.get("notes"),1500)||null;
  if(!/^[A-Z]{3}$/.test(currency)||!["income","expense"].includes(direction)||title.length<2||!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)||value<=0||probability<0||probability>100)go("Flux prévisionnel invalide.","error");
  const {data,error}=await c.admin.from("finance_cash_flow_adjustments").insert({organization_id:c.member.organization_id,currency,direction,title,category,expected_date:expectedDate,amount:value,probability_pct:probability,notes,created_by:c.user.id}).select("id").single<{id:string}>();
  const adjustmentId=data?.id??"";
  if(error||!adjustmentId)go(error?.message??"Ajout impossible.","error");
  await audit(c,"adjustment_created",{currency,direction,title,expectedDate,amount:value,probability},adjustmentId);
  revalidatePath("/dashboard/finance/cash-flow");
  go("Flux prévisionnel ajouté.");
}

export async function changeCashFlowAdjustmentStatusAction(formData:FormData){
  const c=await context();
  const id=clean(formData.get("id"),80);
  const status=clean(formData.get("status"),20);
  if(!id||!["planned","confirmed","cancelled"].includes(status))go("Décision invalide.","error");
  const {error}=await c.admin.from("finance_cash_flow_adjustments").update({status,updated_at:new Date().toISOString()}).eq("id",id).eq("organization_id",c.member.organization_id);
  if(error)go(error.message,"error");
  await audit(c,"adjustment_status_changed",{status},id);
  revalidatePath("/dashboard/finance/cash-flow");
  go("Statut du flux mis à jour.");
}
