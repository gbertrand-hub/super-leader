import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";

export type CashFlowMonth={
  key:string;
  label:string;
  committedIncome:number;
  manualIncome:number;
  budgetIncomeGap:number;
  committedExpenses:number;
  payroll:number;
  commissions:number;
  manualExpenses:number;
  budgetExpenseGap:number;
  inflow:number;
  outflow:number;
  net:number;
  closingBalance:number;
  belowMinimum:boolean;
};

export type CashFlowForecast={
  currency:string;
  asOfDate:string;
  openingBalance:number;
  minimumBalance:number;
  receiptConfidencePct:number;
  expenseContingencyPct:number;
  horizonMonths:number;
  months:CashFlowMonth[];
  totalInflow:number;
  totalOutflow:number;
  projectedClosingBalance:number;
  lowestBalance:number;
  firstRiskMonth:string|null;
  latestClosedBalance:{periodEnd:string;balance:number}|null;
  budget:{id:string;name:string;year:number}|null;
};

type Settings={as_of_date:string;opening_balance:number|string;minimum_balance:number|string;receipt_confidence_pct:number;expense_contingency_pct:number;horizon_months:number};
type Adjustment={direction:string;expected_date:string;amount:number|string;probability_pct:number;status:string};
type Budget={id:string;name:string;fiscal_year:number};
type BudgetLine={month:number;direction:string;forecast_amount:number|string;budget_amount:number|string};

const n=(value:unknown)=>Number(value)||0;
const round=(value:number)=>Math.round(value*100)/100;
const monthKey=(date:string)=>date.slice(0,7);
const dateForMonth=(date:Date)=>`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`;
const monthLabel=(key:string)=>new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${key}-01T00:00:00Z`));
const safeRows=<T>(result:{data:T[]|null;error:unknown})=>result.error?[]:(result.data??[]);

export async function loadCashFlowForecast(admin:SupabaseClient,organizationId:string,currency:string):Promise<CashFlowForecast>{
  const today=new Date().toISOString().slice(0,10);
  const {data:settingsData}=await admin.from("finance_cash_flow_settings").select("as_of_date,opening_balance,minimum_balance,receipt_confidence_pct,expense_contingency_pct,horizon_months").eq("organization_id",organizationId).eq("currency",currency).maybeSingle<Settings>();
  const settings=settingsData??{as_of_date:today,opening_balance:0,minimum_balance:0,receipt_confidence_pct:80,expense_contingency_pct:105,horizon_months:6};
  const asOfDate=settings.as_of_date||today;
  const horizonMonths=settings.horizon_months||6;
  const start=new Date(`${asOfDate.slice(0,7)}-01T00:00:00Z`);
  const endDate=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+horizonMonths,0));
  const end=endDate.toISOString().slice(0,10);
  const monthKeys=Array.from({length:horizonMonths},(_,index)=>dateForMonth(new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+index,1))));
  const currentKey=monthKeys[0];
  const buckets=new Map<string,CashFlowMonth>(monthKeys.map(key=>[key,{key,label:monthLabel(key),committedIncome:0,manualIncome:0,budgetIncomeGap:0,committedExpenses:0,payroll:0,commissions:0,manualExpenses:0,budgetExpenseGap:0,inflow:0,outflow:0,net:0,closingBalance:0,belowMinimum:false}]));
  const bucket=(date:string)=>buckets.get(monthKey(date)<currentKey?currentKey:monthKey(date));

  const [adjustmentResult,scheduleResult,expenseResult,payrollPeriodResult,commissionResult,closeResult,budgetResult]=await Promise.all([
    admin.from("finance_cash_flow_adjustments").select("direction,expected_date,amount,probability_pct,status").eq("organization_id",organizationId).eq("currency",currency).neq("status","cancelled").lte("expected_date",end),
    admin.from("sales_payment_schedule").select("sale_id,due_date,expected_amount,paid_amount,status").eq("organization_id",organizationId).in("status",["upcoming","partial","overdue","rescheduled"]).lte("due_date",end),
    admin.from("finance_expenses").select("expense_date,total_amount").eq("organization_id",organizationId).eq("currency",currency).eq("status","approved").lte("expense_date",end),
    admin.from("payroll_periods").select("id,pay_date").eq("organization_id",organizationId).eq("currency",currency).eq("status","approved").not("pay_date","is",null).lte("pay_date",end),
    admin.from("sales_records").select("commission_amount").eq("organization_id",organizationId).eq("currency",currency).in("commission_status",["validated","payable"]),
    admin.from("finance_close_periods").select("period_end,declared_closing_bank_balance,calculated_closing_balance").eq("organization_id",organizationId).eq("currency",currency).eq("status","closed").lte("period_end",asOfDate).order("period_end",{ascending:false}).limit(1).maybeSingle(),
    admin.from("finance_budgets").select("id,name,fiscal_year").eq("organization_id",organizationId).eq("currency",currency).in("status",["approved","locked"]).eq("fiscal_year",start.getUTCFullYear()).order("updated_at",{ascending:false}).limit(1).maybeSingle<Budget>(),
  ]);

  const schedules=safeRows(scheduleResult) as Array<{sale_id:string;due_date:string;expected_amount:number|string;paid_amount:number|string;status:string}>;
  const saleIds=[...new Set(schedules.map(item=>item.sale_id))];
  const {data:sales}=saleIds.length?await admin.from("sales_records").select("id,currency,workflow_status").eq("organization_id",organizationId).in("id",saleIds):{data:[]};
  const eligibleSales=new Set((sales??[]).filter(item=>item.currency===currency&&!['rejected','cancelled','refunded'].includes(item.workflow_status)).map(item=>item.id));
  for(const item of schedules){
    if(!eligibleSales.has(item.sale_id))continue;
    const target=bucket(item.due_date);if(target)target.committedIncome+=Math.max(0,n(item.expected_amount)-n(item.paid_amount));
  }
  for(const item of safeRows(expenseResult) as Array<{expense_date:string;total_amount:number|string}>){const target=bucket(item.expense_date);if(target)target.committedExpenses+=n(item.total_amount);}

  const payrollPeriods=safeRows(payrollPeriodResult) as Array<{id:string;pay_date:string}>;
  const periodDates=new Map(payrollPeriods.map(item=>[item.id,item.pay_date]));
  const periodIds=payrollPeriods.map(item=>item.id);
  const {data:payrollEntries}=periodIds.length?await admin.from("payroll_entries").select("payroll_period_id,net_amount,status").eq("organization_id",organizationId).in("payroll_period_id",periodIds).not("status","in","(draft,cancelled)"):{data:[]};
  for(const item of payrollEntries??[]){const date=periodDates.get(item.payroll_period_id);const target=date?bucket(date):undefined;if(target)target.payroll+=n(item.net_amount);}
  const commissionTotal=(safeRows(commissionResult) as Array<{commission_amount:number|string}>).reduce((sum,item)=>sum+n(item.commission_amount),0);
  const current=buckets.get(currentKey);if(current)current.commissions=commissionTotal;

  for(const item of safeRows(adjustmentResult) as Adjustment[]){
    const target=bucket(item.expected_date);if(!target)continue;
    const weighted=item.status==="confirmed"?n(item.amount):n(item.amount)*(item.probability_pct/100);
    if(item.direction==="income")target.manualIncome+=weighted;else target.manualExpenses+=weighted;
  }

  const selectedBudget=budgetResult.data??null;
  let budgetLines:BudgetLine[]=[];
  if(selectedBudget){const result=await admin.from("finance_budget_lines").select("month,direction,forecast_amount,budget_amount").eq("organization_id",organizationId).eq("budget_id",selectedBudget.id);budgetLines=safeRows(result) as BudgetLine[];}
  for(const line of budgetLines){
    const key=`${selectedBudget?.fiscal_year}-${String(line.month).padStart(2,"0")}`;
    const target=buckets.get(key);if(!target)continue;
    const planned=n(line.forecast_amount)||n(line.budget_amount);
    if(line.direction==="income")target.budgetIncomeGap+=planned;else target.budgetExpenseGap+=planned;
  }

  let running=n(settings.opening_balance);
  const receiptFactor=settings.receipt_confidence_pct/100,expenseFactor=settings.expense_contingency_pct/100;
  for(const item of buckets.values()){
    const knownIncome=item.committedIncome+item.manualIncome;
    const knownOutflow=item.committedExpenses+item.payroll+item.commissions+item.manualExpenses;
    item.budgetIncomeGap=Math.max(0,item.budgetIncomeGap-knownIncome);
    item.budgetExpenseGap=Math.max(0,item.budgetExpenseGap-knownOutflow);
    item.inflow=round((item.committedIncome+item.budgetIncomeGap)*receiptFactor+item.manualIncome);
    item.outflow=round((item.committedExpenses+item.payroll+item.commissions+item.budgetExpenseGap)*expenseFactor+item.manualExpenses);
    item.net=round(item.inflow-item.outflow);
    running=round(running+item.net);
    item.closingBalance=running;
    item.belowMinimum=running<n(settings.minimum_balance);
  }
  const months=[...buckets.values()];
  const close=closeResult.data as {period_end:string;declared_closing_bank_balance:number|string|null;calculated_closing_balance:number|string}|null;
  return {currency,asOfDate,openingBalance:n(settings.opening_balance),minimumBalance:n(settings.minimum_balance),receiptConfidencePct:settings.receipt_confidence_pct,expenseContingencyPct:settings.expense_contingency_pct,horizonMonths,months,totalInflow:round(months.reduce((sum,item)=>sum+item.inflow,0)),totalOutflow:round(months.reduce((sum,item)=>sum+item.outflow,0)),projectedClosingBalance:running,lowestBalance:months.length?Math.min(...months.map(item=>item.closingBalance)):running,firstRiskMonth:months.find(item=>item.belowMinimum)?.label??null,latestClosedBalance:close?{periodEnd:close.period_end,balance:n(close.declared_closing_bank_balance??close.calculated_closing_balance)}:null,budget:selectedBudget?{id:selectedBudget.id,name:selectedBudget.name,year:selectedBudget.fiscal_year}:null};
}
