import Link from "next/link";
import { redirect } from "next/navigation";
import { OrganizationSignupForm } from "@/components/acquisition/organization-signup-form";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { getI18n } from "@/i18n/server";
import { createClient } from "@/lib/supabase/server";

export default async function SignupPage() {
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
              {fr
                ? "Créez votre compte et demandez une démonstration personnalisée"
                : "Create your account and request a personalized demo"}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              {fr
                ? "Présentez-nous votre organisation, vos priorités et les modules qui vous intéressent. L’équipe Super Leader vous contactera avant l’activation d’un espace d’essai ou de production."
                : "Tell us about your organization, priorities and preferred modules. The Super Leader team will contact you before activating a trial or production workspace."}
            </p>
          </header>
          <div className="p-7 sm:p-10">
            <OrganizationSignupForm />
          </div>
        </section>
      </div>
    </main>
  );
}
