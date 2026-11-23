import type{SupabaseClient}from"@supabase/supabase-js";

const n=(value:unknown)=>Number(value)||0;
const rows=<T>(result:{data:T[]|null;error:unknown})=>result.error?[]:result.data??[];
export type AccountStatus="matched"|"missing_invoice"|"payment_mismatch"|"document_mismatch"|"receipt_due"|"pending_review";
export type CustomerAccount={saleId:string;customer:string;product:string;currency:string;saleTotal:number;salePaid:number;confirmedPaid:number;pendingPaid:number;saleBalance:number;invoiceTotal:number;invoicePaid:number;invoiceBalance:number;documents:Array<{id:string;number:string;type:string;status:string;total:number;paid:number}>;status:AccountStatus;issues:string[]};

export type CustomerAccountDetail={
  sale:Record<string,unknown>;
  crmClient:Record<string,unknown>|null;
  payments:Array<Record<string,unknown>>;
  schedules:Array<Record<string,unknown>>;
  documents:Array<Record<string,unknown>>;
  followUps:Array<Record<string,unknown>>;
  salesAudit:Array<Record<string,unknown>>;
  reconciliationAudit:Array<Record<string,unknown>>;
  profileNames:Record<string,string>;
};

export async function loadCustomerAccounts(admin:SupabaseClient,organizationId:string){
  const[salesResult,documentsResult,paymentsResult]=await Promise.all([
    admin.from("sales_records").select("id,customer_name,product_name,currency,total_amount,paid_amount,balance_amount,workflow_status,sale_date").eq("organization_id",organizationId).not("workflow_status","in","(rejected,cancelled,refunded)").order("sale_date",{ascending:false}).limit(500),
    admin.from("finance_documents").select("id,sale_id,document_number,document_type,status,currency,total_amount,paid_amount,balance_amount").eq("organization_id",organizationId).in("document_type",["proforma","invoice","receipt","credit_note"]).limit(1000),
    admin.from("sales_payments").select("sale_id,amount,status,currency").eq("organization_id",organizationId).limit(2000),
  ]);
  if(salesResult.error)throw new Error(salesResult.error.message);
  if(documentsResult.error)throw new Error(documentsResult.error.message);
  if(paymentsResult.error)throw new Error(paymentsResult.error.message);
  const sales=rows(salesResult)as Array<Record<string,unknown>>,documents=rows(documentsResult)as Array<Record<string,unknown>>,payments=rows(paymentsResult)as Array<Record<string,unknown>>;
  const docsBySale=new Map<string,Array<Record<string,unknown>>>(),paymentsBySale=new Map<string,Array<Record<string,unknown>>>();
  documents.forEach(doc=>{if(doc.sale_id){const id=String(doc.sale_id);docsBySale.set(id,[...(docsBySale.get(id)??[]),doc])}});
  payments.forEach(payment=>{const id=String(payment.sale_id);paymentsBySale.set(id,[...(paymentsBySale.get(id)??[]),payment])});
  const accounts:CustomerAccount[]=sales.map(sale=>{
    const saleId=String(sale.id),docs=docsBySale.get(saleId)??[],salePayments=paymentsBySale.get(saleId)??[],invoices=docs.filter(doc=>doc.document_type==="invoice"&&!['cancelled','archived'].includes(String(doc.status))),receipts=docs.filter(doc=>doc.document_type==="receipt"&&!['cancelled','archived'].includes(String(doc.status)));
    const confirmedPaid=salePayments.filter(x=>x.status==="confirmed").reduce((sum,x)=>sum+n(x.amount),0),pendingPaid=salePayments.filter(x=>x.status==="pending").reduce((sum,x)=>sum+n(x.amount),0),invoiceTotal=invoices.reduce((sum,x)=>sum+n(x.total_amount),0),invoicePaid=invoices.reduce((sum,x)=>sum+n(x.paid_amount),0),invoiceBalance=invoices.reduce((sum,x)=>sum+n(x.balance_amount),0),saleTotal=n(sale.total_amount),salePaid=n(sale.paid_amount),saleBalance=n(sale.balance_amount),issues:string[]=[];
    if(!invoices.length)issues.push("Aucune facture liée");
    if(Math.abs(salePaid-confirmedPaid)>.009)issues.push("Paiements confirmés différents du total payé de la vente");
    if(invoices.length&&Math.abs(invoiceTotal-saleTotal)>.009)issues.push("Montant facturé différent du montant vendu");
    if(invoices.length&&Math.abs(invoicePaid-confirmedPaid)>.009)issues.push("Encaissement de la facture non aligné sur les paiements confirmés");
    if(saleBalance<=0&&invoices.length&&!receipts.length)issues.push("Reçu à générer");
    if(pendingPaid>0)issues.push("Paiement en attente de contrôle bancaire");
    let status:AccountStatus="matched";
    if(!invoices.length)status="missing_invoice";else if(Math.abs(salePaid-confirmedPaid)>.009)status="payment_mismatch";else if(Math.abs(invoiceTotal-saleTotal)>.009||Math.abs(invoicePaid-confirmedPaid)>.009)status="document_mismatch";else if(saleBalance<=0&&!receipts.length)status="receipt_due";else if(pendingPaid>0)status="pending_review";
    return{saleId,customer:String(sale.customer_name||"Client"),product:String(sale.product_name||"Produit"),currency:String(sale.currency||"USD"),saleTotal,salePaid,confirmedPaid,pendingPaid,saleBalance,invoiceTotal,invoicePaid,invoiceBalance,documents:docs.map(doc=>({id:String(doc.id),number:String(doc.document_number),type:String(doc.document_type),status:String(doc.status),total:n(doc.total_amount),paid:n(doc.paid_amount)})),status,issues};
  });
  return{accounts,unlinkedDocuments:documents.filter(doc=>!doc.sale_id).map(doc=>({id:String(doc.id),number:String(doc.document_number),type:String(doc.document_type),status:String(doc.status),currency:String(doc.currency),total:n(doc.total_amount)}))};
}

export async function loadCustomerAccountDetail(admin:SupabaseClient,organizationId:string,saleId:string):Promise<CustomerAccountDetail|null>{
  const{data:sale,error:saleError}=await admin.from("sales_records").select("id,seller_id,crm_client_id,customer_name,customer_email,customer_phone,product_name,sale_date,total_amount,currency,workflow_status,payment_status,payment_plan_type,initial_payment_type,initial_payment_value,first_payment_amount,first_payment_received_at,paid_amount,balance_amount,commission_status,collection_owner_id,collection_status,next_payment_due_date,next_payment_amount,collection_notes,collection_promise_date,collection_next_action_at,collection_last_contact_at,created_at,updated_at").eq("organization_id",organizationId).eq("id",saleId).maybeSingle();
  if(saleError)throw new Error(saleError.message);
  if(!sale)return null;

  const[crmClientResult,paymentsResult,schedulesResult,documentsResult,followUpsResult,salesAuditResult,reconciliationResult]=await Promise.all([
    sale.crm_client_id?admin.from("crm_clients").select("id,full_name,email,phone,whatsapp_phone").eq("organization_id",organizationId).eq("id",String(sale.crm_client_id)).maybeSingle():Promise.resolve({data:null,error:null}),
    admin.from("sales_payments").select("id,sale_id,schedule_item_id,payment_date,amount,currency,payment_method,transaction_reference,proof_storage_path,proof_file_name,status,is_initial_payment,recorded_by,notes,bank_posted_on,bank_reference,reconciliation_note,created_at").eq("organization_id",organizationId).eq("sale_id",saleId).order("payment_date",{ascending:false}).order("created_at",{ascending:false}),
    admin.from("sales_payment_schedule").select("id,sale_id,sequence_number,due_date,expected_amount,paid_amount,status,notes,created_by,created_at").eq("organization_id",organizationId).eq("sale_id",saleId).order("due_date",{ascending:true}),
    admin.from("finance_documents").select("id,sale_id,document_number,document_type,title,status,issue_date,due_date,currency,total_amount,paid_amount,balance_amount,notes,file_name,storage_path,created_by,approved_by,created_at,published_at").eq("organization_id",organizationId).eq("sale_id",saleId).order("issue_date",{ascending:false}),
    admin.from("sales_collection_follow_ups").select("id,sale_id,agent_id,channel,outcome,note,promised_date,next_action_at,created_at").eq("organization_id",organizationId).eq("sale_id",saleId).order("created_at",{ascending:false}),
    admin.from("sales_audit_log").select("id,sale_id,actor_id,action,old_status,new_status,note,created_at").eq("organization_id",organizationId).eq("sale_id",saleId).order("created_at",{ascending:false}),
    admin.from("finance_reconciliation_audit_log").select("id,document_id,sale_id,previous_sale_id,actor_id,action,details,created_at").eq("organization_id",organizationId).eq("sale_id",saleId).order("created_at",{ascending:false}),
  ]);
  const results=[crmClientResult,paymentsResult,schedulesResult,documentsResult,followUpsResult,salesAuditResult,reconciliationResult];
  const failed=results.find(result=>result.error);
  if(failed?.error)throw new Error(failed.error.message);

  const payments=(paymentsResult.data??[])as Array<Record<string,unknown>>;
  const schedules=(schedulesResult.data??[])as Array<Record<string,unknown>>;
  const documents=(documentsResult.data??[])as Array<Record<string,unknown>>;
  const followUps=(followUpsResult.data??[])as Array<Record<string,unknown>>;
  const salesAudit=(salesAuditResult.data??[])as Array<Record<string,unknown>>;
  const reconciliationAudit=(reconciliationResult.data??[])as Array<Record<string,unknown>>;
  const profileIds=[
    sale.seller_id,sale.collection_owner_id,
    ...payments.map(row=>row.recorded_by),
    ...schedules.map(row=>row.created_by),
    ...documents.flatMap(row=>[row.created_by,row.approved_by]),
    ...followUps.map(row=>row.agent_id),
    ...salesAudit.map(row=>row.actor_id),
    ...reconciliationAudit.map(row=>row.actor_id),
  ].filter((value):value is string=>typeof value==="string"&&Boolean(value));
  const uniqueProfileIds=[...new Set(profileIds)];
  const{data:profiles,error:profilesError}=uniqueProfileIds.length?await admin.from("profiles").select("id,full_name,email").in("id",uniqueProfileIds):{data:[],error:null};
  if(profilesError)throw new Error(profilesError.message);
  const profileNames=Object.fromEntries((profiles??[]).map(profile=>[String(profile.id),String(profile.full_name||profile.email||"Membre")]));
  return{sale:sale as Record<string,unknown>,crmClient:crmClientResult.data as Record<string,unknown>|null,payments,schedules,documents,followUps,salesAudit,reconciliationAudit,profileNames};
}
