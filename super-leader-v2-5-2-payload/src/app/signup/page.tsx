import Link from "next/link";
import { redirect } from "next/navigation";
import { OrganizationSignupForm } from "@/components/acquisition/organization-signup-form";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { getI18n } from "@/i18n/server";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requestedPlan = one(params.plan);
  const selectedPlan = ["free", "starter", "growth", "enterprise"].includes(requestedPlan) ? requestedPlan : "";
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/dashboard");

  const { locale } = await getI18n();
  const fr = locale === "fr";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <div className="mb-7 flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-2 font-black">
            <span className="text-amber-500">★</span> SUPER LEADER
          </Link>
          <LanguageSwitcher />
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl shadow-slate-200/60">
          <header className="bg-slate-950 px-7 py-9 text-white sm:px-10">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-400">
              {fr ? "Pour les organisations" : "For organizations"}
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-black sm:text-5xl">
              {selectedPlan === "free"
                ? fr
                  ? "Commencez gratuitement avec Super Leader"
                  : "Start using Super Leader for free"
                : fr
                  ? "Créez votre compte et demandez une démonstration personnalisée"
                  : "Create your account and request a personalized demo"}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              {selectedPlan === "free"
                ? fr
                  ? "Le plan Free accueille jusqu’à 5 utilisateurs actifs, propriétaire inclus. Présentez votre organisation ; notre équipe vérifiera la demande avant l’activation gratuite."
                  : "The Free plan supports up to 5 active users, including the owner. Tell us about your organisation; our team will review the request before free activation."
                : fr
                  ? "Présentez-nous votre organisation, vos priorités et les modules qui vous intéressent. L’équipe Super Leader vous contactera avant l’activation d’un espace d’essai ou de production."
                  : "Tell us about your organization, priorities and preferred modules. The Super Leader team will contact you before activating a trial or production workspace."}
            </p>
          </header>
          <div className="p-7 sm:p-10">
            <OrganizationSignupForm selectedPlan={selectedPlan} />
          </div>
        </section>
      </div>
    </main>
  );
}
