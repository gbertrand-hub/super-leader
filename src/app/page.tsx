import Link from "next/link";
import {LanguageSwitcher} from "@/components/i18n/language-switcher";
import {RecoveryHashRedirect} from "@/components/auth/recovery-hash-redirect";
import {getI18n} from "@/i18n/server";
import {createClient} from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {data} = await supabase.auth.getUser();
  const {t} = await getI18n();

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950">
      <RecoveryHashRedirect />
      <section className="mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-slate-950 px-8 py-12 text-white shadow-2xl sm:px-12 sm:py-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="inline-flex rounded-full bg-white/10 px-4 py-2 text-sm font-bold">
            <span className="mr-2 text-amber-400">★</span> {t("brand.name")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <LanguageSwitcher variant="dark" />
            <nav className="flex gap-3">
              {data.user ? (
                <Link
                  className="rounded-xl bg-white px-4 py-2 font-bold text-slate-950"
                  href="/dashboard"
                >
                  {t("home.dashboard")}
                </Link>
              ) : (
                <>
                  <Link
                    className="rounded-xl border border-white/25 px-4 py-2 font-bold"
                    href="/login"
                  >
                    {t("home.login")}
                  </Link>
                  <Link
                    className="rounded-xl bg-indigo-600 px-4 py-2 font-bold"
                    href="/signup"
                  >
                    {t("home.signup")}
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>

        <h1 className="mt-12 max-w-4xl text-5xl font-black leading-tight tracking-tight sm:text-7xl">
          {t("home.heading")}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
          {t("home.subtitle")}
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <span className="rounded-full bg-emerald-950 px-4 py-2 text-emerald-300">Next.js 16</span>
          <span className="rounded-full bg-blue-950 px-4 py-2 text-blue-300">Supabase Auth</span>
          <span className="rounded-full bg-purple-950 px-4 py-2 text-purple-300">FR / EN</span>
        </div>
      </section>
    </main>
  );
}
