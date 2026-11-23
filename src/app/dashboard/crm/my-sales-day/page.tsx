import Link from "next/link";
import {addCrmOpportunityToDailyPlanAction} from "@/app/actions/crm-pipeline";
import {CrmModuleNav} from "@/components/crm/crm-module-nav";
import {sectorLabel} from "@/i18n/crm-pipeline";
import {formatMoney, safeNumber, type CrmSector} from "@/lib/crm/pipeline";
import {getCrmServerContext} from "@/lib/crm/server";
import {normalizeTimeZone} from "@/lib/timezone";

type SearchParams = {view?: string | string[]; success?: string | string[]; error?: string | string[]};
type PageProps = {searchParams?: Promise<SearchParams>};
type OpportunityRow = {
  id: string;
  reference: string;
  client_id: string;
  sector: CrmSector;
  title: string;
  owner_id: string;
  stage_id: string;
  value_amount: number | string;
  currency: string;
  probability: number;
  next_action: string | null;
  next_action_at: string | null;
  first_payment_expected: number | string | null;
  first_payment_due_date: string | null;
  expected_close_date: string | null;
};
type ClientRow = {id: string; full_name: string};
type StageRow = {id: string; name_fr: string; name_en: string};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Metric({label, value}: {label: string; value: string | number}) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p></article>;
}

function paymentSummary(rows: OpportunityRow[], locale: string) {
  const totals = new Map<string, number>();
  rows.forEach((row) => totals.set(row.currency, (totals.get(row.currency) ?? 0) + safeNumber(row.first_payment_expected)));
  return [...totals.entries()].map(([currency, amount]) => formatMoney(amount, currency, locale)).join(" · ") || formatMoney(0, "USD", locale);
}

export default async function MySalesDayPage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const view = ["today", "overdue", "no-action", "payments", "all"].includes(first(params.view)) ? first(params.view) : "today";
  const success = first(params.success);
  const errorMessage = first(params.error);
  const {admin, user, membership, locale, copy, canManage} = await getCrmServerContext();
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";

  const [{data: workSchedule}, {data: performanceSettings}] = await Promise.all([
    admin.from("member_work_schedules").select("timezone").eq("organization_id", membership.organization_id).eq("user_id", user.id).eq("is_active", true).maybeSingle<{timezone: string}>(),
    admin.from("performance_settings").select("timezone").eq("organization_id", membership.organization_id).maybeSingle<{timezone: string}>(),
  ]);
  const timezone = normalizeTimeZone(workSchedule?.timezone || performanceSettings?.timezone || "UTC");

  const schema = await admin.from("crm_opportunities").select("id", {head: true, count: "exact"}).limit(1);
  if (schema.error) {
    return <main className="min-h-screen bg-slate-50 px-5 py-8"><div className="mx-auto max-w-5xl rounded-3xl border border-amber-200 bg-amber-50 p-7"><h1 className="text-2xl font-black text-amber-950">{copy.migrationTitle}</h1><p className="mt-3 text-amber-900">{copy.migrationHelp}</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/053_multisector_crm_pipeline_v3_5_0.sql</code></div></main>;
  }

  const {data: opportunitiesData, error} = await admin.from("crm_opportunities")
    .select("id, reference, client_id, sector, title, owner_id, stage_id, value_amount, currency, probability, next_action, next_action_at, first_payment_expected, first_payment_due_date, expected_close_date")
    .eq("organization_id", membership.organization_id)
    .eq("owner_id", user.id)
    .eq("status", "open")
    .order("next_action_at", {ascending: true, nullsFirst: false})
    .limit(500);
  if (error) throw new Error(error.message);
  const opportunities = (opportunitiesData ?? []) as OpportunityRow[];
  const clientIds = [...new Set(opportunities.map((item) => item.client_id))];
  const stageIds = [...new Set(opportunities.map((item) => item.stage_id))];
  const [{data: clientsData}, {data: stagesData}] = await Promise.all([
    clientIds.length ? admin.from("crm_clients").select("id, full_name").in("id", clientIds) : Promise.resolve({data: [] as ClientRow[]}),
    stageIds.length ? admin.from("crm_pipeline_stages").select("id, name_fr, name_en").in("id", stageIds) : Promise.resolve({data: [] as StageRow[]}),
  ]);
  const clientById = new Map(((clientsData ?? []) as ClientRow[]).map((item) => [item.id, item]));
  const stageById = new Map(((stagesData ?? []) as StageRow[]).map((item) => [item.id, item]));

  const now = new Date();
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"});
  const todayKey = dayFormatter.format(now);
  const isToday = (date: string | null) => date ? dayFormatter.format(new Date(date)) === todayKey : false;
  const overdue = opportunities.filter((item) => item.next_action_at && new Date(item.next_action_at).getTime() < now.getTime() && !isToday(item.next_action_at));
  const today = opportunities.filter((item) => isToday(item.next_action_at));
  const noAction = opportunities.filter((item) => !item.next_action || !item.next_action_at);
  const payments = opportunities.filter((item) => item.first_payment_due_date && item.first_payment_due_date <= todayKey);
  const visible = view === "overdue" ? overdue : view === "no-action" ? noAction : view === "payments" ? payments : view === "all" ? opportunities : today;

  const tabs = [
    {id: "today", label: copy.today, count: today.length},
    {id: "overdue", label: copy.overdue, count: overdue.length},
    {id: "no-action", label: copy.noNextAction, count: noAction.length},
    {id: "payments", label: copy.expectedPayments, count: payments.length},
    {id: "all", label: copy.all, count: opportunities.length},
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-gradient-to-br from-indigo-800 via-slate-950 to-slate-950 p-7 text-white">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-indigo-300">{copy.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-black">{copy.dayTitle}</h1>
          <p className="mt-3 max-w-4xl leading-7 text-slate-300">{copy.daySubtitle}</p>
        </header>
        <CrmModuleNav locale={locale} active="day" canManage={canManage} />
        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label={copy.today} value={today.length} />
          <Metric label={copy.overdue} value={overdue.length} />
          <Metric label={copy.noNextAction} value={noAction.length} />
          <Metric label={copy.expectedPayments} value={payments.length} />
          <Metric label={copy.firstPayment} value={paymentSummary(payments, locale)} />
        </section>

        <nav className="mt-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {tabs.map((tab) => <Link key={tab.id} href={`/dashboard/crm/my-sales-day?view=${tab.id}`} className={`rounded-xl px-4 py-3 text-sm font-black ${view === tab.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{tab.label} <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5">{tab.count}</span></Link>)}
        </nav>

        <section className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-indigo-950">
          <p className="font-black">{copy.dailyPriorityHelp}</p>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {visible.map((opportunity) => {
            const client = clientById.get(opportunity.client_id);
            const stage = stageById.get(opportunity.stage_id);
            const late = opportunity.next_action_at && new Date(opportunity.next_action_at).getTime() < now.getTime();
            return (
              <article key={opportunity.id} className={`rounded-3xl border bg-white p-6 shadow-sm ${late ? "border-red-200" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-3"><div><span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-black text-sky-800">{sectorLabel(locale, opportunity.sector)}</span><h2 className="mt-3 text-lg font-black">{opportunity.title}</h2><p className="mt-1 text-xs font-bold text-slate-400">{opportunity.reference}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{opportunity.probability}%</span></div>
                <p className="mt-4 font-bold">{client?.full_name || "-"}</p>
                <p className="mt-1 text-sm text-slate-500">{stage ? (locale === "fr" ? stage.name_fr : stage.name_en) : "-"}</p>
                <p className="mt-4 text-2xl font-black">{formatMoney(opportunity.value_amount, opportunity.currency, locale)}</p>
                <div className={`mt-4 rounded-2xl p-4 ${late ? "bg-red-50 text-red-900" : "bg-sky-50 text-sky-900"}`}><p className="text-xs font-bold uppercase tracking-wide">{copy.nextAction}</p><p className="mt-2 font-black">{opportunity.next_action || copy.noNextAction}</p><p className="mt-1 text-sm">{opportunity.next_action_at ? new Date(opportunity.next_action_at).toLocaleString(dateLocale) : "-"}</p></div>
                {opportunity.first_payment_due_date ? <div className="mt-3 rounded-2xl bg-emerald-50 p-4 text-emerald-900"><p className="text-xs font-bold uppercase tracking-wide">{copy.expectedPayments}</p><p className="mt-2 font-black">{formatMoney(opportunity.first_payment_expected, opportunity.currency, locale)}</p><p className="mt-1 text-sm">{new Date(`${opportunity.first_payment_due_date}T12:00:00`).toLocaleDateString(dateLocale)}</p></div> : null}
                <div className="mt-5 grid gap-2 sm:grid-cols-2"><Link href={`/dashboard/crm/opportunities/${opportunity.id}`} className="rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-black text-white">{copy.open}</Link><form action={addCrmOpportunityToDailyPlanAction}><input type="hidden" name="returnTo" value={`/dashboard/crm/my-sales-day?view=${view}`} /><input type="hidden" name="opportunityId" value={opportunity.id} /><button className="h-full w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-800">{copy.addPriority}</button></form></div>
              </article>
            );
          })}
          {!visible.length ? <p className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center font-bold text-slate-500 lg:col-span-2 xl:col-span-3">{copy.empty}</p> : null}
        </section>
      </div>
    </main>
  );
}
