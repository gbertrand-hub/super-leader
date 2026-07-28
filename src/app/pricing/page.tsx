import Link from "next/link";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { getI18n } from "@/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  pricing_mode: string;
  currency: string;
  monthly_price: number | null;
  annual_price: number | null;
  default_trial_days: number;
  sort_order: number;
};

type Feature = {
  plan_id: string;
  feature_key: string;
  enabled: boolean;
  limit_value: number | null;
};

type PublicPlan = Plan & {
  featureKeys: string[];
  memberLimit: number | null;
  isFallback?: boolean;
};

const labelsFr: Record<string, string> = {
  core_feedback: "Feedback continu",
  recognition: "Reconnaissance",
  teams: "Équipes et rôles",
  performance: "Performance et Employé du mois",
  academy: "Super Leader Academy",
  growth: "Plans de croissance",
  crm_sales: "CRM, ventes et recouvrement",
  feedback_automation: "Automatisation du feedback",
  reports_advanced: "Rapports avancés",
  custom_branding: "Personnalisation de la marque",
  api_integrations: "Intégrations API",
  priority_support: "Support prioritaire",
};

const labelsEn: Record<string, string> = {
  core_feedback: "Continuous feedback",
  recognition: "Recognition",
  teams: "Teams and roles",
  performance: "Performance and Employee of the Month",
  academy: "Super Leader Academy",
  growth: "Growth plans",
  crm_sales: "CRM, sales and collections",
  feedback_automation: "Feedback automation",
  reports_advanced: "Advanced reports",
  custom_branding: "Custom branding",
  api_integrations: "API integrations",
  priority_support: "Priority support",
};

const fallbackPlans: PublicPlan[] = [
  {
    id: "fallback-free",
    code: "free",
    name: "Free",
    description: "Pour les très petites organisations qui souhaitent démarrer avec les fonctions essentielles de Super Leader.",
    pricing_mode: "free",
    currency: "USD",
    monthly_price: 0,
    annual_price: 0,
    default_trial_days: 0,
    sort_order: 5,
    memberLimit: 5,
    featureKeys: ["core_feedback", "recognition", "teams", "performance", "academy", "growth"],
    isFallback: true,
  },
  {
    id: "fallback-starter",
    code: "starter",
    name: "Starter",
    description: "Pour les petites organisations qui structurent le feedback, les équipes et la performance.",
    pricing_mode: "fixed",
    currency: "USD",
    monthly_price: 49,
    annual_price: 490,
    default_trial_days: 14,
    sort_order: 10,
    memberLimit: 25,
    featureKeys: ["core_feedback", "recognition", "teams", "performance"],
    isFallback: true,
  },
  {
    id: "fallback-growth",
    code: "growth",
    name: "Growth",
    description: "Pour développer la performance, la formation, les ventes et la croissance des équipes.",
    pricing_mode: "fixed",
    currency: "USD",
    monthly_price: 99,
    annual_price: 990,
    default_trial_days: 14,
    sort_order: 20,
    memberLimit: 100,
    featureKeys: [
      "core_feedback",
      "recognition",
      "teams",
      "performance",
      "academy",
      "growth",
      "crm_sales",
      "feedback_automation",
      "reports_advanced",
    ],
    isFallback: true,
  },
  {
    id: "fallback-enterprise",
    code: "enterprise",
    name: "Enterprise",
    description: "Pour les organisations qui ont besoin de personnalisation, d’intégrations et d’un accompagnement avancé.",
    pricing_mode: "custom",
    currency: "USD",
    monthly_price: null,
    annual_price: null,
    default_trial_days: 30,
    sort_order: 30,
    memberLimit: null,
    featureKeys: [
      "core_feedback",
      "recognition",
      "teams",
      "performance",
      "academy",
      "growth",
      "crm_sales",
      "feedback_automation",
      "reports_advanced",
      "custom_branding",
      "api_integrations",
      "priority_support",
    ],
    isFallback: true,
  },
];

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function money(value: number | null, currency: string, locale: string): string {
  if (value === null) return locale === "fr" ? "Prix à confirmer" : "Price to be confirmed";
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function monthlyEquivalent(annualPrice: number | null, currency: string, locale: string): string | null {
  if (annualPrice === null) return null;
  return money(annualPrice / 12, currency, locale);
}

function savings(monthlyPrice: number | null, annualPrice: number | null): number | null {
  if (monthlyPrice === null || annualPrice === null) return null;
  return Math.max(0, monthlyPrice * 12 - annualPrice);
}

function descriptionFor(plan: PublicPlan, fr: boolean): string {
  if (fr) return plan.description ?? "Une offre adaptée à votre organisation.";
  if (plan.code === "free") return "For very small organisations starting with Super Leader's essential features.";
  if (plan.code === "starter") return "For small organisations structuring feedback, teams and performance.";
  if (plan.code === "growth") return "For organisations developing performance, learning, sales and team growth.";
  if (plan.code === "enterprise") return "For organisations requiring customisation, integrations and advanced support.";
  return plan.description ?? "A plan adapted to your organisation.";
}

export default async function PricingPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { locale, t } = await getI18n();
  const fr = locale === "fr";
  const labels = fr ? labelsFr : labelsEn;
  const billing = one(params.billing) === "annual" ? "annual" : "monthly";
  const admin = createAdminClient();

  const { data: planRows, error } = await admin
    .from("subscription_plans")
    .select("id,code,name,description,pricing_mode,currency,monthly_price,annual_price,default_trial_days,sort_order")
    .eq("status", "active")
    .eq("is_public", true)
    .eq("is_internal", false)
    .order("sort_order");

  const databasePlans = (planRows ?? []) as Plan[];
  const { data: featureRows } = databasePlans.length
    ? await admin
        .from("subscription_plan_features")
        .select("plan_id,feature_key,enabled,limit_value")
        .in("plan_id", databasePlans.map((plan) => plan.id))
        .eq("enabled", true)
    : { data: [] as Feature[] };
  const features = (featureRows ?? []) as Feature[];

  const configuredPlans: PublicPlan[] = databasePlans.map((plan) => {
    const planFeatures = features.filter((feature) => feature.plan_id === plan.id);
    return {
      ...plan,
      featureKeys: planFeatures
        .filter((feature) => feature.feature_key !== "max_members")
        .map((feature) => feature.feature_key),
      memberLimit:
        planFeatures.find((feature) => feature.feature_key === "max_members")?.limit_value ?? null,
    };
  });

  const plans = configuredPlans.length ? configuredPlans : fallbackPlans;
  const usingFallback = Boolean(error) || !configuredPlans.length;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-white/10 bg-slate-950 px-5 py-4 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 font-black">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 text-slate-950">★</span>
            SUPER LEADER
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher variant="dark" />
            <Link href="/login" className="rounded-xl border border-white/20 px-4 py-2 font-bold">
              {t("home.login")}
            </Link>
            <Link href="/signup" className="rounded-xl bg-indigo-600 px-4 py-2 font-black">
              {fr ? "Demander une démo" : "Request a demo"}
            </Link>
          </div>
        </div>
      </header>

      <section className="bg-slate-950 px-5 pb-28 pt-16 text-center text-white">
        <p className="text-xs font-black uppercase tracking-[.22em] text-amber-400">SUPER LEADER V2.5.2</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-black sm:text-6xl">
          {fr ? "Des plans adaptés à la croissance de votre organisation." : "Plans designed for your organisation’s growth."}
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-slate-300">
          {fr
            ? "Commencez avec les fonctions essentielles, puis activez les modules dont vos équipes ont besoin pour progresser."
            : "Start with the essentials, then activate the modules your teams need to grow."}
        </p>
        <div className="mx-auto mt-8 inline-flex rounded-2xl border border-white/15 bg-white/5 p-1.5">
          <Link
            href="/pricing?billing=monthly"
            className={`rounded-xl px-5 py-3 text-sm font-black transition ${billing === "monthly" ? "bg-white text-slate-950" : "text-white hover:bg-white/10"}`}
          >
            {fr ? "Mensuel" : "Monthly"}
          </Link>
          <Link
            href="/pricing?billing=annual"
            className={`rounded-xl px-5 py-3 text-sm font-black transition ${billing === "annual" ? "bg-white text-slate-950" : "text-white hover:bg-white/10"}`}
          >
            {fr ? "Annuel - 2 mois offerts" : "Annual - 2 months free"}
          </Link>
        </div>
      </section>

      <section className="mx-auto -mt-12 max-w-7xl px-5 pb-24">
        <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-center text-sm font-semibold text-amber-950 shadow-sm">
          {fr
            ? "Tarifs de lancement provisoires. Les paiements réels restent désactivés pendant la phase pilote et les offres peuvent être ajustées avant activation."
            : "Provisional launch pricing. Live payments remain disabled during the pilot and offers may be adjusted before activation."}
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => {
            const popular = plan.code === "growth";
            const selectedPrice = billing === "annual" ? plan.annual_price : plan.monthly_price;
            const annualSaving = savings(plan.monthly_price, plan.annual_price);
            const equivalent = monthlyEquivalent(plan.annual_price, plan.currency, locale);
            const planQuery = new URLSearchParams({ plan: plan.code, billing }).toString();

            return (
              <article
                key={plan.id}
                className={`relative flex min-h-[38rem] flex-col rounded-[2rem] border bg-white p-7 shadow-xl ${popular ? "border-indigo-500 ring-4 ring-indigo-100" : "border-slate-200"}`}
              >
                {popular ? (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-5 py-2 text-xs font-black uppercase tracking-[.14em] text-white shadow-lg">
                    {fr ? "Le plus populaire" : "Most popular"}
                  </span>
                ) : null}

                <p className="text-sm font-black uppercase tracking-[.18em] text-indigo-600">{plan.name}</p>
                <p className="mt-4 min-h-20 leading-7 text-slate-600">{descriptionFor(plan, fr)}</p>

                <div className="mt-4 min-h-28">
                  {plan.pricing_mode === "free" ? (
                    <>
                      <p className="text-4xl font-black">{fr ? "Gratuit" : "Free"}</p>
                      <p className="mt-2 text-sm font-semibold text-emerald-700">
                        {fr ? "Sans limite de durée · Aucune carte bancaire" : "No time limit · No card required"}
                      </p>
                    </>
                  ) : plan.pricing_mode === "custom" ? (
                    <>
                      <p className="text-4xl font-black">{fr ? "Sur devis" : "Custom quote"}</p>
                      <p className="mt-2 text-sm text-slate-500">
                        {fr ? "Tarification et limites adaptées à votre organisation." : "Pricing and limits tailored to your organisation."}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-4xl font-black">{money(selectedPrice, plan.currency, locale)}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {billing === "annual" ? (fr ? "par an" : "per year") : (fr ? "par mois" : "per month")}
                      </p>
                      {billing === "annual" && equivalent ? (
                        <p className="mt-2 text-sm font-bold text-emerald-700">
                          {fr ? `Soit ${equivalent} par mois` : `Equivalent to ${equivalent} per month`}
                          {annualSaving && annualSaving > 0 ? ` · ${fr ? "Économie" : "Save"} ${money(annualSaving, plan.currency, locale)}` : ""}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                <p className="mt-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
                  {plan.pricing_mode === "free"
                    ? fr
                      ? "Jusqu’à 5 utilisateurs actifs, propriétaire inclus"
                      : "Up to 5 active users, including the owner"
                    : plan.default_trial_days > 0
                      ? `${plan.default_trial_days} ${fr ? "jours d’essai configurables" : "configurable trial days"}`
                      : fr
                        ? "Activation personnalisée"
                        : "Custom activation"}
                </p>

                <div className="mt-6 space-y-3">
                  <p className="flex gap-2 font-bold">
                    <span className="text-emerald-600">✓</span>
                    {plan.memberLimit !== null
                      ? fr
                        ? `Jusqu’à ${plan.memberLimit} collaborateurs actifs`
                        : `Up to ${plan.memberLimit} active members`
                      : fr
                        ? "Nombre de collaborateurs personnalisé"
                        : "Custom member allowance"}
                  </p>
                  {plan.featureKeys.map((featureKey) => (
                    <p key={featureKey} className="flex gap-2 text-sm font-semibold leading-6 text-slate-700">
                      <span className="text-emerald-600">✓</span>
                      {labels[featureKey] ?? featureKey}
                    </p>
                  ))}
                </div>

                <div className="mt-auto pt-8">
                  <Link
                    href={`/signup?${planQuery}`}
                    className={`inline-flex w-full justify-center rounded-xl px-5 py-4 font-black text-white transition ${popular ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-950 hover:bg-indigo-600"}`}
                  >
                    {plan.code === "free"
                      ? fr
                        ? "Commencer gratuitement"
                        : "Start for free"
                      : fr
                        ? `Demander une démo ${plan.name}`
                        : `Request a ${plan.name} demo`}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>

        {usingFallback ? (
          <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-slate-500">
            {fr
              ? "Le catalogue public utilise temporairement les offres provisoires intégrées. Exécutez les migrations V2.5.1 et V2.5.2 pour publier ces plans dans l’administration."
              : "The public catalogue is temporarily using built-in provisional offers. Run the V2.5.1 and V2.5.2 migrations to publish these plans in administration."}
          </p>
        ) : null}

        <div className="mt-12 rounded-[2rem] bg-slate-950 p-8 text-center text-white sm:p-12">
          <p className="text-xs font-black uppercase tracking-[.2em] text-amber-400">
            {fr ? "Besoin d’un accompagnement personnalisé ?" : "Need a tailored approach?"}
          </p>
          <h2 className="mx-auto mt-4 max-w-3xl text-3xl font-black sm:text-4xl">
            {fr ? "Construisons ensemble le plan le plus adapté à vos équipes." : "Let’s build the plan that best fits your teams."}
          </h2>
          <Link href="/signup" className="mt-7 inline-flex rounded-2xl bg-indigo-600 px-7 py-4 font-black text-white hover:bg-indigo-700">
            {fr ? "Demander une démonstration" : "Request a demo"}
          </Link>
        </div>
      </section>
    </main>
  );
}
