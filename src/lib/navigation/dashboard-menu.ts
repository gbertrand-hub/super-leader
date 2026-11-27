import type { SubscriptionFeatureKey } from "@/lib/billing/entitlements";

export type DashboardIconName =
  | "myday"
  | "dashboard"
  | "academy"
  | "notifications"
  | "payslips"
  | "finance"
  | "vip"
  | "executive"
  | "company"
  | "teams"
  | "members"
  | "feedback"
  | "recognition"
  | "actions"
  | "sales"
  | "collections"
  | "crm"
  | "automation"
  | "performance"
  | "growth"
  | "events"
  | "acquisition"
  | "subscription"
  | "integrations"
  | "schedule"
  | "reports"
  | "settings"
  | "menu"
  | "close"
  | "logout"
  | "lock"
  | "chevron";

export type DashboardNavigationItem = {
  labelKey: string;
  label?: {fr: string; en: string};
  href: string;
  icon: DashboardIconName;
  roles?: string[];
  featureKey?: SubscriptionFeatureKey;
  platformOnly?: boolean;
  comingSoon?: boolean;
  paymentReconciliationOnly?: boolean;
  ambassadorManagementOnly?: boolean;
  academyFinanceControlOnly?: boolean;
  organizationScoped?: boolean;
};

export type DashboardNavigationSection = {
  id: "core" | "crm" | "customer_service" | "hr" | "finance" | "academy" | "events" | "vip" | "administration";
  labelKey: string;
  icon: DashboardIconName;
  accent: "indigo" | "sky" | "emerald" | "amber" | "violet" | "rose" | "slate";
  defaultOpen?: boolean;
  items: DashboardNavigationItem[];
};

const LEADERS = ["owner", "admin", "executive", "hr", "manager"];
const HR_ADMINS = ["owner", "admin", "hr"];
const ORGANIZATION_ADMINS = ["owner", "admin"];
const VIP_ADMINS = ["owner", "admin", "executive", "hr"];

export const DASHBOARD_NAVIGATION_SECTIONS: DashboardNavigationSection[] = [
  {
    id: "core",
    labelKey: "navigation.sections.core",
    icon: "dashboard",
    accent: "indigo",
    defaultOpen: true,
    items: [
      { labelKey: "navigation.myDay", href: "/dashboard/my-day", icon: "myday" },
      { labelKey: "navigation.dashboard", href: "/dashboard", icon: "dashboard" },
      { labelKey: "navigation.notifications", href: "/dashboard/notifications", icon: "notifications" },
      { labelKey: "navigation.myBadge", href: "/dashboard/profile/badge", icon: "recognition" },
      { labelKey: "navigation.schedule", href: "/dashboard/schedule", icon: "schedule" },
      {
        labelKey: "navigation.internalMessaging",
        href: "/dashboard/messages",
        icon: "feedback",
      },
      {
        labelKey: "navigation.internalMessaging",
        label: {fr: "Mentions et réactions", en: "Mentions and reactions"},
        href: "/dashboard/messages?feature=mentions",
        icon: "recognition",
      },
      {
        labelKey: "navigation.internalMessaging",
        label: {fr: "Messages vocaux", en: "Voice messages"},
        href: "/dashboard/messages?feature=voice",
        icon: "notifications",
      },
      {
        labelKey: "navigation.internalMessaging",
        label: {fr: "Annonces officielles", en: "Official announcements"},
        href: "/dashboard/announcements",
        icon: "executive",
      },
      {
        labelKey: "navigation.internalMessaging",
        label: {fr: "Réunions et convocations", en: "Meetings and invitations"},
        href: "/dashboard/performance?view=meetings",
        icon: "events",
      },
    ],
  },
  {
    id: "events",
    labelKey: "navigation.sections.events",
    icon: "events",
    accent: "amber",
    items: [
      {labelKey: "navigation.events", label: {fr: "Tableau de bord", en: "Dashboard"}, href: "/dashboard/events?portal=dashboard", icon: "dashboard", featureKey: "events"},
      {labelKey: "navigation.events", label: {fr: "Calendrier annuel", en: "Annual calendar"}, href: "/dashboard/events?portal=calendar", icon: "schedule", featureKey: "events"},
      {labelKey: "navigation.events", label: {fr: "Tous les événements", en: "All events"}, href: "/dashboard/events?portal=portfolio", icon: "events", featureKey: "events"},
      {labelKey: "navigation.events", label: {fr: "Mes missions", en: "My missions"}, href: "/dashboard/events?portal=missions", icon: "actions", featureKey: "events"},
      {labelKey: "navigation.events", label: {fr: "Centre opérationnel", en: "Operations centre"}, href: "/dashboard/events?portal=operations", icon: "teams", featureKey: "events"},
    ],
  },
  {
    id: "crm",
    labelKey: "navigation.sections.crm",
    icon: "crm",
    accent: "sky",
    items: [
      {
        labelKey: "navigation.crm",
        label: {fr: "Prospects", en: "Prospects"},
        href: "/dashboard/crm/prospects",
        icon: "members",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.crm",
        label: {fr: "Ambassadeurs", en: "Ambassadors"},
        href: "/dashboard/crm/ambassadors",
        icon: "members",
        featureKey: "crm_sales",
        ambassadorManagementOnly: true,
      },
      {
        labelKey: "navigation.crm",
        label: {fr: "Pipeline commercial", en: "Sales pipeline"},
        href: "/dashboard/crm/pipeline",
        icon: "crm",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.crm",
        label: {fr: "Ma journée commerciale", en: "My sales day"},
        href: "/dashboard/crm/my-sales-day",
        icon: "myday",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.crm",
        label: {fr: "Clients et interactions", en: "Clients and interactions"},
        href: "/dashboard/crm",
        icon: "members",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.crm",
        label: {fr: "Catalogue commercial", en: "Sales catalogue"},
        href: "/dashboard/crm/catalog",
        icon: "sales",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.crmReports",
        label: {fr: "Tableau de bord commercial", en: "Sales dashboard"},
        href: "/dashboard/crm/analytics",
        icon: "reports",
        roles: ["owner", "admin", "manager"],
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.sales",
        label: {fr: "Ventes", en: "Sales"},
        href: "/dashboard/sales",
        icon: "sales",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.crmReports",
        label: {fr: "Analyse des performances commerciales", en: "Sales performance analytics"},
        href: "/dashboard/sales/performance",
        icon: "performance",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.collections",
        href: "/dashboard/collections",
        icon: "collections",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.feedbackAutomation",
        href: "/dashboard/feedback-automation",
        icon: "automation",
        roles: ["owner", "admin", "manager"],
        featureKey: "feedback_automation",
      },
      {
        labelKey: "navigation.crmReports",
        label: {fr: "Score intelligent des prospects", en: "Intelligent lead scoring"},
        href: "/dashboard/crm/scoring",
        icon: "performance",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.crmReports",
        label: {fr: "Prévisions commerciales avancées", en: "Advanced sales forecasting"},
        href: "/dashboard/coming-soon/crm-sales-forecasting",
        icon: "reports",
        roles: LEADERS,
        featureKey: "crm_sales",
        comingSoon: true,
      },
      {
        labelKey: "navigation.crmReports",
        label: {fr: "Générateur de propositions", en: "Proposal generator"},
        href: "/dashboard/coming-soon/crm-proposals",
        icon: "payslips",
        featureKey: "crm_sales",
        comingSoon: true,
      },
      {
        labelKey: "navigation.crmReports",
        label: {fr: "Affectation automatique des prospects", en: "Automatic lead assignment"},
        href: "/dashboard/coming-soon/crm-auto-assignment",
        icon: "teams",
        roles: ["owner", "admin", "manager"],
        featureKey: "crm_sales",
        comingSoon: true,
      },
      {
        labelKey: "navigation.crmReports",
        label: {fr: "Analyse IA des conversations", en: "AI conversation analysis"},
        href: "/dashboard/coming-soon/crm-ai-conversation-analysis",
        icon: "feedback",
        featureKey: "crm_sales",
        comingSoon: true,
      },
      {
        labelKey: "navigation.crmReports",
        label: {fr: "Synchronisation des e-mails", en: "Email synchronization"},
        href: "/dashboard/coming-soon/crm-email-sync",
        icon: "notifications",
        featureKey: "crm_sales",
        comingSoon: true,
      },
      {
        labelKey: "navigation.crmReports",
        label: {fr: "Signature électronique", en: "Electronic signature"},
        href: "/dashboard/coming-soon/crm-electronic-signature",
        icon: "lock",
        featureKey: "crm_sales",
        comingSoon: true,
      },
      {
        labelKey: "navigation.crmReports",
        label: {fr: "Conversion automatique en vente", en: "Automatic conversion to sale"},
        href: "/dashboard/coming-soon/crm-automatic-sale-conversion",
        icon: "automation",
        roles: ["owner", "admin", "manager"],
        featureKey: "crm_sales",
        comingSoon: true,
      },
    ],
  },
  {
    id: "customer_service",
    labelKey: "navigation.sections.customerService",
    icon: "feedback",
    accent: "rose",
    items: [
      {labelKey: "navigation.customerService", label: {fr: "Tableau de bord", en: "Dashboard"}, href: "/dashboard/customer-service", icon: "dashboard", featureKey: "crm_sales"},
      {labelKey: "navigation.customerService", label: {fr: "Portefeuille clients", en: "Customer portfolio"}, href: "/dashboard/customer-service/clients", icon: "members", featureKey: "crm_sales"},
      {labelKey: "navigation.customerService", label: {fr: "Mensualités", en: "Instalments"}, href: "/dashboard/customer-service/installments", icon: "finance", featureKey: "crm_sales"},
      {labelKey: "navigation.customerService", label: {fr: "Suivi et recouvrement", en: "Follow-up and collections"}, href: "/dashboard/customer-service/follow-up", icon: "collections", featureKey: "crm_sales"},
      {labelKey: "navigation.customerService", label: {fr: "Tickets et réclamations", en: "Tickets and complaints"}, href: "/dashboard/customer-service/tickets", icon: "feedback", featureKey: "crm_sales"},
      {labelKey: "navigation.customerService", label: {fr: "Communications", en: "Communications"}, href: "/dashboard/coming-soon/customer-service-communications", icon: "notifications", featureKey: "crm_sales", comingSoon: true},
      {labelKey: "navigation.customerService", label: {fr: "Contrats et documents", en: "Contracts and documents"}, href: "/dashboard/coming-soon/customer-service-documents", icon: "payslips", featureKey: "crm_sales", comingSoon: true},
      {labelKey: "navigation.customerService", label: {fr: "Satisfaction et fidélisation", en: "Satisfaction and retention"}, href: "/dashboard/coming-soon/customer-service-satisfaction", icon: "recognition", featureKey: "crm_sales", comingSoon: true},
      {labelKey: "navigation.customerService", label: {fr: "Rapports", en: "Reports"}, href: "/dashboard/coming-soon/customer-service-reports", icon: "reports", roles: LEADERS, featureKey: "crm_sales", comingSoon: true},
      {labelKey: "navigation.customerService", label: {fr: "Paramètres", en: "Settings"}, href: "/dashboard/coming-soon/customer-service-settings", icon: "settings", roles: ["owner", "admin", "manager"], featureKey: "crm_sales", comingSoon: true},
    ],
  },
  {
    id: "hr",
    labelKey: "navigation.sections.hr",
    icon: "members",
    accent: "emerald",
    items: [
      {
        labelKey: "navigation.hrDashboard",
        label: {fr: "Tableau de bord RH", en: "HR dashboard"},
        href: "/dashboard/hr",
        icon: "dashboard",
        roles: ["owner", "admin", "hr", "manager"],
        featureKey: "performance",
      },
      {
        labelKey: "navigation.executive",
        href: "/dashboard/executive",
        icon: "executive",
        roles: ["owner", "admin", "executive", "hr"],
      },
      {
        labelKey: "navigation.members",
        href: "/dashboard/members",
        icon: "members",
        roles: LEADERS,
        featureKey: "teams",
      },
      {
        labelKey: "navigation.teams",
        href: "/dashboard/team",
        icon: "teams",
        roles: LEADERS,
        featureKey: "teams",
      },
      {
        labelKey: "navigation.attendance",
        href: "/dashboard/performance?view=attendance",
        icon: "myday",
        roles: LEADERS,
        featureKey: "performance",
      },
      {
        labelKey: "navigation.workSchedules",
        href: "/dashboard/performance?view=settings",
        icon: "schedule",
        roles: HR_ADMINS,
        featureKey: "performance",
      },
      {
        labelKey: "navigation.leaveAndAbsence",
        href: "/dashboard/hr/leave",
        icon: "schedule",
        roles: HR_ADMINS,
        featureKey: "performance",
      },
      {
        labelKey: "navigation.dailyReports",
        label: {fr: "Rapports de la journée", en: "Daily reports control centre"},
        href: "/dashboard/hr/daily-reports",
        icon: "reports",
        roles: HR_ADMINS,
        featureKey: "performance",
      },
      {
        labelKey: "navigation.dailyReports",
        href: "/dashboard/performance?view=reports",
        icon: "reports",
        roles: LEADERS,
        featureKey: "performance",
      },
      {
        labelKey: "navigation.dailyReports",
        label: {fr: "Relances automatiques des rapports", en: "Automatic report reminders"},
        href: "/dashboard/performance?view=settings#daily-report-reminders",
        icon: "notifications",
        roles: HR_ADMINS,
        featureKey: "performance",
      },
      {
        labelKey: "navigation.performance",
        label: {fr: "Analyse des priorités quotidiennes", en: "Daily priorities analytics"},
        href: "/dashboard/hr/daily-priorities",
        icon: "performance",
        roles: LEADERS,
        featureKey: "performance",
      },
      {
        labelKey: "navigation.performance",
        label: {fr: "Règles avancées des priorités", en: "Advanced priority rules"},
        href: "/dashboard/hr/priority-rules",
        icon: "settings",
        roles: HR_ADMINS,
        featureKey: "performance",
      },
      {
        labelKey: "navigation.performance",
        href: "/dashboard/performance",
        icon: "performance",
        featureKey: "performance",
      },
      {
        labelKey: "navigation.growth",
        href: "/dashboard/growth",
        icon: "growth",
        featureKey: "growth",
      },
      {
        labelKey: "navigation.feedback",
        href: "/dashboard/feedback",
        icon: "feedback",
        featureKey: "core_feedback",
      },
      {
        labelKey: "navigation.recognition",
        href: "/dashboard/recognition",
        icon: "recognition",
        featureKey: "recognition",
      },
      { labelKey: "navigation.actions", href: "/dashboard/actions", icon: "actions" },
      {
        labelKey: "navigation.hrDocuments",
        href: "/dashboard/hr/documents",
        icon: "payslips",
        roles: LEADERS,
      },
      {
        labelKey: "navigation.hrReports",
        href: "/dashboard/reports",
        icon: "reports",
        roles: LEADERS,
        featureKey: "reports_advanced",
      },
    ],
  },
  {
    id: "finance",
    labelKey: "navigation.sections.finance",
    icon: "finance",
    accent: "amber",
    items: [
      {
        labelKey: "navigation.commissions",
        label: {fr: "Commissions", en: "Commissions"},
        href: "/dashboard/commissions",
        icon: "finance",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.financeOverview",
        href: "/dashboard/finance?view=overview",
        icon: "dashboard",
        roles: ORGANIZATION_ADMINS,
      },
      {
        labelKey: "navigation.invoicesReceipts",
        href: "/dashboard/finance?view=documents",
        icon: "finance",
        roles: ORGANIZATION_ADMINS,
      },
      {
        labelKey: "navigation.payments",
        label: {fr: "Contrôle des encaissements", en: "Payment control"},
        href: "/dashboard/finance/payments",
        icon: "collections",
        paymentReconciliationOnly: true,
      },
      {
        labelKey: "navigation.expenses",
        href: "/dashboard/finance/expenses",
        icon: "sales",
      },
      {
        labelKey: "navigation.payrollPayslips",
        href: "/dashboard/finance?view=payroll",
        icon: "payslips",
        roles: ORGANIZATION_ADMINS,
      },
      { labelKey: "navigation.myPayslips", href: "/dashboard/my-payslips", icon: "payslips" },
      {
        labelKey: "navigation.collections",
        label: {fr: "Créances & recouvrement", en: "Receivables & collections"},
        href: "/dashboard/finance/receivables",
        icon: "collections",
        roles: ["owner", "admin", "executive"],
      },
      {
        labelKey: "navigation.invoicesReceipts",
        label: {fr: "Comptes clients", en: "Customer accounts"},
        href: "/dashboard/finance/customer-accounts",
        icon: "finance",
        roles: ["owner", "admin", "executive"],
      },
      {
        labelKey: "navigation.financeReports",
        href: "/dashboard/finance/reports",
        icon: "reports",
        roles: ["owner", "admin", "executive"],
      },
      {
        labelKey: "navigation.financeReports",
        label: {fr: "Budgets & prévisions", en: "Budgets & forecasting"},
        href: "/dashboard/finance/budgets",
        icon: "performance",
        roles: ["owner", "admin", "executive"],
      },
      {
        labelKey: "navigation.financeReports",
        label: {fr: "Trésorerie prévisionnelle", en: "Cash flow forecast"},
        href: "/dashboard/finance/cash-flow",
        icon: "finance",
        roles: ["owner", "admin", "executive"],
      },
      {
        labelKey: "navigation.financeReports",
        label: {fr: "Clôtures financières", en: "Financial close"},
        href: "/dashboard/finance/close",
        icon: "lock",
        roles: ORGANIZATION_ADMINS,
      },
      {
        labelKey: "navigation.financeSettings",
        href: "/dashboard/finance/settings",
        icon: "settings",
        roles: ORGANIZATION_ADMINS,
      },
    ],
  },
  {
    id: "academy",
    labelKey: "navigation.sections.academy",
    icon: "academy",
    accent: "violet",
    defaultOpen: true,
    items: [
      {
        labelKey: "navigation.academyOverview",
        label: {fr: "Centre de travail Academy", en: "Academy staff workspace"},
        href: "/dashboard/academy",
        icon: "dashboard",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyOverview",
        href: "/dashboard/academy",
        icon: "academy",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyStudents",
        label: {fr: "Centre financier étudiants", en: "Student finance center"},
        href: "/dashboard/academy/students/finance-control",
        icon: "finance",
        featureKey: "academy",
        academyFinanceControlOnly: true,
        organizationScoped: true,
      },
      {
        labelKey: "academy.learningSpace",
        href: "/dashboard/academy/staff-training",
        icon: "academy",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyOverview",
        label: {fr: "Mes responsabilités", en: "My responsibilities"},
        href: "/dashboard/academy/responsibilities",
        icon: "actions",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyPrograms",
        href: "/dashboard/academy/schools",
        icon: "growth",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyCohorts",
        href: "/dashboard/academy/cohorts",
        icon: "teams",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyCohorts",
        label: {fr: "Structure & sessions", en: "Structure & sessions"},
        href: "/dashboard/academy/structure",
        icon: "settings",
        featureKey: "academy",
      },
      {
        // V4_8_73_R2_ACADEMY_PRICING_MENU
        labelKey: "navigation.academyPrograms",
        label: {fr: "Tarification & homologation", en: "Pricing & approval"},
        href: "/dashboard/academy/pricing",
        icon: "finance",
        roles: ["owner", "admin"],
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyStudents",
        href: "/dashboard/academy/students",
        icon: "members",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyStudents",
        label: {fr: "Contrôle du parcours", en: "Student journey control"},
        href: "/dashboard/academy/journey-control",
        icon: "performance",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyTrainers",
        href: "/dashboard/academy/trainers",
        icon: "executive",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyAssessments",
        href: "/dashboard/academy/attendance",
        icon: "performance",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyCertificates",
        href: "/dashboard/academy/certificates",
        icon: "recognition",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyReports",
        label: {fr: "Analyse & décisions", en: "Analytics & decisions"},
        href: "/dashboard/academy/analytics",
        icon: "reports",
        roles: ["owner", "admin", "hr"],
        featureKey: "academy",
      },
      {
        labelKey: "navigation.academyReports",
        href: "/dashboard/academy/reports",
        icon: "reports",
        featureKey: "academy",
      },
    ],
  },
  {
    id: "vip",
    labelKey: "navigation.sections.vip",
    icon: "vip",
    accent: "rose",
    items: [
      {
        labelKey: "navigation.vipOverview",
        href: "/dashboard/vip",
        icon: "vip",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipOverview",
        label: {fr: "Croissance & adhésions", en: "Growth & memberships"},
        href: "/dashboard/vip/growth",
        icon: "sales",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipMembers",
        href: "/dashboard/vip?view=members",
        icon: "members",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipNominations",
        href: "/dashboard/vip?view=nominations",
        icon: "recognition",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipApprovals",
        href: "/dashboard/vip?view=approvals",
        icon: "executive",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipCards",
        href: "/dashboard/vip?view=cards",
        icon: "payslips",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipRenewals",
        href: "/dashboard/vip?view=renewals",
        icon: "actions",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipTravel",
        href: "/dashboard/vip/travel",
        icon: "schedule",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipCountryWelcome",
        href: "/dashboard/vip/country-welcome",
        icon: "company",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipAnnualMeeting",
        href: "/dashboard/vip/annual-meeting",
        icon: "events",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipBenefits",
        href: "/dashboard/vip/benefits",
        icon: "recognition",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipCommunications",
        href: "/dashboard/vip/communications",
        icon: "notifications",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipReports",
        href: "/dashboard/vip/reports",
        icon: "reports",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipReports",
        label: {fr: "Centre opérationnel VIP", en: "VIP Operations Center"},
        href: "/dashboard/vip/operations",
        icon: "actions",
        roles: VIP_ADMINS,
      },
      {
        labelKey: "navigation.vipSettings",
        href: "/dashboard/vip/settings",
        icon: "settings",
        roles: ORGANIZATION_ADMINS,
      },
    ],
  },
  {
    id: "administration",
    labelKey: "navigation.sections.administration",
    icon: "settings",
    accent: "slate",
    defaultOpen: true,
    items: [
      {
        labelKey: "navigation.members",
        label: {fr: "Identité 360°", en: "Identity 360°"},
        href: "/dashboard/admin/identity-audit",
        icon: "members",
        roles: ["owner", "admin"],
        organizationScoped: true,
      },
      {
        labelKey: "navigation.myPages",
        label: {fr: "Mes pages · Plan du site", en: "My pages · Site map"},
        href: "/dashboard/my-pages",
        icon: "menu",
      },
      {
        labelKey: "navigation.userHelpCenter",
        label: {fr: "Centre d’aide à l’utilisateur", en: "User help centre"},
        href: "/dashboard/help-center",
        icon: "academy",
      },
      {
        labelKey: "navigation.company",
        href: "/dashboard/company",
        icon: "company",
        roles: HR_ADMINS,
      },
      {
        labelKey: "navigation.members",
        label: {fr: "Collaborateurs & rôles", en: "Staff & roles"},
        href: "/dashboard/members",
        icon: "members",
        roles: HR_ADMINS,
      },
      {
        labelKey: "navigation.teams",
        label: {fr: "Équipes & responsables", en: "Teams & leaders"},
        href: "/dashboard/team",
        icon: "teams",
        roles: HR_ADMINS,
      },
      {
        labelKey: "navigation.financeSettings",
        label: {fr: "Responsabilités Finance", en: "Finance responsibilities"},
        href: "/dashboard/finance/settings",
        icon: "finance",
        roles: ORGANIZATION_ADMINS,
      },
      {
        labelKey: "navigation.acquisition",
        href: "/dashboard/acquisition",
        icon: "acquisition",
        roles: HR_ADMINS,
        platformOnly: true,
      },
      {
        labelKey: "navigation.employeeBadges",
        href: "/dashboard/badges/manage",
        icon: "recognition",
        roles: HR_ADMINS,
      },
      {
        labelKey: "navigation.internalMessaging",
        label: {fr: "Audit de messagerie", en: "Messaging audit"},
        href: "/dashboard/messages?view=audit",
        icon: "lock",
        roles: ORGANIZATION_ADMINS,
      },
      {
        labelKey: "navigation.rolesPermissions",
        href: "/dashboard/roles-permissions",
        icon: "lock",
        roles: ORGANIZATION_ADMINS,
      },
      {
        labelKey: "navigation.moduleStatus",
        label: {fr: "État des modules", en: "Module status"},
        href: "/dashboard/module-status",
        icon: "reports",
        roles: ORGANIZATION_ADMINS,
      },
      {
        labelKey: "navigation.subscription",
        href: "/dashboard/subscription",
        icon: "subscription",
        roles: ORGANIZATION_ADMINS,
      },
      {
        labelKey: "navigation.integrations",
        href: "/dashboard/integrations",
        icon: "integrations",
        roles: ORGANIZATION_ADMINS,
        featureKey: "api_integrations",
      },
      {
        labelKey: "navigation.auditSecurity",
        href: "/dashboard/audit-security",
        icon: "lock",
        roles: ORGANIZATION_ADMINS,
      },
      {
        labelKey: "navigation.settings",
        href: "/dashboard/settings",
        icon: "settings",
        roles: ORGANIZATION_ADMINS,
      },
    ],
  },
];

// Kept for backwards compatibility with earlier navigation builds. Future modules
// now live inside their business sector and display an inline "Soon" badge.
export const DASHBOARD_COMING_SOON_ITEMS: DashboardNavigationItem[] = [];
