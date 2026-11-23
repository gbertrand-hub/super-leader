import Link from "next/link";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {canUseCommercialModules} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {canManageSensitiveFinanceData} from "@/lib/auth/sensitive-finance-access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type PageProps = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string};
type Member = {user_id: string; role: string};
type Profile = {id: string; full_name: string | null; email: string | null};
type Team = {id: string; name: string};
type TeamMember = {team_id: string; user_id: string};
type Product = {id: string; name: string};
type Sale = {
  id: string; seller_id: string; product_id: string | null; product_name: string;
  sale_date: string; total_amount: number | string; first_payment_amount: number | string;
  balance_amount: number | string; commission_amount: number | string; commission_status: string;
  currency: string; workflow_status: string; payment_plan_type: string;
};
type Target = {user_id: string; period_month: string; target_amount: number | string; currency: string};

const confirmedStatuses = new Set(["approved"]);
const inactiveStatuses = new Set(["rejected", "cancelled", "refunded"]);
const earnedCommissionStatuses = new Set(["validated", "payable", "paid"]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string) {
  return Math.max(1, Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1);
}
function percent(value: number, total: number) { return total > 0 ? Math.round((value / total) * 100) : 0; }
function money(locale: string, currency: string, amount: number) {
  try { return new Intl.NumberFormat(locale, {style: "currency", currency, maximumFractionDigits: currency === "XAF" ? 0 : 2}).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}
function moneySummary(rows: Array<{amount: number; currency: string}>, locale: string) {
  const totals = new Map<string, number>();
  rows.forEach(({amount, currency}) => totals.set(currency, (totals.get(currency) ?? 0) + amount));
  return totals.size ? [...totals].map(([currency, amount]) => money(locale, currency, amount)).join(" · ") : money(locale, "USD", 0);
}
function Metric({label, value, detail, tone}: {label: string; value: string | number; detail: string; tone: "indigo" | "emerald" | "amber" | "rose"}) {
  const tones = {indigo: "border-indigo-200 bg-indigo-50", emerald: "border-emerald-200 bg-emerald-50", amber: "border-amber-200 bg-amber-50", rose: "border-rose-200 bg-rose-50"};
  return <article className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}><p className="text-sm font-black text-slate-600">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p><p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p></article>;
}

export default async function SalesPerformancePage({searchParams}: PageProps) {
  const params = (await searchParams) ?? {};
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = validDate(first(params.from)) ? first(params.from) : monthStart;
  const toCandidate = validDate(first(params.to)) ? first(params.to) : today;
  const to = toCandidate >= from ? toCandidate : from;
  const selectedSeller = first(params.seller);
  const selectedTeam = first(params.team);
  const selectedProduct = first(params.product);
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const numberLocale = fr ? "fr-FR" : "en-GB";

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin.from("organization_members").select("organization_id, role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) redirect("/dashboard/company");
  if (!canUseCommercialModules(membership.role)) redirect("/dashboard/performance");

  const visibleIds = await getVisibleUserIds({admin, organizationId: membership.organization_id, actorId: authData.user.id, role: membership.role});
  if (!visibleIds.length) redirect("/dashboard/sales");
  const canSeeTeamCommissions = await canManageSensitiveFinanceData(admin, membership.organization_id, authData.user.id, membership.role);
  const [membersResult, profilesResult, teamsResult, productsResult] = await Promise.all([
    admin.from("organization_members").select("user_id, role").eq("organization_id", membership.organization_id).eq("is_active", true).in("user_id", visibleIds),
    admin.from("profiles").select("id, full_name, email").in("id", visibleIds),
    admin.from("teams").select("id, name").eq("organization_id", membership.organization_id).eq("is_active", true).order("name"),
    admin.from("sales_products").select("id, name").eq("organization_id", membership.organization_id).eq("is_active", true).order("name"),
  ]);
  const loadError = membersResult.error || profilesResult.error || teamsResult.error || productsResult.error;
  if (loadError) throw new Error(loadError.message);
  const members = (membersResult.data ?? []) as Member[];
  const profiles = (profilesResult.data ?? []) as Profile[];
  const teams = (teamsResult.data ?? []) as Team[];
  const products = (productsResult.data ?? []) as Product[];
  const teamIds = teams.map((team) => team.id);
  const {data: teamMembersData, error: teamMembersError} = teamIds.length
    ? await admin.from("team_members").select("team_id, user_id").in("team_id", teamIds).in("user_id", visibleIds)
    : {data: [] as TeamMember[], error: null};
  if (teamMembersError) throw new Error(teamMembersError.message);
  const teamMembers = (teamMembersData ?? []) as TeamMember[];
  const allowedTeamIds = new Set(teamMembers.map((row) => row.team_id));
  const teamFilter = allowedTeamIds.has(selectedTeam) ? selectedTeam : "";
  const teamUserIds = teamFilter ? teamMembers.filter((row) => row.team_id === teamFilter).map((row) => row.user_id) : visibleIds;
  const sellerFilter = selectedSeller && teamUserIds.includes(selectedSeller) ? selectedSeller : "";
  const scopedIds = sellerFilter ? [sellerFilter] : teamUserIds;
  const productFilter = products.some((product) => product.id === selectedProduct) ? selectedProduct : "";
  const nameById = new Map(profiles.map((profile) => [profile.id, profile.full_name?.trim() || profile.email || (fr ? "Collaborateur" : "Team member")]));
  const roleById = new Map(members.map((member) => [member.user_id, member.role]));

  const periodDays = daysBetween(from, to);
  const previousTo = shiftDate(from, -1);
  const previousFrom = shiftDate(previousTo, -(periodDays - 1));
  let salesQuery = admin.from("sales_records").select("id, seller_id, product_id, product_name, sale_date, total_amount, first_payment_amount, balance_amount, commission_amount, commission_status, currency, workflow_status, payment_plan_type").eq("organization_id", membership.organization_id).gte("sale_date", previousFrom).lte("sale_date", to).in("seller_id", scopedIds).limit(10000);
  if (productFilter) salesQuery = salesQuery.eq("product_id", productFilter);
  const targetFrom = `${from.slice(0, 7)}-01`;
  const targetTo = `${to.slice(0, 7)}-01`;
  const [salesResult, targetsResult] = await Promise.all([
    salesQuery,
    admin.from("sales_targets").select("user_id, period_month, target_amount, currency").eq("organization_id", membership.organization_id).gte("period_month", targetFrom).lte("period_month", targetTo).in("user_id", scopedIds),
  ]);
  if (salesResult.error || targetsResult.error) throw new Error(salesResult.error?.message || targetsResult.error?.message || "Sales analytics load failed");
  const allSales = (salesResult.data ?? []) as Sale[];
  const targets = (targetsResult.data ?? []) as Target[];
  const sales = allSales.filter((sale) => sale.sale_date >= from && sale.sale_date <= to);
  const previousSales = allSales.filter((sale) => sale.sale_date >= previousFrom && sale.sale_date <= previousTo);
  const activeSales = sales.filter((sale) => !inactiveStatuses.has(sale.workflow_status));
  const confirmed = sales.filter((sale) => confirmedStatuses.has(sale.workflow_status));
  const previousConfirmed = previousSales.filter((sale) => confirmedStatuses.has(sale.workflow_status));
  const pending = sales.filter((sale) => ["submitted", "verified"].includes(sale.workflow_status));
  const rejected = sales.filter((sale) => sale.workflow_status === "rejected");
  const earnedCommissions = confirmed.filter((sale) => earnedCommissionStatuses.has(sale.commission_status));
  const commissionRows = canSeeTeamCommissions || scopedIds.length === 1 && scopedIds[0] === authData.user.id ? earnedCommissions : [];
  const targetRows = productFilter ? [] : targets.map((target) => ({amount: Number(target.target_amount), currency: target.currency}));
  const confirmedRevenueRows = confirmed.map((sale) => ({amount: Number(sale.total_amount), currency: sale.currency}));
  const targetByCurrency = new Map<string, number>();
  targetRows.forEach((row) => targetByCurrency.set(row.currency, (targetByCurrency.get(row.currency) ?? 0) + row.amount));
  const confirmedByCurrency = new Map<string, number>();
  confirmedRevenueRows.forEach((row) => confirmedByCurrency.set(row.currency, (confirmedByCurrency.get(row.currency) ?? 0) + row.amount));
  const totalTarget = [...targetByCurrency.values()].reduce((sum, value) => sum + value, 0);
  const targetProgress = targetByCurrency.size === 1 && totalTarget > 0 ? percent(confirmedByCurrency.get([...targetByCurrency.keys()][0]) ?? 0, totalTarget) : null;
  const change = previousConfirmed.length ? Math.round(((confirmed.length - previousConfirmed.length) / previousConfirmed.length) * 100) : confirmed.length ? 100 : 0;

  const daily = new Map<string, {submitted: number; confirmed: number}>();
  sales.forEach((sale) => { const row = daily.get(sale.sale_date) ?? {submitted: 0, confirmed: 0}; row.submitted += 1; if (confirmedStatuses.has(sale.workflow_status)) row.confirmed += 1; daily.set(sale.sale_date, row); });
  const trend = [...daily].sort(([a], [b]) => a.localeCompare(b)).slice(-14);
  const memberRows = scopedIds.map((id) => {
    const rows = sales.filter((sale) => sale.seller_id === id);
    const memberActive = rows.filter((sale) => !inactiveStatuses.has(sale.workflow_status));
    const memberConfirmed = rows.filter((sale) => confirmedStatuses.has(sale.workflow_status));
    const memberTargets = productFilter ? [] : targets.filter((target) => target.user_id === id);
    const oneCurrency = new Set(memberTargets.map((target) => target.currency));
    const targetAmount = memberTargets.reduce((sum, target) => sum + Number(target.target_amount), 0);
    const achieved = oneCurrency.size === 1 ? memberConfirmed.filter((sale) => sale.currency === [...oneCurrency][0]).reduce((sum, sale) => sum + Number(sale.total_amount), 0) : 0;
    const commissionsVisible = canSeeTeamCommissions || id === authData.user.id;
    return {id, name: nameById.get(id) ?? id, role: roleById.get(id) ?? "employee", submitted: rows.length, confirmed: memberConfirmed.length, rate: percent(memberConfirmed.length, memberActive.length), revenue: moneySummary(memberConfirmed.map((sale) => ({amount: Number(sale.total_amount), currency: sale.currency})), numberLocale), initial: moneySummary(memberConfirmed.map((sale) => ({amount: Number(sale.first_payment_amount), currency: sale.currency})), numberLocale), commission: commissionsVisible ? moneySummary(memberConfirmed.filter((sale) => earnedCommissionStatuses.has(sale.commission_status)).map((sale) => ({amount: Number(sale.commission_amount), currency: sale.currency})), numberLocale) : null, objective: oneCurrency.size === 1 && targetAmount > 0 ? percent(achieved, targetAmount) : null};
  }).filter((row) => row.submitted > 0 || targets.some((target) => target.user_id === row.id)).sort((a, b) => b.confirmed - a.confirmed || b.rate - a.rate);

  const queryBase = new URLSearchParams({from, to}); if (teamFilter) queryBase.set("team", teamFilter); if (productFilter) queryBase.set("product", productFilter);
  return <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-950 sm:px-6"><div className="mx-auto max-w-[1500px]">
    <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8"><p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">{fr ? "Contribution commerciale de toute l’entreprise" : "Company-wide sales contribution"}</p><div className="mt-2 flex flex-wrap items-end justify-between gap-5"><div><h1 className="text-3xl font-black sm:text-4xl">{fr ? "Analyse des performances commerciales" : "Sales performance analytics"}</h1><p className="mt-3 max-w-3xl text-slate-300">{fr ? "Analysez toute personne ayant réalisé une vente, quel que soit son rôle ou son département, à partir des premiers paiements confirmés, des objectifs et des commissions acquises." : "Analyse anyone who made a sale, regardless of role or department, using confirmed first payments, targets and earned commissions."}</p></div><Link href="/dashboard/sales" className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950">{fr ? "Ouvrir les ventes" : "Open sales"}</Link></div></header>
    <form className="mt-5 grid gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.35fr_1.35fr_1.35fr_auto]" action="/dashboard/sales/performance"><label className="text-sm font-black">{fr ? "Du" : "From"}<input className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" type="date" name="from" defaultValue={from}/></label><label className="text-sm font-black">{fr ? "Au" : "To"}<input className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" type="date" name="to" defaultValue={to}/></label><label className="text-sm font-black">{fr ? "Équipe / département" : "Team / department"}<select className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" name="team" defaultValue={teamFilter}><option value="">{fr ? "Tous les collaborateurs visibles" : "All visible team members"}</option>{teams.filter((team) => allowedTeamIds.has(team.id)).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label className="text-sm font-black">{fr ? "Vendeur / Collaborateur" : "Seller / Team member"}<select className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" name="seller" defaultValue={sellerFilter}><option value="">{fr ? "Tous les collaborateurs" : "All team members"}</option>{teamUserIds.map((id) => <option key={id} value={id}>{nameById.get(id)}</option>)}</select></label><label className="text-sm font-black">{fr ? "Produit ou service" : "Product or service"}<select className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" name="product" defaultValue={productFilter}><option value="">{fr ? "Tous" : "All"}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><button className="self-end rounded-xl bg-indigo-700 px-5 py-2.5 font-black text-white">{fr ? "Appliquer" : "Apply"}</button></form>
    <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric tone="indigo" label={fr ? "Objectif atteint" : "Target achieved"} value={targetProgress === null ? "—" : `${targetProgress}%`} detail={targets.length ? moneySummary(targetRows, numberLocale) : (fr ? "Aucun objectif configuré" : "No target configured")}/><Metric tone="emerald" label={fr ? "Premiers paiements confirmés" : "Confirmed first payments"} value={moneySummary(confirmed.map((sale) => ({amount: Number(sale.first_payment_amount), currency: sale.currency})), numberLocale)} detail={`${confirmed.length} ${fr ? "ventes confirmées" : "confirmed sales"}`}/><Metric tone="amber" label={fr ? "Chiffre d’affaires vendu" : "Contracted revenue"} value={moneySummary(confirmedRevenueRows, numberLocale)} detail={`${change >= 0 ? "+" : ""}${change}% ${fr ? "vs période précédente" : "vs previous period"}`}/><Metric tone="rose" label={fr ? "Commission acquise" : "Earned commission"} value={commissionRows.length || canSeeTeamCommissions || scopedIds[0] === authData.user.id ? moneySummary(commissionRows.map((sale) => ({amount: Number(sale.commission_amount), currency: sale.currency})), numberLocale) : "••••"} detail={canSeeTeamCommissions || scopedIds.length === 1 && scopedIds[0] === authData.user.id ? (fr ? "Premier paiement uniquement" : "First payment only") : (fr ? "Donnée financière protégée" : "Protected financial data")}/></section>
    <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric tone="emerald" label={fr ? "Taux de confirmation" : "Confirmation rate"} value={`${percent(confirmed.length, activeSales.length)}%`} detail={`${confirmed.length}/${activeSales.length} ${fr ? "ventes actives" : "active sales"}`}/><Metric tone="amber" label={fr ? "En attente de confirmation" : "Awaiting confirmation"} value={pending.length} detail={fr ? "À traiter par le circuit de validation" : "Pending validation workflow"}/><Metric tone="indigo" label={fr ? "Solde à recouvrer" : "Balance to collect"} value={moneySummary(confirmed.map((sale) => ({amount: Number(sale.balance_amount), currency: sale.currency})), numberLocale)} detail={fr ? "Suivi par l’équipe de recouvrement" : "Handled by the collections team"}/><Metric tone="rose" label={fr ? "Ventes rejetées" : "Rejected sales"} value={rejected.length} detail={`${percent(rejected.length, sales.length)}% ${fr ? "des ventes soumises" : "of submitted sales"}`}/></section>
    <section className="mt-5 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]"><article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-xl font-black">{fr ? "Tendance sur 14 jours" : "14-day trend"}</h2><p className="mt-1 text-sm text-slate-500">{fr ? "Taux quotidien de confirmation" : "Daily confirmation rate"}</p><div className="mt-6 flex h-64 items-end gap-2">{trend.map(([date, row]) => {const rate = percent(row.confirmed, row.submitted); return <div key={date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] font-black text-slate-500">{rate}%</span><div className="w-full rounded-t-lg bg-emerald-500" style={{height: `${Math.max(4, rate * 1.8)}px`}}/><span className="text-[9px] font-bold text-slate-400">{date.slice(5)}</span></div>})}{!trend.length ? <p className="m-auto text-sm font-bold text-slate-500">{fr ? "Aucune vente pour cette période." : "No sales in this period."}</p> : null}</div></article>
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="p-5 sm:p-6"><h2 className="text-xl font-black">{fr ? "Performance commerciale de tous les collaborateurs" : "Sales performance across all team members"}</h2><p className="mt-1 text-sm text-slate-500">{fr ? "Toute personne ayant vendu ou reçu un objectif apparaît, indépendamment de son équipe, sans sanction automatique." : "Anyone with a sale or assigned target appears regardless of team, without automatic penalties."}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">#</th><th className="px-5 py-3">{fr ? "Vendeur / Collaborateur" : "Seller / Team member"}</th><th className="px-5 py-3">{fr ? "Ventes" : "Sales"}</th><th className="px-5 py-3">{fr ? "Confirmées" : "Confirmed"}</th><th className="px-5 py-3">{fr ? "Taux" : "Rate"}</th><th className="px-5 py-3">{fr ? "CA vendu" : "Revenue"}</th><th className="px-5 py-3">{fr ? "1ers paiements" : "1st payments"}</th><th className="px-5 py-3">{fr ? "Objectif" : "Target"}</th><th className="px-5 py-3">{fr ? "Commission" : "Commission"}</th></tr></thead><tbody>{memberRows.map((row, index) => <tr key={row.id} className="border-t border-slate-100"><td className="px-5 py-4 font-black text-slate-400">{index + 1}</td><td className="px-5 py-4"><Link className="font-black text-indigo-700 hover:underline" href={`/dashboard/sales/performance?${queryBase.toString()}&seller=${row.id}`}>{row.name}</Link><p className="mt-1 text-xs text-slate-400">{row.role}</p></td><td className="px-5 py-4">{row.submitted}</td><td className="px-5 py-4 font-black text-emerald-700">{row.confirmed}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 font-black ${row.rate >= 80 ? "bg-emerald-100 text-emerald-800" : row.rate >= 60 ? "bg-amber-100 text-amber-900" : "bg-rose-100 text-rose-800"}`}>{row.rate}%</span></td><td className="px-5 py-4 font-semibold">{row.revenue}</td><td className="px-5 py-4">{row.initial}</td><td className="px-5 py-4">{row.objective === null ? "—" : `${row.objective}%`}</td><td className="px-5 py-4">{row.commission ?? "••••"}</td></tr>)}{!memberRows.length ? <tr><td colSpan={9} className="px-5 py-12 text-center font-bold text-slate-500">{fr ? "Aucune vente ni aucun objectif pour ces filtres." : "No sales or targets for these filters."}</td></tr> : null}</tbody></table></div></article></section>
  </div></main>;
}
