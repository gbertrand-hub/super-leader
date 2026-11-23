import Link from "next/link";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";

type ModuleDefinition = {
  labelKey: string;
  label?: {fr: string; en: string};
  sectionKey: string;
  backHref: string;
  accent: "indigo" | "sky" | "emerald" | "amber" | "violet" | "rose" | "slate";
};

const MODULES: Record<string, ModuleDefinition> = {
  "internal-messaging": {
    labelKey: "navigation.internalMessaging",
    sectionKey: "navigation.sections.core",
    backHref: "/dashboard",
    accent: "indigo",
  },
  "messaging-mentions-reactions": {
    labelKey: "navigation.internalMessaging",
    label: {fr: "Mentions et réactions", en: "Mentions and reactions"},
    sectionKey: "navigation.sections.core",
    backHref: "/dashboard/messages",
    accent: "indigo",
  },
  "messaging-voice": {
    labelKey: "navigation.internalMessaging",
    label: {fr: "Messages vocaux", en: "Voice messages"},
    sectionKey: "navigation.sections.core",
    backHref: "/dashboard/messages",
    accent: "indigo",
  },
  "messaging-announcements": {
    labelKey: "navigation.internalMessaging",
    label: {fr: "Annonces officielles", en: "Official announcements"},
    sectionKey: "navigation.sections.core",
    backHref: "/dashboard/messages",
    accent: "indigo",
  },
  "messaging-meetings": {
    labelKey: "navigation.internalMessaging",
    label: {fr: "Réunions instantanées", en: "Instant meetings"},
    sectionKey: "navigation.sections.core",
    backHref: "/dashboard/messages",
    accent: "indigo",
  },
  "crm-reports": {
    labelKey: "navigation.crmReports",
    sectionKey: "navigation.sections.crm",
    backHref: "/dashboard/crm",
    accent: "sky",
  },
  "hr-dashboard": {
    labelKey: "navigation.hrDashboard",
    sectionKey: "navigation.sections.hr",
    backHref: "/dashboard/performance",
    accent: "emerald",
  },
  "leave-and-absence": {
    labelKey: "navigation.leaveAndAbsence",
    sectionKey: "navigation.sections.hr",
    backHref: "/dashboard/performance?view=attendance",
    accent: "emerald",
  },
  "hr-documents": {
    labelKey: "navigation.hrDocuments",
    sectionKey: "navigation.sections.hr",
    backHref: "/dashboard/members",
    accent: "emerald",
  },
  "finance-payments": {
    labelKey: "navigation.payments",
    sectionKey: "navigation.sections.finance",
    backHref: "/dashboard/finance?view=documents",
    accent: "amber",
  },
  "finance-expenses": {
    labelKey: "navigation.expenses",
    sectionKey: "navigation.sections.finance",
    backHref: "/dashboard/finance?view=overview",
    accent: "amber",
  },
  "finance-reports": {
    labelKey: "navigation.financeReports",
    sectionKey: "navigation.sections.finance",
    backHref: "/dashboard/finance?view=overview",
    accent: "amber",
  },
  "finance-settings": {
    labelKey: "navigation.financeSettings",
    sectionKey: "navigation.sections.finance",
    backHref: "/dashboard/finance?view=overview",
    accent: "amber",
  },
  "academy-programs": {
    labelKey: "navigation.academyPrograms",
    sectionKey: "navigation.sections.academy",
    backHref: "/dashboard/academy",
    accent: "violet",
  },
  "academy-cohorts": {
    labelKey: "navigation.academyCohorts",
    sectionKey: "navigation.sections.academy",
    backHref: "/dashboard/academy",
    accent: "violet",
  },
  "academy-students": {
    labelKey: "navigation.academyStudents",
    sectionKey: "navigation.sections.academy",
    backHref: "/dashboard/academy",
    accent: "violet",
  },
  "academy-trainers": {
    labelKey: "navigation.academyTrainers",
    sectionKey: "navigation.sections.academy",
    backHref: "/dashboard/academy",
    accent: "violet",
  },
  "academy-assessments": {
    labelKey: "navigation.academyAssessments",
    sectionKey: "navigation.sections.academy",
    backHref: "/dashboard/academy",
    accent: "violet",
  },
  "academy-certificates": {
    labelKey: "navigation.academyCertificates",
    sectionKey: "navigation.sections.academy",
    backHref: "/dashboard/academy",
    accent: "violet",
  },
  "academy-reports": {
    labelKey: "navigation.academyReports",
    sectionKey: "navigation.sections.academy",
    backHref: "/dashboard/academy",
    accent: "violet",
  },
  "vip-members": {
    labelKey: "navigation.vipMembers",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-nominations": {
    labelKey: "navigation.vipNominations",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-approvals": {
    labelKey: "navigation.vipApprovals",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-cards": {
    labelKey: "navigation.vipCards",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-renewals": {
    labelKey: "navigation.vipRenewals",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-travel": {
    labelKey: "navigation.vipTravel",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-country-welcome": {
    labelKey: "navigation.vipCountryWelcome",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-annual-meeting": {
    labelKey: "navigation.vipAnnualMeeting",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-benefits": {
    labelKey: "navigation.vipBenefits",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-communications": {
    labelKey: "navigation.vipCommunications",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-reports": {
    labelKey: "navigation.vipReports",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "vip-settings": {
    labelKey: "navigation.vipSettings",
    sectionKey: "navigation.sections.vip",
    backHref: "/dashboard/vip",
    accent: "rose",
  },
  "contracts-execution-center": {
    labelKey: "navigation.company",
    label: {fr: "Centre d’exécution global", en: "Global execution centre"},
    sectionKey: "navigation.sections.operations",
    backHref: "/dashboard/contracts",
    accent: "slate",
  },
  "contracts-risk-center": {
    labelKey: "navigation.company",
    label: {fr: "Incidents & risques · vue globale", en: "Incidents & risks · global view"},
    sectionKey: "navigation.sections.operations",
    backHref: "/dashboard/contracts",
    accent: "slate",
  },
  "contracts-renewal-center": {
    labelKey: "navigation.company",
    label: {fr: "Renouvellements & décisions", en: "Renewals & decisions"},
    sectionKey: "navigation.sections.operations",
    backHref: "/dashboard/contracts",
    accent: "slate",
  },
  "contracts-documents": {
    labelKey: "navigation.company",
    label: {fr: "Documents contractuels", en: "Contract documents"},
    sectionKey: "navigation.sections.operations",
    backHref: "/dashboard/contracts",
    accent: "slate",
  },
  "contracts-reports": {
    labelKey: "navigation.company",
    label: {fr: "Reporting & analyses", en: "Reporting & analytics"},
    sectionKey: "navigation.sections.operations",
    backHref: "/dashboard/contracts",
    accent: "slate",
  },
  "contracts-finance": {
    labelKey: "navigation.company",
    label: {fr: "Finance & paiements", en: "Finance & payments"},
    sectionKey: "navigation.sections.operations",
    backHref: "/dashboard/contracts",
    accent: "slate",
  },
  "contracts-provider-portal": {
    labelKey: "navigation.company",
    label: {fr: "Portail prestataire", en: "Provider portal"},
    sectionKey: "navigation.sections.operations",
    backHref: "/dashboard/contracts",
    accent: "slate",
  },
  "contracts-settings": {
    labelKey: "navigation.company",
    label: {fr: "Paramètres & modèles", en: "Settings & templates"},
    sectionKey: "navigation.sections.operations",
    backHref: "/dashboard/contracts",
    accent: "slate",
  },
  "roles-permissions": {
    labelKey: "navigation.rolesPermissions",
    sectionKey: "navigation.sections.administration",
    backHref: "/dashboard/company",
    accent: "slate",
  },
  "audit-security": {
    labelKey: "navigation.auditSecurity",
    sectionKey: "navigation.sections.administration",
    backHref: "/dashboard/company",
    accent: "slate",
  },
  "general-settings": {
    labelKey: "navigation.settings",
    sectionKey: "navigation.sections.administration",
    backHref: "/dashboard/company",
    accent: "slate",
  },
};

const ACCENTS = {
  indigo: {
    shell: "border-indigo-200 bg-indigo-50",
    badge: "bg-indigo-100 text-indigo-800",
    icon: "bg-indigo-600 text-white",
    button: "bg-indigo-700 hover:bg-indigo-800",
  },
  sky: {
    shell: "border-sky-200 bg-sky-50",
    badge: "bg-sky-100 text-sky-800",
    icon: "bg-sky-600 text-white",
    button: "bg-sky-700 hover:bg-sky-800",
  },
  emerald: {
    shell: "border-emerald-200 bg-emerald-50",
    badge: "bg-emerald-100 text-emerald-800",
    icon: "bg-emerald-600 text-white",
    button: "bg-emerald-700 hover:bg-emerald-800",
  },
  amber: {
    shell: "border-amber-200 bg-amber-50",
    badge: "bg-amber-100 text-amber-900",
    icon: "bg-amber-500 text-slate-950",
    button: "bg-amber-500 text-slate-950 hover:bg-amber-400",
  },
  violet: {
    shell: "border-violet-200 bg-violet-50",
    badge: "bg-violet-100 text-violet-800",
    icon: "bg-violet-600 text-white",
    button: "bg-violet-700 hover:bg-violet-800",
  },
  rose: {
    shell: "border-rose-200 bg-rose-50",
    badge: "bg-rose-100 text-rose-800",
    icon: "bg-rose-600 text-white",
    button: "bg-rose-700 hover:bg-rose-800",
  },
  slate: {
    shell: "border-slate-200 bg-slate-50",
    badge: "bg-slate-200 text-slate-800",
    icon: "bg-slate-900 text-white",
    button: "bg-slate-950 hover:bg-slate-800",
  },
} as const;

function RoadmapIcon({type}: {type: "ux" | "permissions" | "audit"}) {
  if (type === "ux") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 14h3M14 14h2" />
      </svg>
    );
  }
  if (type === "permissions") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6" aria-hidden="true">
        <path d="M12 3 4.5 6v5.5c0 4.8 3.1 8.1 7.5 9.5 4.4-1.4 7.5-4.7 7.5-9.5V6L12 3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6" aria-hidden="true">
      <path d="M4 20V8l8-4 8 4v12" />
      <path d="M8 12h8M8 16h5M3 20h18" />
    </svg>
  );
}

export default async function ComingSoonModulePage({
  params,
}: {
  params: Promise<{module: string}>;
}) {
  const {t, locale} = await getI18n();
  const {module} = await params;
  if (module === "vip-benefits") redirect("/dashboard/vip/benefits");
  if (module === "vip-communications") redirect("/dashboard/vip/communications");
  if (module === "vip-reports") redirect("/dashboard/vip/reports");
  if (module === "vip-settings") redirect("/dashboard/vip/settings");
  if (module === "messaging-meetings") redirect("/dashboard/performance?view=meetings");
  const definition = MODULES[module] ?? {
    labelKey: "navigation.settings",
    sectionKey: "navigation.sections.core",
    backHref: "/dashboard",
    accent: "indigo" as const,
  };
  const accent = ACCENTS[definition.accent];
  const moduleName = definition.label ? (locale === "fr" ? definition.label.fr : definition.label.en) : t(definition.labelKey);

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <section className={`overflow-hidden rounded-3xl border shadow-sm ${accent.shell}`}>
          <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[1fr_280px] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${accent.badge}`}>
                  {t("comingSoonPage.badge")}
                </span>
                <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                  {t("comingSoonPage.eyebrow")}
                </span>
              </div>
              <h1 className="mt-5 text-4xl font-black tracking-tight sm:text-5xl">
                {t("comingSoonPage.title", {module: moduleName})}
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
                {t("comingSoonPage.subtitle")}
              </p>
              <div className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  {t("comingSoonPage.sectorLabel")}
                </span>
                <span className="font-black text-slate-900">{t(definition.sectionKey)}</span>
              </div>
            </div>

            <div className="mx-auto grid h-52 w-52 place-items-center rounded-[2.5rem] border border-white/80 bg-white/75 shadow-xl shadow-slate-900/10 lg:h-60 lg:w-60">
              <div className={`grid h-24 w-24 place-items-center rounded-3xl text-4xl font-black shadow-lg ${accent.icon}`}>
                SL
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-black">{t("comingSoonPage.roadmapTitle")}</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {([
              ["ux", "comingSoonPage.roadmapUx"],
              ["permissions", "comingSoonPage.roadmapPermissions"],
              ["audit", "comingSoonPage.roadmapAudit"],
            ] as const).map(([type, key]) => (
              <article key={type} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <span className={`grid h-12 w-12 place-items-center rounded-2xl ${accent.icon}`}>
                  <RoadmapIcon type={type} />
                </span>
                <p className="mt-4 text-sm font-semibold leading-6 text-slate-700">{t(key)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-8 flex flex-col gap-5 rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h2 className="text-2xl font-black">{t("comingSoonPage.availableTitle")}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{t("comingSoonPage.availableText")}</p>
          </div>
          <Link
            href={definition.backHref}
            className={`shrink-0 rounded-xl px-5 py-3 text-center text-sm font-black text-white transition ${accent.button}`}
          >
            {t("comingSoonPage.back")}
          </Link>
        </section>
      </div>
    </main>
  );
}
