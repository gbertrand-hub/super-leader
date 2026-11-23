import Link from "next/link";
import {redirect} from "next/navigation";
import {
  createVipGrowthCampaignAction,
  createVipGrowthProspectAction,
  updateVipGrowthCampaignSpendAction,
  updateVipGrowthCampaignStatusAction,
  updateVipGrowthProspectStageAction,
  updateVipGrowthSettingsAction,
} from "@/app/actions/vip-growth";
import {getI18n} from "@/i18n/server";
import {APP_VERSION} from "@/lib/app-version";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const VIP_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const STAGES = ["new", "qualified", "invited", "application", "approved", "payment_pending", "member", "lost"] as const;
const CHANNELS = ["referral", "private_event", "masterclass", "meta", "linkedin", "whatsapp", "partner", "ambassador", "sales", "personal_invitation", "other"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Governance = {vip_manager_user_id: string | null; vip_assistant_manager_user_id: string | null; vip_growth_membership_manager_user_id: string | null};
type GrowthSettings = Governance & {
  vip_membership_product_id: string | null;
  vip_growth_target_members_month: number;
  vip_growth_target_revenue_month: number | string;
  vip_growth_default_currency: string;
};
type Campaign = {
  id: string; name: string; objective: string | null; channel: string; country: string | null; segment: string | null;
  budget_amount: number | string; spent_amount: number | string; currency: string; target_leads: number; target_members: number; starts_on: string | null; ends_on: string | null;
  status: string; owner_user_id: string | null; notes: string | null; created_at: string;
};
type Prospect = {
  id: string; crm_client_id: string; campaign_id: string | null; source_channel: string; stage: string; nomination_id: string | null; member_id: string | null;
  owner_user_id: string | null; expected_value: number | string; currency: string; next_action: string | null; next_action_at: string | null;
  converted_at: string | null; lost_reason: string | null; created_at: string; updated_at: string;
};
type CrmClient = {id: string; full_name: string; email: string | null; phone: string | null; country: string | null; company_name: string | null};
type Profile = {id: string; full_name: string | null; email: string | null};
type OrgMember = {user_id: string; role: string};
type Product = {id: string; name: string; name_en: string | null; code: string | null; currency: string; default_price: number | string; is_active: boolean};
type VipMember = {id: string; status: string; admission_date: string; expires_on: string; email: string | null; phone: string | null};
type VipNomination = {id: string; status: string; submitted_at: string};
type VipRenewal = {id: string; status: string; requested_at: string; decided_at: string | null};
type Sale = {id: string; crm_client_id: string | null; total_amount: number | string; currency: string; sale_date: string; workflow_status: string};
type Payment = {id: string; sale_id: string; payment_date: string; amount: number | string; currency: string; status: string};

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function num(value: number | string | null | undefined) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function pct(value: number) { return `${Math.round(value * 10) / 10}%`; }
function monthBounds(month: string) {
  const normalized = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = normalized.split("-").map(Number);
  const start = `${normalized}-01`;
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return {month: normalized, start, next, end: endDate};
}
function inPeriod(value: string | null | undefined, start: string, next: string) {
  if (!value) return false;
  const day = value.slice(0, 10);
  return day >= start && day < next;
}
function money(value: number, currency: string, locale: string) {
  try { return new Intl.NumberFormat(locale, {style: "currency", currency, maximumFractionDigits: 0}).format(value); }
  catch { return `${Math.round(value).toLocaleString(locale)} ${currency}`; }
}
function progress(value: number, target: number) { return target <= 0 ? 0 : Math.min(100, Math.max(0, (value / target) * 100)); }

export default async function VipGrowthDashboardPage({searchParams}: {searchParams: SearchParams}) {
  const {locale} = await getI18n();
  const fr = locale === "fr";
  const tr = (frText: string, enText: string) => fr ? frText : enText;
  const dateLocale = fr ? "fr-FR" : "en-GB";
  const params = await searchParams;
  const success = first(params.success);
  const errorMessage = first(params.error);
  const period = monthBounds(first(params.month));

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members")
    .select("organization_id,role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");

  const {data: governance} = await admin.from("vip_program_settings")
    .select("vip_manager_user_id,vip_assistant_manager_user_id,vip_growth_membership_manager_user_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<Governance>();
  const assigned = [governance?.vip_manager_user_id, governance?.vip_assistant_manager_user_id, governance?.vip_growth_membership_manager_user_id].includes(authData.user.id);
  if (!VIP_ROLES.has(membership.role) && !assigned) redirect("/dashboard/my-day");
  const canManageSteering = ["owner", "admin"].includes(membership.role) || governance?.vip_manager_user_id === authData.user.id;

  const schemaCheck = await admin.from("vip_growth_campaigns").select("id", {head: true, count: "exact"}).limit(1);
  const migrationMissing = Boolean(schemaCheck.error && ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(schemaCheck.error.code ?? "")));
  if (schemaCheck.error && !migrationMissing) throw new Error(schemaCheck.error.message);

  if (migrationMissing) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 lg:p-10">
        <div className="mx-auto max-w-5xl rounded-3xl border border-amber-300 bg-white p-8 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-700">Super Leader VIP · V{APP_VERSION}</p>
          <h1 className="mt-3 text-3xl font-black text-slate-950">{tr("Tableau de pilotage Croissance & Adhésions", "Growth & Membership Command Center")}</h1>
          <div className="mt-6 rounded-2xl bg-amber-50 p-5 text-amber-950">
            <p className="font-black">{tr("Migration V4.8.78 requise", "V4.8.78 migration required")}</p>
            <p className="mt-2 text-sm">{tr("Exécute ce fichier dans Supabase SQL Editor, puis recharge cette page :", "Run this file in Supabase SQL Editor, then reload this page:")}</p>
            <code className="mt-3 block rounded-xl bg-slate-950 p-4 text-sm text-white">supabase/120_vip_growth_dashboard_v4_8_78.sql</code>
          </div>
        </div>
      </main>
    );
  }

  const [settingsResult, campaignsResult, prospectsResult, profilesResult, orgMembersResult, productsResult, membersResult, nominationsResult, renewalsResult] = await Promise.all([
    admin.from("vip_program_settings").select("vip_manager_user_id,vip_assistant_manager_user_id,vip_growth_membership_manager_user_id,vip_membership_product_id,vip_growth_target_members_month,vip_growth_target_revenue_month,vip_growth_default_currency").eq("organization_id", membership.organization_id).maybeSingle<GrowthSettings>(),
    admin.from("vip_growth_campaigns").select("id,name,objective,channel,country,segment,budget_amount,spent_amount,currency,target_leads,target_members,starts_on,ends_on,status,owner_user_id,notes,created_at").eq("organization_id", membership.organization_id).order("created_at", {ascending: false}).limit(300),
    admin.from("vip_growth_prospects").select("id,crm_client_id,campaign_id,source_channel,stage,nomination_id,member_id,owner_user_id,expected_value,currency,next_action,next_action_at,converted_at,lost_reason,created_at,updated_at").eq("organization_id", membership.organization_id).order("updated_at", {ascending: false}).limit(1500),
    admin.from("profiles").select("id,full_name,email"),
    admin.from("organization_members").select("user_id,role").eq("organization_id", membership.organization_id).eq("is_active", true),
    admin.from("sales_products").select("id,name,name_en,code,currency,default_price,is_active").eq("organization_id", membership.organization_id).order("is_active", {ascending: false}).order("name"),
    admin.from("vip_members").select("id,status,admission_date,expires_on,email,phone").eq("organization_id", membership.organization_id).limit(5000),
    admin.from("vip_nominations").select("id,status,submitted_at").eq("organization_id", membership.organization_id).limit(5000),
    admin.from("vip_renewal_requests").select("id,status,requested_at,decided_at").eq("organization_id", membership.organization_id).limit(5000),
  ]);
  for (const result of [settingsResult, campaignsResult, prospectsResult, profilesResult, orgMembersResult, productsResult, membersResult, nominationsResult, renewalsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const settings = settingsResult.data as GrowthSettings | null;
  const campaigns = (campaignsResult.data ?? []) as Campaign[];
  const prospects = (prospectsResult.data ?? []) as Prospect[];
  const profiles = (profilesResult.data ?? []) as Profile[];
  const orgMembers = (orgMembersResult.data ?? []) as OrgMember[];
  const products = (productsResult.data ?? []) as Product[];
  const vipMembers = (membersResult.data ?? []) as VipMember[];
  const nominations = (nominationsResult.data ?? []) as VipNomination[];
  const renewals = (renewalsResult.data ?? []) as VipRenewal[];

  const crmClientIds = [...new Set(prospects.map((item) => item.crm_client_id))];
  const clientsResult = crmClientIds.length
    ? await admin.from("crm_clients").select("id,full_name,email,phone,country,company_name").in("id", crmClientIds)
    : {data: [] as CrmClient[], error: null};
  if (clientsResult.error) throw new Error(clientsResult.error.message);
  const clients = (clientsResult.data ?? []) as CrmClient[];

  const membershipProductId = settings?.vip_membership_product_id ?? null;
  let sales: Sale[] = [];
  let payments: Payment[] = [];
  if (membershipProductId) {
    const salesResult = await admin.from("sales_records")
      .select("id,crm_client_id,total_amount,currency,sale_date,workflow_status")
      .eq("organization_id", membership.organization_id)
      .eq("product_id", membershipProductId)
      .limit(5000);
    if (salesResult.error) throw new Error(salesResult.error.message);
    sales = (salesResult.data ?? []) as Sale[];
    const saleIds = sales.map((sale) => sale.id);
    if (saleIds.length) {
      const paymentsResult = await admin.from("sales_payments")
        .select("id,sale_id,payment_date,amount,currency,status")
        .in("sale_id", saleIds)
        .eq("status", "confirmed")
        .order("payment_date", {ascending: false})
        .limit(10000);
      if (paymentsResult.error) throw new Error(paymentsResult.error.message);
      payments = (paymentsResult.data ?? []) as Payment[];
    }
  }

  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const prospectByCrm = new Map(prospects.map((prospect) => [prospect.crm_client_id, prospect]));
  const saleMap = new Map(sales.map((sale) => [sale.id, sale]));
  const staff = orgMembers.map((member) => ({
    id: member.user_id,
    role: member.role,
    name: profileMap.get(member.user_id)?.full_name || profileMap.get(member.user_id)?.email || member.user_id,
  })).sort((a, b) => a.name.localeCompare(b.name));

  const targetCurrency = settings?.vip_growth_default_currency || "USD";
  const targetMembers = Number(settings?.vip_growth_target_members_month ?? 10);
  const targetRevenue = num(settings?.vip_growth_target_revenue_month ?? 0);
  const activeMembers = vipMembers.filter((member) => ["active", "honorary", "pending_renewal"].includes(member.status));
  const newMembersThisMonth = vipMembers.filter((member) => inPeriod(member.admission_date, period.start, period.next));
  const prospectsThisMonth = prospects.filter((prospect) => inPeriod(prospect.created_at, period.start, period.next));
  const nominationsThisMonth = nominations.filter((nomination) => inPeriod(nomination.submitted_at, period.start, period.next));
  const conversionThisMonth = prospects.filter((prospect) => prospect.stage === "member" && inPeriod(prospect.converted_at, period.start, period.next)).length;
  const conversionRate = prospectsThisMonth.length ? (conversionThisMonth / prospectsThisMonth.length) * 100 : 0;

  const monthlyPayments = payments.filter((payment) => inPeriod(payment.payment_date, period.start, period.next) && payment.currency === targetCurrency);
  const monthlyCollected = monthlyPayments.reduce((sum, payment) => sum + num(payment.amount), 0);
  const monthlyBooked = sales.filter((sale) => inPeriod(sale.sale_date, period.start, period.next) && sale.currency === targetCurrency && !["rejected", "cancelled", "refunded"].includes(sale.workflow_status)).reduce((sum, sale) => sum + num(sale.total_amount), 0);
  const otherCurrencyPayments = payments.filter((payment) => inPeriod(payment.payment_date, period.start, period.next) && payment.currency !== targetCurrency).length;

  const today = new Date().toISOString().slice(0, 10);
  const sixtyDays = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const renewalsDue = vipMembers.filter((member) => ["active", "pending_renewal"].includes(member.status) && member.expires_on >= today && member.expires_on <= sixtyDays).length;
  const renewalDecisions = renewals.filter((renewal) => inPeriod(renewal.decided_at, period.start, period.next) && ["approved", "rejected"].includes(renewal.status));
  const renewalApproved = renewalDecisions.filter((renewal) => renewal.status === "approved").length;
  const renewalRate = renewalDecisions.length ? (renewalApproved / renewalDecisions.length) * 100 : 0;

  const stageCounts = Object.fromEntries(STAGES.map((stage) => [stage, prospects.filter((prospect) => prospect.stage === stage).length])) as Record<string, number>;
  const paymentRevenueByCampaign = new Map<string, number>();
  const paymentRevenueBySource = new Map<string, number>();
  const allAttributedRevenue = new Map<string, number>();
  for (const payment of payments) {
    if (payment.currency !== targetCurrency) continue;
    const sale = saleMap.get(payment.sale_id);
    if (!sale?.crm_client_id) continue;
    const prospect = prospectByCrm.get(sale.crm_client_id);
    if (!prospect) continue;
    const amount = num(payment.amount);
    if (prospect.campaign_id) paymentRevenueByCampaign.set(prospect.campaign_id, (paymentRevenueByCampaign.get(prospect.campaign_id) ?? 0) + amount);
    paymentRevenueBySource.set(prospect.source_channel, (paymentRevenueBySource.get(prospect.source_channel) ?? 0) + amount);
    allAttributedRevenue.set(prospect.id, (allAttributedRevenue.get(prospect.id) ?? 0) + amount);
  }

  const stageLabel = (stage: string) => ({
    new: tr("Nouveau", "New"), qualified: tr("Qualifié", "Qualified"), invited: tr("Invité", "Invited"), application: tr("Candidature", "Application"),
    approved: tr("Validé", "Approved"), payment_pending: tr("Paiement attendu", "Payment pending"), member: tr("Membre", "Member"), lost: tr("Perdu", "Lost"),
  }[stage] ?? stage);
  const channelLabel = (channel: string) => ({
    referral: tr("Parrainage membre", "Member referral"), private_event: tr("Événement privé", "Private event"), masterclass: "Masterclass", meta: "Meta", linkedin: "LinkedIn",
    whatsapp: "WhatsApp", partner: tr("Partenaire", "Partner"), ambassador: tr("Ambassadeur", "Ambassador"), sales: tr("Commercial", "Sales"),
    personal_invitation: tr("Invitation personnelle", "Personal invitation"), other: tr("Autre", "Other"),
  }[channel] ?? channel);
  const personName = (userId: string | null) => userId ? (profileMap.get(userId)?.full_name || profileMap.get(userId)?.email || userId) : "—";

  const sourceRows = CHANNELS.map((channel) => {
    const channelProspects = prospects.filter((prospect) => prospect.source_channel === channel);
    const channelMembers = channelProspects.filter((prospect) => prospect.stage === "member").length;
    return {
      channel,
      leads: channelProspects.length,
      members: channelMembers,
      conversion: channelProspects.length ? (channelMembers / channelProspects.length) * 100 : 0,
      revenue: paymentRevenueBySource.get(channel) ?? 0,
    };
  }).filter((row) => row.leads > 0 || row.revenue > 0).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);

  const campaignRows = campaigns.map((campaign) => {
    const linked = prospects.filter((prospect) => prospect.campaign_id === campaign.id);
    const members = linked.filter((prospect) => prospect.stage === "member").length;
    const revenue = paymentRevenueByCampaign.get(campaign.id) ?? 0;
    const budget = campaign.currency === targetCurrency ? num(campaign.budget_amount) : 0;
    const spent = campaign.currency === targetCurrency ? num(campaign.spent_amount) : 0;
    return {campaign, leads: linked.length, members, conversion: linked.length ? (members / linked.length) * 100 : 0, revenue, budget, spent, roi: spent > 0 ? ((revenue - spent) / spent) * 100 : null};
  });

  const overdueActions = prospects.filter((prospect) => prospect.next_action_at && new Date(prospect.next_action_at).getTime() < Date.now() && !["member", "lost"].includes(prospect.stage)).length;
  const product = products.find((item) => item.id === membershipProductId) ?? null;
  const fieldClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-rose-500";

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-700">Super Leader VIP · V{APP_VERSION}</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">{tr("Pilotage commercial & marketing VIP", "VIP Commercial & Marketing Command Center")}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">{tr("Acquisition → qualification → invitation → candidature → validation → paiement → membre. CRM garde l’identité du prospect et Finance garde la vérité des paiements.", "Acquisition → qualification → invitation → application → approval → payment → member. CRM remains the prospect identity source and Finance remains the payment source of truth.")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/vip" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black">{tr("Retour VIP", "Back to VIP")}</Link>
            <Link href="/dashboard/vip/operations" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white">{tr("Centre opérationnel", "Operations Center")}</Link>
          </div>
        </div>

        {success ? <div className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-900">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 font-bold text-red-900">{errorMessage}</div> : null}

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <form className="flex items-end gap-3" method="get">
              <label className="text-xs font-black uppercase tracking-wide text-slate-600">{tr("Période", "Period")}
                <input type="month" name="month" defaultValue={period.month} className={fieldClass} />
              </label>
              <button className="rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-black text-white">{tr("Afficher", "Show")}</button>
            </form>
            <div className="text-right text-sm text-slate-600">
              <p><b>{tr("Produit Finance relié", "Linked Finance product")}:</b> {product ? (fr ? product.name : product.name_en || product.name) : tr("Non configuré", "Not configured")}</p>
              <p><b>{tr("Devise de pilotage", "Steering currency")}:</b> {targetCurrency}</p>
            </div>
          </div>
          {!product ? <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-950">{tr("Configure le produit catalogue correspondant à l’adhésion Super Leader VIP ci-dessous. Tant qu’il n’est pas relié, le dashboard n’invente aucun revenu.", "Configure the catalogue product used for Super Leader VIP membership below. Until it is linked, the dashboard will not invent revenue.")}</p> : null}
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            [tr("Membres actifs", "Active members"), activeMembers.length, tr("communauté VIP", "VIP community")],
            [tr("Nouveaux membres", "New members"), newMembersThisMonth.length, `${tr("objectif", "target")} ${targetMembers}`],
            [tr("Prospects VIP", "VIP prospects"), prospects.filter((p) => !["member", "lost"].includes(p.stage)).length, `${prospectsThisMonth.length} ${tr("créés ce mois", "created this month")}`],
            [tr("Taux de conversion", "Conversion rate"), pct(conversionRate), `${conversionThisMonth} ${tr("conversion(s) ce mois", "conversion(s) this month")}`],
            [tr("Encaissements du mois", "Collected this month"), money(monthlyCollected, targetCurrency, dateLocale), `${tr("booké", "booked")} ${money(monthlyBooked, targetCurrency, dateLocale)}`],
            [tr("Candidatures / nominations", "Applications / nominations"), nominationsThisMonth.length, tr("soumis ce mois", "submitted this month")],
            [tr("Renouvellements à 60 j", "Renewals due in 60d"), renewalsDue, tr("à sécuriser", "to secure")],
            [tr("Taux renouvellement", "Renewal approval rate"), pct(renewalRate), `${renewalApproved}/${renewalDecisions.length} ${tr("décisions", "decisions")}`],
            [tr("Actions en retard", "Overdue actions"), overdueActions, tr("prospects à relancer", "prospects to follow up")],
            [tr("Campagnes actives", "Active campaigns"), campaigns.filter((c) => c.status === "active").length, `${campaigns.length} ${tr("au total", "total")}`],
          ].map(([label, value, hint]) => (
            <article key={String(label)} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">{hint}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-2">
          <article className="rounded-3xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black">{tr("Objectif membres", "Membership target")}</h2><p className="text-sm text-slate-500">{period.month}</p></div><b>{newMembersThisMonth.length}/{targetMembers}</b></div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-rose-600" style={{width: `${progress(newMembersThisMonth.length, targetMembers)}%`}} /></div>
          </article>
          <article className="rounded-3xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black">{tr("Objectif encaissements", "Cash collection target")}</h2><p className="text-sm text-slate-500">{targetCurrency} · {period.month}</p></div><b>{money(monthlyCollected, targetCurrency, dateLocale)} / {money(targetRevenue, targetCurrency, dateLocale)}</b></div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{width: `${progress(monthlyCollected, targetRevenue)}%`}} /></div>
            {otherCurrencyPayments ? <p className="mt-2 text-xs text-amber-700">{otherCurrencyPayments} {tr("paiement(s) confirmé(s) dans une autre devise non additionnés au KPI.", "confirmed payment(s) in another currency are excluded from this KPI.")}</p> : null}
          </article>
        </section>

        <section className="mt-6 rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">{tr("Entonnoir commercial VIP", "VIP Commercial Funnel")}</h2><p className="mt-1 text-sm text-slate-500">{tr("Situation actuelle de tous les prospects suivis.", "Current position of all tracked prospects.")}</p></div><span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-800">{prospects.length} {tr("prospects suivis", "tracked prospects")}</span></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            {STAGES.map((stage, index) => <div key={stage} className={`rounded-2xl border p-4 ${stage === "member" ? "border-emerald-300 bg-emerald-50" : stage === "lost" ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}><p className="text-xs font-black text-slate-500">{index + 1}</p><p className="mt-1 font-black">{stageLabel(stage)}</p><p className="mt-2 text-3xl font-black">{stageCounts[stage] ?? 0}</p></div>)}
          </div>
        </section>

        <section className="mt-6 grid gap-6 2xl:grid-cols-[1.1fr_0.9fr]">
          <article className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <div className="p-6"><h2 className="text-2xl font-black">{tr("Performance par source d’acquisition", "Acquisition source performance")}</h2><p className="mt-1 text-sm text-slate-500">{tr("Les encaissements viennent exclusivement des paiements Finance confirmés et reliés au produit VIP.", "Collections come exclusively from confirmed Finance payments linked to the VIP product.")}</p></div>
            <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">{tr("Source", "Source")}</th><th className="px-5 py-3">{tr("Prospects", "Prospects")}</th><th className="px-5 py-3">{tr("Membres", "Members")}</th><th className="px-5 py-3">Conversion</th><th className="px-5 py-3">{tr("Encaissements attribués", "Attributed collections")}</th></tr></thead><tbody className="divide-y">{sourceRows.map((row) => <tr key={row.channel}><td className="px-5 py-4 font-bold">{channelLabel(row.channel)}</td><td className="px-5 py-4">{row.leads}</td><td className="px-5 py-4">{row.members}</td><td className="px-5 py-4">{pct(row.conversion)}</td><td className="px-5 py-4 font-black">{money(row.revenue, targetCurrency, dateLocale)}</td></tr>)}{!sourceRows.length ? <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">{tr("Aucune donnée d’acquisition pour le moment.", "No acquisition data yet.")}</td></tr> : null}</tbody></table></div>
          </article>

          {canManageSteering ? (
            <form action={updateVipGrowthSettingsAction} className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{tr("Configuration du pilotage", "Steering configuration")}</h2>
              <p className="mt-1 text-sm text-slate-500">{tr("Réservé au Owner/Admin/VIP Manager : produit Finance officiel, devise et objectifs globaux.", "Reserved for Owner/Admin/VIP Manager: official Finance product, currency and global targets.")}</p>
              <label className="mt-5 block text-sm font-black">{tr("Produit d’adhésion Super Leader VIP", "Super Leader VIP membership product")}<select name="vipMembershipProductId" defaultValue={membershipProductId ?? ""} className={fieldClass}><option value="">{tr("Non configuré", "Not configured")}</option>{products.map((item) => <option key={item.id} value={item.id}>{fr ? item.name : item.name_en || item.name} · {item.currency} {num(item.default_price)}</option>)}</select></label>
              <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-black">{tr("Objectif nouveaux membres / mois", "New member target / month")}<input name="targetMembers" type="number" min="0" defaultValue={targetMembers} className={fieldClass} /></label><label className="text-sm font-black">{tr("Objectif encaissements / mois", "Collection target / month")}<input name="targetRevenue" type="number" min="0" step="0.01" defaultValue={targetRevenue} className={fieldClass} /></label><label className="text-sm font-black">{tr("Devise", "Currency")}<input name="currency" maxLength={3} defaultValue={targetCurrency} className={fieldClass} /></label></div>
              <button className="mt-5 w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{tr("Enregistrer le pilotage", "Save steering settings")}</button>
            </form>
          ) : (
            <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-black text-amber-950">{tr("Configuration du pilotage", "Steering configuration")}</h2>
                  <p className="mt-1 text-sm text-amber-800">{tr("Lecture seule pour le Responsable Croissance & Adhésions VIP. Les paramètres sensibles sont validés par Owner/Admin/VIP Manager.", "Read-only for the VIP Growth & Membership Manager. Sensitive settings are validated by Owner/Admin/VIP Manager.")}</p>
                </div>
                <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-black text-amber-950">{tr("LECTURE SEULE", "READ ONLY")}</span>
              </div>
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white p-4"><dt className="text-xs font-black uppercase text-slate-500">{tr("Produit Finance relié", "Linked Finance product")}</dt><dd className="mt-1 font-black">{products.find((item) => item.id === membershipProductId)?.name || tr("Non configuré", "Not configured")}</dd></div>
                <div className="rounded-2xl bg-white p-4"><dt className="text-xs font-black uppercase text-slate-500">{tr("Devise de pilotage", "Steering currency")}</dt><dd className="mt-1 font-black">{targetCurrency}</dd></div>
                <div className="rounded-2xl bg-white p-4"><dt className="text-xs font-black uppercase text-slate-500">{tr("Objectif membres / mois", "Member target / month")}</dt><dd className="mt-1 text-2xl font-black">{targetMembers}</dd></div>
                <div className="rounded-2xl bg-white p-4"><dt className="text-xs font-black uppercase text-slate-500">{tr("Objectif encaissements / mois", "Collection target / month")}</dt><dd className="mt-1 text-2xl font-black">{money(targetRevenue, targetCurrency, dateLocale)}</dd></div>
              </dl>
            </article>
          )}
        </section>

        <section className="mt-6 grid gap-6 2xl:grid-cols-2">
          <form action={createVipGrowthCampaignAction} className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">{tr("Nouvelle campagne VIP", "New VIP campaign")}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-black sm:col-span-2">{tr("Nom de campagne", "Campaign name")}<input name="name" required className={fieldClass} placeholder={tr("Ex. 50 nouveaux membres VIP — Septembre", "E.g. 50 new VIP members — September")} /></label><label className="text-sm font-black">{tr("Canal principal", "Primary channel")}<select name="channel" className={fieldClass}>{CHANNELS.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}</select></label><label className="text-sm font-black">{tr("Responsable", "Owner")}<select name="ownerUserId" defaultValue={authData.user.id} className={fieldClass}>{staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label><label className="text-sm font-black">{tr("Pays", "Country")}<input name="country" className={fieldClass} /></label><label className="text-sm font-black">Segment<input name="segment" className={fieldClass} placeholder={tr("Dirigeants, investisseurs…", "Executives, investors…")} /></label><label className="text-sm font-black">Budget<input name="budgetAmount" type="number" min="0" step="0.01" className={fieldClass} /></label><label className="text-sm font-black">{tr("Dépense initiale", "Initial spend")}<input name="spentAmount" type="number" min="0" step="0.01" defaultValue="0" className={fieldClass} /></label><label className="text-sm font-black">{tr("Devise", "Currency")}<input name="currency" defaultValue={targetCurrency} maxLength={3} className={fieldClass} /></label><label className="text-sm font-black">{tr("Objectif prospects", "Lead target")}<input name="targetLeads" type="number" min="0" className={fieldClass} /></label><label className="text-sm font-black">{tr("Objectif membres", "Member target")}<input name="targetMembers" type="number" min="0" className={fieldClass} /></label><label className="text-sm font-black">{tr("Début", "Start")}<input name="startsOn" type="date" className={fieldClass} /></label><label className="text-sm font-black">{tr("Fin", "End")}<input name="endsOn" type="date" className={fieldClass} /></label><label className="text-sm font-black sm:col-span-2">{tr("Objectif / proposition", "Objective / proposition")}<textarea name="objective" rows={3} className={fieldClass} /></label></div>
            <button className="mt-5 w-full rounded-xl bg-rose-700 px-5 py-3 font-black text-white">{tr("Créer la campagne", "Create campaign")}</button>
          </form>

          <form action={createVipGrowthProspectAction} className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">{tr("Ajouter un prospect VIP", "Add VIP prospect")}</h2>
            <p className="mt-1 text-sm text-slate-500">{tr("S’il existe déjà dans le CRM, Super Leader le relie au lieu de le recréer.", "If the person already exists in CRM, Super Leader links the existing record instead of recreating it.")}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-black sm:col-span-2">{tr("Nom complet", "Full name")}<input name="fullName" required className={fieldClass} /></label><label className="text-sm font-black">E-mail<input name="email" type="email" className={fieldClass} /></label><label className="text-sm font-black">{tr("Téléphone", "Phone")}<input name="phone" className={fieldClass} /></label><label className="text-sm font-black">{tr("Pays", "Country")}<input name="country" className={fieldClass} /></label><label className="text-sm font-black">{tr("Langue", "Language")}<select name="preferredLanguage" className={fieldClass}><option value="fr">Français</option><option value="en">English</option></select></label><label className="text-sm font-black">{tr("Source", "Source")}<select name="sourceChannel" className={fieldClass}>{CHANNELS.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}</select></label><label className="text-sm font-black">{tr("Campagne", "Campaign")}<select name="campaignId" className={fieldClass}><option value="">{tr("Aucune campagne", "No campaign")}</option>{campaigns.filter((c) => !["completed", "cancelled"].includes(c.status)).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label className="text-sm font-black">{tr("Responsable", "Owner")}<select name="ownerUserId" defaultValue={authData.user.id} className={fieldClass}>{staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label><label className="text-sm font-black">{tr("Valeur potentielle", "Expected value")}<input name="expectedValue" type="number" min="0" step="0.01" className={fieldClass} /></label><label className="text-sm font-black">{tr("Devise", "Currency")}<input name="currency" defaultValue={targetCurrency} maxLength={3} className={fieldClass} /></label><label className="text-sm font-black sm:col-span-2">{tr("Prochaine action", "Next action")}<input name="nextAction" className={fieldClass} placeholder={tr("Ex. Appel de qualification", "E.g. Qualification call")} /></label><label className="text-sm font-black sm:col-span-2">{tr("Échéance prochaine action", "Next action due")}<input name="nextActionAt" type="datetime-local" className={fieldClass} /></label></div>
            <button className="mt-5 w-full rounded-xl bg-violet-700 px-5 py-3 font-black text-white">{tr("Ajouter au pipeline VIP", "Add to VIP pipeline")}</button>
          </form>
        </section>

        <section className="mt-6 rounded-3xl border bg-white shadow-sm">
          <div className="p-6"><h2 className="text-2xl font-black">{tr("Campagnes marketing & commerciales", "Marketing & Commercial Campaigns")}</h2><p className="mt-1 text-sm text-slate-500">{tr("Le ROI utilise uniquement les encaissements confirmés attribuables au CRM et dans la devise de pilotage.", "ROI uses only confirmed collections attributable through CRM and in the steering currency.")}</p></div>
          <div className="grid gap-4 p-6 pt-0 xl:grid-cols-2">{campaignRows.map(({campaign, leads, members, conversion, revenue, budget, spent, roi}) => <article key={campaign.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-rose-700">{channelLabel(campaign.channel)}</p><h3 className="mt-1 text-xl font-black">{campaign.name}</h3><p className="mt-1 text-xs text-slate-500">{campaign.country || tr("Tous pays", "All countries")} · {campaign.segment || tr("Segment non précisé", "Segment not specified")}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{campaign.status}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-6"><div><b>{leads}</b><br/><span className="text-xs text-slate-500">Prospects</span></div><div><b>{members}</b><br/><span className="text-xs text-slate-500">{tr("Membres", "Members")}</span></div><div><b>{pct(conversion)}</b><br/><span className="text-xs text-slate-500">Conversion</span></div><div><b>{money(revenue, targetCurrency, dateLocale)}</b><br/><span className="text-xs text-slate-500">{tr("Encaissé", "Collected")}</span></div><div><b>{money(spent, targetCurrency, dateLocale)}</b><br/><span className="text-xs text-slate-500">{tr("Dépensé", "Spent")}</span></div><div><b>{roi === null ? "—" : pct(roi)}</b><br/><span className="text-xs text-slate-500">ROI</span></div></div>{campaign.currency !== targetCurrency && num(campaign.budget_amount) > 0 ? <p className="mt-3 text-xs text-amber-700">{tr("Budget dans une autre devise : ROI non calculé sur ce budget.", "Budget is in another currency: ROI is not calculated against that budget.")}</p> : null}<form action={updateVipGrowthCampaignSpendAction} className="mt-4 flex flex-wrap items-end gap-2"><input type="hidden" name="campaignId" value={campaign.id}/><label className="text-xs font-black">{tr("Dépenses réelles", "Actual spend")}<input name="spentAmount" type="number" min="0" step="0.01" defaultValue={num(campaign.spent_amount)} className={`${fieldClass} w-40`}/></label><button className="rounded-lg bg-slate-950 px-3 py-2.5 text-xs font-black text-white">{tr("Mettre à jour", "Update")}</button></form><div className="mt-4 flex flex-wrap gap-2">{["active", "paused", "completed"].filter((status) => status !== campaign.status).map((status) => <form key={status} action={updateVipGrowthCampaignStatusAction}><input type="hidden" name="campaignId" value={campaign.id}/><input type="hidden" name="status" value={status}/><button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black">{status === "active" ? tr("Activer", "Activate") : status === "paused" ? tr("Mettre en pause", "Pause") : tr("Terminer", "Complete")}</button></form>)}</div></article>)}{!campaignRows.length ? <p className="col-span-full rounded-2xl bg-slate-50 p-8 text-center text-slate-500">{tr("Aucune campagne créée.", "No campaigns created yet.")}</p> : null}</div>
        </section>

        <section className="mt-6 rounded-3xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 p-6"><div><h2 className="text-2xl font-black">{tr("Pipeline des prospects VIP", "VIP Prospect Pipeline")}</h2><p className="mt-1 text-sm text-slate-500">{tr("Chaque personne reste un seul dossier CRM ; cette vue ajoute uniquement son parcours VIP.", "Each person remains a single CRM record; this view only adds the VIP journey.")}</p></div><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-800">{prospects.length} {tr("dossiers", "records")}</span></div>
          <div className="grid gap-4 p-6 pt-0 xl:grid-cols-2">{prospects.map((prospect) => {const client = clientMap.get(prospect.crm_client_id); const campaign = prospect.campaign_id ? campaignMap.get(prospect.campaign_id) : null; const late = Boolean(prospect.next_action_at && new Date(prospect.next_action_at).getTime() < Date.now() && !["member","lost"].includes(prospect.stage)); const attributed = allAttributedRevenue.get(prospect.id) ?? 0; return <article key={prospect.id} className={`rounded-2xl border p-5 ${late ? "border-red-300 bg-red-50/40" : "border-slate-200"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black">{client?.full_name || prospect.crm_client_id}</h3><p className="mt-1 text-xs text-slate-500">{client?.email || client?.phone || "—"} · {client?.country || "—"}</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black">{channelLabel(prospect.source_channel)}</span>{campaign ? <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-black text-rose-800">{campaign.name}</span> : null}{prospect.nomination_id ? <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-black text-blue-800">{tr("Nomination liée", "Nomination linked")}</span> : null}{prospect.member_id ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-800">{tr("Membre officiel", "Official member")}</span> : null}</div></div><span className={`rounded-full px-3 py-1 text-xs font-black ${prospect.stage === "member" ? "bg-emerald-100 text-emerald-900" : prospect.stage === "lost" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{stageLabel(prospect.stage)}</span></div><div className="mt-4 grid gap-2 text-sm sm:grid-cols-3"><p><b>{tr("Responsable", "Owner")}:</b><br/>{personName(prospect.owner_user_id)}</p><p><b>{tr("Valeur potentielle", "Expected value")}:</b><br/>{money(num(prospect.expected_value), prospect.currency, dateLocale)}</p><p><b>{tr("Encaissements attribués", "Attributed collections")}:</b><br/>{money(attributed, targetCurrency, dateLocale)}</p></div>{prospect.next_action ? <p className={`mt-3 rounded-xl p-3 text-sm ${late ? "bg-red-100 text-red-900" : "bg-slate-50"}`}><b>{tr("Prochaine action", "Next action")}:</b> {prospect.next_action}{prospect.next_action_at ? ` · ${new Intl.DateTimeFormat(dateLocale, {dateStyle:"medium", timeStyle:"short"}).format(new Date(prospect.next_action_at))}` : ""}</p> : null}<form action={updateVipGrowthProspectStageAction} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="prospectId" value={prospect.id}/><label className="text-xs font-black">{tr("Nouvelle étape", "New stage")}<select name="stage" defaultValue={prospect.stage} className={fieldClass}>{STAGES.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select></label><label className="text-xs font-black">{tr("Prochaine action", "Next action")}<input name="nextAction" defaultValue={prospect.next_action ?? ""} className={fieldClass}/></label><label className="text-xs font-black">{tr("Échéance", "Due")}<input name="nextActionAt" type="datetime-local" defaultValue={prospect.next_action_at ? prospect.next_action_at.slice(0,16) : ""} className={fieldClass}/></label><label className="text-xs font-black">{tr("Raison si perdu", "Reason if lost")}<input name="lostReason" defaultValue={prospect.lost_reason ?? ""} className={fieldClass}/></label><label className="text-xs font-black sm:col-span-2">{tr("Note de suivi", "Follow-up note")}<input name="note" className={fieldClass}/></label><button className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white sm:col-span-2">{tr("Mettre à jour le pipeline", "Update pipeline")}</button></form></article>})}{!prospects.length ? <p className="col-span-full rounded-2xl bg-slate-50 p-8 text-center text-slate-500">{tr("Aucun prospect VIP pour le moment.", "No VIP prospects yet.")}</p> : null}</div>
        </section>

        <footer className="mt-8 rounded-3xl bg-slate-950 p-6 text-sm text-slate-300">
          <p className="font-black text-white">{tr("Principe d’intégrité des données", "Data integrity principle")}</p>
          <p className="mt-2">{tr("Le dashboard ne crée pas un second CRM ni une seconde comptabilité : identité et activité commerciale restent liées à CRM, tandis que les revenus affichés proviennent uniquement des paiements confirmés du module Finance/Ventes.", "The dashboard does not create a second CRM or a second ledger: identity and sales activity remain linked to CRM, while displayed revenue comes only from confirmed Finance/Sales payments.")}</p>
        </footer>
      </div>
    </main>
  );
}
