import Link from "next/link";
import { IleadAccessRequestForm } from "@/components/acquisition/ilead-access-request-form";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { getI18n } from "@/i18n/server";

export default async function IleadAccessPage() {
  const { locale } = await getI18n();
  const fr = locale === "fr";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <div className="mx-auto max-w-4xl">
        <div className="mb-7 flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-2 font-black">
            <span className="text-amber-500">★</span> SUPER LEADER
          </Link>
          <LanguageSwitcher />
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl">
          <header className="bg-slate-950 px-7 py-9 text-white sm:px-10">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-400">iLEAD GLOBAL</p>
            <h1 className="mt-3 text-3xl font-black sm:text-5xl">
              {fr ? "Demander l’accès à l’espace iLEAD Global" : "Request access to the iLEAD Global workspace"}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              {fr
                ? "Cette page est réservée aux collaborateurs, consultants et responsables autorisés de l’écosystème iLEAD. La demande ne crée aucun accès automatique."
                : "This page is reserved for authorized employees, consultants and leaders in the iLEAD ecosystem. Submitting a request does not create automatic access."}
            </p>
          </header>
          <div className="p-7 sm:p-10">
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
              {fr
                ? "Après vérification, Owner, Admin ou RH attribuera le rôle système, les équipes, le superviseur et un mot de passe temporaire obligatoire à changer lors de la première connexion."
                : "After verification, the Owner, Admin or HR will assign the system role, teams, supervisor and a temporary password that must be changed at first sign-in."}
            </div>
            <IleadAccessRequestForm />
          </div>
        </section>
      </div>
    </main>
  );
}
