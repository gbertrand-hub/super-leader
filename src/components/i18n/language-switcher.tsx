"use client";

import {useRouter} from "next/navigation";
import {localeCookieName, type Locale} from "@/i18n/config";
import {useI18n} from "@/i18n/client";

export function LanguageSwitcher({
  variant = "light",
  className = "",
}: {
  variant?: "light" | "dark";
  className?: string;
}) {
  const router = useRouter();
  const {locale, t} = useI18n();

  function changeLocale(nextLocale: Locale) {
    if (nextLocale === locale) return;

    document.cookie = `${localeCookieName}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = nextLocale;
    router.refresh();
  }

  const inactiveClass =
    variant === "dark"
      ? "text-slate-300 hover:bg-white/10 hover:text-white"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950";

  const activeClass =
    variant === "dark"
      ? "bg-white text-slate-950"
      : "bg-slate-950 text-white";

  return (
    <div
      className={`inline-flex rounded-xl border p-1 ${
        variant === "dark" ? "border-white/15 bg-white/5" : "border-slate-200 bg-white"
      } ${className}`}
      aria-label={t("common.language")}
    >
      <button
        type="button"
        onClick={() => changeLocale("fr")}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-black transition ${
          locale === "fr" ? activeClass : inactiveClass
        }`}
        aria-pressed={locale === "fr"}
        title={t("common.french")}
      >
        FR
      </button>
      <button
        type="button"
        onClick={() => changeLocale("en")}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-black transition ${
          locale === "en" ? activeClass : inactiveClass
        }`}
        aria-pressed={locale === "en"}
        title={t("common.english")}
      >
        EN
      </button>
    </div>
  );
}
