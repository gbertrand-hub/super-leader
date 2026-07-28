import Link from "next/link";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { getI18n } from "@/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  pricing_mode: string;
  currency: string;
  monthly_price: number | null;
  annual_price: number | null;
  default_trial_days: number;
};

type Feature = {
  plan_id: string;
  feature_key: string;
  enabled: boolean;
  limit_value: number | null;
};

const labelsFr: Record<string, string> = {
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
const labelsEn: Record<string, string> = {
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

function money(value: number | null, currency: string, locale: string): string {
  if (value === null) return locale === "fr" ? "Prix à confirmer" : "Price to be confirmed";
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export default async function PricingPage() {
  const { locale, t } = await getI18n();
  const fr = locale === "fr";
  const labels = fr ? labelsFr : labelsEn;
  const admin = createAdminClient();
  const { data: planRows, error } = await admin
    .from("subscription_plans")
    .select("id,name,description,pricing_mode,currency,monthly_price,annual_price,default_trial_days")
    .eq("status", "active")
    .eq("is_public", true)
    .eq("is_internal", false)
    .order("sort_order");

  const plans = (planRows ?? []) as Plan[];
  const { data: featureRows } = plans.length
    ? await admin
        .from("subscription_plan_features")
        .select("plan_id,feature_key,enabled,limit_value")
        .in("plan_id", plans.map((plan) => plan.id))
        .eq("enabled", true)
    : { data: [] as Feature[] };
  const features = (featureRows ?? []) as Feature[];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-white/10 bg-slate-950 px-5 py-4 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 font-black"><span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 text-slate-950">★</span>SUPER LEADER</Link>
          <div className="flex items-center gap-3"><LanguageSwitcher variant="dark" /><Link href="/login" className="rounded-xl border border-white/20 px-4 py-2 font-bold">{t("home.login")}</Link><Link href="/signup" className="rounded-xl bg-indigo-600 px-4 py-2 font-black">{fr ? "Demander une démo" : "Request a demo"}</Link></div>
        </div>
      </header>

      <section className="bg-slate-950 px-5 pb-24 pt-16 text-center text-white">
        <p className="text-xs font-black uppercase tracking-[.22em] text-amber-400">SUPER LEADER V2.5</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-black sm:text-6xl">{fr ? "Des plans adaptés à la croissance de votre organisation." : "Plans designed for your organisation’s growth."}</h1>
        <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-slate-300">{fr ? "Les offres sont actuellement en phase de configuration. Demandez une démonstration pour construire le plan le plus adapté à vos équipes." : "Offers are currently being configured. Request a demo to shape the plan that best fits your teams."}</p>
      </section>

      <section className="mx-auto -mt-10 max-w-7xl px-5 pb-24">
        {error || !plans.length ? (
          <div className="rounded-[2rem] border border-amber-300 bg-amber-50 p-10 text-center shadow-xl">
            <h2 className="text-3xl font-black">{fr ? "Plans en préparation" : "Plans in preparation"}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-amber-900">{fr ? "Les prix et limites définitifs seront publiés après validation commerciale. Les demandes de démonstration sont déjà ouvertes." : "Final prices and limits will be published after commercial validation. Demo requests are already open."}</p>
            <Link href="/signup" className="mt-7 inline-flex rounded-2xl bg-indigo-600 px-7 py-4 font-black text-white">{fr ? "Demander une démonstration" : "Request a demo"}</Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {plans.map((plan, index) => {
              const planFeatures = features.filter((feature) => feature.plan_id === plan.id);
              const memberLimit = planFeatures.find((feature) => feature.feature_key === "max_members")?.limit_value ?? null;
              return (
                <article key={plan.id} className={`rounded-[2rem] border bg-white p-7 shadow-xl ${index === 1 ? "border-indigo-400 ring-4 ring-indigo-100" : "border-slate-200"}`}>
                  <p className="text-sm font-black uppercase tracking-[.18em] text-indigo-600">{plan.name}</p>
                  <p className="mt-4 min-h-16 text-slate-600">{plan.description}</p>
                  <div className="mt-6">
                    {plan.pricing_mode === "custom" ? <p className="text-3xl font-black">{fr ? "Sur devis" : "Custom quote"}</p> : <><p className="text-3xl font-black">{money(plan.monthly_price, plan.currency, locale)}</p><p className="mt-1 text-sm text-slate-500">{fr ? "par mois" : "per month"}</p></>}
                  </div>
                  <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{plan.default_trial_days > 0 ? `${plan.default_trial_days} ${fr ? "jours d’essai configurables" : "configurable trial days"}` : (fr ? "Activation personnalisée" : "Custom activation")}</p>
                  <div className="mt-6 space-y-3">
                    {memberLimit !== null ? <p className="flex gap-2 font-bold"><span className="text-emerald-600">✓</span>{fr ? `Jusqu’à ${memberLimit} collaborateurs` : `Up to ${memberLimit} members`}</p> : null}
                    {planFeatures.filter((feature) => feature.feature_key !== "max_members").map((feature) => <p key={feature.feature_key} className="flex gap-2 text-sm font-semibold text-slate-700"><span className="text-emerald-600">✓</span>{labels[feature.feature_key] ?? feature.feature_key}</p>)}
                  </div>
                  <Link href="/signup" className="mt-8 inline-flex w-full justify-center rounded-xl bg-slate-950 px-5 py-4 font-black text-white hover:bg-indigo-600">{fr ? "Demander une démonstration" : "Request a demo"}</Link>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
