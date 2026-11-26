"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useI18n } from "@/i18n/client";
import { OperationalQuickActions } from "@/components/dashboard/operational-quick-actions";

import {
  DASHBOARD_NAVIGATION_SECTIONS,
  type DashboardIconName,
  type DashboardNavigationItem,
} from "@/lib/navigation/dashboard-menu";

type DashboardNavigationProps = {
  children: React.ReactNode;
  fullName: string;
  email: string;
  role: string;
  organizationName: string;
  organizationId?: string | null;
  hasOrganization: boolean;
  unreadNotificationCount: number;
  unreadMessageCount: number;
  isPlatformWorkspace: boolean;
  enabledFeatures: string[];
  subscriptionPlanName: string;
  subscriptionStatus: string;
  avatarUrl: string | null;
  appVersion?: string;
  canReconcilePayments: boolean;
  canAccessFinanceCustomerAccounts?: boolean;
  canVerifySalesForFinance?: boolean;
  canManageAmbassadors?: boolean;
  canAccessAcademyFinanceControl?: boolean;
  hasVipGrowthMembershipAssignment?: boolean;
};

function Icon({ name, className = "h-5 w-5" }: { name: DashboardIconName; className?: string }) {
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

  const paths: Record<DashboardIconName, React.ReactNode> = {
    myday: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
        <path d="M8 3.8 6.5 2.5M16 3.8l1.5-1.3" />
      </>
    ),
    academy: (
      <>
        <path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z" />
        <path d="M6 10v5c0 1.8 2.7 3 6 3s6-1.2 6-3v-5" />
        <path d="M21 8v6" />
      </>
    ),
    notifications: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    payslips: (
      <>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M15 3v4h4" />
        <path d="M9 11h6M9 15h6M9 18h3" />
      </>
    ),
    finance: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9h18M7 14h4M15 14h2" />
        <path d="M12 2v3M12 19v3" />
      </>
    ),
    vip: (
      <>
        <path d="M5 9 8.5 5.5 12 9l3.5-3.5L19 9l-1.5 9h-11L5 9Z" />
        <path d="M7 18h10M8.5 13h.01M12 12h.01M15.5 13h.01" />
      </>
    ),
    executive: (
      <>
        <path d="M4 20h16" />
        <path d="M6 20V9l6-5 6 5v11" />
        <path d="M9 20v-5h6v5" />
        <path d="M9 10h.01M12 10h.01M15 10h.01" />
      </>
    ),
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    acquisition: (
      <>
        <path d="M4 6h16v14H4z" />
        <path d="M9 6V4h6v2" />
        <path d="M4 11h16" />
        <path d="M9 15h6M12 12v6" />
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
    collections: (
      <>
        <path d="M4 7h16v10H4z" />
        <path d="M8 11h8M8 14h5" />
        <path d="M7 4 4 7l3 3M17 20l3-3-3-3" />
      </>
    ),
    crm: (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M2.5 20c.5-4.2 2.3-6 5.5-6 3.1 0 5 1.8 5.5 6" />
        <path d="M15 5h6v10h-4l-2.5 2.5V5Z" />
        <path d="M17 8h2M17 11h2" />
      </>
    ),
    automation: (
      <>
        <path d="M4 6h16v10H8l-4 4V6Z" />
        <path d="M8 10h5M8 13h8" />
        <path d="M17 3v4M15 5h4" />
      </>
    ),
    performance: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        <path d="m5 7 3-3 3 2 4-4 4 3" />
      </>
    ),
    growth: (
      <>
        <path d="M12 21V10" />
        <path d="M12 14c-4 0-7-2.5-7-6 4 0 7 2.5 7 6Z" />
        <path d="M12 11c4 0 7-2.5 7-6-4 0-7 2.5-7 6Z" />
        <path d="M5 21h14" />
      </>
    ),
    events: (
      <>
        <path d="M4 5h16v15H4z" />
        <path d="M8 3v4M16 3v4M4 9h16" />
        <path d="M8 13h3M13 13h3M8 17h8" />
      </>
    ),
    subscription: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9h18M7 14h4M15 14h2" />
      </>
    ),
    integrations: (
      <>
        <path d="M8 7V4M16 7V4M7 12H4M20 12h-3M8 17v3M16 17v3" />
        <rect x="7" y="7" width="10" height="10" rx="3" />
        <path d="M10 12h4" />
      </>
    ),
    schedule: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
        <path d="M7 14h3M14 14h3M7 18h3M14 18h3" />
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
    lock: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
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

function isActivePath(
  pathname: string,
  href: string,
  searchParams: ReturnType<typeof useSearchParams>,
) {
  const [targetPath, targetQuery = ""] = href.split("?");
  const pathMatches =
    targetPath === "/dashboard"
      ? pathname === targetPath
      : pathname === targetPath || pathname.startsWith(`${targetPath}/`);

  if (!pathMatches) return false;
  if (!targetQuery) {
    return pathname !== targetPath || searchParams.toString().length === 0;
  }

  const expected = new URLSearchParams(targetQuery);
  for (const [key, value] of expected.entries()) {
    if (searchParams.get(key) !== value) return false;
  }
  return true;
}

function getActiveNavigationHref(
  pathname: string,
  items: Array<{href: string; lockedByPlan: boolean}>,
  searchParams: ReturnType<typeof useSearchParams>,
) {
  const matches = items.filter(
    (item) => !item.lockedByPlan && isActivePath(pathname, item.href, searchParams),
  );

  if (matches.length === 0) return null;

  return matches.reduce((mostSpecific, candidate) => {
    const [mostSpecificPath, mostSpecificQuery = ""] = mostSpecific.href.split("?");
    const [candidatePath, candidateQuery = ""] = candidate.href.split("?");

    if (candidatePath.length !== mostSpecificPath.length) {
      return candidatePath.length > mostSpecificPath.length ? candidate : mostSpecific;
    }

    return candidateQuery.length > mostSpecificQuery.length ? candidate : mostSpecific;
  }).href;
}

const GLOBAL_SEARCH_ALIASES: Record<string, string[]> = {
  "/dashboard/my-day": [
    "priorites", "priorités", "rapport journalier", "presence", "présence", "pointage", "conge", "congé", "leave", "daily report", "attendance",
  ],
  "/dashboard/events?portal=operations": [
    "budget evenement", "budget événement", "documents evenement", "documents événement", "equipe mission", "équipe mission", "taches evenement", "tâches événement", "event budget", "event documents", "mission team",
  ],
  "/dashboard/events?portal=calendar": ["calendrier evenement", "calendrier événement", "agenda evenement", "agenda événement", "event calendar"],
  "/dashboard/crm/prospects": ["leads", "clients potentiels", "prospects commerciaux", "nouveau prospect"],
  "/dashboard/crm/ambassadors": ["ambassadeur", "ambassadeurs", "recommande par", "recommandé par", "apporteur", "parrain", "referral", "referrer"],
  "/dashboard/academy/responsibilities": ["mes responsabilites", "mes responsabilités", "fiche de fonction", "poste academique", "poste académique", "direction ecole", "direction école", "coordination academique", "coordination académique", "responsable suivi", "formateur", "responsable communication", "responsable marketing", "responsable financier", "analyste de donnees", "analyste de données", "observateur", "academy responsibilities", "role profile"],
  "/dashboard/crm/pipeline": ["pipeline", "opportunites", "opportunités", "negociation", "négociation"],
  "/dashboard/crm/scoring": ["score prospect", "score prospects", "prospects chauds", "lead scoring", "qualification prospect"],
  "/dashboard/crm/catalog": ["produits", "catalogue", "secteurs", "offres commerciales"],
  "/dashboard/collections": ["recouvrement", "impayes", "impayés", "retards paiement", "collections"],
  "/dashboard/finance?view=overview": ["finance", "tresorerie", "trésorerie", "vue finance", "financial overview"],
  "/dashboard/finance?view=documents": ["factures", "proforma", "documents finance", "invoices"],
  "/dashboard/finance/payments": ["paiements", "encaissements", "payments"],
  "/dashboard/finance/expenses": ["depenses", "dépenses", "expenses"],
  "/dashboard/finance/budgets": ["budget", "budgets", "budget finance"],
  "/dashboard/finance/settings": ["parametres finance", "paramètres finance", "finance settings"],
  "/dashboard/academy/students/finance-control": ["centre financier étudiant", "centre financier etudiant", "finance academy", "paiements étudiants", "paiements etudiants", "soldes étudiants", "soldes etudiants", "student finance", "academy payments", "recouvrement academy"],
  "/dashboard/admin/identity-audit": ["identités 360", "identites 360", "identité", "identite", "dossier 360", "identity 360", "crm academy identity"],
  "/dashboard/vip/growth": ["marketing vip", "croissance vip", "adhesions vip", "adhésions vip", "prospects vip", "vip growth", "membership growth"],
  "/dashboard/notifications": ["notifications", "alertes", "alerts"],
  "/dashboard/messages": ["messages", "messagerie", "chat interne", "internal messaging"],
  "/dashboard/schedule": ["agenda", "planning", "calendrier personnel", "schedule"],
  "/dashboard/profile": ["profil", "mon profil", "profile"],
};

function normalizeNavigationSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SECTION_ACCENTS = {
  indigo: {
    icon: "bg-indigo-500/15 text-indigo-300",
    active: "border-indigo-400/30 bg-indigo-500/10 text-indigo-100",
  },
  sky: {
    icon: "bg-sky-500/15 text-sky-300",
    active: "border-sky-400/30 bg-sky-500/10 text-sky-100",
  },
  emerald: {
    icon: "bg-emerald-500/15 text-emerald-300",
    active: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  },
  amber: {
    icon: "bg-amber-400/15 text-amber-300",
    active: "border-amber-300/30 bg-amber-400/10 text-amber-100",
  },
  violet: {
    icon: "bg-violet-500/15 text-violet-300",
    active: "border-violet-400/30 bg-violet-500/10 text-violet-100",
  },
  rose: {
    icon: "bg-rose-500/15 text-rose-300",
    active: "border-rose-400/30 bg-rose-500/10 text-rose-100",
  },
  slate: {
    icon: "bg-white/10 text-slate-300",
    active: "border-white/15 bg-white/10 text-white",
  },
} as const;

export function DashboardNavigation({
  children,
  fullName,
  email,
  role,
  organizationName,
  organizationId = null,
  hasOrganization,
  unreadNotificationCount,
  unreadMessageCount,
  isPlatformWorkspace,
  enabledFeatures,
  subscriptionPlanName,
  subscriptionStatus,
  avatarUrl,
  appVersion,
  canReconcilePayments,
  canAccessFinanceCustomerAccounts = false,
  canVerifySalesForFinance = false,
  canManageAmbassadors = false,
  canAccessAcademyFinanceControl = false,
  hasVipGrowthMembershipAssignment = false,
}: DashboardNavigationProps) {
  const pathname = usePathname();

  // V4.10.138 R8 - Contextual quick actions
  const showAcademicQuickActions =
    pathname.startsWith("/dashboard/academy") ||
    pathname.startsWith("/dashboard/admin/identity-audit");
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sectionOpenState, setSectionOpenState] = useState<Record<string, boolean>>({});
  const [menuSearch, setMenuSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const desktopGlobalSearchInputRef = useRef<HTMLInputElement>(null);
  const mobileGlobalSearchInputRef = useRef<HTMLInputElement>(null);

  type ResolvedNavigationItem = DashboardNavigationItem & {
    lockedByPlan: boolean;
    resolvedHref: string;
  };

  const canSeeLockedPlanModules = role === "owner" || role === "admin";
  const canAccessIdentity360 = role === "owner" || role === "admin";
  // V4_8_70_ADMIN_COMMAND_CENTER_NAV
  const resolvedSections = DASHBOARD_NAVIGATION_SECTIONS.map((section) => {
    const sourceItems: DashboardNavigationItem[] =
      section.id === "administration" && hasOrganization
        ? [
            {
              labelKey: "navigation.adminDashboard",
              label: { fr: "Tableau de bord", en: "Dashboard" },
              href: "/dashboard/admin",
              icon: "dashboard",
              roles: ["owner", "admin", "hr"],
            },
            ...section.items,
          ]
        : section.items;

    const items = sourceItems.flatMap<ResolvedNavigationItem>((item) => {
      if (!hasOrganization) {
        return item.href === "/dashboard"
          ? [{ ...item, lockedByPlan: false, resolvedHref: item.href }]
          : [];
      }
      if (item.platformOnly && !isPlatformWorkspace) return [];

      // V4.8.83 R2: a delegated VIP Growth & Membership Manager may access
      // only the dedicated growth command center without inheriting VIP admin rights.
      const grantedByVipGrowthAssignment =
        item.href === "/dashboard/vip/growth" && hasVipGrowthMembershipAssignment;
      const grantedByFinanceVerification =
        item.href === "/dashboard/finance?view=overview" && canVerifySalesForFinance;
      const grantedByFinanceCustomerAccounts =
        item.href === "/dashboard/finance/customer-accounts" && canAccessFinanceCustomerAccounts;

      if (item.roles && !item.roles.includes(role) && !grantedByVipGrowthAssignment && !grantedByFinanceVerification && !grantedByFinanceCustomerAccounts) return [];
      if (item.paymentReconciliationOnly && !canReconcilePayments) return [];
      if (item.ambassadorManagementOnly && !canManageAmbassadors) return [];
      if (item.academyFinanceControlOnly && !canAccessAcademyFinanceControl) return [];

      const lockedByPlan = Boolean(
        item.featureKey && !enabledFeatures.includes(item.featureKey),
      );
      if (lockedByPlan && !canSeeLockedPlanModules) return [];

      const scopedHref =
        item.organizationScoped && organizationId
          ? `${item.href}${item.href.includes("?") ? "&" : "?"}organization=${encodeURIComponent(organizationId)}`
          : item.href;
      const resolvedHref =
        lockedByPlan && item.featureKey
          ? `/dashboard/subscription?upgrade=${encodeURIComponent(item.featureKey)}`
          : scopedHref;
      return [{ ...item, lockedByPlan, resolvedHref }];
    });
    const orderedItems = section.id === "finance"
      ? [...items].sort((left, right) => {
          const priority = (href: string) => {
            if (href === "/dashboard/finance?view=overview") return 0;
            if (href === "/dashboard/finance/payments") return 1;
            if (href === "/dashboard/finance/customer-accounts") return 2;
            return 3;
          };
          return priority(left.href) - priority(right.href);
        })
      : items;
    return { ...section, items: orderedItems };
  }).filter((section) => section.items.length > 0);
  const normalizedMenuSearch = normalizeNavigationSearch(menuSearch);
  const normalizedGlobalSearch = normalizeNavigationSearch(globalSearch);

  const globalSearchResults = useMemo(() => {
    if (!normalizedGlobalSearch) return [];

    return resolvedSections
      .flatMap((section) =>
        section.items.map((item, itemIndex) => {
          const label = item.label
            ? locale === "fr" ? item.label.fr : item.label.en
            : t(item.labelKey);
          const sectionLabel = t(section.labelKey);
          const aliases = GLOBAL_SEARCH_ALIASES[item.href] ?? [];
          const haystack = normalizeNavigationSearch(
            [sectionLabel, label, item.href, ...aliases].join(" "),
          );
          const normalizedLabel = normalizeNavigationSearch(label);
          const startsWithLabel = normalizedLabel.startsWith(normalizedGlobalSearch);
          const containsLabel = normalizedLabel.includes(normalizedGlobalSearch);
          const matches = haystack.includes(normalizedGlobalSearch);
          if (!matches) return null;
          return {
            sectionId: section.id,
            sectionLabel,
            label,
            item,
            score: startsWithLabel ? 3 : containsLabel ? 2 : 1,
          };
        }),
      )
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, locale))
      .slice(0, 10);
  }, [locale, normalizedGlobalSearch, resolvedSections, t]);

  const visibleSections = normalizedMenuSearch
    ? resolvedSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => {
            const label = item.label
              ? locale === "fr" ? item.label.fr : item.label.en
              : t(item.labelKey);
            return normalizeNavigationSearch(
              [t(section.labelKey), label].join(" "),
            ).includes(normalizedMenuSearch);
          }),
        }))
        .filter((section) => section.items.length > 0)
    : resolvedSections;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const target = window.innerWidth >= 1024
          ? desktopGlobalSearchInputRef.current
          : mobileGlobalSearchInputRef.current;
        target?.focus();
        target?.select();
      }

      if (event.key === "Escape") {
        setGlobalSearch("");
        desktopGlobalSearchInputRef.current?.blur();
        mobileGlobalSearchInputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

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
          href={hasOrganization ? "/dashboard/my-day" : "/dashboard"}
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

      <Link
        href="/dashboard/profile"
        onClick={() => setMobileOpen(false)}
        title={locale === "fr" ? "Ouvrir et modifier mon profil" : "Open and edit my profile"}
        aria-label={locale === "fr" ? "Ouvrir mon profil" : "Open my profile"}
        className={`mx-4 mt-4 block rounded-2xl border p-3 transition ${
          pathname === "/dashboard/profile"
            ? "border-indigo-400/50 bg-indigo-500/15 shadow-lg shadow-indigo-950/20"
            : "border-white/10 bg-white/5 hover:border-indigo-400/40 hover:bg-white/10"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-indigo-500 font-black">
            {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : (initials || "SL")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{fullName}</p>
            <p className="truncate text-xs text-slate-400">{email}</p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-indigo-300">
              {locale === "fr" ? "Modifier mon profil" : "Edit my profile"}
            </p>
          </div>
          <Icon name="chevron" className="h-4 w-4 text-slate-500" />
        </div>
        <div className="mt-3 border-t border-white/10 pt-3">
          <p className="truncate text-xs font-semibold text-amber-300">
            {organizationName}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t(`roles.${role}`)}
          </p>
          {hasOrganization ? (
            <p className="mt-2 truncate text-[10px] font-bold uppercase tracking-wide text-indigo-300">
              {subscriptionPlanName} · {subscriptionStatus}
            </p>
          ) : null}
        </div>
      </Link>

      <div className="px-3 pt-4">
        <label className="relative block">
          <span className="sr-only">
            {locale === "fr" ? "Rechercher un module" : "Search a module"}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            type="search"
            value={menuSearch}
            onChange={(event) => setMenuSearch(event.target.value)}
            placeholder={locale === "fr" ? "Rechercher un module" : "Search a module"}
            autoComplete="off"
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm font-semibold text-white outline-none placeholder:text-slate-500 focus:border-indigo-400/60 focus:bg-white/10 focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
      </div>

      <nav className="mt-3 flex-1 overflow-y-auto px-3 pb-4" aria-label={t("navigation.section")}>
        <div className="space-y-2">
          {visibleSections.map((section) => {
            const activeHref = getActiveNavigationHref(pathname, section.items, searchParams);
            const sectionActive = activeHref !== null;
            const sectionOpen =
              normalizedMenuSearch
                ? true
                : sectionOpenState[section.id] ?? (sectionActive || Boolean(section.defaultOpen));
            const accent = SECTION_ACCENTS[section.accent];

            return (
              <section key={section.id} aria-labelledby={`navigation-section-${section.id}`}>
                <button
                  type="button"
                  id={`navigation-section-${section.id}`}
                  aria-expanded={sectionOpen}
                  aria-controls={`navigation-items-${section.id}`}
                  onClick={() =>
                    setSectionOpenState((current) => ({
                      ...current,
                      [section.id]: !sectionOpen,
                    }))
                  }
                  className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition ${
                    sectionActive
                      ? accent.active
                      : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${accent.icon}`}>
                    <Icon name={section.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1 text-[10px] font-black uppercase tracking-[0.16em]">
                    {t(section.labelKey)}
                  </span>
                  <Icon
                    name="chevron"
                    className={`h-4 w-4 shrink-0 transition-transform ${sectionOpen ? "rotate-90" : ""}`}
                  />
                </button>

                {sectionOpen ? (
                  <div
                    id={`navigation-items-${section.id}`}
                    className="ml-4 mt-1 space-y-1 border-l border-white/10 pl-2"
                  >
                    {section.items.map((item, itemIndex) => {
                      const active = item.href === activeHref;
                      const title = item.lockedByPlan
                        ? t("navigation.planRequired")
                        : item.comingSoon
                          ? t("navigation.moduleSoon")
                          : undefined;

                      return (
                        <Link
                          key={`${section.id}-${item.href}-${itemIndex}`}
                          href={item.resolvedHref}
                          onClick={() => setMobileOpen(false)}
                          title={title}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                            active
                              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-950/30"
                              : item.lockedByPlan
                                ? "border border-white/5 text-slate-500 hover:border-indigo-400/30 hover:bg-indigo-500/10 hover:text-indigo-200"
                                : item.comingSoon
                                  ? "text-slate-400 hover:bg-white/10 hover:text-white"
                                  : "text-slate-300 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                          <span className="min-w-0 flex-1">{item.label ? (locale === "fr" ? item.label.fr : item.label.en) : t(item.labelKey)}</span>
                          {item.href === "/dashboard/notifications" && unreadNotificationCount > 0 ? (
                            <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
                              {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                            </span>
                          ) : null}
                          {item.href === "/dashboard/messages" && unreadMessageCount > 0 ? (
                            <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
                              {unreadMessageCount > 99 ? "99+" : unreadMessageCount}
                            </span>
                          ) : null}
                          {item.lockedByPlan ? (
                            <span className="flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-500">
                              <Icon name="lock" className="h-3 w-3" />
                              {t("navigation.planBadge")}
                            </span>
                          ) : item.comingSoon ? (
                            <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-300">
                              {t("common.soon")}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
          {visibleSections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm font-semibold text-slate-500">
              {locale === "fr" ? "Aucun module trouvé" : "No module found"}
            </div>
          ) : null}
        </div>

      
        {/* V4_10_138_CANTON_MENU_FINAL_R10 */}
        {hasOrganization ? (
          <section className="mt-5" aria-labelledby="navigation-section-canton-r10">
            <p
              id="navigation-section-canton-r10"
              className="px-3 pb-2 text-[10px] font-black uppercase tracking-[0.19em] text-slate-500"
            >
              ACTIVITÉ COMMERCIALE</p>
            <Link
              href="/dashboard/canton-visitors"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                isActivePath(pathname, "/dashboard/canton-visitors", searchParams)
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-950/30"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon name="schedule" className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1">Visiteurs &amp; Rendez-vous</span>
            </Link>
          </section>
        ) : null}
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
        <p suppressHydrationWarning className="mt-3 px-3 text-[10px] text-slate-600">Super Leader V{appVersion ?? ""}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 print:hidden lg:block">
        {sidebar}
      </aside>

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur print:hidden lg:hidden">
        <div className="flex h-16 items-center justify-between px-4">
          <Link href={hasOrganization ? "/dashboard/my-day" : "/dashboard"} className="flex items-center gap-2 font-black text-slate-950">
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
        </div>
        <div className="relative px-4 pb-3">
          <label className="relative block">
            <span className="sr-only">
              {locale === "fr" ? "Rechercher dans Super Leader" : "Search Super Leader"}
            </span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              ref={mobileGlobalSearchInputRef}
              type="search"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder={locale === "fr" ? "Rechercher dans Super Leader..." : "Search Super Leader..."}
              autoComplete="off"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15"
            />
          </label>
          {normalizedGlobalSearch ? (
            <div className="absolute left-4 right-4 top-[calc(100%-0.25rem)] z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              {globalSearchResults.length > 0 ? (
                <div className="max-h-80 overflow-y-auto p-2">
                  {globalSearchResults.map(({sectionId, sectionLabel, label, item}) => (
                    <Link
                      key={`mobile-global-search-${sectionId}-${item.href}`}
                      href={item.resolvedHref}
                      onClick={() => setGlobalSearch("")}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
                        <Icon name={item.icon} className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-950">{label}</span>
                        <span className="block truncate text-[11px] font-semibold text-slate-500">{sectionLabel}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-5 text-center text-sm font-semibold text-slate-500">
                  {locale === "fr" ? "Aucun résultat dans vos accès" : "No result in your access"}
                </div>
              )}
              <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-semibold leading-4 text-slate-500">
                {locale === "fr"
                  ? "Sécurité : seules les pages autorisées pour votre compte sont affichées."
                  : "Security: only pages authorized for your account are shown."}
              </div>
            </div>
          ) : null}
        </div>
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

      <div className="min-w-0 print:pl-0 lg:pl-72">
        <header className="sticky top-0 z-30 hidden border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur print:hidden lg:block">
          <div className="mx-auto flex min-h-20 max-w-[1600px] items-center gap-6 px-6">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600">
                {locale === "fr" ? "Navigation rapide" : "Quick navigation"}
              </p>
              <p className="mt-1 text-sm font-bold text-slate-700">
                {locale === "fr" ? "Trouvez une page sans parcourir les menus" : "Find a page without browsing menus"}
              </p>
            </div>
            <div className="relative mx-auto w-full max-w-3xl">
              <label className="relative block">
                <span className="sr-only">
                  {locale === "fr" ? "Rechercher dans Super Leader" : "Search Super Leader"}
                </span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
                <input
                  ref={desktopGlobalSearchInputRef}
                  type="search"
                  value={globalSearch}
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  placeholder={locale === "fr" ? "Rechercher dans Super Leader..." : "Search Super Leader..."}
                  autoComplete="off"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-20 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-400">
                  Ctrl K
                </span>
              </label>

              {normalizedGlobalSearch ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/10">
                  {globalSearchResults.length > 0 ? (
                    <div className="max-h-[28rem] overflow-y-auto p-2">
                      {globalSearchResults.map(({sectionId, sectionLabel, label, item}) => (
                        <Link
                          key={`desktop-global-search-${sectionId}-${item.href}`}
                          href={item.resolvedHref}
                          onClick={() => setGlobalSearch("")}
                          className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                            <Icon name={item.icon} className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-black text-slate-950">{label}</span>
                            <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{sectionLabel}</span>
                          </span>
                          {item.lockedByPlan ? (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase text-slate-500">
                              {t("navigation.planBadge")}
                            </span>
                          ) : item.comingSoon ? (
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-black uppercase text-amber-700">
                              {t("common.soon")}
                            </span>
                          ) : null}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm font-black text-slate-700">
                        {locale === "fr" ? "Aucun résultat dans vos accès" : "No result in your access"}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">
                        {locale === "fr" ? "Essayez un autre nom de page ou un mot-clé." : "Try another page name or keyword."}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold text-slate-500">
                    <Icon name="lock" className="h-3.5 w-3.5 text-emerald-600" />
                    {locale === "fr"
                      ? "Sécurité : seules les pages autorisées pour votre compte sont affichées."
                      : "Security: only pages authorized for your account are shown."}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canAccessIdentity360 ? (
                <Link
                  href={organizationId
                    ? `/dashboard/admin/identity-audit?organization=${encodeURIComponent(organizationId)}`
                    : "/dashboard/admin/identity-audit"}
                  className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-950 shadow-sm transition hover:border-indigo-400 hover:bg-indigo-100"
                  title={locale === "fr" ? "Ouvrir Identité 360°" : "Open Identity 360°"}
                >
                  <span aria-hidden="true">🪪</span>{" "}
                  {locale === "fr" ? "Identité 360°" : "Identity 360°"}
                </Link>
              ) : null}
              {canAccessAcademyFinanceControl ? (
                <Link
                  href={organizationId
                    ? `/dashboard/academy/students/finance-control?organization=${encodeURIComponent(organizationId)}`
                    : "/dashboard/academy/students/finance-control"}
                  className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-950 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-100"
                  title={locale === "fr" ? "Ouvrir le Centre financier étudiants" : "Open the Student finance center"}
                >
                  <span aria-hidden="true">💳</span>{" "}
                  {locale === "fr" ? "Centre financier étudiants" : "Student finance center"}
                </Link>
              ) : null}
            </div>
          </div>
        </header>
        {children}
        {/* OPERATIONAL_QUICK_ACTIONS_V4_8_67 */}
        {showAcademicQuickActions ? (
<OperationalQuickActions
          role={role}
          enabledFeatures={enabledFeatures}
          unreadNotificationCount={unreadNotificationCount}
          unreadMessageCount={unreadMessageCount}
          isPlatformWorkspace={isPlatformWorkspace}
          organizationId={organizationId}
          canAccessAcademyFinanceControl={canAccessAcademyFinanceControl}
        />
) : null}
      </div>
    </div>
  );
}
