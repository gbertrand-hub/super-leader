import Link from "next/link";
import {updateProspectQualificationAction} from "@/app/actions/crm-lead-scoring";
import {CrmModuleNav} from "@/components/crm/crm-module-nav";
import {canManageAmbassadors} from "@/lib/crm/ambassador-access";
import {getCrmServerContext} from "@/lib/crm/server";

type Props = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type LeadScoreRow = {
  id: string;
  reference: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  source_detail: string | null;
  campaign_name: string | null;
  product_interest: string | null;
  estimated_budget: number | null;
  budget_currency: string;
  budget_confirmed: boolean;
  lead_status: string;
  lead_priority: string;
  owner_id: string | null;
  follow_up_owner_id: string | null;
  next_action: string | null;
  next_action_at: string | null;
  qualification_need: string;
  purchase_timeline: string;
  decision_role: string;
  lead_score: number;
  lead_score_band: string;
  lead_score_breakdown: unknown;
  lead_score_updated_at: string | null;
  created_at: string;
};
type BreakdownItem = {points: number; max: number};
type Breakdown = {
  model?: string;
  status?: BreakdownItem;
  engagement?: BreakdownItem;
  need?: BreakdownItem;
  timing?: BreakdownItem;
  budget?: BreakdownItem;
  authority?: BreakdownItem;
  source?: BreakdownItem;
  signals?: {
    interaction_count?: number;
    inbound_count?: number;
    meeting_count?: number;
    no_answer_count?: number;
    last_interaction_at?: string | null;
  };
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function asBreakdown(value: unknown): Breakdown {
  return value && typeof value === "object" ? value as Breakdown : {};
}
function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const bandTone: Record<string, string> = {
  hot: "border-red-200 bg-red-50 text-red-800",
  warm: "border-orange-200 bg-orange-50 text-orange-800",
  nurture: "border-amber-200 bg-amber-50 text-amber-800",
  cold: "border-slate-200 bg-slate-50 text-slate-700",
  converted: "border-emerald-200 bg-emerald-50 text-emerald-800",
  disqualified: "border-zinc-200 bg-zinc-50 text-zinc-700",
};
const scoreTone: Record<string, string> = {
  hot: "bg-red-600 text-white",
  warm: "bg-orange-500 text-white",
  nurture: "bg-amber-400 text-slate-950",
  cold: "bg-slate-700 text-white",
  converted: "bg-emerald-600 text-white",
  disqualified: "bg-zinc-600 text-white",
};

export default async function LeadScoringPage({searchParams}: Props) {
  const params = (await searchParams) ?? {};
  const context = await getCrmServerContext();
  const {admin, user, membership, visibleUserIds, locale, memberOptions, memberName, canManage} = context;
  const ambassadorManager = await canManageAmbassadors(admin, membership.organization_id, user.id, membership.role);
  const fr = locale === "fr";
  const selectedBand = first(params.band);
  const selectedOwner = first(params.owner);
  const selectedStatus = first(params.status);
  const selectedSource = first(params.source);
  const search = first(params.q).trim().toLowerCase();
  const success = first(params.success);
  const errorMessage = first(params.error);

  const schema = await admin
    .from("crm_clients")
    .select("lead_score,lead_score_band,qualification_need,purchase_timeline,decision_role,budget_confirmed", {head: true, count: "exact"})
    .eq("organization_id", membership.organization_id)
    .limit(1);

  if (schema.error) {
    return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-[1500px]">
      <header className="rounded-3xl bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 p-7 text-white">
        <p className="text-sm font-black uppercase tracking-[.18em] text-indigo-300">SUPER LEADER CRM</p>
        <h1 className="mt-2 text-3xl font-black">{fr ? "Score intelligent des prospects" : "Intelligent lead scoring"}</h1>
      </header>
      <CrmModuleNav locale={locale} active="scoring" canManage={canManage} canManageAmbassadors={ambassadorManager}/>
      <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-8">
        <h2 className="text-2xl font-black text-amber-950">{fr ? "Migration V4.8.81 requise" : "V4.8.81 migration required"}</h2>
        <p className="mt-3 text-amber-900">{fr ? "Exécute la migration ci-dessous dans Supabase SQL Editor pour activer le moteur de scoring." : "Run the migration below in Supabase SQL Editor to activate the scoring engine."}</p>
        <code className="mt-5 block rounded-xl bg-slate-950 p-4 font-bold text-white">supabase/122_intelligent_lead_scoring_v4_8_81.sql</code>
      </section>
    </div></main>;
  }

  const organizationWide = membership.role === "owner" || membership.role === "admin";
  let query = admin
    .from("crm_clients")
    .select("id,reference,full_name,email,phone,source_detail,campaign_name,product_interest,estimated_budget,budget_currency,budget_confirmed,lead_status,lead_priority,owner_id,follow_up_owner_id,next_action,next_action_at,qualification_need,purchase_timeline,decision_role,lead_score,lead_score_band,lead_score_breakdown,lead_score_updated_at,created_at")
    .eq("organization_id", membership.organization_id)
    .eq("status", "prospect")
    .order("lead_score", {ascending: false})
    .order("created_at", {ascending: false})
    .limit(500);
  if (!organizationWide) {
    query = query.or(`owner_id.in.(${visibleUserIds.join(",")}),follow_up_owner_id.in.(${visibleUserIds.join(",")})`);
  }
  const {data, error} = await query;
  if (error) throw new Error(error.message);
  const leads = (data ?? []) as LeadScoreRow[];
  const active = leads.filter((lead) => !["converted", "lost", "unqualified"].includes(lead.lead_status));
  const now = Date.now();
  const hot = active.filter((lead) => lead.lead_score >= 80);
  const warm = active.filter((lead) => lead.lead_score >= 60 && lead.lead_score < 80);
  const nurture = active.filter((lead) => lead.lead_score >= 40 && lead.lead_score < 60);
  const cold = active.filter((lead) => lead.lead_score < 40);
  const average = active.length ? Math.round(active.reduce((sum, lead) => sum + lead.lead_score, 0) / active.length) : 0;
  const highScoreOverdue = active.filter((lead) => lead.lead_score >= 60 && lead.next_action_at && new Date(lead.next_action_at).getTime() < now);
  const incomplete = active.filter((lead) => lead.qualification_need === "unknown" || lead.purchase_timeline === "unknown" || lead.decision_role === "unknown" || !lead.product_interest || !lead.estimated_budget);
  const sources = Array.from(new Set(leads.map((lead) => lead.source_detail).filter((value): value is string => Boolean(value)))).sort();

  let displayed = leads.filter((lead) => {
    if (!selectedStatus && !selectedBand && ["converted", "lost", "unqualified"].includes(lead.lead_status)) return false;
    if (selectedBand && lead.lead_score_band !== selectedBand) return false;
    if (selectedOwner && lead.owner_id !== selectedOwner) return false;
    if (selectedStatus && lead.lead_status !== selectedStatus) return false;
    if (selectedSource && lead.source_detail !== selectedSource) return false;
    if (search) {
      const haystack = [lead.full_name, lead.email, lead.phone, lead.reference, lead.product_interest, lead.campaign_name]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  displayed = displayed.sort((a, b) => b.lead_score - a.lead_score || new Date(a.next_action_at ?? "9999-12-31").getTime() - new Date(b.next_action_at ?? "9999-12-31").getTime());

  const statusLabels: Record<string, string> = fr ? {
    new: "Nouveau", uncontacted: "Non contacté", contact_attempt: "Tentative de contact", contacted: "Contacté", qualified: "Qualifié", appointment: "Rendez-vous fixé", follow_up: "À relancer", unqualified: "Non qualifié", converted: "Converti", lost: "Perdu",
  } : {
    new: "New", uncontacted: "Uncontacted", contact_attempt: "Contact attempt", contacted: "Contacted", qualified: "Qualified", appointment: "Appointment set", follow_up: "Follow up", unqualified: "Unqualified", converted: "Converted", lost: "Lost",
  };
  const bandLabels: Record<string, string> = fr ? {hot: "Très chaud", warm: "Chaud", nurture: "À nourrir", cold: "Froid", converted: "Converti", disqualified: "Écarté"} : {hot: "Very hot", warm: "Warm", nurture: "Nurture", cold: "Cold", converted: "Converted", disqualified: "Disqualified"};
  const needLabels: Record<string, string> = fr ? {unknown: "À préciser", exploring: "Exploration", clear: "Besoin clair", urgent: "Besoin urgent"} : {unknown: "Unknown", exploring: "Exploring", clear: "Clear need", urgent: "Urgent need"};
  const timelineLabels: Record<string, string> = fr ? {unknown: "À préciser", within_30_days: "0–30 jours", "31_90_days": "31–90 jours", "91_180_days": "91–180 jours", later: "+180 jours"} : {unknown: "Unknown", within_30_days: "0–30 days", "31_90_days": "31–90 days", "91_180_days": "91–180 days", later: "+180 days"};
  const decisionLabels: Record<string, string> = fr ? {unknown: "À préciser", decision_maker: "Décideur", influencer: "Influenceur", representative: "Représentant"} : {unknown: "Unknown", decision_maker: "Decision maker", influencer: "Influencer", representative: "Representative"};

  function recommendation(lead: LeadScoreRow, breakdown: Breakdown) {
    const interactions = number(breakdown.signals?.interaction_count);
    if (!lead.owner_id) return fr ? "Attribuer immédiatement un commercial." : "Assign a salesperson immediately.";
    if (lead.next_action_at && new Date(lead.next_action_at).getTime() < now) return fr ? "Relance en retard : traiter aujourd’hui." : "Follow-up overdue: handle today.";
    if (interactions === 0) return fr ? "Effectuer le premier contact et enregistrer l’issue." : "Make the first contact and record the outcome.";
    if (!lead.product_interest || lead.qualification_need === "unknown") return fr ? "Clarifier le besoin et le produit recherché." : "Clarify the need and product interest.";
    if (lead.decision_role === "unknown") return fr ? "Identifier le décideur dans le processus d’achat." : "Identify the decision maker in the buying process.";
    if (!lead.estimated_budget || !lead.budget_confirmed) return fr ? "Qualifier et confirmer le budget disponible." : "Qualify and confirm the available budget.";
    if (lead.purchase_timeline === "unknown") return fr ? "Confirmer le délai de décision / achat." : "Confirm the decision / purchase timeline.";
    if (["contacted", "follow_up"].includes(lead.lead_status) && lead.lead_score >= 60) return fr ? "Proposer un rendez-vous de conversion." : "Propose a conversion meeting.";
    if (lead.lead_status === "qualified") return fr ? "Fixer le rendez-vous et préparer l’offre adaptée." : "Book the meeting and prepare the tailored offer.";
    if (lead.lead_status === "appointment") return fr ? "Sécuriser le rendez-vous et préparer le closing." : "Secure the meeting and prepare for closing.";
    return fr ? "Poursuivre la prochaine action planifiée." : "Continue with the planned next action.";
  }

  function metricHref(key: "hot" | "warm" | "nurture" | "cold") {
    return `/dashboard/crm/scoring?band=${key}`;
  }

  return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-[1500px]">
    <header className="rounded-3xl bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 p-7 text-white">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div><p className="text-sm font-black uppercase tracking-[.18em] text-indigo-300">SUPER LEADER CRM · SL-LEAD-V1</p><h1 className="mt-2 text-3xl font-black">{fr ? "Score intelligent des prospects" : "Intelligent lead scoring"}</h1><p className="mt-3 max-w-4xl text-indigo-100">{fr ? "Classe les prospects selon leur probabilité commerciale avec un score transparent sur 100. Chaque point est expliqué et relié à une prochaine action concrète." : "Rank prospects by commercial potential with a transparent score out of 100. Every point is explained and linked to a concrete next action."}</p></div>
        <Link href="/dashboard/crm/prospects" className="rounded-xl bg-white px-5 py-3 font-black text-slate-950">{fr ? "Centre Prospects" : "Prospect Centre"}</Link>
      </div>
    </header>
    <CrmModuleNav locale={locale} active="scoring" canManage={canManage} canManageAmbassadors={ambassadorManager}/>
    {success ? <p className="mt-5 rounded-2xl bg-emerald-100 p-4 font-bold text-emerald-900">{success}</p> : null}
    {errorMessage ? <p className="mt-5 rounded-2xl bg-red-100 p-4 font-bold text-red-900">{errorMessage}</p> : null}

    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
      <Link href={metricHref("hot")} className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><p className="text-xs font-black uppercase tracking-wide text-red-700">{fr ? "Très chauds" : "Very hot"}</p><p className="mt-2 text-3xl font-black">{hot.length}</p><p className="mt-1 text-xs font-bold text-slate-500">80–100</p></Link>
      <Link href={metricHref("warm")} className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><p className="text-xs font-black uppercase tracking-wide text-orange-700">{fr ? "Chauds" : "Warm"}</p><p className="mt-2 text-3xl font-black">{warm.length}</p><p className="mt-1 text-xs font-bold text-slate-500">60–79</p></Link>
      <Link href={metricHref("nurture")} className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><p className="text-xs font-black uppercase tracking-wide text-amber-700">{fr ? "À nourrir" : "Nurture"}</p><p className="mt-2 text-3xl font-black">{nurture.length}</p><p className="mt-1 text-xs font-bold text-slate-500">40–59</p></Link>
      <Link href={metricHref("cold")} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><p className="text-xs font-black uppercase tracking-wide text-slate-600">{fr ? "Froids" : "Cold"}</p><p className="mt-2 text-3xl font-black">{cold.length}</p><p className="mt-1 text-xs font-bold text-slate-500">0–39</p></Link>
      <div className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wide text-indigo-700">{fr ? "Score moyen" : "Average score"}</p><p className="mt-2 text-3xl font-black">{average}<span className="text-base text-slate-400">/100</span></p><p className="mt-1 text-xs font-bold text-slate-500">{active.length} {fr ? "prospects actifs" : "active prospects"}</p></div>
      <div className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wide text-rose-700">{fr ? "Priorités à traiter" : "Priority follow-ups"}</p><p className="mt-2 text-3xl font-black">{highScoreOverdue.length}</p><p className="mt-1 text-xs font-bold text-slate-500">{fr ? "score ≥60 + relance en retard" : "score ≥60 + overdue follow-up"}</p></div>
    </section>

    <section className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black text-sky-950">{fr ? "Qualité des données de qualification" : "Qualification data quality"}</p><p className="mt-1 text-sm font-semibold text-sky-800">{incomplete.length} {fr ? "prospect(s) actif(s) ont encore au moins une information clé à compléter : besoin, produit, budget, décideur ou délai." : "active prospect(s) still have at least one key field to complete: need, product, budget, decision maker or timeline."}</p></div><span className="rounded-full bg-white px-4 py-2 text-sm font-black text-sky-800">{active.length ? Math.round(((active.length - incomplete.length) / active.length) * 100) : 100}% {fr ? "qualifiés" : "qualified"}</span></div></section>

    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-black">{fr ? "File priorisée des prospects" : "Prioritized prospect queue"}</h2><p className="mt-1 text-sm font-semibold text-slate-500">{fr ? "Par défaut, les prospects actifs sont classés du score le plus élevé au plus faible." : "By default, active prospects are ranked from highest to lowest score."}</p></div>
      <form className="grid w-full gap-2 md:grid-cols-2 xl:w-auto xl:grid-cols-5">
        <input name="q" defaultValue={first(params.q)} placeholder={fr ? "Nom, e-mail, produit..." : "Name, email, product..."} className="rounded-xl border border-slate-300 px-3 py-2"/>
        <select name="band" defaultValue={selectedBand} className="rounded-xl border border-slate-300 px-3 py-2"><option value="">{fr ? "Tous les scores actifs" : "All active scores"}</option>{["hot","warm","nurture","cold","converted","disqualified"].map((key) => <option key={key} value={key}>{bandLabels[key]}</option>)}</select>
        <select name="status" defaultValue={selectedStatus} className="rounded-xl border border-slate-300 px-3 py-2"><option value="">{fr ? "Tous les statuts actifs" : "All active statuses"}</option>{Object.entries(statusLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
        {canManage ? <select name="owner" defaultValue={selectedOwner} className="rounded-xl border border-slate-300 px-3 py-2"><option value="">{fr ? "Tous les commerciaux" : "All salespeople"}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select> : null}
        <select name="source" defaultValue={selectedSource} className="rounded-xl border border-slate-300 px-3 py-2"><option value="">{fr ? "Toutes les sources" : "All sources"}</option>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select>
        <div className="flex gap-2"><button className="rounded-xl bg-slate-950 px-4 py-2 font-black text-white">{fr ? "Filtrer" : "Filter"}</button><Link href="/dashboard/crm/scoring" className="rounded-xl border border-slate-300 px-4 py-2 font-black text-slate-700">{fr ? "Effacer" : "Clear"}</Link></div>
      </form></div>

      <div className="mt-6 space-y-4">
        {displayed.map((lead) => {
          const breakdown = asBreakdown(lead.lead_score_breakdown);
          const band = lead.lead_score_band || "cold";
          const factors: Array<[string, BreakdownItem | undefined]> = [
            [fr ? "Statut & qualification" : "Status & qualification", breakdown.status],
            [fr ? "Engagement réel" : "Real engagement", breakdown.engagement],
            [fr ? "Besoin" : "Need", breakdown.need],
            [fr ? "Délai" : "Timing", breakdown.timing],
            [fr ? "Budget" : "Budget", breakdown.budget],
            [fr ? "Décideur" : "Authority", breakdown.authority],
            [fr ? "Source" : "Source", breakdown.source],
          ];
          const lastInteraction = breakdown.signals?.last_interaction_at;
          return <article key={lead.id} className="rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="flex min-w-0 flex-1 items-start gap-4"><div className={`flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl ${scoreTone[band] ?? scoreTone.cold}`}><span className="text-3xl font-black">{lead.lead_score}</span><span className="text-[10px] font-black uppercase">/100</span></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-black">{lead.full_name}</h3><span className={`rounded-full border px-3 py-1 text-xs font-black ${bandTone[band] ?? bandTone.cold}`}>{bandLabels[band] ?? band}</span><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">{statusLabels[lead.lead_status] ?? lead.lead_status}</span></div><p className="mt-2 text-sm font-semibold text-slate-600">{lead.product_interest || (fr ? "Produit à préciser" : "Product to clarify")} · {lead.source_detail || "manual"}{lead.campaign_name ? ` · ${lead.campaign_name}` : ""}</p><p className="mt-1 text-sm text-slate-500">{memberName(lead.owner_id)} · {lead.estimated_budget ? `${Number(lead.estimated_budget).toLocaleString(fr ? "fr-FR" : "en-GB")} ${lead.budget_currency}${lead.budget_confirmed ? ` · ${fr ? "budget confirmé" : "budget confirmed"}` : ""}` : (fr ? "budget à qualifier" : "budget to qualify")}</p></div></div>
              <div className="text-right text-xs font-bold text-slate-500"><p>{lead.reference}</p><p className="mt-1">{fr ? "Créé le" : "Created"} {new Date(lead.created_at).toLocaleDateString(fr ? "fr-FR" : "en-GB")}</p><Link href={`/dashboard/crm/${lead.id}`} className="mt-3 inline-block rounded-xl border border-slate-300 px-3 py-2 font-black text-slate-700 hover:bg-slate-50">{fr ? "Ouvrir la fiche" : "Open profile"}</Link></div>
            </div>

            <div className="mt-5 rounded-2xl bg-indigo-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-indigo-700">{fr ? "Action recommandée" : "Recommended action"}</p><p className="mt-1 font-black text-indigo-950">{recommendation(lead, breakdown)}</p>{lead.next_action ? <p className="mt-2 text-sm font-semibold text-indigo-800">{fr ? "Action planifiée" : "Planned action"}: {lead.next_action}{lead.next_action_at ? ` · ${new Date(lead.next_action_at).toLocaleString(fr ? "fr-FR" : "en-GB")}` : ""}</p> : null}</div>

            <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"><summary className="cursor-pointer font-black text-slate-800">{fr ? "Pourquoi ce score ?" : "Why this score?"} · {fr ? "Voir le détail" : "See breakdown"}</summary><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{factors.map(([label,item]) => {const points = number(item?.points); const max = Math.max(1, number(item?.max)); return <div key={label} className="rounded-xl bg-white p-3"><div className="flex items-center justify-between gap-2 text-xs font-black"><span>{label}</span><span>{points}/{max}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-indigo-600" style={{width: `${Math.min(100, Math.round((points / max) * 100))}%`}}/></div></div>;})}</div><div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-600"><span className="rounded-full bg-white px-3 py-2">{number(breakdown.signals?.interaction_count)} {fr ? "interaction(s)" : "interaction(s)"}</span><span className="rounded-full bg-white px-3 py-2">{number(breakdown.signals?.inbound_count)} {fr ? "entrante(s)" : "inbound"}</span><span className="rounded-full bg-white px-3 py-2">{number(breakdown.signals?.meeting_count)} {fr ? "rendez-vous / vidéo" : "meeting / video"}</span>{lastInteraction ? <span className="rounded-full bg-white px-3 py-2">{fr ? "Dernière interaction" : "Last interaction"}: {new Date(lastInteraction).toLocaleDateString(fr ? "fr-FR" : "en-GB")}</span> : null}<span className="rounded-full bg-white px-3 py-2">{breakdown.model || "SL-LEAD-V1"}</span></div></details>

            <details className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4"><summary className="cursor-pointer font-black text-sky-950">{fr ? "Qualification rapide — améliorer la précision du score" : "Quick qualification — improve score accuracy"}</summary><form action={updateProspectQualificationAction} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><input type="hidden" name="prospectId" value={lead.id}/><label className="text-xs font-black">{fr ? "Niveau du besoin" : "Need level"}<select name="qualificationNeed" defaultValue={lead.qualification_need} className="mt-1 w-full rounded-xl border border-sky-200 bg-white px-3 py-2">{Object.entries(needLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs font-black">{fr ? "Délai d’achat" : "Purchase timeline"}<select name="purchaseTimeline" defaultValue={lead.purchase_timeline} className="mt-1 w-full rounded-xl border border-sky-200 bg-white px-3 py-2">{Object.entries(timelineLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs font-black">{fr ? "Rôle dans la décision" : "Decision role"}<select name="decisionRole" defaultValue={lead.decision_role} className="mt-1 w-full rounded-xl border border-sky-200 bg-white px-3 py-2">{Object.entries(decisionLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs font-black">{fr ? "Produit / service recherché" : "Product / service interest"}<input name="productInterest" defaultValue={lead.product_interest ?? ""} className="mt-1 w-full rounded-xl border border-sky-200 px-3 py-2"/></label><label className="text-xs font-black">{fr ? "Budget estimé" : "Estimated budget"}<input type="number" min="0" step="0.01" name="estimatedBudget" defaultValue={lead.estimated_budget ?? ""} className="mt-1 w-full rounded-xl border border-sky-200 px-3 py-2"/></label><label className="text-xs font-black">{fr ? "Devise" : "Currency"}<select name="budgetCurrency" defaultValue={lead.budget_currency} className="mt-1 w-full rounded-xl border border-sky-200 bg-white px-3 py-2">{["USD","EUR","GBP","XAF","CAD"].map((currency) => <option key={currency}>{currency}</option>)}</select></label><label className="flex items-center gap-3 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-black"><input type="checkbox" name="budgetConfirmed" defaultChecked={lead.budget_confirmed}/><span>{fr ? "Budget confirmé avec le prospect" : "Budget confirmed with prospect"}</span></label><button className="rounded-xl bg-sky-700 px-5 py-3 font-black text-white">{fr ? "Enregistrer & recalculer" : "Save & recalculate"}</button></form></details>
          </article>;
        })}
        {!displayed.length ? <p className="rounded-2xl bg-slate-50 p-8 text-center font-bold text-slate-500">{fr ? "Aucun prospect ne correspond à ces filtres." : "No prospects match these filters."}</p> : null}
      </div>
    </section>

    <section className="mt-6 rounded-3xl bg-slate-950 p-6 text-white"><h2 className="text-xl font-black">{fr ? "Comment Super Leader calcule le score" : "How Super Leader calculates the score"}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-2xl bg-white/10 p-4"><p className="font-black">25 pts · {fr ? "Statut" : "Status"}</p><p className="mt-1 text-sm text-slate-300">{fr ? "Progression réelle de la qualification." : "Actual qualification progress."}</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="font-black">25 pts · Engagement</p><p className="mt-1 text-sm text-slate-300">{fr ? "Interactions, réponses entrantes, rendez-vous et récence." : "Interactions, inbound responses, meetings and recency."}</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="font-black">30 pts · {fr ? "Besoin + délai" : "Need + timing"}</p><p className="mt-1 text-sm text-slate-300">{fr ? "Clarté du besoin et proximité de la décision." : "Need clarity and proximity to decision."}</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="font-black">20 pts · {fr ? "Budget + décideur + source" : "Budget + authority + source"}</p><p className="mt-1 text-sm text-slate-300">{fr ? "Capacité, pouvoir de décision et qualité d’acquisition." : "Capacity, decision authority and acquisition quality."}</p></div></div><p className="mt-4 text-xs font-semibold text-slate-400">{fr ? "Le score est une aide à la priorisation, pas une décision automatique. Le commercial reste responsable de la qualification et de la relation client." : "The score supports prioritization; it is not an automatic decision. The salesperson remains responsible for qualification and the customer relationship."}</p></section>
  </div></main>;
}
