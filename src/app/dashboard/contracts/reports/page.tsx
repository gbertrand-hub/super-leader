import Link from "next/link";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {requireAccessContext} from "@/lib/auth/access-control";

type ContractRow = {
  id: string;
  provider_id: string;
  contract_number: string;
  title: string;
  internal_owner_user_id: string;
  start_date: string;
  end_date: string;
  value_amount: number | string;
  currency: string;
  status: string;
  performance_target: number | string;
};
type ProviderRow = {id: string; legal_name: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type DeliverableRow = {contract_id: string; due_date: string; status: string};
type ObligationRow = {contract_id: string; due_date: string; status: string};
type KpiRow = {contract_id: string; kpi_id: string; period_end: string; score: number | string; status: string};
type IncidentRow = {contract_id: string; severity: string; status: string};
type FinancialRow = {contract_id: string; calculated_amount: number | string; settled_amount: number | string | null; currency: string; gate_status: string; status: string; due_date: string | null; settled_at: string | null};
type ReportRow = {contract_id: string; status: string};
type RenewalRow = {contract_id: string; is_final: boolean; decided_at: string};
type RiskLevel = "critical" | "high" | "watch" | "ok";
type ContractAnalytics = {
  contract: ContractRow;
  provider: string;
  owner: string;
  kpiScore: number | null;
  target: number;
  risk: RiskLevel;
  riskPoints: number;
  overdueDeliverables: number;
  overdueObligations: number;
  openIncidents: number;
  criticalIncidents: number;
  highIncidents: number;
  blockedFinancial: number;
  reviewFinancial: number;
  approvedUnpaid: number;
  days: number;
  renewalDue: boolean;
};

const LEADERS = new Set(["owner", "admin", "executive", "hr", "manager"]);
const CLOSED_CONTRACTS = new Set(["completed", "terminated"]);
const CLOSED_DELIVERABLES = new Set(["accepted", "cancelled"]);
const CLOSED_OCCURRENCES = new Set(["accepted", "waived"]);
const CLOSED_INCIDENTS = new Set(["resolved", "closed"]);
const CLOSED_FINANCIAL = new Set(["paid", "delivered", "cancelled", "rejected"]);

function todayIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}
function daysUntil(date: string) {
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.ceil((new Date(`${date}T00:00:00Z`).getTime() - start) / 86400000);
}
function n(value: number | string | null | undefined) {
  const out = Number(value ?? 0);
  return Number.isFinite(out) ? out : 0;
}
function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function money(value: number, currency: string, locale: string) {
  try { return new Intl.NumberFormat(locale, {style: "currency", currency, maximumFractionDigits: 2}).format(value); }
  catch { return `${value.toLocaleString(locale, {maximumFractionDigits: 2})} ${currency}`; }
}
function riskLabel(value: RiskLevel, fr: boolean) {
  const labels: Record<RiskLevel, [string, string]> = {critical:["CRITIQUE","CRITICAL"], high:["ÉLEVÉ","HIGH"], watch:["À SURVEILLER","WATCH"], ok:["SOUS CONTRÔLE","ON TRACK"]};
  return labels[value][fr ? 0 : 1];
}
function riskTone(value: RiskLevel) {
  if (value === "critical") return "bg-red-100 text-red-800";
  if (value === "high") return "bg-orange-100 text-orange-900";
  if (value === "watch") return "bg-amber-100 text-amber-900";
  return "bg-emerald-100 text-emerald-800";
}
function statusLabel(value: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {draft:["Brouillon","Draft"], active:["Actif","Active"], under_review:["En revue","Under review"], renewed:["Renouvelé","Renewed"], suspended:["Suspendu","Suspended"], completed:["Terminé","Completed"], terminated:["Résilié","Terminated"]};
  return (labels[value] ?? [value,value])[fr ? 0 : 1];
}
function sumByCurrency(rows: Array<{currency: string; amount: number}>) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.currency || "USD", (totals.get(row.currency || "USD") ?? 0) + row.amount);
  return [...totals.entries()].sort(([a],[b]) => a.localeCompare(b));
}

export default async function ContractReportsPage({searchParams}: {searchParams: Promise<{q?: string; scope?: string; risk?: string}>}) {
  const [{locale}, query, context] = await Promise.all([getI18n(), searchParams, requireAccessContext()]);
  const fr = locale === "fr";
  const localeCode = fr ? "fr-FR" : "en-GB";
  if (!LEADERS.has(context.role)) redirect("/dashboard/my-day");

  const [contractsRes, providersRes, deliverablesRes, obligationsRes, kpiRes, incidentsRes, financialRes, reportsRes, renewalsRes] = await Promise.all([
    context.admin.from("service_contracts").select("id,provider_id,contract_number,title,internal_owner_user_id,start_date,end_date,value_amount,currency,status,performance_target").eq("organization_id", context.organizationId).order("end_date", {ascending: true}),
    context.admin.from("service_providers").select("id,legal_name").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_deliverables").select("contract_id,due_date,status").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_obligation_occurrences").select("contract_id,due_date,status").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_kpi_results").select("contract_id,kpi_id,period_end,score,status").eq("organization_id", context.organizationId).order("period_end", {ascending: false}),
    context.admin.from("service_contract_incidents").select("contract_id,severity,status").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_financial_items").select("contract_id,calculated_amount,settled_amount,currency,gate_status,status,due_date,settled_at").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_reports").select("contract_id,status").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_renewal_reviews").select("contract_id,is_final,decided_at").eq("organization_id", context.organizationId).order("decided_at", {ascending: false}),
  ]);
  const firstError = [contractsRes, providersRes, deliverablesRes, obligationsRes, kpiRes, incidentsRes, financialRes, reportsRes, renewalsRes].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  let contracts = (contractsRes.data ?? []) as ContractRow[];
  if (context.role === "manager") contracts = contracts.filter((row) => row.internal_owner_user_id === context.user.id);
  const contractIds = new Set(contracts.map((row) => row.id));
  const ownerIds = [...new Set(contracts.map((row) => row.internal_owner_user_id))];
  const profilesRes = ownerIds.length ? await context.admin.from("profiles").select("id,full_name,email").in("id", ownerIds) : {data: [] as ProfileRow[], error: null};
  if (profilesRes.error) throw new Error(profilesRes.error.message);

  const providers = (providersRes.data ?? []) as ProviderRow[];
  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const providerById = new Map(providers.map((row) => [row.id, row.legal_name]));
  const ownerById = new Map(profiles.map((row) => [row.id, row.full_name || row.email || "—"]));
  const deliverables = ((deliverablesRes.data ?? []) as DeliverableRow[]).filter((row) => contractIds.has(row.contract_id));
  const obligations = ((obligationsRes.data ?? []) as ObligationRow[]).filter((row) => contractIds.has(row.contract_id));
  const kpis = ((kpiRes.data ?? []) as KpiRow[]).filter((row) => contractIds.has(row.contract_id) && row.status === "accepted");
  const incidents = ((incidentsRes.data ?? []) as IncidentRow[]).filter((row) => contractIds.has(row.contract_id));
  const financial = ((financialRes.data ?? []) as FinancialRow[]).filter((row) => contractIds.has(row.contract_id));
  const reports = ((reportsRes.data ?? []) as ReportRow[]).filter((row) => contractIds.has(row.contract_id));
  const renewals = ((renewalsRes.data ?? []) as RenewalRow[]).filter((row) => contractIds.has(row.contract_id));
  const today = todayIso();

  const latestKpiByKey = new Map<string, KpiRow>();
  for (const row of kpis) {
    const key = `${row.contract_id}:${row.kpi_id}`;
    if (!latestKpiByKey.has(key)) latestKpiByKey.set(key, row);
  }
  const finalRenewals = new Set(renewals.filter((row) => row.is_final).map((row) => row.contract_id));

  const analytics: ContractAnalytics[] = contracts.map((contract) => {
    const openIncidentsRows = incidents.filter((row) => row.contract_id === contract.id && !CLOSED_INCIDENTS.has(row.status));
    const criticalIncidents = openIncidentsRows.filter((row) => row.severity === "critical").length;
    const highIncidents = openIncidentsRows.filter((row) => row.severity === "high").length;
    const overdueDeliverables = deliverables.filter((row) => row.contract_id === contract.id && row.due_date < today && !CLOSED_DELIVERABLES.has(row.status)).length;
    const overdueObligations = obligations.filter((row) => row.contract_id === contract.id && row.due_date < today && !CLOSED_OCCURRENCES.has(row.status)).length;
    const contractFinancial = financial.filter((row) => row.contract_id === contract.id && !CLOSED_FINANCIAL.has(row.status));
    const blockedFinancial = contractFinancial.filter((row) => row.gate_status === "blocked" || row.status === "held").length;
    const reviewFinancial = contractFinancial.filter((row) => row.gate_status === "review" && row.status === "pending").length;
    const approvedUnpaid = contractFinancial.filter((row) => row.status === "approved").length;
    const latestScores = [...latestKpiByKey.values()].filter((row) => row.contract_id === contract.id).map((row) => n(row.score));
    const kpiScore = average(latestScores);
    const target = n(contract.performance_target);
    const days = daysUntil(contract.end_date);
    const renewalDue = !CLOSED_CONTRACTS.has(contract.status) && days <= 90 && !finalRenewals.has(contract.id);
    const pendingReports = reports.filter((row) => row.contract_id === contract.id && row.status === "submitted").length;
    let points = 0;
    if (!CLOSED_CONTRACTS.has(contract.status) && days < 0) points += 100;
    points += criticalIncidents * 80;
    points += blockedFinancial * 60;
    points += highIncidents * 45;
    points += overdueDeliverables * 30;
    points += overdueObligations * 25;
    if (kpiScore !== null && target > 0 && kpiScore < target) points += Math.max(20, Math.round(target - kpiScore));
    points += reviewFinancial * 12;
    points += pendingReports * 8;
    if (renewalDue) points += days <= 30 ? 25 : days <= 60 ? 15 : 8;
    const risk: RiskLevel = points >= 80 ? "critical" : points >= 40 ? "high" : points > 0 ? "watch" : "ok";
    return {contract, provider: providerById.get(contract.provider_id) || "—", owner: ownerById.get(contract.internal_owner_user_id) || "—", kpiScore, target, risk, riskPoints: points, overdueDeliverables, overdueObligations, openIncidents: openIncidentsRows.length, criticalIncidents, highIncidents, blockedFinancial, reviewFinancial, approvedUnpaid, days, renewalDue};
  });

  const scope = String(query.scope ?? "open");
  const scoped = analytics.filter((row) => scope === "all" || !CLOSED_CONTRACTS.has(row.contract.status));
  const q = String(query.q ?? "").trim().toLowerCase();
  const risk = String(query.risk ?? "all");
  const visible = scoped.filter((row) => {
    const matchQ = !q || [row.contract.title, row.contract.contract_number, row.provider, row.owner].some((value) => value.toLowerCase().includes(q));
    const matchRisk = risk === "all" || row.risk === risk;
    return matchQ && matchRisk;
  }).sort((a,b) => b.riskPoints - a.riskPoints || (a.kpiScore ?? 999) - (b.kpiScore ?? 999));

  const open = analytics.filter((row) => !CLOSED_CONTRACTS.has(row.contract.status));
  const latestScores = open.map((row) => row.kpiScore).filter((value): value is number => value !== null);
  const portfolioKpi = average(latestScores);
  const belowTarget = open.filter((row) => row.kpiScore !== null && row.target > 0 && row.kpiScore < row.target).length;
  const atRisk = open.filter((row) => row.risk === "critical" || row.risk === "high").length;
  const overdueDeliverables = open.reduce((sum,row) => sum + row.overdueDeliverables, 0);
  const openIncidents = open.reduce((sum,row) => sum + row.openIncidents, 0);
  const renewals90 = open.filter((row) => row.renewalDue && row.days <= 90).length;
  const renewals60 = open.filter((row) => row.renewalDue && row.days <= 60).length;
  const renewals30 = open.filter((row) => row.renewalDue && row.days <= 30).length;

  const contractValues = sumByCurrency(open.map((row) => ({currency: row.contract.currency, amount: n(row.contract.value_amount)})));
  const approvedDue = sumByCurrency(financial.filter((row) => row.status === "approved").map((row) => ({currency: row.currency, amount: n(row.calculated_amount)})));
  const settled = sumByCurrency(financial.filter((row) => row.status === "paid" || row.status === "delivered").map((row) => ({currency: row.currency, amount: n(row.settled_amount ?? row.calculated_amount)})));

  const riskCounts: Array<[RiskLevel, number]> = ["critical","high","watch","ok"].map((level) => [level as RiskLevel, open.filter((row) => row.risk === level).length]);
  const maxRiskCount = Math.max(1, ...riskCounts.map(([,count]) => count));

  const monthScores = new Map<string, number[]>();
  for (const row of kpis) {
    const month = row.period_end.slice(0,7);
    const arr = monthScores.get(month) ?? [];
    arr.push(n(row.score));
    monthScores.set(month, arr);
  }
  const trend = [...monthScores.entries()].sort(([a],[b]) => a.localeCompare(b)).slice(-6).map(([month, values]) => ({month, score: average(values) ?? 0}));

  const severityRows: Array<[string, number]> = ["critical","high","medium","low"].map((severity) => [severity, incidents.filter((row) => !CLOSED_INCIDENTS.has(row.status) && row.severity === severity).length]);
  const providerStats = [...new Set(open.map((row) => row.provider))].map((provider) => {
    const rows = open.filter((row) => row.provider === provider);
    const scores = rows.map((row) => row.kpiScore).filter((value): value is number => value !== null);
    return {provider, contracts: rows.length, score: average(scores), atRisk: rows.filter((row) => row.risk === "critical" || row.risk === "high").length};
  }).sort((a,b) => b.atRisk - a.atRisk || (a.score ?? 999) - (b.score ?? 999)).slice(0,8);

  const exportHref = `/api/contracts/reports/export?scope=${encodeURIComponent(scope)}&risk=${encodeURIComponent(risk)}&q=${encodeURIComponent(String(query.q ?? ""))}`;

  return <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6"><div className="mx-auto max-w-7xl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-4"><Link href="/dashboard/contracts/execution-center" className="text-sm font-black text-indigo-700">← {fr ? "Centre d’exécution" : "Execution centre"}</Link><Link href="/dashboard/contracts/risk-center" className="text-sm font-black text-indigo-700">{fr ? "Incidents & risques" : "Incidents & risks"} →</Link></div>
      <Link href="/dashboard/module-status" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700">{fr ? "Feuille de route" : "Roadmap"}</Link>
    </div>

    <header className="mt-4 rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">SUPER LEADER OPERATIONS · V4.10.15</p>
      <h1 className="mt-3 text-3xl font-black sm:text-4xl">{fr ? "Reporting & analyses contractuelles" : "Contract reporting & analytics"}</h1>
      <p className="mt-3 max-w-4xl text-sm text-slate-300">{fr ? "Une lecture direction du portefeuille : performance, risques, retards, exposition financière, renouvellements et tendances KPI." : "An executive view of the portfolio: performance, risk, delays, financial exposure, renewals and KPI trends."}</p>
    </header>

    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      {[
        [fr ? "Contrats ouverts" : "Open contracts", open.length, "text-slate-950"],
        [fr ? "KPI moyen" : "Average KPI", portfolioKpi === null ? "—" : `${portfolioKpi.toFixed(1)}%`, portfolioKpi !== null && portfolioKpi < 80 ? "text-amber-700" : "text-emerald-700"],
        [fr ? "Sous cible" : "Below target", belowTarget, belowTarget ? "text-amber-700" : "text-emerald-700"],
        [fr ? "À risque" : "At risk", atRisk, atRisk ? "text-red-700" : "text-emerald-700"],
        [fr ? "Livrables en retard" : "Overdue deliverables", overdueDeliverables, overdueDeliverables ? "text-orange-700" : "text-emerald-700"],
        [fr ? "Incidents ouverts" : "Open incidents", openIncidents, openIncidents ? "text-red-700" : "text-emerald-700"],
        [fr ? "Renouvellements ≤ 90 j" : "Renewals ≤ 90d", renewals90, renewals90 ? "text-amber-700" : "text-emerald-700"],
        [fr ? "Paiements bloqués" : "Blocked payments", open.reduce((sum,row) => sum + row.blockedFinancial,0), open.some((row) => row.blockedFinancial) ? "text-red-700" : "text-emerald-700"],
      ].map(([label,value,tone]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 text-2xl font-black ${tone}`}>{value}</p></article>)}
    </section>

    <section className="mt-6 grid gap-4 lg:grid-cols-3">
      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">{fr ? "VALEUR DU PORTEFEUILLE" : "PORTFOLIO VALUE"}</p><div className="mt-4 space-y-2">{contractValues.map(([currency,value]) => <div key={currency} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="font-black">{currency}</span><span className="text-lg font-black">{money(value,currency,localeCode)}</span></div>)}{!contractValues.length ? <p className="text-sm text-slate-500">—</p> : null}</div></article>
      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{fr ? "APPROUVÉ À PAYER" : "APPROVED TO PAY"}</p><div className="mt-4 space-y-2">{approvedDue.map(([currency,value]) => <div key={currency} className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3"><span className="font-black">{currency}</span><span className="text-lg font-black text-amber-900">{money(value,currency,localeCode)}</span></div>)}{!approvedDue.length ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{fr ? "Aucun montant approuvé en attente." : "No approved amount waiting."}</p> : null}</div></article>
      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{fr ? "PAIEMENTS ENREGISTRÉS" : "RECORDED SETTLEMENTS"}</p><div className="mt-4 space-y-2">{settled.map(([currency,value]) => <div key={currency} className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3"><span className="font-black">{currency}</span><span className="text-lg font-black text-emerald-900">{money(value,currency,localeCode)}</span></div>)}{!settled.length ? <p className="text-sm text-slate-500">—</p> : null}</div></article>
    </section>

    <section className="mt-6 grid gap-4 lg:grid-cols-2">
      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">{fr ? "RISQUE" : "RISK"}</p><h2 className="mt-1 text-2xl font-black">{fr ? "Distribution du portefeuille" : "Portfolio distribution"}</h2></div><Link href="/dashboard/contracts/risk-center" className="text-xs font-black text-indigo-700">{fr ? "Voir risques →" : "View risks →"}</Link></div><div className="mt-5 space-y-4">{riskCounts.map(([level,count]) => <div key={level}><div className="flex items-center justify-between text-sm"><span className="font-black">{riskLabel(level,fr)}</span><span className="font-black">{count}</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${level === "critical" ? "bg-red-600" : level === "high" ? "bg-orange-500" : level === "watch" ? "bg-amber-400" : "bg-emerald-500"}`} style={{width: `${Math.max(count ? 6 : 0, (count/maxRiskCount)*100)}%`}} /></div></div>)}</div></article>
      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">{fr ? "PERFORMANCE" : "PERFORMANCE"}</p><h2 className="mt-1 text-2xl font-black">{fr ? "Tendance KPI · 6 périodes" : "KPI trend · 6 periods"}</h2><div className="mt-5 space-y-4">{trend.map((item) => <div key={item.month}><div className="flex items-center justify-between text-sm"><span className="font-bold">{item.month}</span><span className="font-black">{item.score.toFixed(1)}%</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{width: `${Math.min(100,Math.max(0,item.score))}%`}} /></div></div>)}{!trend.length ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{fr ? "Pas encore assez de résultats KPI validés pour afficher une tendance." : "Not enough accepted KPI results yet to show a trend."}</p> : null}</div></article>
    </section>

    <section className="mt-6 grid gap-4 lg:grid-cols-3">
      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">{fr ? "INCIDENTS" : "INCIDENTS"}</p><h2 className="mt-1 text-xl font-black">{fr ? "Répartition par gravité" : "Severity mix"}</h2><div className="mt-4 grid grid-cols-2 gap-3">{severityRows.map(([severity,count]) => <div key={severity} className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-500">{severity}</p><p className="mt-1 text-2xl font-black">{count}</p></div>)}</div></article>
      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{fr ? "RENOUVELLEMENTS" : "RENEWALS"}</p><h2 className="mt-1 text-xl font-black">{fr ? "Fenêtres de décision" : "Decision windows"}</h2><div className="mt-4 space-y-3"><div className="flex justify-between rounded-xl bg-amber-50 p-3 font-bold"><span>≤ 90 {fr ? "jours" : "days"}</span><span>{renewals90}</span></div><div className="flex justify-between rounded-xl bg-orange-50 p-3 font-bold"><span>≤ 60 {fr ? "jours" : "days"}</span><span>{renewals60}</span></div><div className="flex justify-between rounded-xl bg-red-50 p-3 font-bold"><span>≤ 30 {fr ? "jours" : "days"}</span><span>{renewals30}</span></div></div></article>
      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">{fr ? "PRESTATAIRES" : "PROVIDERS"}</p><h2 className="mt-1 text-xl font-black">{fr ? "Exposition prioritaire" : "Priority exposure"}</h2><div className="mt-4 space-y-2">{providerStats.map((row) => <div key={row.provider} className="rounded-xl bg-slate-50 p-3"><div className="flex justify-between gap-3"><span className="truncate font-black">{row.provider}</span><span className="text-xs font-black text-red-700">{row.atRisk ? `${row.atRisk} ${fr ? "à risque" : "at risk"}` : "OK"}</span></div><p className="mt-1 text-xs text-slate-500">{row.contracts} {fr ? "contrat(s)" : "contract(s)"} · KPI {row.score === null ? "—" : `${row.score.toFixed(1)}%`}</p></div>)}{!providerStats.length ? <p className="text-sm text-slate-500">—</p> : null}</div></article>
    </section>

    <form className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[1fr_190px_190px_auto_auto]">
      <input name="q" defaultValue={query.q ?? ""} placeholder={fr ? "Rechercher contrat, prestataire, responsable…" : "Search contract, provider, owner…"} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500" />
      <select name="scope" defaultValue={scope} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="open">{fr ? "Contrats ouverts" : "Open contracts"}</option><option value="all">{fr ? "Tous les contrats" : "All contracts"}</option></select>
      <select name="risk" defaultValue={risk} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="all">{fr ? "Tous les risques" : "All risks"}</option><option value="critical">{fr ? "Critique" : "Critical"}</option><option value="high">{fr ? "Élevé" : "High"}</option><option value="watch">{fr ? "À surveiller" : "Watch"}</option><option value="ok">{fr ? "Sous contrôle" : "On track"}</option></select>
      <button className="rounded-xl bg-slate-950 px-5 py-2 font-black text-white">{fr ? "Filtrer" : "Filter"}</button>
      <a href={exportHref} className="rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-2 text-center font-black text-emerald-800">{fr ? "Exporter CSV" : "Export CSV"}</a>
    </form>

    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-5"><h2 className="text-2xl font-black">{fr ? "Analyse par contrat" : "Contract-level analysis"}</h2><p className="mt-1 text-sm text-slate-500">{visible.length} {fr ? "contrat(s) affiché(s)" : "contract(s) shown"}</p></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">{fr ? "Contrat" : "Contract"}</th><th className="px-4 py-3">{fr ? "Risque" : "Risk"}</th><th className="px-4 py-3">KPI</th><th className="px-4 py-3">{fr ? "Retards" : "Delays"}</th><th className="px-4 py-3">{fr ? "Incidents" : "Incidents"}</th><th className="px-4 py-3">Finance</th><th className="px-4 py-3">{fr ? "Échéance" : "Expiry"}</th><th className="px-4 py-3">{fr ? "Statut" : "Status"}</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map((row) => <tr key={row.contract.id} className="align-top"><td className="px-4 py-4"><p className="font-black">{row.contract.title}</p><p className="mt-1 text-xs text-slate-500">{row.provider} · {row.contract.contract_number}</p><p className="mt-1 text-[11px] text-slate-400">{row.owner}</p></td><td className="px-4 py-4"><span className={`rounded-full px-3 py-1 text-[10px] font-black ${riskTone(row.risk)}`}>{riskLabel(row.risk,fr)}</span><p className="mt-2 text-xs text-slate-500">{row.riskPoints} pts</p></td><td className="px-4 py-4 font-black">{row.kpiScore === null ? "—" : `${row.kpiScore.toFixed(1)}%`}<p className="mt-1 text-[11px] font-normal text-slate-400">{fr ? "cible" : "target"} {row.target.toFixed(0)}%</p></td><td className="px-4 py-4"><p className="font-bold">{row.overdueDeliverables} {fr ? "livr." : "deliv."}</p><p className="text-xs text-slate-500">{row.overdueObligations} {fr ? "oblig." : "oblig."}</p></td><td className="px-4 py-4"><p className="font-bold">{row.openIncidents} {fr ? "ouvert(s)" : "open"}</p><p className="text-xs text-red-600">{row.criticalIncidents} critical · {row.highIncidents} high</p></td><td className="px-4 py-4"><p className="font-bold">{row.blockedFinancial} {fr ? "bloqué(s)" : "blocked"}</p><p className="text-xs text-slate-500">{row.reviewFinancial} review · {row.approvedUnpaid} {fr ? "approuvé(s)" : "approved"}</p></td><td className="px-4 py-4"><p className="font-black">{row.contract.end_date}</p><p className={`text-xs ${row.days < 0 ? "text-red-700" : row.days <= 90 ? "text-amber-700" : "text-slate-500"}`}>{row.days < 0 ? `${Math.abs(row.days)} ${fr ? "j expiré" : "d expired"}` : `J-${row.days}`}</p></td><td className="px-4 py-4"><span className="font-bold">{statusLabel(row.contract.status,fr)}</span></td><td className="px-4 py-4"><Link href={`/dashboard/contracts/${row.contract.id}`} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white">{fr ? "Passeport" : "Passport"}</Link></td></tr>)}{!visible.length ? <tr><td colSpan={9} className="px-4 py-8 text-center font-bold text-slate-500">{fr ? "Aucun contrat correspondant aux filtres." : "No contract matches the filters."}</td></tr> : null}</tbody></table></div></section>

    <section className="mt-6 grid gap-4 lg:grid-cols-3"><Link href="/dashboard/contracts/execution-center" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><p className="text-xs font-black uppercase text-indigo-700">{fr ? "EXÉCUTION" : "EXECUTION"}</p><p className="mt-2 text-xl font-black">{fr ? "Centre global d’exécution" : "Global execution centre"}</p></Link><Link href="/dashboard/contracts/risk-center" className="rounded-2xl border border-red-200 bg-red-50 p-5"><p className="text-xs font-black uppercase text-red-700">{fr ? "RISQUES" : "RISKS"}</p><p className="mt-2 text-xl font-black">{fr ? "Incidents & risques" : "Incidents & risks"}</p></Link><Link href="/dashboard/coming-soon/contracts-finance" className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-black uppercase text-slate-500">{fr ? "PROCHAINE ÉTAPE" : "NEXT STEP"}</p><p className="mt-2 text-xl font-black">{fr ? "Finance & paiements intégrés" : "Integrated Finance & payments"}</p><p className="mt-2 text-sm text-slate-600">{fr ? "Prochaine brique de la feuille de route contractuelle." : "Next workstream in the contract roadmap."}</p></Link></section>
  </div></main>;
}
