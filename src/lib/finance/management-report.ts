import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";

export type FinancialReportFilters={from:string;to:string;currency:string};
export type FinancialBreakdown={label:string;amount:number};
export type FinancialMonth={month:string;incoming:number;expenses:number;payroll:number;commissions:number;outgoing:number;net:number};
export type FinancialManagementReport={filters:FinancialReportFilters;incoming:number;outgoing:number;net:number;margin:number;salesIncoming:number;serviceIncoming:number;expensesPaid:number;payrollPaid:number;commissionsPaid:number;receivables:number;approvedExpenses:number;pendingReconciliations:number;incomingCount:number;expenseCount:number;months:FinancialMonth[];products:FinancialBreakdown[];expenseCategories:FinancialBreakdown[]};
const n=(value:unknown)=>Number(value)||0;
const add=(map:Map<string,number>,key:string,value:number)=>map.set(key,(map.get(key)??0)+value);
const rows=<T>(result:{data:T[]|null;error:unknown})=>result.error?[]:(result.data??[]);
const monthKey=(date:string)=>date.slice(0,7);
export function canViewFinancialReports(role:string){return ["owner","admin","executive"].includes(role);}

export async function loadFinancialManagementReport(admin:SupabaseClient,organizationId:string,filters:FinancialReportFilters):Promise<FinancialManagementReport>{
  const {from,to,currency}=filters;
  const [salesPaymentsResult,servicePaymentsResult,expensesResult,periodsResult,commissionsResult,receivablesResult,approvedExpensesResult,pendingSalesResult,pendingServiceResult]=await Promise.all([
    admin.from("sales_payments").select("id,sale_id,payment_date,amount,transaction_reference").eq("organization_id",organizationId).eq("currency",currency).eq("status","confirmed").gte("payment_date",from).lte("payment_date",to),
    admin.from("customer_service_installment_payments").select("id,received_on,amount_received,transaction_reference").eq("organization_id",organizationId).eq("currency",currency).eq("finance_status","validated").gte("received_on",from).lte("received_on",to),
    admin.from("finance_expenses").select("id,paid_on,total_amount,category").eq("organization_id",organizationId).eq("currency",currency).eq("status","paid").gte("paid_on",from).lte("paid_on",to),
    admin.from("payroll_periods").select("id,pay_date").eq("organization_id",organizationId).eq("currency",currency).eq("status","paid").gte("pay_date",from).lte("pay_date",to),
    admin.from("sales_records").select("id,commission_amount,commission_paid_at").eq("organization_id",organizationId).eq("currency",currency).eq("commission_status","paid").gte("commission_paid_at",`${from}T00:00:00`).lte("commission_paid_at",`${to}T23:59:59.999`),
    admin.from("sales_records").select("balance_amount").eq("organization_id",organizationId).eq("currency",currency).gt("balance_amount",0).not("workflow_status","in","(rejected,cancelled,refunded)"),
    admin.from("finance_expenses").select("total_amount").eq("organization_id",organizationId).eq("currency",currency).eq("status","approved"),
    admin.from("sales_payments").select("id",{count:"exact"}).eq("organization_id",organizationId).eq("currency",currency).eq("status","pending"),
    admin.from("customer_service_installment_payments").select("id",{count:"exact"}).eq("organization_id",organizationId).eq("currency",currency).eq("finance_status","pending"),
  ]);
  const salesPayments=rows(salesPaymentsResult) as Array<{id:string;sale_id:string;payment_date:string;amount:number|string;transaction_reference:string|null}>;
  const confirmedReferences=new Set(salesPayments.map(x=>x.transaction_reference?.trim().toLowerCase()).filter(Boolean));
  const servicePayments=(rows(servicePaymentsResult) as Array<{id:string;received_on:string;amount_received:number|string;transaction_reference:string|null}>).filter(x=>!x.transaction_reference||!confirmedReferences.has(x.transaction_reference.trim().toLowerCase()));
  const expenses=rows(expensesResult) as Array<{id:string;paid_on:string;total_amount:number|string;category:string}>;
  const periods=rows(periodsResult) as Array<{id:string;pay_date:string}>;
  const commissions=rows(commissionsResult) as Array<{id:string;commission_amount:number|string;commission_paid_at:string}>;
  const periodIds=periods.map(x=>x.id),saleIds=[...new Set(salesPayments.map(x=>x.sale_id))];
  const [payrollResult,salesResult]=await Promise.all([
    periodIds.length?admin.from("payroll_entries").select("payroll_period_id,net_amount,status").eq("organization_id",organizationId).in("payroll_period_id",periodIds).not("status","in","(draft,cancelled)"):Promise.resolve({data:[],error:null}),
    saleIds.length?admin.from("sales_records").select("id,product_name").eq("organization_id",organizationId).in("id",saleIds):Promise.resolve({data:[],error:null}),
  ]);
  const payroll=rows(payrollResult) as Array<{payroll_period_id:string;net_amount:number|string;status:string}>;
  const sales=rows(salesResult) as Array<{id:string;product_name:string}>;
  const saleNames=new Map(sales.map(x=>[x.id,x.product_name||"Produit non renseigné"])),periodDates=new Map(periods.map(x=>[x.id,x.pay_date]));
  const productMap=new Map<string,number>(),categoryMap=new Map<string,number>(),monthly=new Map<string,FinancialMonth>();
  const ensure=(date:string)=>{const key=monthKey(date);if(!monthly.has(key))monthly.set(key,{month:key,incoming:0,expenses:0,payroll:0,commissions:0,outgoing:0,net:0});return monthly.get(key)!;};
  for(const x of salesPayments){const amount=n(x.amount);ensure(x.payment_date).incoming+=amount;add(productMap,saleNames.get(x.sale_id)??"Produit non renseigné",amount);}
  for(const x of servicePayments){const amount=n(x.amount_received);ensure(x.received_on).incoming+=amount;add(productMap,"Mensualités suivies par le service client",amount);}
  for(const x of expenses){const amount=n(x.total_amount);ensure(x.paid_on).expenses+=amount;add(categoryMap,x.category||"other",amount);}
  for(const x of payroll){const date=periodDates.get(x.payroll_period_id);if(date)ensure(date).payroll+=n(x.net_amount);}
  for(const x of commissions){ensure(x.commission_paid_at).commissions+=n(x.commission_amount);}
  for(const x of monthly.values()){x.outgoing=x.expenses+x.payroll+x.commissions;x.net=x.incoming-x.outgoing;}
  const salesIncoming=salesPayments.reduce((s,x)=>s+n(x.amount),0),serviceIncoming=servicePayments.reduce((s,x)=>s+n(x.amount_received),0),expensesPaid=expenses.reduce((s,x)=>s+n(x.total_amount),0),payrollPaid=payroll.reduce((s,x)=>s+n(x.net_amount),0),commissionsPaid=commissions.reduce((s,x)=>s+n(x.commission_amount),0),incoming=salesIncoming+serviceIncoming,outgoing=expensesPaid+payrollPaid+commissionsPaid;
  return {filters,incoming,outgoing,net:incoming-outgoing,margin:incoming?((incoming-outgoing)/incoming)*100:0,salesIncoming,serviceIncoming,expensesPaid,payrollPaid,commissionsPaid,receivables:rows(receivablesResult).reduce((s,x)=>s+n((x as {balance_amount:unknown}).balance_amount),0),approvedExpenses:rows(approvedExpensesResult).reduce((s,x)=>s+n((x as {total_amount:unknown}).total_amount),0),pendingReconciliations:(pendingSalesResult.count??0)+(pendingServiceResult.count??0),incomingCount:salesPayments.length+servicePayments.length,expenseCount:expenses.length,months:[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)),products:[...productMap].map(([label,amount])=>({label,amount})).sort((a,b)=>b.amount-a.amount),expenseCategories:[...categoryMap].map(([label,amount])=>({label,amount})).sort((a,b)=>b.amount-a.amount)};
}
