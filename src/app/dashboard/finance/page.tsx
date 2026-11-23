import type {ReactNode} from "react";
import Link from "next/link";
import {redirect} from "next/navigation";
import {
  createFinanceDocumentAction,
  createPayrollPeriodAction,
  publishPayslipAction,
  savePayrollEntryAction,
  savePayrollProfileAction,
  updateFinanceDocumentStatusAction,
  updatePayrollPeriodStatusAction,
} from "@/app/actions/finance";
import {SecureAttachmentUpload} from "@/components/forms/secure-attachment-upload";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {canVerifySalesForFinance} from "@/lib/auth/sensitive-finance-access";

type SearchParams = Promise<{
  view?: string | string[];
  success?: string | string[];
  error?: string | string[];
}>;

type FinanceDocument = {
  id: string;
  document_type: string;
  document_number: string;
  title: string;
  counterparty_name: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  total_amount: number | string;
  paid_amount: number | string;
  balance_amount: number | string;
  status: string;
  file_name: string | null;
  sale_id: string | null;
};

type Sale = {
  id: string;
  customer_name: string;
  product_name: string;
  sale_date: string;
  currency: string;
  total_amount: number | string;
  paid_amount: number | string;
  balance_amount: number | string;
  workflow_status: string;
  payment_status: string;
};

type SalePayment = {id: string; sale_id: string; currency: string; amount: number | string; status: string};

type PayrollPeriod = {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  pay_date: string | null;
  currency: string;
  status: string;
};

type PayrollEntry = {
  id: string;
  payroll_period_id: string;
  employee_user_id: string;
  base_amount: number | string;
  gross_amount: number | string;
  deduction_amount: number | string;
  tax_amount: number | string;
  net_amount: number | string;
  status: string;
};

type Payslip = {
  id: string;
  payroll_entry_id: string;
  employee_user_id: string;
  password_protected: boolean;
  password_mode: string;
  published_at: string;
};

type Member = {user_id: string; role: string};
type Profile = {id: string; full_name: string | null; email: string | null};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function number(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(locale: string, currency: string, value: number | string | null | undefined) {
  return new Intl.NumberFormat(locale, {style: "currency", currency, maximumFractionDigits: 2}).format(number(value));
}

function date(locale: string, value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {dateStyle: "medium"}).format(new Date(`${value}T00:00:00Z`));
}

function Status({children, tone = "slate"}: {children: ReactNode; tone?: "slate" | "blue" | "green" | "amber" | "red" | "violet"}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-100 text-blue-800",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    violet: "bg-violet-100 text-violet-800",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${tones[tone]}`}>{children}</span>;
}

function statusTone(status: string): "slate" | "blue" | "green" | "amber" | "red" | "violet" {
  if (["paid", "approved", "accepted", "published"].includes(status)) return "green";
  if (["submitted", "pending_approval", "review", "partial", "open"].includes(status)) return "amber";
  if (["overdue", "rejected", "cancelled", "expired", "disputed"].includes(status)) return "red";
  if (["verified", "sent", "converted"].includes(status)) return "blue";
  if (["locked"].includes(status)) return "violet";
  return "slate";
}

export default async function FinancePage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const dateLocale = fr ? "fr-FR" : "en-US";
  const params = await searchParams;
  let view = ["overview", "documents", "payroll"].includes(firstValue(params.view)) ? firstValue(params.view) : "overview";
  const success = firstValue(params.success);
  const errorMessage = firstValue(params.error);

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  const isFinanceAdmin = ["owner", "admin"].includes(membership.role);
  const canVerifyFinanceSales = await canVerifySalesForFinance(
    admin,
    membership.organization_id,
    authData.user.id,
    membership.role,
  );
  if (!isFinanceAdmin && !canVerifyFinanceSales) redirect("/dashboard/my-payslips");
  if (!isFinanceAdmin) view = "overview";

  const schemaCheck = await admin.from("finance_documents").select("id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missing = ["42P01", "PGRST205"].includes(String(schemaCheck.error.code ?? ""));
    if (!missing) throw new Error(schemaCheck.error.message);
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-5xl">
          <header className="rounded-3xl bg-slate-950 p-8 text-white shadow-xl">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">Super Leader Finance · V4.10.54</p>
            <h1 className="mt-2 text-4xl font-black">{fr ? "Finance & Paie" : "Finance & Payroll"}</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">{fr ? "Migration Supabase requise" : "Supabase migration required"}</h2>
            <p className="mt-3 leading-7 text-amber-900">
              {fr ? "Exécute la migration ci-dessous avant d’utiliser le module." : "Run the migration below before using this module."}
            </p>
            <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/041_finance_payroll_foundation_v3_0.sql</code>
          </section>
        </div>
      </main>
    );
  }

  const [documentsResult, periodsResult, entriesResult, payslipsResult, membersResult, salesResult, salePaymentsResult] = await Promise.all([
    admin
      .from("finance_documents")
      .select("id, document_type, document_number, title, counterparty_name, issue_date, due_date, currency, total_amount, paid_amount, balance_amount, status, file_name, sale_id")
      .eq("organization_id", membership.organization_id)
      .order("issue_date", {ascending: false})
      .limit(100),
    admin
      .from("payroll_periods")
      .select("id, name, period_start, period_end, pay_date, currency, status")
      .eq("organization_id", membership.organization_id)
      .order("period_end", {ascending: false})
      .limit(24),
    admin
      .from("payroll_entries")
      .select("id, payroll_period_id, employee_user_id, base_amount, gross_amount, deduction_amount, tax_amount, net_amount, status")
      .eq("organization_id", membership.organization_id)
      .order("created_at", {ascending: false})
      .limit(250),
    admin
      .from("payslips")
      .select("id, payroll_entry_id, employee_user_id, password_protected, password_mode, published_at")
      .eq("organization_id", membership.organization_id)
      .order("published_at", {ascending: false})
      .limit(250),
    admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("created_at"),
    admin
      .from("sales_records")
      .select("id, customer_name, product_name, sale_date, currency, total_amount, paid_amount, balance_amount, workflow_status, payment_status")
      .eq("organization_id", membership.organization_id)
      .not("workflow_status", "in", "(rejected,cancelled,refunded)")
      .order("sale_date", {ascending: false})
      .limit(500),
    admin
      .from("sales_payments")
      .select("id, sale_id, currency, amount, status")
      .eq("organization_id", membership.organization_id)
      .limit(2000),
  ]);

  const loadError = [documentsResult.error, periodsResult.error, entriesResult.error, payslipsResult.error, membersResult.error, salesResult.error, salePaymentsResult.error].find(Boolean);
  if (loadError) throw new Error(loadError.message);

  const documents = (documentsResult.data ?? []) as FinanceDocument[];
  const periods = (periodsResult.data ?? []) as PayrollPeriod[];
  const entries = (entriesResult.data ?? []) as PayrollEntry[];
  const payslips = (payslipsResult.data ?? []) as Payslip[];
  const members = (membersResult.data ?? []) as Member[];
  const sales = (salesResult.data ?? []) as Sale[];
  const salePayments = (salePaymentsResult.data ?? []) as SalePayment[];
  const userIds = members.map((member) => member.user_id);
  const {data: profileRows, error: profileError} = userIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", userIds)
    : {data: [] as Profile[], error: null};
  if (profileError) throw new Error(profileError.message);
  const profiles = (profileRows ?? []) as Profile[];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const employeeName = (id: string) => profileMap.get(id)?.full_name || profileMap.get(id)?.email || id;
  const employeeEmail = (id: string) => profileMap.get(id)?.email || "";
  const periodMap = new Map(periods.map((period) => [period.id, period]));
  const payslipByEntry = new Map(payslips.map((payslip) => [payslip.payroll_entry_id, payslip]));

  const activeInvoices = documents.filter((doc) => doc.document_type === "invoice" && !["cancelled", "archived"].includes(doc.status));
  const invoicedSaleIds = new Set(activeInvoices.map((doc) => doc.sale_id).filter(Boolean));
  const confirmedPayments = salePayments.filter((payment) => payment.status === "confirmed");
  const pendingPayments = salePayments.filter((payment) => ["pending", "correction_requested"].includes(payment.status));
  const submittedSales = sales.filter((sale) => sale.workflow_status === "submitted");
  const verifiedSales = sales.filter((sale) => sale.workflow_status === "verified");
  const approvedSales = sales.filter((sale) => sale.workflow_status === "approved");
  const salesWithoutInvoice = approvedSales.filter((sale) => !invoicedSaleIds.has(sale.id));
  const confirmedBySale = new Map<string, number>();
  const pendingBySale = new Map<string, number>();
  for (const payment of confirmedPayments) confirmedBySale.set(payment.sale_id, (confirmedBySale.get(payment.sale_id) ?? 0) + number(payment.amount));
  for (const payment of pendingPayments) pendingBySale.set(payment.sale_id, (pendingBySale.get(payment.sale_id) ?? 0) + number(payment.amount));
  const byCurrency = (rows: Array<{currency: string; amount: number}>) => {
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amount);
    return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
  };
  const invoicedTotals = byCurrency(activeInvoices.map((doc) => ({currency: doc.currency, amount: number(doc.total_amount)})));
  const collectedTotals = byCurrency(confirmedPayments.map((payment) => ({currency: payment.currency, amount: number(payment.amount)})));
  const receivableTotals = byCurrency(approvedSales.map((sale) => ({currency: sale.currency, amount: number(sale.balance_amount)})));
  const formatTotals = (totals: Array<[string, number]>) => totals.length
    ? totals.map(([currency, amount]) => money(dateLocale, currency, amount)).join(" · ")
    : money(dateLocale, "USD", 0);
  const documentsBySale = new Map<string, FinanceDocument[]>();
  for (const document of documents) {
    if (!document.sale_id) continue;
    documentsBySale.set(document.sale_id, [...(documentsBySale.get(document.sale_id) ?? []), document]);
  }
  const paymentMismatchSales: Sale[] = [];
  const documentMismatchSales: Sale[] = [];
  const receiptDueSales: Sale[] = [];
  for (const sale of approvedSales) {
    const saleDocuments = documentsBySale.get(sale.id) ?? [];
    const invoices = saleDocuments.filter((doc) => doc.document_type === "invoice" && !["cancelled", "archived"].includes(doc.status));
    const receipts = saleDocuments.filter((doc) => doc.document_type === "receipt" && !["cancelled", "archived"].includes(doc.status));
    const confirmed = confirmedBySale.get(sale.id) ?? 0;
    const invoiceTotal = invoices.reduce((sum, invoice) => sum + number(invoice.total_amount), 0);
    const invoicePaid = invoices.reduce((sum, invoice) => sum + number(invoice.paid_amount), 0);
    if (Math.abs(number(sale.paid_amount) - confirmed) > 0.009) paymentMismatchSales.push(sale);
    if (invoices.length && (Math.abs(invoiceTotal - number(sale.total_amount)) > 0.009 || Math.abs(invoicePaid - confirmed) > 0.009)) documentMismatchSales.push(sale);
    if (number(sale.balance_amount) <= 0 && invoices.length && !receipts.length) receiptDueSales.push(sale);
  }
  const anomalySaleIds = new Set([...salesWithoutInvoice, ...paymentMismatchSales, ...documentMismatchSales, ...receiptDueSales].map((sale) => sale.id));
  const workflowLabels: Record<string, string> = fr
    ? {draft: "Brouillon", submitted: "Soumise", verified: "Vérifiée", approved: "Approuvée", rejected: "Rejetée", cancelled: "Annulée", refunded: "Remboursée"}
    : {draft: "Draft", submitted: "Submitted", verified: "Verified", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled", refunded: "Refunded"};

  const labels = {
    proforma: fr ? "Pro forma" : "Pro forma",
    invoice: fr ? "Facture" : "Invoice",
    receipt: fr ? "Reçu" : "Receipt",
    credit_note: fr ? "Note de crédit" : "Credit note",
    expense_receipt: fr ? "Justificatif de dépense" : "Expense receipt",
    other: fr ? "Autre" : "Other",
  } as Record<string, string>;
  const documentStatusLabels = {
    draft: fr ? "Brouillon" : "Draft",
    pending_approval: fr ? "En attente d’approbation" : "Pending approval",
    approved: fr ? "Approuvé" : "Approved",
    sent: fr ? "Envoyé" : "Sent",
    accepted: fr ? "Accepté" : "Accepted",
    partial: fr ? "Partiellement payé" : "Partially paid",
    paid: fr ? "Payé" : "Paid",
    overdue: fr ? "En retard" : "Overdue",
    cancelled: fr ? "Annulé" : "Cancelled",
    archived: fr ? "Archivé" : "Archived",
  } as Record<string, string>;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-xl">
          <div className="grid gap-6 p-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">Super Leader Finance · V4.10.54</p>
              <h1 className="mt-2 text-4xl font-black">{fr ? "Finance, facturation & paie" : "Finance, billing & payroll"}</h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                {fr
                  ? "Centralise les documents financiers, prépare les périodes de paie et publie les bulletins dans un espace privé et auditable."
                  : "Centralise financial documents, prepare payroll periods and publish payslips to a private, auditable space."}
              </p>
            </div>
            <Link href="/dashboard/my-payslips" className="rounded-xl bg-white px-5 py-3 text-center text-sm font-black text-slate-950">
              {fr ? "Voir mon espace bulletins" : "Open my payslip space"}
            </Link>
          </div>
        </header>

        {success ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900">{success}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-900">{errorMessage}</p> : null}

        <nav className="mt-6 flex flex-wrap gap-2" aria-label={fr ? "Sections Finance" : "Finance sections"}>
          {[
            ["overview", fr ? "Vue d’ensemble" : "Overview"],
            ["documents", fr ? "Factures & reçus" : "Invoices & receipts"],
            ["payroll", fr ? "Paie & bulletins" : "Payroll & payslips"],
          ].map(([key, label]) => (
            <Link key={key} href={`/dashboard/finance?view=${key}`} className={`rounded-xl px-5 py-3 text-sm font-black ${view === key ? "bg-violet-600 text-white" : "border border-slate-200 bg-white text-slate-800"}`}>
              {label}
            </Link>
          ))}
        </nav>

        {view === "overview" ? (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                [fr ? "Documents enregistrés" : "Registered documents", documents.length, "border-slate-200 bg-white"],
                [fr ? "Montant facturé" : "Invoiced amount", formatTotals(invoicedTotals), "border-violet-200 bg-violet-50"],
                [fr ? "Encaissements confirmés" : "Confirmed collections", formatTotals(collectedTotals), "border-emerald-200 bg-emerald-50"],
                [fr ? "Créances sur ventes approuvées" : "Approved sales receivables", formatTotals(receivableTotals), "border-amber-200 bg-amber-50"],
              ].map(([label, value, tone]) => (
                <article key={String(label)} className={`rounded-2xl border p-5 shadow-sm ${tone}`}>
                  <p className="text-sm font-bold text-slate-500">{label}</p>
                  <p className="mt-2 text-3xl font-black">{value}</p>
                </article>
              ))}
            </section>

            <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.16em] text-violet-700">{fr ? "Ventes → Finance" : "Sales → Finance"}</p>
                  <h2 className="mt-2 text-2xl font-black">{fr ? "Du chiffre d’affaires à l’encaissement" : "From revenue to collection"}</h2>
                </div>
                <p className="max-w-xl rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">
                  {fr ? "Une vente est visible immédiatement. Elle ne devient un encaissement qu’après confirmation du paiement par Finance." : "A sale is visible immediately. It becomes collected cash only after Finance confirms the payment."}
                </p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                {[
                  [fr ? "Ventes soumises" : "Submitted sales", submittedSales.length, "/dashboard/sales?status=submitted&from=finance#validation-queue", "bg-amber-50 text-amber-950"],
                  [fr ? "Ventes vérifiées" : "Verified sales", verifiedSales.length, "/dashboard/sales?status=verified&from=finance#validation-queue", "bg-blue-50 text-blue-950"],
                  [fr ? "Ventes approuvées" : "Approved sales", approvedSales.length, "/dashboard/finance/customer-accounts", "bg-violet-50 text-violet-950"],
                  [fr ? "Sans facture" : "Without invoice", salesWithoutInvoice.length, "/dashboard/finance/customer-accounts?status=missing_invoice", "bg-amber-50 text-amber-950"],
                  [fr ? "Paiements à contrôler" : "Payments to review", pendingPayments.length, "/dashboard/finance/payments?source=sale&status=pending", "bg-orange-50 text-orange-950"],
                  [fr ? "Paiements confirmés" : "Confirmed payments", confirmedPayments.length, "/dashboard/finance/payments?source=sale&status=confirmed", "bg-emerald-50 text-emerald-950"],
                ].map(([label, value, href, tone]) => (
                  <Link key={String(label)} href={String(href)} className={`rounded-2xl p-4 transition hover:-translate-y-0.5 hover:shadow-md ${tone}`}>
                    <p className="text-sm font-black">{label}</p>
                    <p className="mt-2 text-3xl font-black">{value}</p>
                    <p className="mt-2 text-xs font-black uppercase tracking-wide">{fr ? "Ouvrir →" : "Open →"}</p>
                  </Link>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border-2 border-rose-200 bg-rose-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-xs font-black uppercase tracking-[0.16em] text-rose-700">{fr ? "Contrôle de cohérence" : "Consistency control"}</p><h3 className="mt-1 text-xl font-black text-rose-950">{fr ? "Anomalies à corriger" : "Issues to resolve"}</h3></div>
                  <Link href="/dashboard/finance/customer-accounts?status=missing_invoice" className="rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-black text-white">{anomalySaleIds.size} {fr ? "dossier(s) · Ouvrir →" : "case(s) · Open →"}</Link>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    [fr ? "Factures manquantes" : "Missing invoices", salesWithoutInvoice.length, "missing_invoice"],
                    [fr ? "Écarts de paiement" : "Payment mismatches", paymentMismatchSales.length, "payment_mismatch"],
                    [fr ? "Écarts documentaires" : "Document mismatches", documentMismatchSales.length, "document_mismatch"],
                    [fr ? "Reçus à générer" : "Receipts due", receiptDueSales.length, "receipt_due"],
                  ].map(([label, value, status]) => <Link key={String(status)} href={`/dashboard/finance/customer-accounts?status=${status}`} className="rounded-xl border border-rose-200 bg-white p-3 transition hover:shadow"><p className="text-sm font-bold text-slate-600">{label}</p><p className="mt-1 text-2xl font-black text-rose-800">{value}</p></Link>)}
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
                  <h3 className="font-black">{fr ? "Ventes récentes suivies par Finance" : "Recent sales tracked by Finance"}</h3>
                  <Link href="/dashboard/finance/customer-accounts" className="text-sm font-black text-violet-700">{fr ? "Tous les comptes clients →" : "All customer accounts →"}</Link>
                </div>
                <div className="divide-y divide-slate-200">
                  {sales.slice(0, 8).map((sale) => {
                    const confirmed = confirmedBySale.get(sale.id) ?? 0;
                    const pending = pendingBySale.get(sale.id) ?? 0;
                    const invoice = (documentsBySale.get(sale.id) ?? []).find((document) => document.document_type === "invoice" && document.status !== "cancelled");
                    const saleHref = sale.workflow_status === "submitted"
                      ? `/dashboard/sales?status=submitted&sale=${sale.id}&from=finance#validation-queue`
                      : sale.workflow_status === "verified"
                        ? `/dashboard/sales?status=verified&sale=${sale.id}&from=finance#validation-queue`
                        : `/dashboard/finance/customer-accounts?sale=${sale.id}#customer-account-${sale.id}`;
                    const saleActionLabel = sale.workflow_status === "submitted"
                      ? (fr ? "Vérifier" : "Verify")
                      : sale.workflow_status === "verified"
                        ? (fr ? "Approuver" : "Approve")
                        : sale.workflow_status === "approved"
                          ? (fr ? "Dossier client" : "Customer file")
                          : (fr ? "Ouvrir" : "Open");
                    return (
                      <div key={sale.id} className="grid gap-3 p-4 transition hover:bg-slate-50 md:grid-cols-[1.4fr_.7fr_.7fr_.7fr_.7fr_auto] md:items-center">
                        <div><Link href={saleHref} className="font-black text-slate-950 underline-offset-4 hover:text-violet-700 hover:underline">{sale.customer_name}</Link><p className="text-sm text-slate-500">{sale.product_name} · {date(dateLocale, sale.sale_date)}</p></div>
                        <div><p className="text-xs font-bold text-slate-500">{fr ? "Vente" : "Sale"}</p><p className="font-black">{money(dateLocale, sale.currency, sale.total_amount)}</p></div>
                        <div><p className="text-xs font-bold text-slate-500">{fr ? "Confirmé" : "Confirmed"}</p><p className="font-black text-emerald-700">{money(dateLocale, sale.currency, confirmed)}</p></div>
                        <div><p className="text-xs font-bold text-slate-500">{fr ? "Déclaré" : "Declared"}</p><p className="font-black text-amber-700">{money(dateLocale, sale.currency, pending)}</p></div>
                        <div><p className="text-xs font-bold text-slate-500">{fr ? "Solde" : "Balance"}</p><p className="font-black text-rose-700">{money(dateLocale, sale.currency, sale.balance_amount)}</p></div>
                        <div className="flex flex-col items-start gap-2">
                          <Status tone={statusTone(sale.workflow_status)}>{workflowLabels[sale.workflow_status] ?? sale.workflow_status}</Status>
                          <div className="flex flex-wrap gap-1.5">
                            <Link href={saleHref} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-black text-white">{saleActionLabel}</Link>
                            {invoice ? <Link href={`/dashboard/finance/documents/${invoice.id}`} className="rounded-lg bg-violet-100 px-2.5 py-1.5 text-xs font-black text-violet-800">{fr ? "Facture" : "Invoice"}</Link> : null}
                            {sale.workflow_status === "approved" ? <Link href={`/dashboard/finance/payments?sale=${sale.id}`} className="rounded-lg bg-emerald-100 px-2.5 py-1.5 text-xs font-black text-emerald-800">{fr ? "Encaissements" : "Payments"}</Link> : null}
                            {sale.workflow_status === "approved" && number(sale.balance_amount) > 0 ? <Link href={`/dashboard/collections?sale=${sale.id}#collection-case-${sale.id}`} className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-black text-amber-900">{fr ? "Recouvrement" : "Collections"}</Link> : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!sales.length ? <p className="p-6 text-center text-sm text-slate-500">{fr ? "Aucune vente enregistrée." : "No sale recorded."}</p> : null}
                </div>
              </div>
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-2">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-violet-700">{fr ? "Contrôle financier" : "Financial control"}</p>
                <h2 className="mt-2 text-2xl font-black">{fr ? "Cycle documentaire" : "Document lifecycle"}</h2>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[fr ? "Pro forma → Facture" : "Pro forma → Invoice", fr ? "Facture → Paiement" : "Invoice → Payment", fr ? "Paiement → Reçu" : "Payment → Receipt", fr ? "Correction → Note de crédit" : "Correction → Credit note"].map((item, index) => (
                    <div key={item} className="rounded-2xl bg-slate-50 p-4">
                      <span className="text-xs font-black text-violet-700">0{index + 1}</span>
                      <p className="mt-1 font-black">{item}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-amber-700">{fr ? "Paie sécurisée" : "Secure payroll"}</p>
                <h2 className="mt-2 text-2xl font-black">{fr ? "État de la publication" : "Publication status"}</h2>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4"><p className="text-sm font-bold text-slate-500">{fr ? "Périodes" : "Periods"}</p><p className="mt-1 text-3xl font-black">{periods.length}</p></div>
                  <div className="rounded-2xl bg-slate-50 p-4"><p className="text-sm font-bold text-slate-500">{fr ? "Lignes de paie" : "Payroll entries"}</p><p className="mt-1 text-3xl font-black">{entries.length}</p></div>
                  <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-sm font-bold text-emerald-700">{fr ? "Bulletins publiés" : "Payslips published"}</p><p className="mt-1 text-3xl font-black">{payslips.length}</p></div>
                </div>
                <p className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                  {fr
                    ? "Phase 1 : Super Leader publie un PDF préparé par Finance. Lorsque la protection est activée, le PDF doit déjà avoir été chiffré avec son mot de passe avant le téléversement. La génération et le chiffrement automatiques arrivent en phase 2."
                    : "Phase 1: Super Leader publishes a PDF prepared by Finance. When protection is enabled, the PDF must already be password-encrypted before upload. Automatic generation and encryption arrive in phase 2."}
                </p>
              </article>
            </section>
          </>
        ) : null}

        {view === "documents" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
            <form action={createFinanceDocumentAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-black uppercase tracking-[0.16em] text-violet-700">{fr ? "Nouveau document" : "New document"}</p>
              <h2 className="mt-2 text-2xl font-black">{fr ? "Enregistrer une pièce financière" : "Register a financial document"}</h2>
              <div className="mt-5 space-y-4">
                <label className="block text-sm font-black">{fr ? "Type" : "Type"}<select name="documentType" required className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5">{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950"><p className="font-black">{fr ? "Numéro automatique" : "Automatic number"}</p><p className="mt-1 text-xs font-semibold text-indigo-800">{fr ? "Le numéro est généré à l’enregistrement selon le type et les préfixes définis dans Paramètres Finance (ex. PRO, FAC, REC)." : "The number is generated on save from the document type and the prefixes configured in Finance Settings (e.g. PRO, FAC, REC)."}</p></div>
                <label className="block text-sm font-black">{fr ? "Titre" : "Title"}<input name="title" required className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
                <label className="block text-sm font-black">{fr ? "Client ou fournisseur" : "Client or supplier"}<input name="counterpartyName" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
                <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-black">{fr ? "Date d’émission" : "Issue date"}<input name="issueDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-black">{fr ? "Échéance" : "Due date"}<input name="dueDate" type="date" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /><span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-500">{fr ? "Laisser vide pour calculer automatiquement l’échéance depuis Paramètres Finance." : "Leave blank to calculate the due date automatically from Finance Settings."}</span></label></div>
                <div className="grid grid-cols-3 gap-3"><label className="block text-sm font-black">{fr ? "Devise" : "Currency"}<input name="currency" defaultValue="USD" maxLength={3} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 uppercase" /></label><label className="block text-sm font-black">{fr ? "Sous-total" : "Subtotal"}<input name="subtotal" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-black">{fr ? "Taxes" : "Tax"}<input name="taxAmount" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label></div>
                <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-black">{fr ? "Total" : "Total"}<input name="totalAmount" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-black">{fr ? "Déjà payé" : "Already paid"}<input name="paidAmount" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label></div>
                <label className="block text-sm font-black">{fr ? "Notes" : "Notes"}<textarea name="notes" rows={3} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
                <SecureAttachmentUpload purpose="finance" prefix="financeDocument" required label={fr ? "Fichier financier" : "Financial file"} help={fr ? "PDF, image ou document Word, 10 Mo maximum. Stockage privé." : "PDF, image or Word document, up to 10 MB. Private storage."} chooseLabel={fr ? "Choisir le fichier" : "Choose file"} uploadingLabel={fr ? "Téléversement sécurisé…" : "Secure upload…"} uploadedLabel={fr ? "Fichier prêt" : "File ready"} removeLabel={fr ? "Retirer" : "Remove"} errorLabel={fr ? "Fichier invalide ou trop volumineux." : "Invalid or oversized file."} />
                <button className="w-full rounded-xl bg-violet-600 px-5 py-3 font-black text-white">{fr ? "Enregistrer le document" : "Save document"}</button>
              </div>
            </form>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-black uppercase tracking-[0.16em] text-violet-700">{fr ? "Registre financier" : "Financial register"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Factures, pro forma et reçus" : "Invoices, pro formas and receipts"}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black">{documents.length}</span></div>
              <div className="mt-5 space-y-4">
                {documents.length ? documents.map((document) => (
                  <article key={document.id} className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-violet-700">{labels[document.document_type] || document.document_type} · {document.document_number}</p><h3 className="mt-1 text-lg font-black">{document.title}</h3><p className="mt-1 text-sm text-slate-500">{document.counterparty_name || (fr ? "Aucune contrepartie" : "No counterparty")}</p></div><Status tone={statusTone(document.status)}>{documentStatusLabels[document.status] ?? document.status}</Status></div>
                    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4"><div><p className="text-xs font-bold text-slate-500">{fr ? "Émission" : "Issue"}</p><p className="font-black">{date(dateLocale, document.issue_date)}</p></div><div><p className="text-xs font-bold text-slate-500">{fr ? "Échéance" : "Due"}</p><p className="font-black">{date(dateLocale, document.due_date)}</p></div><div><p className="text-xs font-bold text-slate-500">{fr ? "Total" : "Total"}</p><p className="font-black">{money(dateLocale, document.currency, document.total_amount)}</p></div><div><p className="text-xs font-bold text-slate-500">{fr ? "Solde" : "Balance"}</p><p className="font-black">{money(dateLocale, document.currency, document.balance_amount)}</p></div></div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {document.file_name ? <Link href={`/api/attachments/finance/${document.id}`} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr ? "Ouvrir le fichier" : "Open file"}</Link> : null}
                      <form action={updateFinanceDocumentStatusAction} className="flex flex-wrap gap-2"><input type="hidden" name="documentId" value={document.id} /><select name="status" defaultValue={document.status} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold">{["draft", "pending_approval", "approved", "sent", "accepted", "partial", "paid", "overdue", "cancelled", "archived"].map((status) => <option key={status} value={status}>{documentStatusLabels[status] ?? status}</option>)}</select><button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black">{fr ? "Mettre à jour" : "Update"}</button></form>
                    </div>
                  </article>
                )) : <p className="rounded-2xl bg-slate-50 p-6 text-slate-500">{fr ? "Aucun document financier n’a encore été enregistré." : "No financial document has been registered yet."}</p>}
              </div>
            </div>
          </section>
        ) : null}

        {view === "payroll" ? (
          <section className="mt-6 space-y-6">
            <div className="grid gap-6 xl:grid-cols-3">
              <form action={savePayrollProfileAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-violet-700">{fr ? "Rémunération" : "Compensation"}</p><h2 className="mt-2 text-xl font-black">{fr ? "Profil de salaire" : "Salary profile"}</h2>
                <div className="mt-5 space-y-3">
                  <label className="block text-sm font-black">{fr ? "Employé" : "Employee"}<select name="employeeUserId" required className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="">{fr ? "Sélectionner" : "Select"}</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{employeeName(member.user_id)} · {member.role}</option>)}</select></label>
                  <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-black">{fr ? "Base" : "Basis"}<select name="salaryBasis" defaultValue="monthly" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="monthly">{fr ? "Mensuel" : "Monthly"}</option><option value="semimonthly">{fr ? "Bimensuel" : "Semimonthly"}</option><option value="biweekly">{fr ? "Toutes les 2 semaines" : "Biweekly"}</option><option value="weekly">{fr ? "Hebdomadaire" : "Weekly"}</option><option value="hourly">{fr ? "Horaire" : "Hourly"}</option><option value="custom">{fr ? "Personnalisé" : "Custom"}</option></select></label><label className="block text-sm font-black">{fr ? "Devise" : "Currency"}<input name="currency" defaultValue="USD" maxLength={3} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 uppercase" /></label></div>
                  <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-black">{fr ? "Salaire de base" : "Base salary"}<input name="baseSalary" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-black">{fr ? "Taux horaire" : "Hourly rate"}<input name="hourlyRate" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label></div>
                  <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-black">{fr ? "Indemnité standard" : "Standard allowance"}<input name="standardAllowance" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-black">{fr ? "Déduction standard" : "Standard deduction"}<input name="standardDeduction" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label></div>
                  <label className="block text-sm font-black">{fr ? "Mode de paiement" : "Payment method"}<select name="paymentMethod" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="bank_transfer">{fr ? "Virement bancaire" : "Bank transfer"}</option><option value="mobile_money">Mobile Money</option><option value="cash">{fr ? "Espèces" : "Cash"}</option><option value="cheque">{fr ? "Chèque" : "Cheque"}</option><option value="other">{fr ? "Autre" : "Other"}</option></select></label>
                  <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-black">{fr ? "4 derniers chiffres" : "Last 4 digits"}<input name="bankAccountLast4" inputMode="numeric" maxLength={4} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-black">{fr ? "Effet à partir du" : "Effective from"}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label></div>
                  <button className="w-full rounded-xl bg-violet-600 px-4 py-3 font-black text-white">{fr ? "Enregistrer le profil" : "Save profile"}</button>
                </div>
              </form>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <form action={createPayrollPeriodAction}>
                <p className="text-sm font-black uppercase tracking-[0.16em] text-amber-700">{fr ? "Cycle de paie" : "Payroll cycle"}</p><h2 className="mt-2 text-xl font-black">{fr ? "Ouvrir une période" : "Open a period"}</h2>
                <div className="mt-5 space-y-3">
                  <label className="block text-sm font-black">{fr ? "Nom" : "Name"}<input name="name" required placeholder={fr ? "Paie août 2026" : "August 2026 payroll"} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
                  <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-black">{fr ? "Début" : "Start"}<input name="periodStart" type="date" required className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-black">{fr ? "Fin" : "End"}<input name="periodEnd" type="date" required className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label></div>
                  <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-black">{fr ? "Date de paiement" : "Pay date"}<input name="payDate" type="date" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-black">{fr ? "Devise" : "Currency"}<input name="currency" defaultValue="USD" maxLength={3} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 uppercase" /></label></div>
                  <button className="w-full rounded-xl bg-slate-950 px-4 py-3 font-black text-white">{fr ? "Ouvrir la période" : "Open period"}</button>
                </div>
                </form>
                <div className="mt-5 space-y-3">{periods.slice(0, 5).map((period) => <div key={period.id} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><div><p className="font-black">{period.name}</p><p className="text-xs text-slate-500">{date(dateLocale, period.period_start)} - {date(dateLocale, period.period_end)}</p></div><Status tone={statusTone(period.status)}>{period.status}</Status></div><form action={updatePayrollPeriodStatusAction} className="mt-3 flex gap-2"><input type="hidden" name="periodId" value={period.id} /><select name="status" defaultValue={period.status} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-xs font-bold">{["open", "review", "approved", "paid", "locked", "cancelled"].map((status) => <option key={status} value={status}>{status}</option>)}</select><button className="rounded-lg border border-slate-300 px-3 text-xs font-black">OK</button></form></div>)}</div>
              </div>

              <form action={savePayrollEntryAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-emerald-700">{fr ? "Calcul contrôlé" : "Controlled calculation"}</p><h2 className="mt-2 text-xl font-black">{fr ? "Préparer une ligne de paie" : "Prepare payroll entry"}</h2>
                <div className="mt-5 space-y-3">
                  <label className="block text-sm font-black">{fr ? "Période" : "Period"}<select name="periodId" required className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="">{fr ? "Sélectionner" : "Select"}</option>{periods.filter((period) => !["locked", "cancelled"].includes(period.status)).map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}</select></label>
                  <label className="block text-sm font-black">{fr ? "Employé" : "Employee"}<select name="employeeUserId" required className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="">{fr ? "Sélectionner" : "Select"}</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{employeeName(member.user_id)}</option>)}</select></label>
                  <div className="grid grid-cols-2 gap-3">{[["baseAmount", fr ? "Base" : "Base"], ["overtimeAmount", fr ? "Heures sup." : "Overtime"], ["bonusAmount", fr ? "Prime" : "Bonus"], ["commissionAmount", fr ? "Commission" : "Commission"], ["allowanceAmount", fr ? "Indemnités" : "Allowances"], ["deductionAmount", fr ? "Déductions" : "Deductions"], ["taxAmount", fr ? "Taxes/cotisations" : "Taxes/contributions"]].map(([name, label]) => <label key={name} className="block text-sm font-black">{label}<input name={name} type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>)}</div>
                  <label className="block text-sm font-black">{fr ? "Notes" : "Notes"}<textarea name="notes" rows={2} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
                  <button className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-black text-white">{fr ? "Calculer et enregistrer" : "Calculate and save"}</button>
                </div>
              </form>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div><p className="text-sm font-black uppercase tracking-[0.16em] text-violet-700">{fr ? "Publication confidentielle" : "Confidential publication"}</p><h2 className="mt-2 text-2xl font-black">{fr ? "Lignes de paie et bulletins" : "Payroll entries and payslips"}</h2></div>
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">{fr ? "Pour cette première phase, prépare le PDF et applique son mot de passe avant le téléversement. Super Leader protège ensuite le stockage, limite l’accès à l’employé concerné et enregistre chaque téléchargement." : "For this first phase, prepare the PDF and apply its password before upload. Super Leader then secures storage, limits access to the relevant employee and records each download."}</p>
              <div className="mt-5 space-y-4">
                {entries.length ? entries.map((entry) => {
                  const period = periodMap.get(entry.payroll_period_id);
                  const payslip = payslipByEntry.get(entry.id);
                  return (
                    <article key={entry.id} className="rounded-2xl border border-slate-200 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black">{employeeName(entry.employee_user_id)}</h3><p className="text-sm text-slate-500">{employeeEmail(entry.employee_user_id)} · {period?.name || entry.payroll_period_id}</p></div><Status tone={statusTone(entry.status)}>{entry.status}</Status></div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-4"><div><p className="text-xs font-bold text-slate-500">{fr ? "Base" : "Base"}</p><p className="font-black">{money(dateLocale, period?.currency || "USD", entry.base_amount)}</p></div><div><p className="text-xs font-bold text-slate-500">{fr ? "Brut" : "Gross"}</p><p className="font-black">{money(dateLocale, period?.currency || "USD", entry.gross_amount)}</p></div><div><p className="text-xs font-bold text-slate-500">{fr ? "Déductions + taxes" : "Deductions + tax"}</p><p className="font-black">{money(dateLocale, period?.currency || "USD", number(entry.deduction_amount) + number(entry.tax_amount))}</p></div><div><p className="text-xs font-bold text-slate-500">{fr ? "Net" : "Net"}</p><p className="font-black text-emerald-700">{money(dateLocale, period?.currency || "USD", entry.net_amount)}</p></div></div>
                      {payslip ? (
                        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 p-4"><Status tone="green">{fr ? "Publié" : "Published"}</Status><span className="text-sm font-bold text-emerald-900">{payslip.password_protected ? (fr ? `PDF protégé · ${payslip.password_mode}` : `Protected PDF · ${payslip.password_mode}`) : (fr ? "PDF sans mot de passe" : "PDF without password")}</span><Link href={`/api/attachments/payslip/${payslip.id}`} className="ml-auto rounded-lg bg-emerald-700 px-3 py-2 text-sm font-black text-white">{fr ? "Ouvrir" : "Open"}</Link></div>
                      ) : (
                        <form action={publishPayslipAction} className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4">
                          <input type="hidden" name="payrollEntryId" value={entry.id} />
                          <div className="grid gap-3 md:grid-cols-2"><label className="block text-sm font-black">{fr ? "Mode de mot de passe" : "Password mode"}<select name="passwordMode" defaultValue="employee_secret" className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5"><option value="employee_secret">{fr ? "Secret personnel de l’employé" : "Employee personal secret"}</option><option value="unique">{fr ? "Mot de passe unique" : "Unique password"}</option><option value="none">{fr ? "Aucun mot de passe" : "No password"}</option></select></label><label className="block text-sm font-black">{fr ? "Indice non sensible" : "Non-sensitive hint"}<input name="passwordHint" placeholder={fr ? "Communiqué séparément" : "Shared separately"} className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5" /></label></div>
                          <div className="mt-3"><SecureAttachmentUpload purpose="payslip" prefix="payslipDocument" required label={fr ? "Bulletin PDF" : "Payslip PDF"} help={fr ? "PDF uniquement, 10 Mo maximum. Si un mot de passe est choisi, chiffre le fichier avant de l’envoyer." : "PDF only, up to 10 MB. If a password is selected, encrypt the file before uploading."} chooseLabel={fr ? "Choisir le bulletin" : "Choose payslip"} uploadingLabel={fr ? "Téléversement sécurisé…" : "Secure upload…"} uploadedLabel={fr ? "Bulletin prêt" : "Payslip ready"} removeLabel={fr ? "Retirer" : "Remove"} errorLabel={fr ? "Le fichier doit être un PDF valide de moins de 10 Mo." : "The file must be a valid PDF under 10 MB."} /></div>
                          <button className="mt-3 rounded-xl bg-violet-600 px-4 py-3 font-black text-white">{fr ? "Publier dans l’espace privé" : "Publish to private space"}</button>
                        </form>
                      )}
                    </article>
                  );
                }) : <p className="rounded-2xl bg-slate-50 p-6 text-slate-500">{fr ? "Aucune ligne de paie n’a encore été préparée." : "No payroll entry has been prepared yet."}</p>}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
