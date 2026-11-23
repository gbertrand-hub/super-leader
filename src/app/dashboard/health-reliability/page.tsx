import Link from "next/link";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {requireAccessContext} from "@/lib/auth/access-control";
import {getHealthReliabilitySnapshot} from "@/lib/health/reliability";
import type {HealthStatus} from "@/lib/health/types";

export const dynamic = "force-dynamic";

const statusTone: Record<HealthStatus, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  critical: "border-rose-200 bg-rose-50 text-rose-900",
};

const statusDot: Record<HealthStatus, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
};

function statusLabel(status: HealthStatus, fr: boolean) {
  if (status === "healthy") return fr ? "Healthy" : "Healthy";
  if (status === "warning") return fr ? "Warning" : "Warning";
  return fr ? "Critical" : "Critical";
}

function StatusBadge({status, fr}: {status: HealthStatus; fr: boolean}) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-wide ${statusTone[status]}`}>
      <span className={`h-2 w-2 rounded-full ${statusDot[status]}`} />
      {statusLabel(status, fr)}
    </span>
  );
}

function safeDate(value: string | null, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {dateStyle: "medium", timeStyle: "short"}).format(date);
}

export default async function HealthReliabilityPage() {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const context = await requireAccessContext();
  if (!["owner", "admin"].includes(context.role)) redirect("/dashboard/my-day");

  const snapshot = await getHealthReliabilitySnapshot(context);
  const healthy = snapshot.checks.filter((item) => item.status === "healthy").length;
  const warnings = snapshot.checks.filter((item) => item.status === "warning").length;
  const critical = snapshot.checks.filter((item) => item.status === "critical").length;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="overflow-hidden rounded-3xl bg-slate-950 p-7 text-white shadow-xl sm:p-9">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-4xl">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
                {fr ? "ADMINISTRATION · FIABILITÉ · SÉCURITÉ OPÉRATIONNELLE" : "ADMINISTRATION · RELIABILITY · OPERATIONAL SECURITY"}
              </p>
              <h1 className="mt-3 text-3xl font-black sm:text-4xl">Super Leader Health & Reliability Center</h1>
              <p className="mt-3 leading-7 text-slate-300">
                {fr
                  ? "Un centre de contrôle en lecture seule pour détecter rapidement les problèmes de base de données, d'authentification, de stockage, de migrations, de tâches de fond et de qualité des données, sans exposer les secrets techniques."
                  : "A read-only control centre for quickly detecting database, authentication, storage, migration, background-job, and data-quality problems without exposing technical secrets."}
              </p>
            </div>
            <div className="min-w-56 rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-xs font-black uppercase tracking-wider text-slate-400">{fr ? "État global" : "Overall status"}</p>
              <div className="mt-3"><StatusBadge status={snapshot.overallStatus} fr={fr} /></div>
              <p className="mt-3 text-xs text-slate-400">{fr ? "Dernier contrôle" : "Last check"}</p>
              <p className="mt-1 text-sm font-bold">{safeDate(snapshot.checkedAt, locale)}</p>
              <Link href="/dashboard/health-reliability?refresh=1" className="mt-4 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950">
                {fr ? "Relancer les contrôles" : "Run checks again"}
              </Link>
            </div>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric value={healthy} label={fr ? "Healthy" : "Healthy"} />
            <Metric value={warnings} label={fr ? "Warning" : "Warning"} />
            <Metric value={critical} label={fr ? "Critical" : "Critical"} />
            <Metric value={snapshot.failedJobs24h} label={fr ? "Jobs échoués · 24 h" : "Failed jobs · 24h"} />
            <Metric value={snapshot.openIncidents} label={fr ? "Incidents ouverts" : "Open incidents"} />
          </div>
        </header>

        <section className="mt-6 rounded-3xl border border-cyan-200 bg-cyan-50 p-5 text-cyan-950">
          <p className="font-black">🔒 {fr ? "Conception sans secrets" : "Secret-safe by design"}</p>
          <p className="mt-1 text-sm leading-6">
            {fr
              ? "Cette page n'affiche ni mot de passe, ni clé API, ni token, ni URL de connexion complète. Les conseils de correction restent volontairement opérationnels et non sensibles."
              : "This page never displays passwords, API keys, tokens, or full connection URLs. Corrective guidance is deliberately operational and non-sensitive."}
          </p>
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{fr ? "CONTRÔLES EN TEMPS RÉEL" : "LIVE CHECKS"}</p>
              <h2 className="mt-1 text-2xl font-black">{fr ? "Santé des composants critiques" : "Critical component health"}</h2>
            </div>
            <p className="text-sm text-slate-500">App {snapshot.applicationVersion} · Manifest {snapshot.manifestVersion}</p>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {snapshot.checks.map((item) => (
              <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{item.id.replaceAll("-", " ")}</p>
                    <h3 className="mt-1 text-xl font-black">{fr ? item.titleFr : item.titleEn}</h3>
                  </div>
                  <StatusBadge status={item.status} fr={fr} />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-700">{fr ? item.summaryFr : item.summaryEn}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                  {item.metric ? <span className="rounded-full bg-slate-100 px-3 py-1">{item.metric}</span> : null}
                  {typeof item.latencyMs === "number" ? <span className="rounded-full bg-slate-100 px-3 py-1">{item.latencyMs} ms</span> : null}
                  {item.affectsOverall === false ? <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">{fr ? "Informatif" : "Informational"}</span> : null}
                </div>
                <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{fr ? "Correction sûre" : "Safe corrective guidance"}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{fr ? item.guidanceFr : item.guidanceEn}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-5 xl:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{fr ? "AUTOMATISATIONS" : "AUTOMATIONS"}</p>
                <h2 className="mt-1 text-2xl font-black">{fr ? "Tâches de fond récentes" : "Recent background jobs"}</h2>
              </div>
              <div className="text-right text-xs font-bold text-slate-500">
                <p>{snapshot.failedJobs24h} {fr ? "échec(s)" : "failed"}</p>
                <p>{snapshot.warningJobs24h} {fr ? "alerte(s)" : "warning"}</p>
              </div>
            </div>
            <div className="mt-5 divide-y divide-slate-100">
              {snapshot.recentJobs.length ? snapshot.recentJobs.map((job) => (
                <div key={job.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-black">{job.jobName}</p>
                      <p className="mt-1 text-xs text-slate-500">{safeDate(job.startedAt, locale)}{job.durationMs !== null ? ` · ${job.durationMs} ms` : ""}</p>
                    </div>
                    <StatusBadge status={job.status === "failed" ? "critical" : job.status === "warning" ? "warning" : "healthy"} fr={fr} />
                  </div>
                  {job.summary ? <p className="mt-2 text-sm text-slate-600">{job.summary}</p> : null}
                </div>
              )) : <Empty text={fr ? "Aucune exécution récente enregistrée." : "No recent executions recorded."} />}
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{fr ? "INCIDENTS" : "INCIDENTS"}</p>
                <h2 className="mt-1 text-2xl font-black">{fr ? "Incidents techniques récents" : "Recent technical incidents"}</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{snapshot.openIncidents} {fr ? "ouvert(s)" : "open"}</span>
            </div>
            <div className="mt-5 divide-y divide-slate-100">
              {snapshot.recentIncidents.length ? snapshot.recentIncidents.map((incident) => (
                <div key={incident.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-black">{incident.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{incident.source} · {safeDate(incident.occurredAt, locale)}</p>
                    </div>
                    <StatusBadge status={incident.severity} fr={fr} />
                  </div>
                  {incident.summary ? <p className="mt-2 text-sm text-slate-600">{incident.summary}</p> : null}
                  <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-slate-400">{incident.status === "resolved" ? (fr ? "Résolu" : "Resolved") : (fr ? "Ouvert" : "Open")}</p>
                </div>
              )) : <Empty text={fr ? "Aucun incident récent enregistré." : "No recent technical incidents recorded."} />}
            </div>
          </article>
        </section>

        <section className="mt-10 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-600">{fr ? "QUALITÉ DES DONNÉES MÉTIER" : "BUSINESS DATA QUALITY"}</p>
              <h2 className="mt-1 text-2xl font-black">{fr ? "Résumé Terrains" : "Land data summary"}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                {fr
                  ? "Contrôle non destructif des offres Terrain et opportunités ouvertes : présence du code, description, prix, localisation, superficie et référence du lot."
                  : "Non-destructive review of Land offers and open opportunities: code, description, price, location, surface area, and lot reference."}
              </p>
            </div>
            <Link href="/dashboard/crm/catalog" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">{fr ? "Ouvrir le catalogue" : "Open catalogue"}</Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DataMetric value={snapshot.land.activeProducts} label={fr ? "Produits Terrain actifs" : "Active Land products"} />
            <DataMetric value={snapshot.land.productIssues} label={fr ? "Produits à compléter" : "Products needing data"} warning={snapshot.land.productIssues > 0} />
            <DataMetric value={snapshot.land.openOpportunities} label={fr ? "Opportunités ouvertes" : "Open opportunities"} />
            <DataMetric value={snapshot.land.opportunityIssues} label={fr ? "Opportunités à compléter" : "Opportunities needing data"} warning={snapshot.land.opportunityIssues > 0} />
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-indigo-200 bg-indigo-50 p-6 text-indigo-950">
          <h2 className="text-xl font-black">{fr ? "Principe de correction" : "Corrective principle"}</h2>
          <p className="mt-2 text-sm leading-6">
            {fr
              ? "Le centre signale et guide; il ne répare jamais silencieusement une donnée métier, ne change pas une politique RLS et ne modifie pas une migration automatiquement. Les actions correctives restent explicites et auditables."
              : "The centre detects and guides; it never silently repairs business data, changes an RLS policy, or modifies a migration automatically. Corrective actions remain explicit and auditable."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/dashboard/audit-security" className="rounded-xl bg-indigo-950 px-4 py-2 text-sm font-black text-white">{fr ? "Audit & sécurité" : "Audit & security"}</Link>
            <Link href="/dashboard/module-status" className="rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-black text-indigo-950">{fr ? "État des modules" : "Module status"}</Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({value, label}: {value: number; label: string}) {
  return <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-2xl font-black">{value}</p><p className="mt-1 text-xs font-bold text-slate-300">{label}</p></div>;
}

function DataMetric({value, label, warning = false}: {value: number; label: string; warning?: boolean}) {
  return <div className={`rounded-2xl border p-5 ${warning ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}><p className="text-3xl font-black">{value}</p><p className={`mt-1 text-sm font-bold ${warning ? "text-amber-800" : "text-slate-600"}`}>{label}</p></div>;
}

function Empty({text}: {text: string}) {
  return <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{text}</div>;
}
