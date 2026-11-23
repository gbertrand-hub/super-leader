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
  end_date: string;
  status: string;
  performance_target: number | string;
  current_version: number | string | null;
};

type ProviderRow = {id: string; legal_name: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type DeliverableRow = {id: string; contract_id: string; title: string; due_date: string; status: string; review_score: number | string | null};
type ObligationOccurrenceRow = {id: string; contract_id: string; due_date: string; status: string; review_score: number | string | null};
type KpiResultRow = {id: string; contract_id: string; kpi_id: string; period_end: string; score: number | string; status: string};
type IncidentRow = {id: string; contract_id: string; title: string; severity: string; status: string; due_date: string | null};
type FinancialRow = {id: string; contract_id: string; due_date: string | null; calculated_amount: number | string; currency: string; gate_status: string; status: string};
type ReportRow = {id: string; contract_id: string; period_end: string; status: string};
type RenewalRow = {id: string; contract_id: string; is_final: boolean; decided_at: string};

type ContractSignals = {
  contract: ContractRow;
  provider: string;
  owner: string;
  days: number;
  overdueDeliverables: number;
  overdueObligations: number;
  pendingReports: number;
  kpiScore: number | null;
  openIncidents: number;
  highIncidents: number;
  criticalIncidents: number;
  blockedFinancial: number;
  reviewFinancial: number;
  approvedUnpaid: number;
  renewalDue: boolean;
  risk: "critical" | "high" | "watch" | "ok";
  riskPoints: number;
  reasons: string[];
};

const LEADERS = new Set(["owner", "admin", "executive", "hr", "manager"]);
const CLOSED_CONTRACTS = new Set(["completed", "terminated"]);
const CLOSED_DELIVERABLES = new Set(["accepted", "cancelled"]);
const CLOSED_OCCURRENCES = new Set(["accepted", "waived"]);
const CLOSED_INCIDENTS = new Set(["resolved", "closed"]);
const CLOSED_FINANCIAL = new Set(["paid", "delivered", "cancelled", "rejected"]);

function daysUntil(date: string) {
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.ceil((new Date(`${date}T00:00:00Z`).getTime() - start) / 86400000);
}

function todayIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

function n(value: number | string | null | undefined) {
  const out = Number(value ?? 0);
  return Number.isFinite(out) ? out : 0;
}

function avg(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function riskTone(risk: ContractSignals["risk"]) {
  if (risk === "critical") return "border-red-300 bg-red-50 text-red-900";
  if (risk === "high") return "border-orange-300 bg-orange-50 text-orange-950";
  if (risk === "watch") return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function riskLabel(risk: ContractSignals["risk"], fr: boolean) {
  const labels = {
    critical: fr ? "CRITIQUE" : "CRITICAL",
    high: fr ? "ÉLEVÉ" : "HIGH",
    watch: fr ? "À SURVEILLER" : "WATCH",
    ok: fr ? "SOUS CONTRÔLE" : "ON TRACK",
  };
  return labels[risk];
}

function statusLabel(status: string, fr: boolean) {
  const map: Record<string, [string, string]> = {
    draft: ["Brouillon", "Draft"], active: ["Actif", "Active"], under_review: ["En revue", "Under review"],
    renewed: ["Renouvelé", "Renewed"], suspended: ["Suspendu", "Suspended"], completed: ["Terminé", "Completed"], terminated: ["Résilié", "Terminated"],
  };
  return (map[status] ?? [status, status])[fr ? 0 : 1];
}

export default async function ContractExecutionCenter({searchParams}: {searchParams: Promise<{q?: string; risk?: string; status?: string}>}) {
  const [{locale}, query, context] = await Promise.all([getI18n(), searchParams, requireAccessContext()]);
  const fr = locale === "fr";
  if (!LEADERS.has(context.role)) redirect("/dashboard/my-day");

  const contractsRes = await context.admin.from("service_contracts")
    .select("id,provider_id,contract_number,title,internal_owner_user_id,end_date,status,performance_target,current_version")
    .eq("organization_id", context.organizationId)
    .order("end_date", {ascending: true});
  if (contractsRes.error) throw new Error(contractsRes.error.message);

  let contracts = (contractsRes.data ?? []) as ContractRow[];
  if (context.role === "manager") contracts = contracts.filter((row) => row.internal_owner_user_id === context.user.id);
  const contractIds = new Set(contracts.map((row) => row.id));
  const ownerIds = [...new Set(contracts.map((row) => row.internal_owner_user_id))];

  const [providerRes, profileRes, deliverableRes, occurrenceRes, kpiRes, incidentRes, financialRes, reportRes, renewalRes] = await Promise.all([
    context.admin.from("service_providers").select("id,legal_name").eq("organization_id", context.organizationId),
    ownerIds.length ? context.admin.from("profiles").select("id,full_name,email").in("id", ownerIds) : Promise.resolve({data: [] as ProfileRow[], error: null}),
    context.admin.from("service_contract_deliverables").select("id,contract_id,title,due_date,status,review_score").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_obligation_occurrences").select("id,contract_id,due_date,status,review_score").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_kpi_results").select("id,contract_id,kpi_id,period_end,score,status").eq("organization_id", context.organizationId).order("period_end", {ascending: false}),
    context.admin.from("service_contract_incidents").select("id,contract_id,title,severity,status,due_date").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_financial_items").select("id,contract_id,due_date,calculated_amount,currency,gate_status,status").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_reports").select("id,contract_id,period_end,status").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_renewal_reviews").select("id,contract_id,is_final,decided_at").eq("organization_id", context.organizationId).order("decided_at", {ascending: false}),
  ]);

  const firstError = [providerRes, profileRes, deliverableRes, occurrenceRes, kpiRes, incidentRes, financialRes, reportRes, renewalRes].find((res) => res.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const providers = (providerRes.data ?? []) as ProviderRow[];
  const profiles = (profileRes.data ?? []) as ProfileRow[];
  const providerById = new Map(providers.map((row) => [row.id, row.legal_name]));
  const ownerById = new Map(profiles.map((row) => [row.id, row.full_name || row.email || "—"]));
  const deliverables = ((deliverableRes.data ?? []) as DeliverableRow[]).filter((row) => contractIds.has(row.contract_id));
  const occurrences = ((occurrenceRes.data ?? []) as ObligationOccurrenceRow[]).filter((row) => contractIds.has(row.contract_id));
  const kpiResults = ((kpiRes.data ?? []) as KpiResultRow[]).filter((row) => contractIds.has(row.contract_id) && row.status === "accepted");
  const incidents = ((incidentRes.data ?? []) as IncidentRow[]).filter((row) => contractIds.has(row.contract_id));
  const financial = ((financialRes.data ?? []) as FinancialRow[]).filter((row) => contractIds.has(row.contract_id));
  const reports = ((reportRes.data ?? []) as ReportRow[]).filter((row) => contractIds.has(row.contract_id));
  const renewals = ((renewalRes.data ?? []) as RenewalRow[]).filter((row) => contractIds.has(row.contract_id));
  const today = todayIso();

  const latestKpiByKey = new Map<string, KpiResultRow>();
  for (const row of kpiResults) {
    const key = `${row.contract_id}:${row.kpi_id}`;
    if (!latestKpiByKey.has(key)) latestKpiByKey.set(key, row);
  }
  const latestFinalRenewal = new Set<string>();
  for (const row of renewals) if (row.is_final) latestFinalRenewal.add(row.contract_id);

  const signals: ContractSignals[] = contracts.map((contract) => {
    const d = deliverables.filter((row) => row.contract_id === contract.id);
    const o = occurrences.filter((row) => row.contract_id === contract.id);
    const i = incidents.filter((row) => row.contract_id === contract.id && !CLOSED_INCIDENTS.has(row.status));
    const f = financial.filter((row) => row.contract_id === contract.id && !CLOSED_FINANCIAL.has(row.status));
    const r = reports.filter((row) => row.contract_id === contract.id);
    const latestScores = [...latestKpiByKey.values()].filter((row) => row.contract_id === contract.id).map((row) => n(row.score));
    const kpiScore = avg(latestScores);
    const overdueDeliverables = d.filter((row) => row.due_date < today && !CLOSED_DELIVERABLES.has(row.status)).length;
    const overdueObligations = o.filter((row) => row.due_date < today && !CLOSED_OCCURRENCES.has(row.status)).length;
    const pendingReports = r.filter((row) => row.status === "submitted").length;
    const openIncidents = i.length;
    const highIncidents = i.filter((row) => row.severity === "high").length;
    const criticalIncidents = i.filter((row) => row.severity === "critical").length;
    const blockedFinancial = f.filter((row) => row.gate_status === "blocked" || row.status === "held").length;
    const reviewFinancial = f.filter((row) => row.gate_status === "review" && row.status === "pending").length;
    const approvedUnpaid = f.filter((row) => row.status === "approved").length;
    const days = daysUntil(contract.end_date);
    const renewalDue = !CLOSED_CONTRACTS.has(contract.status) && days <= 90 && !latestFinalRenewal.has(contract.id);
    const reasons: string[] = [];
    let points = 0;
    if (!CLOSED_CONTRACTS.has(contract.status) && days < 0) {points += 100; reasons.push(fr ? "Contrat actif expiré" : "Active contract expired");}
    if (criticalIncidents) {points += criticalIncidents * 80; reasons.push(fr ? `${criticalIncidents} incident(s) critique(s)` : `${criticalIncidents} critical incident(s)`);}
    if (blockedFinancial) {points += blockedFinancial * 60; reasons.push(fr ? `${blockedFinancial} paiement(s) bloqué(s)` : `${blockedFinancial} blocked payment(s)`);}
    if (highIncidents) {points += highIncidents * 45; reasons.push(fr ? `${highIncidents} incident(s) élevé(s)` : `${highIncidents} high-severity incident(s)`);}
    if (overdueDeliverables) {points += overdueDeliverables * 30; reasons.push(fr ? `${overdueDeliverables} livrable(s) en retard` : `${overdueDeliverables} overdue deliverable(s)`);}
    if (overdueObligations) {points += overdueObligations * 25; reasons.push(fr ? `${overdueObligations} obligation(s) en retard` : `${overdueObligations} overdue obligation(s)`);}
    const target = n(contract.performance_target);
    if (kpiScore !== null && target > 0 && kpiScore < target) {points += Math.max(20, Math.round(target - kpiScore)); reasons.push(fr ? `KPI ${kpiScore.toFixed(1)}% sous cible ${target.toFixed(0)}%` : `KPI ${kpiScore.toFixed(1)}% below ${target.toFixed(0)}% target`);}
    if (reviewFinancial) {points += reviewFinancial * 12; reasons.push(fr ? `${reviewFinancial} paiement(s) à revoir` : `${reviewFinancial} payment(s) to review`);}
    if (pendingReports) {points += pendingReports * 8; reasons.push(fr ? `${pendingReports} rapport(s) à valider` : `${pendingReports} report(s) to review`);}
    if (renewalDue) {points += days <= 30 ? 25 : days <= 60 ? 15 : 8; reasons.push(fr ? `Renouvellement J-${Math.max(0, days)}` : `Renewal D-${Math.max(0, days)}`);}
    const risk: ContractSignals["risk"] = points >= 80 ? "critical" : points >= 40 ? "high" : points > 0 ? "watch" : "ok";
    return {
      contract, provider: providerById.get(contract.provider_id) || "—", owner: ownerById.get(contract.internal_owner_user_id) || "—", days,
      overdueDeliverables, overdueObligations, pendingReports, kpiScore, openIncidents, highIncidents, criticalIncidents,
      blockedFinancial, reviewFinancial, approvedUnpaid, renewalDue, risk, riskPoints: points, reasons,
    };
  });

  const q = String(query.q ?? "").trim().toLowerCase();
  const riskFilter = String(query.risk ?? "all");
  const statusFilter = String(query.status ?? "open");
  const visible = signals.filter((item) => {
    const matchesQ = !q || [item.contract.title, item.contract.contract_number, item.provider, item.owner].some((value) => value.toLowerCase().includes(q));
    const matchesRisk = riskFilter === "all" || item.risk === riskFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "open" ? !CLOSED_CONTRACTS.has(item.contract.status) : item.contract.status === statusFilter);
    return matchesQ && matchesRisk && matchesStatus;
  }).sort((a, b) => b.riskPoints - a.riskPoints || a.contract.end_date.localeCompare(b.contract.end_date));

  const openSignals = signals.filter((item) => !CLOSED_CONTRACTS.has(item.contract.status));
  const atRisk = openSignals.filter((item) => item.risk === "critical" || item.risk === "high").length;
  const overdueDeliverables = openSignals.reduce((sum, item) => sum + item.overdueDeliverables, 0);
  const overdueObligations = openSignals.reduce((sum, item) => sum + item.overdueObligations, 0);
  const openIncidents = openSignals.reduce((sum, item) => sum + item.openIncidents, 0);
  const blockedPayments = openSignals.reduce((sum, item) => sum + item.blockedFinancial, 0);
  const paymentsToReview = openSignals.reduce((sum, item) => sum + item.reviewFinancial, 0);
  const renewalsDue = openSignals.filter((item) => item.renewalDue).length;
  const approvedUnpaid = openSignals.reduce((sum, item) => sum + item.approvedUnpaid, 0);
  const priorityQueue = openSignals.filter((item) => item.risk !== "ok").sort((a, b) => b.riskPoints - a.riskPoints).slice(0, 12);

  return <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6"><div className="mx-auto max-w-7xl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/dashboard/contracts" className="text-sm font-black text-indigo-700">← {fr ? "Prestataires & Contrats" : "Providers & Contracts"}</Link>
      <Link href="/dashboard/module-status" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700">{fr ? "Feuille de route" : "Roadmap"}</Link>
    </div>

    <header className="mt-4 rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">SUPER LEADER OPERATIONS · V4.10.14</p>
      <h1 className="mt-3 text-3xl font-black sm:text-4xl">{fr ? "Centre global d’exécution des contrats" : "Global contract execution centre"}</h1>
      <p className="mt-3 max-w-4xl text-sm text-slate-300">{fr ? "Une vue de pilotage unique pour savoir quels contrats exigent une action maintenant: retards, obligations, KPI, incidents, paiements et renouvellements." : "One command view showing which contracts need action now: delays, obligations, KPIs, incidents, payments and renewals."}</p>
    </header>

    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[
        [fr ? "Contrats ouverts" : "Open contracts", openSignals.length, "text-slate-950"],
        [fr ? "Contrats à risque" : "Contracts at risk", atRisk, atRisk ? "text-red-700" : "text-emerald-700"],
        [fr ? "Livrables en retard" : "Overdue deliverables", overdueDeliverables, overdueDeliverables ? "text-orange-700" : "text-emerald-700"],
        [fr ? "Obligations en retard" : "Overdue obligations", overdueObligations, overdueObligations ? "text-orange-700" : "text-emerald-700"],
        [fr ? "Incidents ouverts" : "Open incidents", openIncidents, openIncidents ? "text-red-700" : "text-emerald-700"],
        [fr ? "Paiements bloqués" : "Blocked payments", blockedPayments, blockedPayments ? "text-red-700" : "text-emerald-700"],
        [fr ? "Paiements à revoir" : "Payments to review", paymentsToReview, paymentsToReview ? "text-amber-700" : "text-emerald-700"],
        [fr ? "Renouvellements ≤ 90 j" : "Renewals ≤ 90 d", renewalsDue, renewalsDue ? "text-indigo-700" : "text-emerald-700"],
      ].map(([label, value, tone]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 text-3xl font-black ${tone}`}>{value}</p></article>)}
    </section>

    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">{fr ? "FILE D’ACTION" : "ACTION QUEUE"}</p><h2 className="mt-1 text-2xl font-black">{fr ? "À traiter maintenant" : "Needs attention now"}</h2></div><p className="text-sm font-bold text-slate-500">{fr ? `${priorityQueue.length} priorité(s) affichée(s)` : `${priorityQueue.length} priorities shown`}</p></div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{priorityQueue.map((item) => <Link key={item.contract.id} href={`/dashboard/contracts/${item.contract.id}`} className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 ${riskTone(item.risk)}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase opacity-70">{item.provider} · {item.contract.contract_number}</p><h3 className="mt-1 text-lg font-black">{item.contract.title}</h3><p className="mt-1 text-xs font-bold opacity-70">{item.owner} · {item.days < 0 ? (fr ? `expiré depuis ${Math.abs(item.days)} j` : `expired ${Math.abs(item.days)} d ago`) : (fr ? `${item.days} j restant(s)` : `${item.days} d remaining`)}</p></div><span className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-black">{riskLabel(item.risk, fr)}</span></div><div className="mt-3 flex flex-wrap gap-2">{item.reasons.slice(0, 4).map((reason) => <span key={reason} className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold">{reason}</span>)}</div></Link>)}{!priorityQueue.length ? <p className="rounded-2xl bg-emerald-50 p-5 font-bold text-emerald-800 lg:col-span-2">{fr ? "Aucune alerte prioritaire sur les contrats ouverts." : "No priority alert across open contracts."}</p> : null}</div>
    </section>

    <form className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_220px_220px_auto]">
      <input name="q" defaultValue={query.q ?? ""} placeholder={fr ? "Rechercher contrat, prestataire, responsable…" : "Search contract, provider, owner…"} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500" />
      <select name="risk" defaultValue={riskFilter} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="all">{fr ? "Tous les niveaux" : "All risk levels"}</option><option value="critical">{fr ? "Critique" : "Critical"}</option><option value="high">{fr ? "Élevé" : "High"}</option><option value="watch">{fr ? "À surveiller" : "Watch"}</option><option value="ok">{fr ? "Sous contrôle" : "On track"}</option></select>
      <select name="status" defaultValue={statusFilter} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="open">{fr ? "Contrats ouverts" : "Open contracts"}</option><option value="all">{fr ? "Tous les statuts" : "All statuses"}</option>{["draft","active","under_review","renewed","suspended","completed","terminated"].map((status) => <option key={status} value={status}>{statusLabel(status, fr)}</option>)}</select>
      <button className="rounded-xl bg-slate-950 px-5 py-2 font-black text-white">{fr ? "Filtrer" : "Filter"}</button>
    </form>

    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5"><h2 className="text-2xl font-black">{fr ? "Exécution par contrat" : "Execution by contract"}</h2><p className="mt-1 text-sm text-slate-500">{fr ? "Les signaux sont calculés à partir des données opérationnelles déjà enregistrées dans Super Leader." : "Signals are calculated from operational data already recorded in Super Leader."}</p></div>
      <div className="overflow-x-auto"><table className="min-w-[1180px] w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">{fr ? "Contrat" : "Contract"}</th><th className="px-4 py-3">{fr ? "Risque" : "Risk"}</th><th className="px-4 py-3">KPI</th><th className="px-4 py-3">{fr ? "Retards" : "Delays"}</th><th className="px-4 py-3">{fr ? "Incidents" : "Incidents"}</th><th className="px-4 py-3">{fr ? "Finance" : "Finance"}</th><th className="px-4 py-3">{fr ? "Échéance" : "Expiry"}</th><th className="px-4 py-3"></th></tr></thead><tbody>{visible.map((item) => <tr key={item.contract.id} className="border-t border-slate-100 align-top"><td className="px-4 py-4"><p className="font-black">{item.contract.title}</p><p className="mt-1 text-xs text-slate-500">{item.provider} · {item.owner}</p><p className="mt-1 text-[11px] font-bold text-slate-400">{item.contract.contract_number} · V{item.contract.current_version ?? 1}</p></td><td className="px-4 py-4"><span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black ${riskTone(item.risk)}`}>{riskLabel(item.risk, fr)}</span></td><td className="px-4 py-4"><p className="font-black">{item.kpiScore === null ? "—" : `${item.kpiScore.toFixed(1)}%`}</p><p className="text-xs text-slate-500">{fr ? `cible ${n(item.contract.performance_target).toFixed(0)}%` : `target ${n(item.contract.performance_target).toFixed(0)}%`}</p></td><td className="px-4 py-4"><p className={item.overdueDeliverables ? "font-black text-orange-700" : "font-bold text-slate-600"}>{item.overdueDeliverables} {fr ? "livr." : "deliv."}</p><p className={item.overdueObligations ? "font-black text-orange-700" : "text-xs text-slate-500"}>{item.overdueObligations} {fr ? "oblig." : "oblig."}</p><p className={item.pendingReports ? "text-xs font-bold text-amber-700" : "text-xs text-slate-400"}>{item.pendingReports} {fr ? "rapport(s) à valider" : "report(s) pending"}</p></td><td className="px-4 py-4"><p className={item.openIncidents ? "font-black text-red-700" : "font-bold text-slate-600"}>{item.openIncidents} {fr ? "ouvert(s)" : "open"}</p><p className="text-xs text-slate-500">{item.criticalIncidents} critical · {item.highIncidents} high</p></td><td className="px-4 py-4"><p className={item.blockedFinancial ? "font-black text-red-700" : "font-bold text-slate-600"}>{item.blockedFinancial} {fr ? "bloqué(s)" : "blocked"}</p><p className={item.reviewFinancial ? "text-xs font-bold text-amber-700" : "text-xs text-slate-500"}>{item.reviewFinancial} review · {item.approvedUnpaid} {fr ? "approuvé(s)" : "approved"}</p></td><td className="px-4 py-4"><p className="font-black">{item.contract.end_date}</p><p className={item.renewalDue ? "text-xs font-black text-indigo-700" : "text-xs text-slate-500"}>{item.days < 0 ? (fr ? `${Math.abs(item.days)} j dépassé(s)` : `${Math.abs(item.days)} d overdue`) : (fr ? `J-${item.days}` : `D-${item.days}`)}</p></td><td className="px-4 py-4"><Link href={`/dashboard/contracts/${item.contract.id}`} className="inline-flex rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white">{fr ? "Passeport" : "Passport"}</Link></td></tr>)}{!visible.length ? <tr><td colSpan={8} className="px-5 py-10 text-center font-bold text-slate-500">{fr ? "Aucun contrat correspondant aux filtres." : "No contract matches the filters."}</td></tr> : null}</tbody></table></div>
    </section>

    <section className="mt-6 grid gap-4 lg:grid-cols-3">
      <Link href="/dashboard/contracts#renewal-queue" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><p className="text-xs font-black uppercase text-indigo-700">{fr ? "Renouvellements" : "Renewals"}</p><p className="mt-2 text-2xl font-black">{renewalsDue}</p><p className="mt-2 text-sm text-indigo-900">{fr ? "Ouvrir la file J-90 / J-60 / J-30 et décisions finales." : "Open D-90 / D-60 / D-30 and final decision queue."}</p></Link>
      <Link href="/dashboard/contracts/documents" className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><p className="text-xs font-black uppercase text-blue-700">{fr ? "Documents & avenants" : "Documents & amendments"}</p><p className="mt-2 text-2xl font-black">V4.10.12</p><p className="mt-2 text-sm text-blue-900">{fr ? "Consulter le registre documentaire et les versions contractuelles." : "Open the document register and contract versions."}</p></Link>
      <Link href="/dashboard/contracts/risk-center" className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="text-xs font-black uppercase text-amber-700">{fr ? "Incidents & risques" : "Incidents & risks"}</p><p className="mt-2 text-xl font-black">{fr ? "Incidents & risques · vue globale" : "Incidents & risks · global view"}</p><p className="mt-2 text-sm text-amber-900">{fr ? "Ouvrir la vue globale des incidents, actions correctives et risques contractuels." : "Open the global view of incidents, corrective actions and contract risks."}</p></Link>
    </section>

    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><span className="font-black text-slate-900">{fr ? "Contrôle financier:" : "Financial control:"}</span> {fr ? `${blockedPayments} bloqué(s), ${paymentsToReview} à revoir, ${approvedUnpaid} approuvé(s) non encore clôturé(s). Aucun paiement bancaire n’est déclenché depuis ce centre.` : `${blockedPayments} blocked, ${paymentsToReview} to review, ${approvedUnpaid} approved and not yet closed. This centre never triggers a bank payment.`}</section>
  </div></main>;
}
