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
};
type ProviderRow = {id: string; legal_name: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type IncidentRow = {
  id: string;
  contract_id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  corrective_action: string;
  owner_user_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};
type DeliverableRow = {contract_id: string; due_date: string; status: string};
type ObligationRow = {contract_id: string; due_date: string; status: string};
type KpiRow = {contract_id: string; kpi_id: string; period_end: string; score: number | string; status: string};
type FinancialRow = {contract_id: string; gate_status: string; status: string};
type RenewalRow = {contract_id: string; is_final: boolean; decided_at: string};

type RiskLevel = "critical" | "high" | "watch" | "ok";
type ContractRisk = {
  contract: ContractRow;
  provider: string;
  owner: string;
  risk: RiskLevel;
  points: number;
  openIncidents: number;
  criticalIncidents: number;
  highIncidents: number;
  overdueIncidents: number;
  overdueDeliverables: number;
  overdueObligations: number;
  blockedFinancial: number;
  kpiScore: number | null;
  reasons: string[];
};

const LEADERS = new Set(["owner", "admin", "executive", "hr", "manager"]);
const CLOSED_CONTRACTS = new Set(["completed", "terminated"]);
const CLOSED_INCIDENTS = new Set(["resolved", "closed"]);
const CLOSED_DELIVERABLES = new Set(["accepted", "cancelled"]);
const CLOSED_OCCURRENCES = new Set(["accepted", "waived"]);

function todayIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}
function daysUntil(date: string) {
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.ceil((new Date(`${date}T00:00:00Z`).getTime() - start) / 86400000);
}
function daysOpen(createdAt: string) {
  const created = new Date(createdAt).getTime();
  return Math.max(0, Math.floor((Date.now() - created) / 86400000));
}
function n(value: number | string | null | undefined) {
  const out = Number(value ?? 0);
  return Number.isFinite(out) ? out : 0;
}
function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function severityRank(value: string) {
  return ({critical: 4, high: 3, medium: 2, low: 1} as Record<string, number>)[value] ?? 0;
}
function severityTone(value: string) {
  if (value === "critical") return "bg-red-700 text-white";
  if (value === "high") return "bg-orange-100 text-orange-900";
  if (value === "medium") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}
function riskTone(value: RiskLevel) {
  if (value === "critical") return "border-red-300 bg-red-50 text-red-900";
  if (value === "high") return "border-orange-300 bg-orange-50 text-orange-950";
  if (value === "watch") return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}
function riskLabel(value: RiskLevel, fr: boolean) {
  const labels: Record<RiskLevel, [string, string]> = {
    critical: ["CRITIQUE", "CRITICAL"],
    high: ["ÉLEVÉ", "HIGH"],
    watch: ["À SURVEILLER", "WATCH"],
    ok: ["SOUS CONTRÔLE", "ON TRACK"],
  };
  return labels[value][fr ? 0 : 1];
}
function statusLabel(value: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    open: ["Ouvert", "Open"], corrective_action: ["Action corrective", "Corrective action"], resolved: ["Résolu", "Resolved"], closed: ["Clôturé", "Closed"],
  };
  return (labels[value] ?? [value, value])[fr ? 0 : 1];
}

export default async function ContractRiskCenter({searchParams}: {searchParams: Promise<{q?: string; severity?: string; status?: string; due?: string}>}) {
  const [{locale}, query, context] = await Promise.all([getI18n(), searchParams, requireAccessContext()]);
  const fr = locale === "fr";
  if (!LEADERS.has(context.role)) redirect("/dashboard/my-day");

  const [contractsRes, providerRes, incidentRes, deliverableRes, obligationRes, kpiRes, financialRes, renewalRes] = await Promise.all([
    context.admin.from("service_contracts").select("id,provider_id,contract_number,title,internal_owner_user_id,end_date,status,performance_target").eq("organization_id", context.organizationId).order("end_date", {ascending: true}),
    context.admin.from("service_providers").select("id,legal_name").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_incidents").select("id,contract_id,title,description,severity,status,corrective_action,owner_user_id,due_date,created_at,updated_at").eq("organization_id", context.organizationId).order("created_at", {ascending: false}),
    context.admin.from("service_contract_deliverables").select("contract_id,due_date,status").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_obligation_occurrences").select("contract_id,due_date,status").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_kpi_results").select("contract_id,kpi_id,period_end,score,status").eq("organization_id", context.organizationId).order("period_end", {ascending: false}),
    context.admin.from("service_contract_financial_items").select("contract_id,gate_status,status").eq("organization_id", context.organizationId),
    context.admin.from("service_contract_renewal_reviews").select("contract_id,is_final,decided_at").eq("organization_id", context.organizationId).order("decided_at", {ascending: false}),
  ]);
  const firstError = [contractsRes, providerRes, incidentRes, deliverableRes, obligationRes, kpiRes, financialRes, renewalRes].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  let contracts = (contractsRes.data ?? []) as ContractRow[];
  if (context.role === "manager") contracts = contracts.filter((row) => row.internal_owner_user_id === context.user.id);
  const contractIds = new Set(contracts.map((row) => row.id));
  const incidents = ((incidentRes.data ?? []) as IncidentRow[]).filter((row) => contractIds.has(row.contract_id));
  const ownerIds = [...new Set([...contracts.map((row) => row.internal_owner_user_id), ...incidents.map((row) => row.owner_user_id).filter(Boolean) as string[]])];
  const profileRes = ownerIds.length ? await context.admin.from("profiles").select("id,full_name,email").in("id", ownerIds) : {data: [] as ProfileRow[], error: null};
  if (profileRes.error) throw new Error(profileRes.error.message);

  const providers = (providerRes.data ?? []) as ProviderRow[];
  const profiles = (profileRes.data ?? []) as ProfileRow[];
  const providerById = new Map(providers.map((row) => [row.id, row.legal_name]));
  const profileById = new Map(profiles.map((row) => [row.id, row.full_name || row.email || "—"]));
  const contractById = new Map(contracts.map((row) => [row.id, row]));
  const deliverables = ((deliverableRes.data ?? []) as DeliverableRow[]).filter((row) => contractIds.has(row.contract_id));
  const obligations = ((obligationRes.data ?? []) as ObligationRow[]).filter((row) => contractIds.has(row.contract_id));
  const kpiRows = ((kpiRes.data ?? []) as KpiRow[]).filter((row) => contractIds.has(row.contract_id) && row.status === "accepted");
  const financial = ((financialRes.data ?? []) as FinancialRow[]).filter((row) => contractIds.has(row.contract_id));
  const renewals = ((renewalRes.data ?? []) as RenewalRow[]).filter((row) => contractIds.has(row.contract_id));
  const today = todayIso();

  const latestKpiByKey = new Map<string, KpiRow>();
  for (const row of kpiRows) {
    const key = `${row.contract_id}:${row.kpi_id}`;
    if (!latestKpiByKey.has(key)) latestKpiByKey.set(key, row);
  }
  const contractsWithFinalRenewal = new Set(renewals.filter((row) => row.is_final).map((row) => row.contract_id));

  const risks: ContractRisk[] = contracts.map((contract) => {
    const open = incidents.filter((row) => row.contract_id === contract.id && !CLOSED_INCIDENTS.has(row.status));
    const criticalIncidents = open.filter((row) => row.severity === "critical").length;
    const highIncidents = open.filter((row) => row.severity === "high").length;
    const overdueIncidents = open.filter((row) => row.due_date && row.due_date < today).length;
    const overdueDeliverables = deliverables.filter((row) => row.contract_id === contract.id && row.due_date < today && !CLOSED_DELIVERABLES.has(row.status)).length;
    const overdueObligations = obligations.filter((row) => row.contract_id === contract.id && row.due_date < today && !CLOSED_OCCURRENCES.has(row.status)).length;
    const blockedFinancial = financial.filter((row) => row.contract_id === contract.id && (row.gate_status === "blocked" || row.status === "held")).length;
    const reviewFinancial = financial.filter((row) => row.contract_id === contract.id && row.gate_status === "review" && row.status === "pending").length;
    const latestScores = [...latestKpiByKey.values()].filter((row) => row.contract_id === contract.id).map((row) => n(row.score));
    const kpiScore = average(latestScores);
    const days = daysUntil(contract.end_date);
    const renewalDue = !CLOSED_CONTRACTS.has(contract.status) && days <= 90 && !contractsWithFinalRenewal.has(contract.id);
    const target = n(contract.performance_target);
    const reasons: string[] = [];
    let points = 0;
    if (!CLOSED_CONTRACTS.has(contract.status) && days < 0) {points += 100; reasons.push(fr ? "Contrat actif expiré" : "Active contract expired");}
    if (criticalIncidents) {points += criticalIncidents * 80; reasons.push(fr ? `${criticalIncidents} incident(s) critique(s)` : `${criticalIncidents} critical incident(s)`);}
    if (blockedFinancial) {points += blockedFinancial * 60; reasons.push(fr ? `${blockedFinancial} paiement(s) bloqué(s)` : `${blockedFinancial} blocked payment(s)`);}
    if (highIncidents) {points += highIncidents * 45; reasons.push(fr ? `${highIncidents} incident(s) élevé(s)` : `${highIncidents} high incident(s)`);}
    if (overdueIncidents) {points += overdueIncidents * 20; reasons.push(fr ? `${overdueIncidents} action(s) incident en retard` : `${overdueIncidents} overdue incident action(s)`);}
    if (overdueDeliverables) {points += overdueDeliverables * 30; reasons.push(fr ? `${overdueDeliverables} livrable(s) en retard` : `${overdueDeliverables} overdue deliverable(s)`);}
    if (overdueObligations) {points += overdueObligations * 25; reasons.push(fr ? `${overdueObligations} obligation(s) en retard` : `${overdueObligations} overdue obligation(s)`);}
    if (kpiScore !== null && target > 0 && kpiScore < target) {points += Math.max(20, Math.round(target - kpiScore)); reasons.push(fr ? `KPI ${kpiScore.toFixed(1)}% sous cible ${target.toFixed(0)}%` : `KPI ${kpiScore.toFixed(1)}% below ${target.toFixed(0)}% target`);}
    if (reviewFinancial) {points += reviewFinancial * 12; reasons.push(fr ? `${reviewFinancial} paiement(s) à revoir` : `${reviewFinancial} payment(s) to review`);}
    if (renewalDue) {points += days <= 30 ? 25 : days <= 60 ? 15 : 8; reasons.push(fr ? `Renouvellement J-${Math.max(0, days)}` : `Renewal D-${Math.max(0, days)}`);}
    const risk: RiskLevel = points >= 80 ? "critical" : points >= 40 ? "high" : points > 0 ? "watch" : "ok";
    return {contract, provider: providerById.get(contract.provider_id) || "—", owner: profileById.get(contract.internal_owner_user_id) || "—", risk, points, openIncidents: open.length, criticalIncidents, highIncidents, overdueIncidents, overdueDeliverables, overdueObligations, blockedFinancial, kpiScore, reasons};
  });

  const openIncidents = incidents.filter((row) => !CLOSED_INCIDENTS.has(row.status));
  const criticalCount = openIncidents.filter((row) => row.severity === "critical").length;
  const highCount = openIncidents.filter((row) => row.severity === "high").length;
  const overdueCount = openIncidents.filter((row) => row.due_date && row.due_date < today).length;
  const withoutCorrectiveAction = openIncidents.filter((row) => ["critical", "high"].includes(row.severity) && !row.corrective_action.trim()).length;
  const contractsAtRisk = risks.filter((row) => row.risk === "critical" || row.risk === "high").length;

  const q = String(query.q ?? "").trim().toLowerCase();
  const severityFilter = String(query.severity ?? "all");
  const statusFilter = String(query.status ?? "open");
  const dueFilter = String(query.due ?? "all");
  const visibleIncidents = incidents.filter((incident) => {
    const contract = contractById.get(incident.contract_id);
    if (!contract) return false;
    const provider = providerById.get(contract.provider_id) || "";
    const matchesQ = !q || [incident.title, incident.description, incident.corrective_action, contract.title, contract.contract_number, provider].some((value) => value.toLowerCase().includes(q));
    const matchesSeverity = severityFilter === "all" || incident.severity === severityFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "open" ? !CLOSED_INCIDENTS.has(incident.status) : incident.status === statusFilter);
    const isOverdue = Boolean(incident.due_date && incident.due_date < today && !CLOSED_INCIDENTS.has(incident.status));
    const matchesDue = dueFilter === "all" || (dueFilter === "overdue" ? isOverdue : dueFilter === "without_due" ? !incident.due_date : true);
    return matchesQ && matchesSeverity && matchesStatus && matchesDue;
  }).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || Number(Boolean(b.due_date && b.due_date < today)) - Number(Boolean(a.due_date && a.due_date < today)) || b.created_at.localeCompare(a.created_at));

  const topRisks = risks.filter((row) => row.risk !== "ok").sort((a, b) => b.points - a.points).slice(0, 8);

  return <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6"><div className="mx-auto max-w-7xl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/dashboard/contracts/execution-center" className="text-sm font-black text-indigo-700">← {fr ? "Centre global d’exécution" : "Global execution centre"}</Link>
      <Link href="/dashboard/module-status" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700">{fr ? "Feuille de route" : "Roadmap"}</Link>
    </div>

    <header className="mt-4 rounded-3xl bg-slate-950 p-7 text-white shadow-xl">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">SUPER LEADER OPERATIONS · V4.10.15</p>
      <h1 className="mt-3 text-3xl font-black sm:text-4xl">{fr ? "Incidents & risques · vue globale" : "Incidents & risks · global view"}</h1>
      <p className="mt-3 max-w-4xl text-sm text-slate-300">{fr ? "Une vue unique pour prioriser les non-conformités, actions correctives et risques contractuels avant qu’ils ne deviennent des problèmes financiers ou de renouvellement." : "One view to prioritise non-conformities, corrective actions and contract risks before they become financial or renewal problems."}</p>
    </header>

    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      {[
        [fr ? "Incidents ouverts" : "Open incidents", openIncidents.length, openIncidents.length ? "text-red-700" : "text-emerald-700"],
        [fr ? "Critiques" : "Critical", criticalCount, criticalCount ? "text-red-700" : "text-emerald-700"],
        [fr ? "Élevés" : "High", highCount, highCount ? "text-orange-700" : "text-emerald-700"],
        [fr ? "Actions en retard" : "Overdue actions", overdueCount, overdueCount ? "text-orange-700" : "text-emerald-700"],
        [fr ? "Sans action corrective" : "No corrective action", withoutCorrectiveAction, withoutCorrectiveAction ? "text-amber-700" : "text-emerald-700"],
        [fr ? "Contrats à risque" : "Contracts at risk", contractsAtRisk, contractsAtRisk ? "text-red-700" : "text-emerald-700"],
      ].map(([label, value, tone]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 text-3xl font-black ${tone}`}>{value}</p></article>)}
    </section>

    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">{fr ? "EXPOSITION" : "EXPOSURE"}</p><h2 className="mt-1 text-2xl font-black">{fr ? "Contrats à surveiller en priorité" : "Contracts requiring priority attention"}</h2></div><Link href="/dashboard/contracts/execution-center" className="text-sm font-black text-indigo-700">{fr ? "Voir toute l’exécution →" : "View all execution →"}</Link></div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{topRisks.map((item) => <Link key={item.contract.id} href={`/dashboard/contracts/${item.contract.id}`} className={`rounded-2xl border p-4 transition hover:-translate-y-0.5 ${riskTone(item.risk)}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase opacity-70">{item.provider} · {item.contract.contract_number}</p><h3 className="mt-1 text-lg font-black">{item.contract.title}</h3><p className="mt-1 text-xs font-bold opacity-70">{item.owner} · {item.points} {fr ? "pts risque" : "risk pts"}</p></div><span className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-black">{riskLabel(item.risk, fr)}</span></div><div className="mt-3 flex flex-wrap gap-2">{item.reasons.slice(0, 5).map((reason) => <span key={reason} className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold">{reason}</span>)}</div></Link>)}{!topRisks.length ? <p className="rounded-2xl bg-emerald-50 p-5 font-bold text-emerald-800 lg:col-span-2">{fr ? "Aucun contrat à risque actuellement." : "No contract is currently at risk."}</p> : null}</div>
    </section>

    <form className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[1fr_180px_190px_190px_auto]">
      <input name="q" defaultValue={query.q ?? ""} placeholder={fr ? "Rechercher incident, contrat, prestataire…" : "Search incident, contract, provider…"} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500" />
      <select name="severity" defaultValue={severityFilter} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="all">{fr ? "Toutes gravités" : "All severities"}</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      <select name="status" defaultValue={statusFilter} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="open">{fr ? "Incidents ouverts" : "Open incidents"}</option><option value="all">{fr ? "Tous statuts" : "All statuses"}</option><option value="corrective_action">{fr ? "Action corrective" : "Corrective action"}</option><option value="resolved">{fr ? "Résolus" : "Resolved"}</option><option value="closed">{fr ? "Clôturés" : "Closed"}</option></select>
      <select name="due" defaultValue={dueFilter} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="all">{fr ? "Toutes échéances" : "All due dates"}</option><option value="overdue">{fr ? "En retard" : "Overdue"}</option><option value="without_due">{fr ? "Sans échéance" : "No due date"}</option></select>
      <button className="rounded-xl bg-slate-950 px-5 py-2 font-black text-white">{fr ? "Filtrer" : "Filter"}</button>
    </form>

    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5"><h2 className="text-2xl font-black">{fr ? "Registre global des incidents" : "Global incident register"}</h2><p className="mt-1 text-sm text-slate-500">{fr ? "Chaque incident reste géré dans le Passeport du contrat; cette page sert à prioriser et superviser le portefeuille." : "Each incident remains managed in the contract Passport; this page prioritises and supervises the portfolio."}</p></div>
      <div className="grid gap-3 p-4">{visibleIncidents.map((incident) => {const contract = contractById.get(incident.contract_id)!; const overdue = Boolean(incident.due_date && incident.due_date < today && !CLOSED_INCIDENTS.has(incident.status)); const owner = incident.owner_user_id ? profileById.get(incident.owner_user_id) || "—" : "—"; return <article key={incident.id} className={`rounded-2xl border p-4 ${overdue ? "border-red-200 bg-red-50/50" : "border-slate-200 bg-white"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase ${severityTone(incident.severity)}`}>{incident.severity}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase text-slate-700">{statusLabel(incident.status, fr)}</span>{overdue ? <span className="rounded-full bg-red-100 px-3 py-1 text-[11px] font-black uppercase text-red-800">{fr ? "EN RETARD" : "OVERDUE"}</span> : null}</div><h3 className="mt-3 text-lg font-black">{incident.title}</h3><p className="mt-1 text-xs font-bold text-slate-500">{providerById.get(contract.provider_id) || "—"} · {contract.title} · {contract.contract_number}</p></div><Link href={`/dashboard/contracts/${contract.id}`} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white">{fr ? "Ouvrir le Passeport" : "Open Passport"}</Link></div><div className="mt-4 grid gap-3 md:grid-cols-4"><div><p className="text-[10px] font-black uppercase text-slate-400">{fr ? "Responsable" : "Owner"}</p><p className="mt-1 text-sm font-bold">{owner}</p></div><div><p className="text-[10px] font-black uppercase text-slate-400">{fr ? "Échéance" : "Due date"}</p><p className={`mt-1 text-sm font-bold ${overdue ? "text-red-700" : ""}`}>{incident.due_date || "—"}</p></div><div><p className="text-[10px] font-black uppercase text-slate-400">{fr ? "Âge" : "Age"}</p><p className="mt-1 text-sm font-bold">{daysOpen(incident.created_at)} {fr ? "jour(s)" : "day(s)"}</p></div><div><p className="text-[10px] font-black uppercase text-slate-400">{fr ? "Action corrective" : "Corrective action"}</p><p className={`mt-1 text-sm font-bold ${!incident.corrective_action.trim() && ["critical", "high"].includes(incident.severity) ? "text-red-700" : ""}`}>{incident.corrective_action.trim() || (fr ? "Non renseignée" : "Not provided")}</p></div></div>{incident.description ? <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{incident.description}</p> : null}</article>})}{!visibleIncidents.length ? <p className="rounded-2xl bg-emerald-50 p-5 text-center font-bold text-emerald-800">{fr ? "Aucun incident correspondant aux filtres." : "No incident matches the filters."}</p> : null}</div>
    </section>

    <section className="mt-6 grid gap-4 lg:grid-cols-3">
      <Link href="/dashboard/contracts/execution-center" className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><p className="text-xs font-black uppercase text-indigo-700">{fr ? "Exécution" : "Execution"}</p><p className="mt-2 text-xl font-black">{fr ? "Centre global d’exécution" : "Global execution centre"}</p><p className="mt-2 text-sm text-indigo-900">{fr ? "Croiser risques, KPI, retards, paiements et renouvellements." : "Cross-check risks, KPIs, delays, payments and renewals."}</p></Link>
      <Link href="/dashboard/contracts#renewal-queue" className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="text-xs font-black uppercase text-amber-700">{fr ? "Gouvernance" : "Governance"}</p><p className="mt-2 text-xl font-black">{fr ? "Renouvellements & décisions" : "Renewals & decisions"}</p><p className="mt-2 text-sm text-amber-900">{fr ? "Utiliser les signaux de risque avant une décision de renouvellement." : "Use risk signals before making a renewal decision."}</p></Link>
      <Link href="/dashboard/contracts/reports" className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-black uppercase text-slate-500">{fr ? "ANALYSES" : "ANALYTICS"}</p><p className="mt-2 text-xl font-black">{fr ? "Reporting & analyses" : "Reporting & analytics"}</p><p className="mt-2 text-sm text-slate-600">{fr ? "Ouvrir les indicateurs portefeuille, tendances KPI, exposition financière et renouvellements." : "Open portfolio indicators, KPI trends, financial exposure and renewals."}</p></Link>
    </section>
  </div></main>;
}
