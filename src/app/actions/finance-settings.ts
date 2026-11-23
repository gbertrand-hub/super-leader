"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const PAYMENT_METHODS=new Set(["bank_transfer","card","cash","mobile_money","check","online"]);
const clean=(value:FormDataEntryValue|null,max=160)=>String(value??"").trim().slice(0,max);
const go=(message:string,kind:"success"|"error"="success"):never=>redirect(`/dashboard/finance/settings?${kind}=${encodeURIComponent(message)}`);

function numberValue(formData:FormData,key:string,min:number,max:number,fallback=min){
  const raw=clean(formData.get(key),30).replace(",",".");
  const parsed=raw===""?fallback:Number(raw);
  return Number.isFinite(parsed)?Math.min(max,Math.max(min,parsed)):fallback;
}

function prefix(value:FormDataEntryValue|null,fallback:string){
  const result=clean(value,10).toUpperCase().replace(/[^A-Z0-9_-]/g,"");
  return result||fallback;
}

async function ctx(){
  const supabase=await createClient();
  const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)redirect("/login");
  const admin=createAdminClient();
  const {data:membership}=await admin.from("organization_members").select("organization_id,role").eq("user_id",auth.user.id).eq("is_active",true).limit(1).maybeSingle<{organization_id:string;role:string}>();
  if(!membership||!["owner","admin"].includes(membership.role))redirect("/dashboard?error=access-denied");
  return {admin,user:auth.user,membership};
}

async function audit(context:Awaited<ReturnType<typeof ctx>>,action:string,details:Record<string,unknown>){
  await context.admin.from("finance_settings_audit_log").insert({organization_id:context.membership.organization_id,actor_id:context.user.id,action,details});
}

export async function saveFinanceSettingsAction(formData:FormData){
  const context=await ctx();
  const baseCurrency=clean(formData.get("baseCurrency"),3).toUpperCase();
  const allowedCurrencies=clean(formData.get("allowedCurrencies"),100).toUpperCase().split(/[ ,;]+/).filter(value=>/^[A-Z]{3}$/.test(value));
  const allowedPaymentMethods=[...new Set(formData.getAll("allowedPaymentMethods").map(value=>clean(value,30)).filter(value=>PAYMENT_METHODS.has(value)))];
  const financeEmail=clean(formData.get("financeEmail"),320).toLowerCase();
  const reminderDaysAfter=[...new Set(clean(formData.get("reminderDaysAfter"),120).split(/[ ,;]+/).map(Number).filter(value=>Number.isInteger(value)&&value>=1&&value<=365))].sort((a,b)=>a-b);
  const customerAccountAccessMode=clean(formData.get("customerAccountAccessMode"),30)==="selected_users"?"selected_users":"finance_team";
  const customerAccountUserIds=[...new Set(formData.getAll("customerAccountUserIds").map(value=>clean(value,80)).filter(value=>/^[0-9a-f-]{36}$/i.test(value)))];

  if(!/^[A-Z]{3}$/.test(baseCurrency))go("Devise principale invalide.","error");
  if(financeEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(financeEmail))go("Adresse e-mail Finance invalide.","error");
  if(!allowedPaymentMethods.length)go("Sélectionnez au moins un moyen de paiement.","error");

  const values={
    organization_id:context.membership.organization_id,
    legal_name:clean(formData.get("legalName"),240)||null,
    registration_number:clean(formData.get("registrationNumber"),120)||null,
    tax_identifier:clean(formData.get("taxIdentifier"),120)||null,
    billing_address:clean(formData.get("billingAddress"),1200)||null,
    finance_email:financeEmail||null,
    finance_phone:clean(formData.get("financePhone"),80)||null,
    base_currency:baseCurrency,
    allowed_currencies:[...new Set([baseCurrency,...allowedCurrencies])],
    fiscal_year_start_month:numberValue(formData,"fiscalMonth",1,12,1),
    payment_terms_days:numberValue(formData,"paymentTerms",0,365,30),
    default_tax_label:clean(formData.get("defaultTaxLabel"),80)||"Taxes",
    default_tax_rate:numberValue(formData,"defaultTaxRate",0,100,0),
    default_payment_terms:clean(formData.get("defaultPaymentTerms"),1500)||null,
    default_payment_instructions:clean(formData.get("defaultPaymentInstructions"),2500)||null,
    document_footer:clean(formData.get("documentFooter"),1000)||null,
    allowed_payment_methods:allowedPaymentMethods,
    reconciliation_warning_days:numberValue(formData,"reconciliationDays",1,90,3),
    receivable_warning_days:numberValue(formData,"receivableDays",1,365,30),
    expense_owner_threshold:numberValue(formData,"ownerThreshold",0,999999999,5000),
    negative_cash_flow_alert:formData.get("negativeAlert")==="on",
    reminders_enabled:formData.get("remindersEnabled")==="on",
    reminder_days_before_due:numberValue(formData,"reminderDaysBefore",0,90,3),
    reminder_days_after_due:reminderDaysAfter.length?reminderDaysAfter:[1,7,15,30],
    email_reminders_enabled:formData.get("emailReminders")==="on",
    in_app_reminders_enabled:formData.get("inAppReminders")==="on",
    invoice_prefix:prefix(formData.get("invoicePrefix"),"FAC"),
    receipt_prefix:prefix(formData.get("receiptPrefix"),"REC"),
    expense_prefix:prefix(formData.get("expensePrefix"),"DEP"),
    proforma_prefix:prefix(formData.get("proformaPrefix"),"PRO"),
    credit_note_prefix:prefix(formData.get("creditNotePrefix"),"AVO"),
    controller_user_id:clean(formData.get("controller"),80)||null,
    approver_user_id:clean(formData.get("approver"),80)||null,
    payer_user_id:clean(formData.get("payer"),80)||null,
    customer_account_access_mode:customerAccountAccessMode,
    customer_account_user_ids:customerAccountAccessMode==="selected_users"?customerAccountUserIds:[],
    updated_by:context.user.id,
    updated_at:new Date().toISOString(),
  };

  const {error}=await context.admin.from("finance_settings").upsert(values,{onConflict:"organization_id"});
  if(error)go(error.message,"error");
  await audit(context,"settings_updated",{baseCurrency,allowedCurrencies:values.allowed_currencies,allowedPaymentMethods,remindersEnabled:values.reminders_enabled,customerAccountAccessMode,customerAccountUserIds:values.customer_account_user_ids});
  revalidatePath("/dashboard/finance/settings");
  revalidatePath("/dashboard/finance/documents");
  revalidatePath("/dashboard/finance/customer-accounts");
  revalidatePath("/dashboard","layout");
  go("Paramètres financiers enregistrés.");
}

export async function addFinanceBankAccountAction(formData:FormData){
  const context=await ctx();
  const bankName=clean(formData.get("bankName"));
  const accountName=clean(formData.get("accountName"));
  const currency=clean(formData.get("currency"),3).toUpperCase();
  const last4=clean(formData.get("last4"),4);
  if(!bankName||!accountName||!/^[A-Z]{3}$/.test(currency)||!/^[0-9]{4}$/.test(last4))go("Compte bancaire incomplet.","error");
  if(formData.get("primary")==="on")await context.admin.from("finance_bank_accounts").update({is_primary:false}).eq("organization_id",context.membership.organization_id);
  const {error}=await context.admin.from("finance_bank_accounts").insert({organization_id:context.membership.organization_id,bank_name:bankName,account_name:accountName,currency,account_last4:last4,is_primary:formData.get("primary")==="on",created_by:context.user.id});
  if(error)go(error.message,"error");
  await audit(context,"bank_account_added",{bank:bankName,currency,last4});
  revalidatePath("/dashboard/finance/settings");
  go("Compte bancaire ajouté.");
}

export async function addFinanceCostCenterAction(formData:FormData){
  const context=await ctx();
  const code=clean(formData.get("code"),30).toUpperCase();
  const name=clean(formData.get("name"));
  if(!code||!name)go("Centre de coût incomplet.","error");
  const {error}=await context.admin.from("finance_cost_centers").insert({organization_id:context.membership.organization_id,code,name,created_by:context.user.id});
  if(error)go(error.message,"error");
  await audit(context,"cost_center_added",{code,name});
  revalidatePath("/dashboard/finance/settings");
  go("Centre de coût ajouté.");
}

export async function toggleFinanceReferenceAction(formData:FormData){
  const context=await ctx();
  const kind=clean(formData.get("kind"),20);
  const id=clean(formData.get("id"),80);
  const active=clean(formData.get("active"))==="true";
  const table=kind==="bank"?"finance_bank_accounts":kind==="cost"?"finance_cost_centers":"";
  if(!table)go("Action invalide.","error");
  const {error}=await context.admin.from(table).update({is_active:active}).eq("id",id).eq("organization_id",context.membership.organization_id);
  if(error)go(error.message,"error");
  await audit(context,"reference_toggled",{kind,id,active});
  revalidatePath("/dashboard/finance/settings");
  go("Statut mis à jour.");
}
