import "server-only";

import type {SupabaseClient} from "@supabase/supabase-js";
import {loadFinancialManagementReport} from "@/lib/finance/management-report";

export type FinanceCloseCheck = {
  key: string;
  label: string;
  passed: boolean;
  count?: number;
  detail: string;
};

export type FinanceCloseSnapshot = {
  incoming: number;
  outgoing: number;
  net: number;
  calculatedClosingBalance: number;
  variance: number | null;
  checks: FinanceCloseCheck[];
  ready: boolean;
};

const count = (result: {count: number | null; error: unknown}) => result.error ? 0 : result.count ?? 0;
const round = (value: number) => Math.round(value * 100) / 100;

export async function calculateFinanceCloseSnapshot(
  admin: SupabaseClient,
  organizationId: string,
  input: {
    from: string;
    to: string;
    currency: string;
    openingBankBalance: number;
    declaredClosingBankBalance: number | null;
  },
): Promise<FinanceCloseSnapshot> {
  const [report, pendingSales, pendingService, unresolvedExpenses, unresolvedPayroll, unpaidCommissions] = await Promise.all([
    loadFinancialManagementReport(admin, organizationId, {from: input.from, to: input.to, currency: input.currency}),
    admin.from("sales_payments").select("id", {count: "exact", head: true}).eq("organization_id", organizationId).eq("currency", input.currency).gte("payment_date", input.from).lte("payment_date", input.to).in("status", ["pending", "correction_requested"]),
    admin.from("customer_service_installment_payments").select("id", {count: "exact", head: true}).eq("organization_id", organizationId).eq("currency", input.currency).gte("received_on", input.from).lte("received_on", input.to).in("finance_status", ["pending", "correction_requested"]),
    admin.from("finance_expenses").select("id", {count: "exact", head: true}).eq("organization_id", organizationId).eq("currency", input.currency).gte("expense_date", input.from).lte("expense_date", input.to).in("status", ["submitted", "correction_requested", "approved"]),
    admin.from("payroll_periods").select("id", {count: "exact", head: true}).eq("organization_id", organizationId).eq("currency", input.currency).gte("period_end", input.from).lte("period_end", input.to).in("status", ["draft", "open", "review", "approved"]),
    admin.from("sales_records").select("id", {count: "exact", head: true}).eq("organization_id", organizationId).eq("currency", input.currency).gte("sale_date", input.from).lte("sale_date", input.to).in("commission_status", ["validated", "payable"]),
  ]);

  const reconciliationCount = count(pendingSales) + count(pendingService);
  const expenseCount = count(unresolvedExpenses);
  const payrollCount = count(unresolvedPayroll);
  const commissionCount = count(unpaidCommissions);
  const calculatedClosingBalance = round(input.openingBankBalance + report.incoming - report.outgoing);
  const variance = input.declaredClosingBankBalance === null
    ? null
    : round(input.declaredClosingBankBalance - calculatedClosingBalance);
  const checks: FinanceCloseCheck[] = [
    {key: "reconciliation", label: "Encaissements rapprochés", passed: reconciliationCount === 0, count: reconciliationCount, detail: reconciliationCount ? `${reconciliationCount} encaissement(s) attendent encore une décision.` : "Aucun rapprochement en attente sur la période."},
    {key: "expenses", label: "Dépenses finalisées", passed: expenseCount === 0, count: expenseCount, detail: expenseCount ? `${expenseCount} dépense(s) restent à contrôler, corriger ou payer.` : "Toutes les dépenses de la période sont finalisées."},
    {key: "payroll", label: "Paie finalisée", passed: payrollCount === 0, count: payrollCount, detail: payrollCount ? `${payrollCount} période(s) de paie ne sont pas payées ou verrouillées.` : "Aucune période de paie inachevée."},
    {key: "commissions", label: "Commissions finalisées", passed: commissionCount === 0, count: commissionCount, detail: commissionCount ? `${commissionCount} commission(s) validée(s) restent à payer.` : "Toutes les commissions de la période sont finalisées."},
    {key: "bank_balance", label: "Solde bancaire renseigné", passed: input.declaredClosingBankBalance !== null, detail: input.declaredClosingBankBalance === null ? "Saisissez le solde du relevé bancaire à la fin de la période." : "Le solde du relevé bancaire est renseigné."},
    {key: "variance", label: "Écart bancaire nul", passed: variance !== null && Math.abs(variance) <= 0.01, detail: variance === null ? "Le calcul attend le solde bancaire déclaré." : Math.abs(variance) <= 0.01 ? "Le relevé bancaire correspond aux mouvements confirmés." : `Un écart de ${variance.toFixed(2)} ${input.currency} doit être résolu.`},
  ];

  return {
    incoming: round(report.incoming),
    outgoing: round(report.outgoing),
    net: round(report.net),
    calculatedClosingBalance,
    variance,
    checks,
    ready: checks.every(check => check.passed),
  };
}
