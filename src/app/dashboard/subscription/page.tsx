import Link from "next/link";
import {
  assignSubscriptionAction,
  createCouponAction,
  createManualInvoiceAction,
  createPlanAction,
  resumeSubscriptionAction,
  scheduleSubscriptionCancellationAction,
  suspendSubscriptionAction,
  toggleCouponAction,
  updateInvoiceStatusAction,
  updatePlanAction,
} from "@/app/actions/subscriptions";
import { getI18n } from "@/i18n/server";
import { getBillingContext } from "@/lib/billing/context";
import {
  getOrganizationEntitlements,
  SUBSCRIPTION_FEATURE_KEYS,
  type SubscriptionFeatureKey,
} from "@/lib/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  is_public: boolean;
  is_internal: boolean;
  pricing_mode: string;
  currency: string;
  monthly_price: number | null;
  annual_price: number | null;
  default_trial_days: number;
  sort_order: number;
};

type PlanFeature = {
  plan_id: string;
  feature_key: string;
  enabled: boolean;
  limit_value: number | null;
};

type Organization = { id: string; name: string; sector: string | null };
type Subscription = {
  id: string;
  organization_id: string;
  plan_id: string;
  status: string;
  billing_interval: string;
  currency: string;
  provider: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  cancel_at_period_end: boolean;
  suspension_reason: string | null;
  created_at: string;
};
type Coupon = {
  id: string;
  code: string;
  name: string;
  discount_type: string;
  discount_percent: number | null;
  discount_amount: number | null;
  currency: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  valid_until: string | null;
  is_active: boolean;
  applies_to_plan_id: string | null;
};
type Invoice = {
  id: string;
  organization_id: string;
  invoice_number: string;
  status: string;
  currency: string;
  total: number;
  amount_paid: number;
  due_at: string | null;
  created_at: string;
};

const featureLabelsFr: Record<string, string> = {
  core_feedback: "Feedback continu",
  recognition: "Reconnaissance",
  teams: "Équipes et rôles",
  performance: "Performance",
  academy: "Super Leader Academy",
  growth: "Plans de croissance",
  crm_sales: "CRM, ventes et recouvrement",
  feedback_automation: "Automatisation du feedback",
  reports_advanced: "Rapports avancés",
  custom_branding: "Personnalisation de la marque",
  api_integrations: "Intégrations API",
  priority_support: "Support prioritaire",
};

const featureLabelsEn: Record<string, string> = {
  core_feedback: "Continuous feedback",
  recognition: "Recognition",
  teams: "Teams and roles",
  performance: "Performance",
  academy: "Super Leader Academy",
  growth: "Growth plans",
  crm_sales: "CRM, sales and collections",
  feedback_automation: "Feedback automation",
  reports_advanced: "Advanced reports",
  custom_branding: "Custom branding",
  api_integrations: "API integrations",
  priority_support: "Priority support",
};

const statusLabelsFr: Record<string, string> = {
  draft: "Brouillon",
  trialing: "Essai",
  active: "Actif",
  past_due: "Paiement en attente",
  scheduled_cancel: "Annulation programmée",
  canceled: "Annulé",
  suspended: "Suspendu",
  expired: "Expiré",
};

const statusLabelsEn: Record<string, string> = {
  draft: "Draft",
  trialing: "Trial",
  active: "Active",
  past_due: "Payment pending",
  scheduled_cancel: "Cancellation scheduled",
  canceled: "Cancelled",
  suspended: "Suspended",
  expired: "Expired",
};

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatMoney(value: number | null, currency: string, locale: string): string {
  if (value === null || value === undefined) return locale === "fr" ? "À configurer" : "To configure";
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function statusClass(status: string): string {
  if (["active", "paid"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["trialing", "open", "scheduled_cancel"].includes(status)) return "bg-amber-100 text-amber-800";
  if (["suspended", "past_due", "uncollectible"].includes(status)) return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

export default async function SubscriptionPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { locale } = await getI18n();
  const fr = locale === "fr";
  const context = await getBillingContext(["owner", "admin"]);
  const admin = createAdminClient();
  const featureLabels = fr ? featureLabelsFr : featureLabelsEn;
  const statusLabels = fr ? statusLabelsFr : statusLabelsEn;
  const success = one(params.success);
  const error = one(params.error);
  const upgrade = one(params.upgrade);

  let databaseReady = true;
  let plans: Plan[] = [];
  let planFeatures: PlanFeature[] = [];
  let organizations: Organization[] = [];
  let subscriptions: Subscription[] = [];
  let coupons: Coupon[] = [];
  let invoices: Invoice[] = [];

  const plansResult = await admin
    .from("subscription_plans")
    .select("id,code,name,description,status,is_public,is_internal,pricing_mode,currency,monthly_price,annual_price,default_trial_days,sort_order")
    .order("sort_order");
  if (plansResult.error) {
    databaseReady = false;
  } else {
    plans = (plansResult.data ?? []) as Plan[];
  }

  if (databaseReady) {
    const [featureResult, invoiceResult] = await Promise.all([
      admin.from("subscription_plan_features").select("plan_id,feature_key,enabled,limit_value"),
      admin
        .from("subscription_invoices")
        .select("id,organization_id,invoice_number,status,currency,total,amount_paid,due_at,created_at")
        .eq("organization_id", context.organizationId)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    planFeatures = (featureResult.data ?? []) as PlanFeature[];
    invoices = (invoiceResult.data ?? []) as Invoice[];
  }

  if (databaseReady && context.isPlatformWorkspace) {
    const [orgResult, subscriptionResult, couponResult, allInvoicesResult] = await Promise.all([
      admin.from("organizations").select("id,name,sector").order("name"),
      admin
        .from("organization_subscriptions")
        .select("id,organization_id,plan_id,status,billing_interval,currency,provider,trial_ends_at,current_period_ends_at,cancel_at_period_end,suspension_reason,created_at")
        .in("status", ["draft", "trialing", "active", "past_due", "scheduled_cancel", "suspended"])
        .order("created_at", { ascending: false }),
      admin
        .from("subscription_coupons")
        .select("id,code,name,discount_type,discount_percent,discount_amount,currency,max_redemptions,redemption_count,valid_until,is_active,applies_to_plan_id")
        .order("created_at", { ascending: false }),
      admin
        .from("subscription_invoices")
        .select("id,organization_id,invoice_number,status,currency,total,amount_paid,due_at,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    organizations = (orgResult.data ?? []) as Organization[];
    subscriptions = (subscriptionResult.data ?? []) as Subscription[];
    coupons = (couponResult.data ?? []) as Coupon[];
    invoices = (allInvoicesResult.data ?? []) as Invoice[];
  }

  const ownEntitlements = await getOrganizationEntitlements(context.organizationId);
  const currentPlan = plans.find((plan) => plan.id === ownEntitlements.planId) ?? null;
  const { count: memberCount } = await admin
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", context.organizationId)
    .eq("is_active", true);
  const maxMembers = ownEntitlements.featureLimits.max_members ?? null;

  const featuresByPlan = new Map<string, Map<string, PlanFeature>>();
  for (const feature of planFeatures) {
    const map = featuresByPlan.get(feature.plan_id) ?? new Map<string, PlanFeature>();
    map.set(feature.feature_key, feature);
    featuresByPlan.set(feature.plan_id, map);
  }
  const orgById = new Map(organizations.map((organization) => [organization.id, organization]));
  const planById = new Map(plans.map((plan) => [plan.id, plan]));

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <Link href="/dashboard" className="font-bold text-indigo-700">← {fr ? "Retour au tableau de bord" : "Back to dashboard"}</Link>
        <header className="mt-5 rounded-[2rem] bg-slate-950 p-7 text-white">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-400">SUPER LEADER V2.5.2</p>
          <h1 className="mt-3 text-3xl font-black sm:text-5xl">{fr ? "Plans, abonnements & fonctionnalités" : "Plans, subscriptions & features"}</h1>
          <p className="mt-3 max-w-4xl text-slate-300">
            {fr
              ? "Prépare les offres commerciales, les essais, les limites et les droits fonctionnels sans activer encore les paiements réels."
              : "Prepare commercial offers, trials, limits and feature entitlements before enabling live payments."}
          </p>
          <div className="mt-5 inline-flex rounded-full bg-amber-400 px-4 py-2 text-sm font-black text-slate-950">
            {fr ? "Mode test / attribution manuelle" : "Test mode / manual assignment"}
          </div>
        </header>

        {success ? <p className="mt-5 rounded-2xl bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</p> : null}
        {error ? <p className="mt-5 rounded-2xl bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p> : null}
        {upgrade ? (
          <p className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 font-bold text-amber-900">
            {fr
              ? `La fonctionnalité « ${featureLabels[upgrade] ?? upgrade} » n’est pas incluse dans le plan actuel.`
              : `“${featureLabels[upgrade] ?? upgrade}” is not included in the current plan.`}
          </p>
        ) : null}

        {!databaseReady ? (
          <section className="mt-6 rounded-[2rem] border border-amber-300 bg-amber-50 p-7">
            <h2 className="text-2xl font-black">{fr ? "Activation Supabase requise" : "Supabase activation required"}</h2>
            <p className="mt-2 text-amber-900">
              {fr ? "Exécute uniquement supabase/030_subscriptions_feature_control_v2_5.sql, puis actualise cette page." : "Run only supabase/030_subscriptions_feature_control_v2_5.sql, then refresh this page."}
            </p>
          </section>
        ) : (
          <>
            <section className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
              <article className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">{fr ? "Abonnement de l’organisation" : "Organization subscription"}</p>
                    <h2 className="mt-2 text-3xl font-black">{ownEntitlements.planName}</h2>
                    <p className="mt-2 text-slate-600">{context.organizationName}</p>
                  </div>
                  <span className={`rounded-full px-4 py-2 text-sm font-black ${statusClass(ownEntitlements.status)}`}>
                    {statusLabels[ownEntitlements.status] ?? ownEntitlements.status}
                  </span>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-sm font-bold text-slate-500">{fr ? "Collaborateurs actifs" : "Active members"}</p>
                    <p className="mt-2 text-2xl font-black">{memberCount ?? 0}{maxMembers !== null ? ` / ${maxMembers}` : ""}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-sm font-bold text-slate-500">{fr ? "Fin d’essai" : "Trial end"}</p>
                    <p className="mt-2 text-lg font-black">{formatDate(ownEntitlements.trialEndsAt, locale)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-sm font-bold text-slate-500">{fr ? "Fin de période" : "Period end"}</p>
                    <p className="mt-2 text-lg font-black">{formatDate(ownEntitlements.currentPeriodEndsAt, locale)}</p>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  {ownEntitlements.enabledFeatures.map((feature) => (
                    <span key={feature} className="rounded-full bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700">
                      {featureLabels[feature] ?? feature}
                    </span>
                  ))}
                </div>
                {ownEntitlements.planCode === "free" ? (
                  <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
                    <p className="font-black">
                      {fr ? "Plan Free · Limite de 5 utilisateurs actifs" : "Free plan · 5 active-user limit"}
                    </p>
                    <p className="mt-2 text-sm leading-6">
                      {fr
                        ? "Aucune donnée ne sera supprimée lorsque la limite est atteinte. L’ajout ou la réactivation d’un utilisateur supplémentaire sera bloqué jusqu’au passage à Starter."
                        : "No data is deleted when the limit is reached. Adding or reactivating another user is blocked until the organisation upgrades to Starter."}
                    </p>
                    <Link href="/pricing?billing=monthly" className="mt-4 inline-flex rounded-xl bg-slate-950 px-5 py-3 font-black text-white">
                      {fr ? "Comparer les plans et passer à Starter" : "Compare plans and upgrade to Starter"}
                    </Link>
                  </div>
                ) : null}
                {!context.isPlatformWorkspace && ownEntitlements.planCode !== "free" && ["active", "trialing", "past_due"].includes(ownEntitlements.status) ? (
                  <form action={scheduleSubscriptionCancellationAction} className="mt-6">
                    <button className="rounded-xl border border-red-300 bg-red-50 px-5 py-3 font-black text-red-700">
                      {fr ? "Programmer l’annulation en fin de période" : "Schedule cancellation at period end"}
                    </button>
                  </form>
                ) : null}
                {!context.isPlatformWorkspace && ownEntitlements.status === "scheduled_cancel" ? (
                  <form action={resumeSubscriptionAction} className="mt-6">
                    <button className="rounded-xl bg-emerald-600 px-5 py-3 font-black text-white">
                      {fr ? "Conserver mon abonnement" : "Keep my subscription"}
                    </button>
                  </form>
                ) : null}
              </article>

              <article className="rounded-[2rem] bg-indigo-600 p-7 text-white shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-200">{fr ? "Préparation commerciale" : "Commercial preparation"}</p>
                <h2 className="mt-3 text-2xl font-black">{fr ? "Paiements réels désactivés" : "Live payments disabled"}</h2>
                <p className="mt-3 text-indigo-100">
                  {fr
                    ? "Les plans, essais, coupons et factures manuelles peuvent être testés. Le prestataire de paiement, les taxes et les tarifs définitifs seront activés après validation."
                    : "Plans, trials, coupons and manual invoices can be tested. The payment provider, taxes and final prices will be enabled after validation."}
                </p>
                {currentPlan ? (
                  <div className="mt-6 rounded-2xl bg-white/10 p-4">
                    <p className="font-black">{currentPlan.name}</p>
                    <p className="mt-2 text-sm text-indigo-100">
                      {formatMoney(currentPlan.monthly_price, currentPlan.currency, locale)} / {fr ? "mois" : "month"}
                    </p>
                  </div>
                ) : null}
              </article>
            </section>

            {context.isPlatformWorkspace ? (
              <>
                <section className="mt-8">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">{fr ? "Catalogue" : "Catalogue"}</p>
                      <h2 className="mt-2 text-3xl font-black">{fr ? "Plans commerciaux" : "Commercial plans"}</h2>
                    </div>
                    <p className="max-w-xl text-sm text-slate-600">{fr ? "Les prix et les limites ci-dessous sont provisoires et entièrement modifiables." : "Prices and limits below are provisional and fully editable."}</p>
                  </div>

                  <div className="mt-5 grid gap-5 xl:grid-cols-3">
                    {plans.filter((plan) => !plan.is_internal).map((plan) => {
                      const map = featuresByPlan.get(plan.id) ?? new Map();
                      const maxMemberFeature = map.get("max_members");
                      return (
                        <form key={plan.id} action={updatePlanAction} className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
                          <input type="hidden" name="planId" value={plan.id} />
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">{plan.code}</p>
                              <input name="name" defaultValue={plan.name} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-xl font-black" />
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(plan.status)}`}>{statusLabels[plan.status] ?? plan.status}</span>
                          </div>
                          <textarea name="description" defaultValue={plan.description ?? ""} rows={3} className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <label className="text-sm font-bold">{fr ? "Statut" : "Status"}<select name="status" defaultValue={plan.status} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"><option value="draft">{fr ? "Brouillon" : "Draft"}</option><option value="active">{fr ? "Actif" : "Active"}</option><option value="archived">{fr ? "Archivé" : "Archived"}</option></select></label>
                            <label className="text-sm font-bold">{fr ? "Tarification" : "Pricing"}<select name="pricingMode" defaultValue={plan.pricing_mode} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"><option value="fixed">{fr ? "Prix fixe" : "Fixed"}</option><option value="custom">{fr ? "Sur devis" : "Custom"}</option><option value="free">{fr ? "Gratuit" : "Free"}</option></select></label>
                            <label className="text-sm font-bold">{fr ? "Prix mensuel" : "Monthly price"}<input name="monthlyPrice" type="number" min="0" step="0.01" defaultValue={plan.monthly_price ?? ""} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
                            <label className="text-sm font-bold">{fr ? "Prix annuel" : "Annual price"}<input name="annualPrice" type="number" min="0" step="0.01" defaultValue={plan.annual_price ?? ""} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
                            <label className="text-sm font-bold">{fr ? "Devise" : "Currency"}<input name="currency" maxLength={3} defaultValue={plan.currency} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 uppercase" /></label>
                            <label className="text-sm font-bold">{fr ? "Essai (jours)" : "Trial days"}<input name="trialDays" type="number" min="0" max="365" defaultValue={plan.default_trial_days} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
                            <label className="col-span-2 text-sm font-bold">{fr ? "Collaborateurs maximum (vide = illimité)" : "Maximum members (blank = unlimited)"}<input name="maxMembers" type="number" min="0" defaultValue={maxMemberFeature?.limit_value ?? ""} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
                          </div>
                          <label className="mt-4 flex items-center gap-2 text-sm font-bold"><input type="checkbox" name="isPublic" defaultChecked={plan.is_public} /> {fr ? "Afficher publiquement ce plan" : "Show this plan publicly"}</label>
                          <div className="mt-5 space-y-2 rounded-2xl bg-slate-50 p-4">
                            {SUBSCRIPTION_FEATURE_KEYS.map((feature) => (
                              <label key={feature} className="flex items-center gap-2 text-sm font-semibold">
                                <input type="checkbox" name="features" value={feature} defaultChecked={map.get(feature)?.enabled ?? false} />
                                {featureLabels[feature]}
                              </label>
                            ))}
                          </div>
                          <button className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 font-black text-white">{fr ? "Enregistrer le plan" : "Save plan"}</button>
                        </form>
                      );
                    })}
                  </div>

                  <form action={createPlanAction} className="mt-5 grid gap-3 rounded-[2rem] border border-dashed border-indigo-300 bg-indigo-50 p-6 md:grid-cols-4">
                    <input name="code" required placeholder={fr ? "Code du nouveau plan" : "New plan code"} className="rounded-xl border border-indigo-200 px-3 py-3" />
                    <input name="name" required placeholder={fr ? "Nom du plan" : "Plan name"} className="rounded-xl border border-indigo-200 px-3 py-3" />
                    <input name="description" placeholder={fr ? "Description" : "Description"} className="rounded-xl border border-indigo-200 px-3 py-3" />
                    <button className="rounded-xl bg-indigo-600 px-4 py-3 font-black text-white">{fr ? "Créer en brouillon" : "Create draft"}</button>
                  </form>
                </section>

                <section className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm">
                  <h2 className="text-3xl font-black">{fr ? "Attribuer un plan ou un essai" : "Assign a plan or trial"}</h2>
                  <form action={assignSubscriptionAction} className="mt-5 grid gap-3 lg:grid-cols-5">
                    <select name="organizationId" required className="rounded-xl border border-slate-300 px-3 py-3"><option value="">{fr ? "Organisation" : "Organization"}</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select>
                    <select name="planId" required className="rounded-xl border border-slate-300 px-3 py-3"><option value="">{fr ? "Plan" : "Plan"}</option>{plans.filter((plan) => !plan.is_internal && plan.status !== "archived").map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>
                    <select name="status" defaultValue="trialing" className="rounded-xl border border-slate-300 px-3 py-3"><option value="trialing">{fr ? "Essai" : "Trial"}</option><option value="active">{fr ? "Actif" : "Active"}</option><option value="draft">{fr ? "Brouillon" : "Draft"}</option></select>
                    <div className="grid grid-cols-2 gap-2"><select name="billingInterval" defaultValue="monthly" className="rounded-xl border border-slate-300 px-3 py-3"><option value="monthly">{fr ? "Mensuel" : "Monthly"}</option><option value="annual">{fr ? "Annuel" : "Annual"}</option><option value="custom">{fr ? "Personnalisé" : "Custom"}</option></select><input name="trialDays" type="number" min="0" max="365" defaultValue="14" title={fr ? "Jours d’essai" : "Trial days"} className="rounded-xl border border-slate-300 px-3 py-3" /></div>
                    <button className="rounded-xl bg-emerald-600 px-4 py-3 font-black text-white">{fr ? "Attribuer" : "Assign"}</button>
                  </form>

                  <div className="mt-6 overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead><tr className="border-b border-slate-200 text-slate-500"><th className="px-3 py-3">{fr ? "Organisation" : "Organization"}</th><th className="px-3 py-3">{fr ? "Plan" : "Plan"}</th><th className="px-3 py-3">{fr ? "Statut" : "Status"}</th><th className="px-3 py-3">{fr ? "Échéance" : "End date"}</th><th className="px-3 py-3">{fr ? "Action" : "Action"}</th></tr></thead>
                      <tbody>
                        {subscriptions.map((subscription) => (
                          <tr key={subscription.id} className="border-b border-slate-100 align-top">
                            <td className="px-3 py-4 font-bold">{orgById.get(subscription.organization_id)?.name ?? subscription.organization_id}</td>
                            <td className="px-3 py-4">{planById.get(subscription.plan_id)?.name ?? "—"}</td>
                            <td className="px-3 py-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(subscription.status)}`}>{statusLabels[subscription.status] ?? subscription.status}</span></td>
                            <td className="px-3 py-4">{formatDate(subscription.trial_ends_at ?? subscription.current_period_ends_at, locale)}</td>
                            <td className="px-3 py-4">
                              {subscription.status === "suspended" ? (
                                <form action={suspendSubscriptionAction}><input type="hidden" name="organizationId" value={subscription.organization_id} /><input type="hidden" name="suspend" value="false" /><button className="rounded-lg bg-emerald-600 px-3 py-2 font-bold text-white">{fr ? "Réactiver" : "Reactivate"}</button></form>
                              ) : (
                                <form action={suspendSubscriptionAction} className="flex gap-2"><input type="hidden" name="organizationId" value={subscription.organization_id} /><input name="reason" required placeholder={fr ? "Motif" : "Reason"} className="min-w-0 rounded-lg border border-slate-300 px-2 py-2" /><button className="rounded-lg bg-red-600 px-3 py-2 font-bold text-white">{fr ? "Suspendre" : "Suspend"}</button></form>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="mt-8 grid gap-6 xl:grid-cols-2">
                  <article className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm">
                    <h2 className="text-2xl font-black">{fr ? "Coupons" : "Coupons"}</h2>
                    <form action={createCouponAction} className="mt-5 grid gap-3 sm:grid-cols-2">
                      <input name="code" required placeholder="WELCOME20" className="rounded-xl border border-slate-300 px-3 py-3 uppercase" />
                      <input name="name" required placeholder={fr ? "Nom de la promotion" : "Promotion name"} className="rounded-xl border border-slate-300 px-3 py-3" />
                      <select name="discountType" className="rounded-xl border border-slate-300 px-3 py-3"><option value="percent">{fr ? "Pourcentage" : "Percentage"}</option><option value="fixed">{fr ? "Montant fixe" : "Fixed amount"}</option></select>
                      <input name="discountValue" type="number" min="0.01" step="0.01" required placeholder={fr ? "Réduction" : "Discount"} className="rounded-xl border border-slate-300 px-3 py-3" />
                      <select name="planId" className="rounded-xl border border-slate-300 px-3 py-3"><option value="">{fr ? "Tous les plans" : "All plans"}</option>{plans.filter((plan) => !plan.is_internal).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>
                      <input name="maxRedemptions" type="number" min="1" placeholder={fr ? "Utilisations max." : "Max redemptions"} className="rounded-xl border border-slate-300 px-3 py-3" />
                      <input name="validUntil" type="date" className="rounded-xl border border-slate-300 px-3 py-3" />
                      <input name="currency" defaultValue="USD" maxLength={3} className="rounded-xl border border-slate-300 px-3 py-3 uppercase" />
                      <button className="rounded-xl bg-indigo-600 px-4 py-3 font-black text-white sm:col-span-2">{fr ? "Créer le coupon" : "Create coupon"}</button>
                    </form>
                    <div className="mt-5 space-y-3">
                      {coupons.map((coupon) => (
                        <div key={coupon.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
                          <div><p className="font-black">{coupon.code} · {coupon.name}</p><p className="text-sm text-slate-600">{coupon.discount_type === "percent" ? `${coupon.discount_percent}%` : formatMoney(coupon.discount_amount, coupon.currency ?? "USD", locale)} · {coupon.redemption_count}/{coupon.max_redemptions ?? "∞"}</p></div>
                          <form action={toggleCouponAction}><input type="hidden" name="couponId" value={coupon.id} /><input type="hidden" name="active" value={coupon.is_active ? "false" : "true"} /><button className={`rounded-xl px-4 py-2 font-black ${coupon.is_active ? "bg-red-50 text-red-700" : "bg-emerald-600 text-white"}`}>{coupon.is_active ? (fr ? "Désactiver" : "Disable") : (fr ? "Activer" : "Enable")}</button></form>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm">
                    <h2 className="text-2xl font-black">{fr ? "Facturation manuelle de test" : "Manual test invoicing"}</h2>
                    <form action={createManualInvoiceAction} className="mt-5 grid gap-3 sm:grid-cols-2">
                      <select name="organizationId" required className="rounded-xl border border-slate-300 px-3 py-3 sm:col-span-2"><option value="">{fr ? "Organisation" : "Organization"}</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select>
                      <input name="total" type="number" min="0" step="0.01" required placeholder={fr ? "Montant" : "Amount"} className="rounded-xl border border-slate-300 px-3 py-3" />
                      <input name="currency" defaultValue="USD" maxLength={3} className="rounded-xl border border-slate-300 px-3 py-3 uppercase" />
                      <input name="dueDate" type="date" className="rounded-xl border border-slate-300 px-3 py-3" />
                      <input name="notes" placeholder={fr ? "Notes" : "Notes"} className="rounded-xl border border-slate-300 px-3 py-3" />
                      <button className="rounded-xl bg-slate-950 px-4 py-3 font-black text-white sm:col-span-2">{fr ? "Créer une facture test" : "Create test invoice"}</button>
                    </form>
                    <div className="mt-5 space-y-3">
                      {invoices.slice(0, 12).map((invoice) => (
                        <div key={invoice.id} className="rounded-2xl bg-slate-50 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black">{invoice.invoice_number}</p><p className="text-sm text-slate-600">{orgById.get(invoice.organization_id)?.name ?? context.organizationName} · {formatMoney(invoice.total, invoice.currency, locale)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(invoice.status)}`}>{invoice.status}</span></div>
                          <form action={updateInvoiceStatusAction} className="mt-3 flex gap-2"><input type="hidden" name="invoiceId" value={invoice.id} /><select name="status" defaultValue={invoice.status} className="rounded-lg border border-slate-300 px-2 py-2"><option value="draft">Draft</option><option value="open">Open</option><option value="paid">Paid</option><option value="void">Void</option><option value="uncollectible">Uncollectible</option></select><button className="rounded-lg bg-indigo-600 px-3 py-2 font-bold text-white">{fr ? "Mettre à jour" : "Update"}</button></form>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              </>
            ) : (
              <section className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm">
                <h2 className="text-2xl font-black">{fr ? "Historique des factures" : "Invoice history"}</h2>
                <div className="mt-5 space-y-3">
                  {invoices.length ? invoices.map((invoice) => (
                    <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
                      <div><p className="font-black">{invoice.invoice_number}</p><p className="text-sm text-slate-600">{formatDate(invoice.created_at, locale)} · {formatMoney(invoice.total, invoice.currency, locale)}</p></div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(invoice.status)}`}>{invoice.status}</span>
                    </div>
                  )) : <p className="text-slate-500">{fr ? "Aucune facture pour le moment." : "No invoices yet."}</p>}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
