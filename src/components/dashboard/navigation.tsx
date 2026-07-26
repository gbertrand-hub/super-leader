"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useI18n } from "@/i18n/client";

type DashboardNavigationProps = {
  children: React.ReactNode;
  fullName: string;
  email: string;
  role: string;
  organizationName: string;
  hasOrganization: boolean;
};

type NavigationItem = {
  labelKey: string;
  href: string;
  icon: IconName;
  roles?: string[];
};

type IconName =
  | "dashboard"
  | "company"
  | "teams"
  | "members"
  | "feedback"
  | "recognition"
  | "actions"
  | "sales"
  | "reports"
  | "settings"
  | "menu"
  | "close"
  | "logout";


const navigationItems: NavigationItem[] = [
  {
    labelKey: "navigation.dashboard",
    href: "/dashboard",
    icon: "dashboard",
  },
  {
    labelKey: "navigation.company",
    href: "/dashboard/company",
    icon: "company",
    roles: ["owner", "admin", "hr"],
  },
  {
    labelKey: "navigation.teams",
    href: "/dashboard/team",
    icon: "teams",
    roles: ["owner", "admin", "hr", "manager"],
  },
  {
    labelKey: "navigation.members",
    href: "/dashboard/members",
    icon: "members",
    roles: ["owner", "admin", "hr", "manager"],
  },
  {
    labelKey: "navigation.feedback",
    href: "/dashboard/feedback",
    icon: "feedback",
  },
  {
    labelKey: "navigation.recognition",
    href: "/dashboard/recognition",
    icon: "recognition",
  },
  {
    labelKey: "navigation.actions",
    href: "/dashboard/actions",
    icon: "actions",
  },
  {
    labelKey: "navigation.sales",
    href: "/dashboard/sales",
    icon: "sales",
  },
  {
    labelKey: "navigation.reports",
    href: "/dashboard/reports",
    icon: "reports",
    roles: ["owner", "admin", "hr", "manager"],
  },
];

const comingSoonItems = [
  { labelKey: "navigation.settings", icon: "settings" as IconName },
];

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  const paths: Record<IconName, React.ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    company: (
      <>
        <path d="M3 21h18" />
        <path d="M5 21V7l7-4 7 4v14" />
        <path d="M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4" />
      </>
    ),
    teams: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3 20c.4-4 2.4-6 6-6s5.6 2 6 6" />
        <path d="M15 15c3.3 0 5.2 1.7 5.5 5" />
      </>
    ),
    members: (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M2.5 20c.5-4.2 2.3-6 5.5-6 3.1 0 5 1.8 5.5 6" />
        <path d="M17 7v6M14 10h6" />
      </>
    ),
    feedback: (
      <>
        <path d="M4 4h16v12H8l-4 4V4Z" />
        <path d="M8 8h8M8 12h5" />
      </>
    ),
    recognition: (
      <>
        <path d="m12 3 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 8.2l5-.7L12 3Z" />
        <path d="M9 18.5 8 22l4-2 4 2-1-3.5" />
      </>
    ),
    actions: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </>
    ),
    sales: (
      <>
        <path d="M4 7h16v10H4z" />
        <path d="M7 10h.01M11 10h6M7 14h4M15 14h2" />
        <path d="M8 4v3M16 4v3M8 17v3M16 17v3" />
      </>
    ),
    reports: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5M15 12H3" />
        <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
      </>
    ),
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNavigation({
  children,
  fullName,
  email,
  role,
  organizationName,
  hasOrganization,
}: DashboardNavigationProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = navigationItems.filter((item) => {
    if (!hasOrganization) {
      return item.href === "/dashboard" || item.href === "/dashboard/company";
    }
    return !item.roles || item.roles.includes(role);
  });

  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const sidebar = (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      <div className="border-b border-white/10 px-5 py-5">
        <Link
          href="/dashboard"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-3"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 text-xl font-black text-slate-950">
            ★
          </span>
          <span>
            <span className="block text-base font-black tracking-wide">
              SUPER LEADER
            </span>
            <span className="block text-xs text-slate-400">
              {t("brand.shortPromise")}
            </span>
          </span>
        </Link>
      </div>

      <div className="mx-4 mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-500 font-black">
            {initials || "SL"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{fullName}</p>
            <p className="truncate text-xs text-slate-400">{email}</p>
          </div>
        </div>
        <div className="mt-3 border-t border-white/10 pt-3">
          <p className="truncate text-xs font-semibold text-amber-300">
            {organizationName}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t(`roles.${role}`)}
          </p>
        </div>
      </div>

      <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
          {t("navigation.section")}
        </p>
        <div className="space-y-1">
          {visibleItems.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                  active
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-950/30"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>

        {hasOrganization && (
          <div className="mt-6">
            <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
              {t("navigation.comingSoon")}
            </p>
            <div className="space-y-1">
              {comingSoonItems.map((item) => (
                <div
                  key={item.labelKey}
                  className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600"
                  title={t("navigation.moduleSoon")}
                >
                  <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                  <span>{t(item.labelKey)}</span>
                  <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-500">
                    {t("common.soon")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="mb-3 flex items-center justify-between gap-3 px-3">
          <span className="text-xs font-semibold text-slate-500">{t("common.language")}</span>
          <LanguageSwitcher variant="dark" />
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-red-500/15 hover:text-red-300"
          >
            <Icon name="logout" className="h-5 w-5" />
            {t("navigation.logout")}
          </button>
        </form>
        <p className="mt-3 px-3 text-[10px] text-slate-600">Super Leader V1</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 print:hidden lg:block">
        {sidebar}
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur print:hidden lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 font-black text-slate-950">
          <span className="text-amber-500">★</span>
          SUPER LEADER
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-700"
          aria-label={t("navigation.openMenu")}
        >
          <Icon name="menu" />
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 print:hidden lg:hidden">
          <button
            type="button"
            aria-label={t("navigation.closeMenu")}
            className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[min(88vw,20rem)] shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white"
              aria-label={t("navigation.closeMenu")}
            >
              <Icon name="close" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="min-w-0 print:pl-0 lg:pl-72">{children}</div>
    </div>
  );
}
