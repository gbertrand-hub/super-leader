import { CrmModuleNav } from "@/components/crm/crm-module-nav";
import { saveCrmSalesTargetAction } from "@/app/actions/crm-targets";
import { lossReasonLabel, sectorLabel } from "@/i18n/crm-pipeline";
import {
  formatMoney,
  safeNumber,
  sectorOptionLabel,
  type CrmSector,
} from "@/lib/crm/pipeline";
import { getCrmServerContext } from "@/lib/crm/server";
import { CrmOperationalQuickActions } from "@/components/crm/crm-operational-quick-actions";

type SearchParams = {
  sector?: string | string[];
  from?: string | string[];
  to?: string | string[];
  owner?: string | string[];
  product?: string | string[];
  team?: string | string[];
  success?: string | string[];
  error?: string | string[];
  target_periodStart?: string | string[];
  target_periodEnd?: string | string[];
  target_ownerId?: string | string[];
  target_teamId?: string | string[];
  target_sector?: string | string[];
  target_productId?: string | string[];
  target_currency?: string | string[];
  target_targetAmount?: string | string[];
  target_targetCount?: string | string[];
  target_notes?: string | string[];
};
type PageProps = { searchParams?: Promise<SearchParams> };
type OpportunityRow = {
  id: string;
  sector: CrmSector;
  owner_id: string;
  stage_id: string;
  status: "open" | "won" | "lost" | "on_hold";
  value_amount: number | string;
  currency: string;
  probability: number;
  loss_reason: string | null;
  created_at: string;
  first_payment_confirmed_at: string | null;
  first_payment_expected: number | string | null;
  product_id: string | null;
  expected_close_date: string | null;
  next_action: string | null;
  next_action_at: string | null;
};
type StageRow = {
  id: string;
  sector: CrmSector;
  name_fr: string;
  name_en: string;
  position: number;
  stage_kind: string;
};
type TargetRow = {
  id: string;
  period_start: string;
  period_end: string;
  owner_id: string | null;
  team_id: string | null;
  product_id: string | null;
  sector: CrmSector | null;
  currency: string;
  target_amount: number | string;
  target_count: number;
  notes: string | null;
};
type ProductRow = {
  id: string;
  name: string;
  name_en: string | null;
  sector: CrmSector | null;
  currency: string;
};
type TeamRow = { id: string; name: string };
type TeamMemberRow = { team_id: string; user_id: string };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
      {detail ? (
        <p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p>
      ) : null}
    </article>
  );
}

function moneySummary(
  rows: OpportunityRow[],
  locale: string,
  weighted = false,
) {
  const sums = new Map<string, number>();
  rows.forEach((row) =>
    sums.set(
      row.currency,
      (sums.get(row.currency) ?? 0) +
        safeNumber(row.value_amount) * (weighted ? row.probability / 100 : 1),
    ),
  );
  return (
    [...sums.entries()]
      .map(([currency, amount]) => formatMoney(amount, currency, locale))
      .join(" · ") || formatMoney(0, "USD", locale)
  );
}

export default async function CrmAnalyticsPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const from = validDate(first(params.from)) ? first(params.from) : defaultFrom;
  const to = validDate(first(params.to)) ? first(params.to) : defaultTo;
  const selectedOwner = first(params.owner);
  const selectedProduct = first(params.product);
  const selectedTeam = first(params.team);
  const { admin, membership, locale, copy, memberOptions, memberName, activeSectorOptions } =
    await getCrmServerContext({ leadersOnly: true });
  const requestedSector = first(params.sector);
  const selectedSector = activeSectorOptions.some((sector) => sector.code === requestedSector) ? requestedSector : "";
  const sectorName = (code: string | null) => {
    if (!code) return locale === "fr" ? "Tous les secteurs" : "All sectors";
    const option = activeSectorOptions.find((sector) => sector.code === code);
    return option ? sectorOptionLabel(locale, option) : sectorLabel(locale, code);
  };

  const schema = await admin
    .from("crm_opportunities")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  if (schema.error)
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8">
        <div className="mx-auto max-w-5xl rounded-3xl border border-amber-200 bg-amber-50 p-7">
          <h1 className="text-2xl font-black text-amber-950">
            {copy.migrationTitle}
          </h1>
          <p className="mt-3 text-amber-900">{copy.migrationHelp}</p>
          <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">
            supabase/053_multisector_crm_pipeline_v3_5_0.sql
          </code>
        </div>
      </main>
    );

  const targetsSchema = await admin
    .from("crm_sales_targets")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  const targetsReady = !targetsSchema.error;
  const [
    { data: productsData },
    { data: teamsData },
    { data: teamMembersData },
  ] = await Promise.all([
    admin
      .from("sales_products")
      .select("id, name, name_en, sector, currency")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("name"),
    admin
      .from("teams")
      .select("id, name")
      .eq("organization_id", membership.organization_id)
      .order("name"),
    admin.from("team_members").select("team_id, user_id"),
  ]);
  const products = (productsData ?? []) as ProductRow[];
  const teams = (teamsData ?? []) as TeamRow[];
  const teamMembers = (teamMembersData ?? []) as TeamMemberRow[];
  const selectedTeamOwners = selectedTeam
    ? teamMembers
        .filter((row) => row.team_id === selectedTeam)
        .map((row) => row.user_id)
    : [];

  let query = admin
    .from("crm_opportunities")
    .select(
      "id, sector, owner_id, stage_id, status, value_amount, currency, probability, loss_reason, created_at, first_payment_confirmed_at, first_payment_expected, product_id, expected_close_date, next_action, next_action_at",
    )
    .eq("organization_id", membership.organization_id)
    .limit(5000);
  query = query.or(
    `and(status.eq.won,first_payment_confirmed_at.gte.${from}T00:00:00.000Z,first_payment_confirmed_at.lte.${to}T23:59:59.999Z),and(status.neq.won,created_at.gte.${from}T00:00:00.000Z,created_at.lte.${to}T23:59:59.999Z)`,
  );
  if (selectedSector) query = query.eq("sector", selectedSector);
  if (selectedOwner) query = query.eq("owner_id", selectedOwner);
  if (selectedProduct) query = query.eq("product_id", selectedProduct);
  if (selectedTeam)
    query = selectedTeamOwners.length
      ? query.in("owner_id", selectedTeamOwners)
      : query.eq("owner_id", "00000000-0000-0000-0000-000000000000");
  const [
    { data: opportunitiesData, error },
    { data: stagesData, error: stageError },
    targetsResult,
  ] = await Promise.all([
    query,
    admin
      .from("crm_pipeline_stages")
      .select("id, sector, name_fr, name_en, position, stage_kind")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("sector")
      .order("position"),
    targetsReady
      ? admin
          .from("crm_sales_targets")
          .select(
            "id, period_start, period_end, owner_id, team_id, product_id, sector, currency, target_amount, target_count, notes",
          )
          .eq("organization_id", membership.organization_id)
          .lte("period_start", to)
          .gte("period_end", from)
          .order("period_start", { ascending: false })
      : Promise.resolve({ data: [] as TargetRow[], error: null }),
  ]);
  if (error || stageError || targetsResult.error)
    throw new Error(
      error?.message ||
        stageError?.message ||
        targetsResult.error?.message ||
        "CRM analytics load failed",
    );
  const opportunities = (opportunitiesData ?? []) as OpportunityRow[];
  const stages = (stagesData ?? []) as StageRow[];
  const targets = (targetsResult.data ?? []) as TargetRow[];
  const open = opportunities.filter((item) => item.status === "open");
  const won = opportunities.filter((item) => item.status === "won");
  const lost = opportunities.filter((item) => item.status === "lost");
  const conversion =
    won.length + lost.length
      ? Math.round((won.length / (won.length + lost.length)) * 100)
      : 0;
  const forecast = open.filter(
    (item) =>
      !item.expected_close_date ||
      (item.expected_close_date >= from && item.expected_close_date <= to),
  );
  const overdueOpportunities = open.filter(
    (item) =>
      item.next_action_at &&
      new Date(item.next_action_at).getTime() < now.getTime(),
  );
  const noNextAction = open.filter(
    (item) => !item.next_action || !item.next_action_at,
  );
  const scopedTargets = targets.filter((target) => {
    if (selectedOwner && target.owner_id !== selectedOwner) return false;
    if (
      selectedTeam &&
      target.team_id !== selectedTeam &&
      (!target.owner_id || !selectedTeamOwners.includes(target.owner_id))
    )
      return false;
    if (selectedProduct && target.product_id !== selectedProduct) return false;
    if (selectedSector && target.sector !== selectedSector) return false;
    return true;
  });
  const globalTargets = scopedTargets.filter(
    (target) => !target.owner_id && !target.team_id,
  );
  const targetsForSummary =
    !selectedOwner && !selectedTeam && globalTargets.length
      ? globalTargets
      : scopedTargets;
  const targetByCurrency = new Map<string, { amount: number; count: number }>();
  targetsForSummary.forEach((target) => {
    const current = targetByCurrency.get(target.currency) ?? {
      amount: 0,
      count: 0,
    };
    current.amount += safeNumber(target.target_amount);
    current.count += target.target_count;
    targetByCurrency.set(target.currency, current);
  });
  const wonByCurrency = new Map<string, number>();
  won.forEach((item) =>
    wonByCurrency.set(
      item.currency,
      (wonByCurrency.get(item.currency) ?? 0) +
        safeNumber(item.first_payment_expected ?? item.value_amount),
    ),
  );
  const targetSummary = [...targetByCurrency.entries()].map(
    ([currency, target]) => {
      const achieved = wonByCurrency.get(currency) ?? 0;
      return {
        currency,
        ...target,
        achieved,
        progress:
          target.amount > 0 ? Math.round((achieved / target.amount) * 100) : 0,
      };
    },
  );
  const productName = (id: string | null) =>
    products.find((product) => product.id === id)?.[
      locale === "fr" ? "name" : "name_en"
    ] ||
    products.find((product) => product.id === id)?.name ||
    (locale === "fr" ? "Tous les produits" : "All products");
  const teamName = (id: string | null) =>
    teams.find((team) => team.id === id)?.name ||
    (locale === "fr" ? "Toute l’organisation" : "Whole organization");

  const sectorRows = activeSectorOptions.map((sectorOption) => {
    const sector = sectorOption.code;
    const rows = opportunities.filter((item) => item.sector === sector);
    const sectorWon = rows.filter((item) => item.status === "won").length;
    const sectorLost = rows.filter((item) => item.status === "lost").length;
    return {
      sector,
      total: rows.length,
      open: rows.filter((item) => item.status === "open").length,
      won: sectorWon,
      lost: sectorLost,
      conversion:
        sectorWon + sectorLost
          ? Math.round((sectorWon / (sectorWon + sectorLost)) * 100)
          : 0,
      value: moneySummary(
        rows.filter((item) => item.status === "open"),
        locale,
      ),
    };
  }).filter((row) => row.total > 0 || !selectedSector);

  const ownerRows = memberOptions
    .map((member) => {
      const rows = opportunities.filter((item) => item.owner_id === member.id);
      const ownerWon = rows.filter((item) => item.status === "won").length;
      const ownerLost = rows.filter((item) => item.status === "lost").length;
      return {
        id: member.id,
        name: member.name,
        total: rows.length,
        open: rows.filter((item) => item.status === "open").length,
        won: ownerWon,
        lost: ownerLost,
        conversion:
          ownerWon + ownerLost
            ? Math.round((ownerWon / (ownerWon + ownerLost)) * 100)
            : 0,
        value: moneySummary(
          rows.filter((item) => item.status === "open"),
          locale,
        ),
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.won - a.won || b.total - a.total);

  const stageRows = stages
    .filter((stage) => !selectedSector || stage.sector === selectedSector)
    .map((stage) => ({
      ...stage,
      count: opportunities.filter((item) => item.stage_id === stage.id).length,
    }));
  const lossRows = [...new Set(lost.map((item) => item.loss_reason || "other"))]
    .map((reason) => ({
      reason,
      count: lost.filter((item) => (item.loss_reason || "other") === reason)
        .length,
    }))
    .sort((a, b) => b.count - a.count);
  const maxStageCount = Math.max(1, ...stageRows.map((row) => row.count));

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-gradient-to-br from-violet-800 via-slate-950 to-slate-950 p-7 text-white">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-violet-300">
            {copy.eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-black">{copy.analyticsTitle}</h1>
          <p className="mt-3 max-w-4xl leading-7 text-slate-300">
            {copy.analyticsSubtitle}
          </p>
        </header>
      {/* CRM_CARREFOUR_INLINE_V4_8_67_V2 */}
      <CrmOperationalQuickActions />
        <CrmModuleNav locale={locale} active="analytics" canManage />
        {first(params.success) ? (
          <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900">
            {first(params.success)}
          </p>
        ) : null}
        {first(params.error) ? (
          <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-900">
            {first(params.error)}
          </p>
        ) : null}
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <form
            method="get"
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
          >
            <label className="text-sm font-bold">
              {copy.sector}
              <select
                name="sector"
                defaultValue={selectedSector}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
              >
                <option value="">{copy.all}</option>
                {activeSectorOptions.map((sector) => (
                  <option key={sector.code} value={sector.code}>
                    {sectorOptionLabel(locale, sector)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold">
              {copy.owner}
              <select
                name="owner"
                defaultValue={selectedOwner}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
              >
                <option value="">{copy.all}</option>
                {memberOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold">
              {locale === "fr" ? "Équipe" : "Team"}
              <select
                name="team"
                defaultValue={selectedTeam}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
              >
                <option value="">{copy.all}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold">
              {copy.product}
              <select
                name="product"
                defaultValue={selectedProduct}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
              >
                <option value="">{copy.all}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {productName(product.id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold">
              {locale === "fr" ? "Du" : "From"}
              <input
                name="from"
                type="date"
                defaultValue={from}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
              />
            </label>
            <label className="text-sm font-bold">
              {locale === "fr" ? "Au" : "To"}
              <input
                name="to"
                type="date"
                defaultValue={to}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
              />
            </label>
            <button className="self-end rounded-xl bg-slate-950 px-6 py-3 font-black text-white">
              {copy.filters}
            </button>
          </form>
        </section>
        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label={copy.opportunities} value={opportunities.length} />
          <Metric label={copy.openOpportunities} value={open.length} />
          <Metric
            label={copy.pipelineValue}
            value={moneySummary(open, locale)}
          />
          <Metric
            label={copy.weightedValue}
            value={moneySummary(open, locale, true)}
          />
          <Metric label={copy.wonOpportunities} value={won.length} />
          <Metric label={copy.conversion} value={`${conversion}%`} />
        </section>

        <section className="mt-6 rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">
                {locale === "fr" ? "PRÉVISIONS COMMERCIALES" : "SALES FORECAST"}
              </p>
              <h2 className="mt-2 text-2xl font-black">
                {locale === "fr"
                  ? "Objectif, réalisé et pipeline pondéré"
                  : "Target, achieved and weighted pipeline"}
              </h2>
            </div>
            {!targetsReady ? (
              <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-black text-amber-900">
                Migration 056 requise
              </span>
            ) : null}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label={
                locale === "fr" ? "Prévision pondérée" : "Weighted forecast"
              }
              value={moneySummary(forecast, locale, true)}
              detail={
                locale === "fr"
                  ? "Opportunités ouvertes prévues sur la période"
                  : "Open opportunities expected in period"
              }
            />
            <Metric
              label={
                locale === "fr" ? "Relances en retard" : "Overdue follow-ups"
              }
              value={overdueOpportunities.length}
            />
            <Metric
              label={
                locale === "fr"
                  ? "Sans prochaine action"
                  : "Without next action"
              }
              value={noNextAction.length}
            />
            <Metric
              label={locale === "fr" ? "Objectifs actifs" : "Active targets"}
              value={targets.length}
            />
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {targetSummary.map((row) => (
              <article
                key={row.currency}
                className="rounded-2xl border border-violet-100 bg-white p-5"
              >
                <div className="flex items-center justify-between">
                  <p className="font-black">{row.currency}</p>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${row.progress >= 100 ? "bg-emerald-100 text-emerald-800" : row.progress >= 70 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}
                  >
                    {row.progress}%
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {formatMoney(row.achieved, row.currency, locale)} /{" "}
                  {formatMoney(row.amount, row.currency, locale)}
                </p>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-violet-600"
                    style={{ width: `${Math.min(100, row.progress)}%` }}
                  />
                </div>
              </article>
            ))}
            {targetsReady && !targetSummary.length ? (
              <p className="rounded-2xl border border-dashed border-violet-200 bg-white p-6 text-slate-500">
                {locale === "fr"
                  ? "Aucun objectif ne couvre cette période."
                  : "No target covers this period."}
              </p>
            ) : null}
          </div>
        </section>

        {targetsReady ? (
          <section className="mt-6 space-y-6">
            <form
              action={saveCrmSalesTargetAction}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h2 className="text-xl font-black">
                {locale === "fr" ? "Fixer un objectif" : "Set a target"}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {locale === "fr"
                  ? "Un objectif existant avec le même périmètre sera mis à jour."
                  : "An existing target with the same scope will be updated."}
              </p>
              <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                <label className="text-sm font-bold">
                  {locale === "fr" ? "Début" : "Start"}
                  <input
                    required
                    name="periodStart"
                    type="date"
                    defaultValue={first(params.target_periodStart) || from}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
                  />
                </label>
                <label className="text-sm font-bold">
                  {locale === "fr" ? "Fin" : "End"}
                  <input
                    required
                    name="periodEnd"
                    type="date"
                    defaultValue={first(params.target_periodEnd) || to}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
                  />
                </label>
                <label className="text-sm font-bold">
                  {copy.owner}
                  <select
                    name="ownerId"
                    defaultValue={first(params.target_ownerId)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
                  >
                    <option value="">
                      {locale === "fr"
                        ? "Objectif global"
                        : "Organization target"}
                    </option>
                    {memberOptions.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-bold">
                  {locale === "fr"
                    ? "Équipe (si aucun commercial)"
                    : "Team (if no seller)"}
                  <select
                    name="teamId"
                    defaultValue={first(params.target_teamId)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
                  >
                    <option value="">—</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-bold">
                  {copy.sector}
                  <select
                    name="sector"
                    defaultValue={first(params.target_sector)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
                  >
                    <option value="">{copy.all}</option>
                    {activeSectorOptions.map((sector) => (
                      <option key={sector.code} value={sector.code}>
                        {sectorOptionLabel(locale, sector)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-bold">
                  {copy.product}
                  <select
                    name="productId"
                    defaultValue={first(params.target_productId)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
                  >
                    <option value="">{copy.all}</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {productName(product.id)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-bold">
                  {locale === "fr" ? "Devise" : "Currency"}
                  <select
                    name="currency"
                    defaultValue={first(params.target_currency) || "USD"}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
                  >
                    {["USD", "EUR", "GBP", "XAF", "CAD"].map((currency) => (
                      <option key={currency}>{currency}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-bold">
                  {locale === "fr" ? "Montant cible" : "Target amount"}
                  <input
                    required
                    min="0"
                    step="0.01"
                    name="targetAmount"
                    type="number"
                    defaultValue={first(params.target_targetAmount)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
                  />
                </label>
                <label className="text-sm font-bold">
                  {locale === "fr" ? "Nombre de ventes" : "Sales count"}
                  <input
                    required
                    min="0"
                    step="1"
                    name="targetCount"
                    type="number"
                    defaultValue={first(params.target_targetCount)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
                  />
                </label>
                <label className="text-sm font-bold md:col-span-2 xl:col-span-4">
                  Notes
                  <input
                    name="notes"
                    maxLength={1000}
                    defaultValue={first(params.target_notes)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal"
                  />
                </label>
              </div>
              <button className="mt-5 w-full rounded-xl bg-violet-700 px-6 py-3 font-black text-white hover:bg-violet-800">
                {copy.save}
              </button>
            </form>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">
                {locale === "fr"
                  ? "Objectifs de la période"
                  : "Targets for the period"}
              </h2>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[780px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-slate-500">
                      <th className="p-3">
                        {locale === "fr" ? "Périmètre" : "Scope"}
                      </th>
                      <th className="p-3">{copy.sector}</th>
                      <th className="p-3">{copy.product}</th>
                      <th className="p-3">
                        {locale === "fr" ? "Période" : "Period"}
                      </th>
                      <th className="p-3">
                        {locale === "fr" ? "Cible" : "Target"}
                      </th>
                      <th className="p-3">
                        {locale === "fr" ? "Ventes" : "Sales"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((target) => (
                      <tr key={target.id} className="border-b border-slate-100">
                        <td className="p-3 font-black">
                          {target.owner_id
                            ? memberName(target.owner_id)
                            : teamName(target.team_id)}
                        </td>
                        <td className="p-3">
                          {target.sector
                            ? sectorName(target.sector)
                            : copy.all}
                        </td>
                        <td className="p-3">
                          {productName(target.product_id)}
                        </td>
                        <td className="p-3">
                          {target.period_start} → {target.period_end}
                        </td>
                        <td className="p-3 font-black">
                          {formatMoney(
                            safeNumber(target.target_amount),
                            target.currency,
                            locale,
                          )}
                        </td>
                        <td className="p-3">{target.target_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">{copy.sectorPerformance}</h2>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[650px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-3">{copy.sector}</th>
                    <th className="px-3 py-3">{copy.openOpportunities}</th>
                    <th className="px-3 py-3">{copy.wonOpportunities}</th>
                    <th className="px-3 py-3">{copy.lostOpportunities}</th>
                    <th className="px-3 py-3">{copy.conversion}</th>
                    <th className="px-3 py-3">{copy.pipelineValue}</th>
                  </tr>
                </thead>
                <tbody>
                  {sectorRows.map((row) => (
                    <tr key={row.sector} className="border-b border-slate-100">
                      <td className="px-3 py-4 font-black">
                        {sectorName(row.sector)}
                      </td>
                      <td className="px-3 py-4">{row.open}</td>
                      <td className="px-3 py-4 text-emerald-700">{row.won}</td>
                      <td className="px-3 py-4 text-red-700">{row.lost}</td>
                      <td className="px-3 py-4 font-black">
                        {row.conversion}%
                      </td>
                      <td className="px-3 py-4 font-bold">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">{copy.teamPerformance}</h2>
            <div className="mt-5 space-y-3">
              {ownerRows.map((row) => (
                <article
                  key={row.id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-black">{row.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.open} open · {row.won} won · {row.lost} lost
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black">{row.conversion}%</p>
                      <p className="text-xs font-bold text-slate-500">
                        {row.value}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
              {!ownerRows.length ? (
                <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  {copy.empty}
                </p>
              ) : null}
            </div>
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">{copy.stageFunnel}</h2>
            <div className="mt-5 space-y-4">
              {stageRows.map((row) => (
                <div key={row.id}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-bold">
                      {locale === "fr" ? row.name_fr : row.name_en}{" "}
                      <span className="text-xs text-slate-400">
                        · {sectorName(row.sector)}
                      </span>
                    </span>
                    <span className="font-black">{row.count}</span>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-violet-600"
                      style={{
                        width: `${Math.max(2, (row.count / maxStageCount) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">{copy.lossAnalysis}</h2>
            <div className="mt-5 space-y-3">
              {lossRows.map((row) => (
                <div
                  key={row.reason}
                  className="flex items-center justify-between rounded-2xl border border-red-100 bg-red-50 p-4 text-red-900"
                >
                  <span className="font-bold">
                    {lossReasonLabel(locale, row.reason)}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 font-black">
                    {row.count}
                  </span>
                </div>
              ))}
              {!lossRows.length ? (
                <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  {copy.noLosses}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
