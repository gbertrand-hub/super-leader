import type {ReactNode} from "react";
import Link from "next/link";
import {LanguageSwitcher} from "@/components/i18n/language-switcher";

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-2 font-bold text-slate-950">
            <span className="text-amber-500">★</span> SUPER LEADER
          </Link>
          <LanguageSwitcher />
        </div>
        <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/60">
          <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>
          <div className="mt-7">{children}</div>
        </section>
      </div>
    </main>
  );
}
