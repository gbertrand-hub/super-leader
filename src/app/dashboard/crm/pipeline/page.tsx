import Link from "next/link";
import {
  addCrmOpportunityToDailyPlanAction,
  closeLostCrmOpportunityAction,
  moveCrmOpportunityStageAction,
} from "@/app/actions/crm-pipeline";
import {CrmModuleNav} from "@/components/crm/crm-module-nav";
import {OpportunityCreateForm} from "@/components/crm/opportunity-create-form";
import {lossReasonLabel, sectorLabel} from "@/i18n/crm-pipeline";
import {CRM_LOSS_REASONS, STAGE_TONE, formatMoney, normalizeSector, safeNumber, sectorOptionLabel, type CrmSector} from "@/lib/crm/pipeline";
import {getCrmServerContext} from "@/lib/crm/server";

type SearchParams = {sector?: string | string[]; owner?: string | string[]; success?: string | string[]; error?: string | string[]};
type PageProps = {searchParams?: Promise<SearchParams>};
type ClientRow = {id: string; full_name: string; owner_id: string | null; follow_up_owner_id: string | null; status: string};
type ProductRow = {id: string; name: string; name_en: string | null; sector: CrmSector; currency: string; default_price: number | string};
type StageRow = {id: string; sector: CrmSector; stage_key: string; name_fr: string; name_en: string; position: number; probability: number; stage_kind: "open" | "won" | "lost"; color_key: string};
type OpportunityRow = {
  id: string;
  reference: string;
  client_id: string;
  product_id: string | null;
  sector: CrmSector;
  title: string;
  owner_id: string;
  stage_id: string;
  status: "open" | "won" | "lost" | "on_hold";
  value_amount: number | string;
  currency: string;
  probability: number;
  expected_close_date: string | null;
  next_action: string | null;
  next_action_at: string | null;
  first_payment_expected: number | string | null;
  first_payment_due_date: string | null;
  handoff_status: string;
  loss_reason: string | null;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function Metric({label, value, detail}: {label: string; value: string | number; detail?: string}) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p>{detail ? <p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p> : null}</article>;
}

function moneySummary(rows: OpportunityRow[], locale: string, weighted = false) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const amount = safeNumber(row.value_amount) * (weighted ? row.probability / 100 : 1);
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + amount);
  });
  return [...totals.entries()].map(([currency, amount]) => formatMoney(amount, currency, locale)).join(" · ") || formatMoney(0, "USD", locale);
}

export default async function CrmPipelinePage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const selectedOwner = first(params.owner);
  const success = first(params.success);
  const errorMessage = first(params.error);
  const {admin, user, membership, visibleUserIds, locale, copy, memberOptions, memberName, canManage, activeSectorOptions} = await getCrmServerContext();
  const selectedSector = normalizeSector(first(params.sector), activeSectorOptions.map((sector) => sector.code));
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";

  const schema = await admin.from("crm_opportunities").select("id", {head: true, count: "exact"}).limit(1);
  if (schema.error) {
    return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950"><div className="mx-auto max-w-5xl"><header className="rounded-3xl bg-slate-950 p-7 text-white"><p className="text-sm font-black uppercase tracking-[0.18em] text-sky-300">{copy.eyebrow}</p><h1 className="mt-2 text-3xl font-black">{copy.pipelineTitle}</h1></header><section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7"><h2 className="text-2xl font-black text-amber-950">{copy.migrationTitle}</h2><p className="mt-3 text-amber-900">{copy.migrationHelp}</p><code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/053_multisector_crm_pipeline_v3_5_0.sql</code></section></div></main>;
  }

  const [clientsResult, productsResult, stagesResult, opportunitiesResult] = await Promise.all([
    admin.from("crm_clients").select("id, full_name, owner_id, follow_up_owner_id, status").eq("organization_id", membership.organization_id).order("full_name").limit(1000),
    admin.from("sales_products").select("id, name, name_en, sector, currency, default_price").eq("organization_id", membership.organization_id).eq("is_active", true).not("sector", "is", null).order("name"),
    admin.from("crm_pipeline_stages").select("id, sector, stage_key, name_fr, name_en, position, probability, stage_kind, color_key").eq("organization_id", membership.organization_id).eq("is_active", true).eq("sector", selectedSector).order("position"),
    admin.from("crm_opportunities").select("id, reference, client_id, product_id, sector, title, owner_id, stage_id, status, value_amount, currency, probability, expected_close_date, next_action, next_action_at, first_payment_expected, first_payment_due_date, handoff_status, loss_reason").eq("organization_id", membership.organization_id).eq("sector", selectedSector).in("owner_id", visibleUserIds).order("updated_at", {ascending: false}).limit(1000),
  ]);
  const loadError = clientsResult.error || productsResult.error || stagesResult.error || opportunitiesResult.error;
  if (loadError) throw new Error(loadError.message);

  const allClients = (clientsResult.data ?? []) as ClientRow[];
  const clients = ["owner", "admin"].includes(membership.role)
    ? allClients
    : allClients.filter((client) => (client.owner_id && visibleUserIds.includes(client.owner_id)) || (client.follow_up_owner_id && visibleUserIds.includes(client.follow_up_owner_id)));
  const products = (productsResult.data ?? []) as ProductRow[];
  const stages = (stagesResult.data ?? []) as StageRow[];
  const allOpportunities = (opportunitiesResult.data ?? []) as OpportunityRow[];
  const opportunities = selectedOwner ? allOpportunities.filter((item) => item.owner_id === selectedOwner) : allOpportunities;
  const clientById = new Map(allClients.map((client) => [client.id, client]));
  const productById = new Map(products.map((product) => [product.id, product]));
  // Server-render timestamp used to classify opportunities for this response.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const open = opportunities.filter((item) => item.status === "open");
  const won = opportunities.filter((item) => item.status === "won");
  const lost = opportunities.filter((item) => item.status === "lost");
  const overdue = open.filter((item) => item.next_action_at && new Date(item.next_action_at).getTime() < now);
  const conversion = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
  const returnTo = `/dashboard/crm/pipeline?sector=${selectedSector}${selectedOwner ? `&owner=${selectedOwner}` : ""}`;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-[1600px]">
        <header className="rounded-3xl bg-gradient-to-br from-sky-800 via-slate-950 to-slate-950 p-7 text-white">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-sky-300">{copy.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-black">{copy.pipelineTitle}</h1>
          <p className="mt-3 max-w-4xl leading-7 text-slate-300">{copy.pipelineSubtitle}</p>
          <p className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-bold text-amber-100">{copy.firstPaymentWarning}</p>
        </header>

        <CrmModuleNav locale={locale} active="pipeline" canManage={canManage} />
        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label={copy.openOpportunities} value={open.length} />
          <Metric label={copy.pipelineValue} value={moneySummary(open, locale)} />
          <Metric label={copy.weightedValue} value={moneySummary(open, locale, true)} />
          <Metric label={copy.overdueActions} value={overdue.length} />
          <Metric label={copy.wonOpportunities} value={won.length} />
          <Metric label={copy.conversion} value={`${conversion}%`} />
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto]" method="get">
            <label className="text-sm font-bold">{copy.sector}<select name="sector" defaultValue={selectedSector} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal">{activeSectorOptions.map((sector) => <option key={sector.code} value={sector.code}>{sectorOptionLabel(locale, sector)}</option>)}</select></label>
            <label className="text-sm font-bold">{copy.owner}<select name="owner" defaultValue={selectedOwner} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"><option value="">{copy.all}</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            <button className="self-end rounded-xl bg-slate-950 px-6 py-3 font-black text-white">{copy.filters}</button>
          </form>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[430px_1fr]">
          <OpportunityCreateForm
            locale={locale}
            clients={clients.map((client) => ({id: client.id, name: `${client.full_name} · ${client.status}`}))}
            products={products.map((product) => ({id: product.id, name: locale === "fr" ? product.name : product.name_en || product.name, sector: product.sector, currency: product.currency, basePrice: safeNumber(product.default_price)}))}
            sectors={activeSectorOptions}
            members={memberOptions}
            currentUserId={user.id}
            canManage={canManage}
            returnTo={returnTo}
          />

          <section className="min-w-0 overflow-x-auto pb-3">
            <div className="flex min-w-max gap-4">
              {stages.map((stage) => {
                const stageItems = opportunities.filter((item) => item.stage_id === stage.id);
                return (
                  <div key={stage.id} className={`w-[330px] shrink-0 rounded-3xl border p-4 ${STAGE_TONE[stage.color_key] ?? STAGE_TONE.slate}`}>
                    <div className="flex items-center justify-between gap-3"><div><h2 className="font-black">{locale === "fr" ? stage.name_fr : stage.name_en}</h2><p className="mt-1 text-xs font-bold opacity-70">{stage.probability}% · {stageItems.length}</p></div><span className="rounded-full bg-white/70 px-3 py-1 text-xs font-black">{moneySummary(stageItems, locale)}</span></div>
                    <div className="mt-4 space-y-4">
                      {stageItems.map((opportunity) => {
                        const client = clientById.get(opportunity.client_id);
                        const product = opportunity.product_id ? productById.get(opportunity.product_id) : null;
                        const late = opportunity.status === "open" && opportunity.next_action_at && new Date(opportunity.next_action_at).getTime() < now;
                        return (
                          <article key={opportunity.id} className="rounded-2xl border border-white/80 bg-white p-4 text-slate-900 shadow-sm">
                            <div className="flex items-start justify-between gap-2"><div><Link href={`/dashboard/crm/opportunities/${opportunity.id}`} className="font-black text-sky-800 hover:underline">{opportunity.title}</Link><p className="mt-1 text-xs font-bold text-slate-400">{opportunity.reference}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black">{opportunity.probability}%</span></div>
                            <p className="mt-3 text-sm font-bold">{client?.full_name || "-"}</p>
                            <p className="mt-1 text-xs text-slate-500">{product ? (locale === "fr" ? product.name : product.name_en || product.name) : sectorOptionLabel(locale, activeSectorOptions.find((sector) => sector.code === opportunity.sector) ?? {code: opportunity.sector, nameFr: sectorLabel(locale, opportunity.sector), nameEn: sectorLabel("en", opportunity.sector)})}</p>
                            <div className="mt-3 flex items-center justify-between gap-3"><span className="text-sm font-black">{formatMoney(opportunity.value_amount, opportunity.currency, locale)}</span><span className="text-xs font-bold text-slate-500">{memberName(opportunity.owner_id)}</span></div>
                            {opportunity.next_action ? <div className={`mt-3 rounded-xl p-3 text-xs ${late ? "bg-red-50 text-red-800" : "bg-sky-50 text-sky-900"}`}><p className="font-black">{opportunity.next_action}</p><p className="mt-1">{opportunity.next_action_at ? new Date(opportunity.next_action_at).toLocaleString(dateLocale) : copy.noNextAction}</p></div> : null}
                            {opportunity.loss_reason ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-800">{lossReasonLabel(locale, opportunity.loss_reason)}</p> : null}
                            {opportunity.status === "open" ? (
                              <>
                                <form action={moveCrmOpportunityStageAction} className="mt-4 grid gap-2">
                                  <input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="opportunityId" value={opportunity.id} />
                                  <select name="stageId" defaultValue={opportunity.stage_id} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">{stages.filter((item) => item.stage_kind !== "lost").map((item) => <option key={item.id} value={item.id}>{locale === "fr" ? item.name_fr : item.name_en}</option>)}</select>
                                  <input name="firstPaymentConfirmedAt" type="datetime-local" aria-label={copy.firstPaymentConfirmed} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                                  <button className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">{copy.updateStage}</button>
                                </form>
                                <form action={addCrmOpportunityToDailyPlanAction} className="mt-2"><input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="opportunityId" value={opportunity.id} /><button className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-800">{copy.addPriority}</button></form>
                                <details className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3"><summary className="cursor-pointer text-xs font-black text-red-800">{copy.markLost}</summary><form action={closeLostCrmOpportunityAction} className="mt-3 grid gap-2"><input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="opportunityId" value={opportunity.id} /><select name="lossReason" required className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs">{CRM_LOSS_REASONS.map((reason) => <option key={reason} value={reason}>{lossReasonLabel(locale, reason)}</option>)}</select><textarea name="lossNotes" className="min-h-16 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs" /><button className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white">{copy.markLost}</button></form></details>
                              </>
                            ) : null}
                            {opportunity.handoff_status === "ready" ? <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs font-black text-emerald-800">{copy.handoffReady}</p> : null}
                          </article>
                        );
                      })}
                      {!stageItems.length ? <p className="rounded-2xl border border-dashed border-current/20 bg-white/40 p-6 text-center text-xs font-bold opacity-60">{copy.empty}</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
