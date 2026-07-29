import type { SubscriptionFeatureKey } from "@/lib/billing/entitlements";

export type DashboardIconName =
  | "myday"
  | "dashboard"
  | "academy"
  | "notifications"
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
  | "schedule"
  | "reports"
  | "settings"
  | "menu"
  | "close"
  | "logout"
  | "lock";

export type DashboardNavigationItem = {
  labelKey: string;
  href: string;
  icon: DashboardIconName;
  roles?: string[];
  featureKey?: SubscriptionFeatureKey;
  platformOnly?: boolean;
};

export type DashboardNavigationSection = {
  id: "daily" | "development" | "organization" | "commercial" | "administration";
  labelKey: string;
  items: DashboardNavigationItem[];
};

export const DASHBOARD_NAVIGATION_SECTIONS: DashboardNavigationSection[] = [
  {
    id: "daily",
    labelKey: "navigation.sections.daily",
    items: [
      { labelKey: "navigation.myDay", href: "/dashboard/my-day", icon: "myday" },
      { labelKey: "navigation.dashboard", href: "/dashboard", icon: "dashboard" },
      { labelKey: "navigation.notifications", href: "/dashboard/notifications", icon: "notifications" },
      { labelKey: "navigation.schedule", href: "/dashboard/schedule", icon: "schedule" },
    ],
  },
  {
    id: "development",
    labelKey: "navigation.sections.development",
    items: [
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
        labelKey: "navigation.academy",
        href: "/dashboard/academy",
        icon: "academy",
        featureKey: "academy",
      },
      {
        labelKey: "navigation.growth",
        href: "/dashboard/growth",
        icon: "growth",
        featureKey: "growth",
      },
      {
        labelKey: "navigation.performance",
        href: "/dashboard/performance",
        icon: "performance",
        featureKey: "performance",
      },
    ],
  },
  {
    id: "organization",
    labelKey: "navigation.sections.organization",
    items: [
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
        featureKey: "teams",
      },
      {
        labelKey: "navigation.members",
        href: "/dashboard/members",
        icon: "members",
        roles: ["owner", "admin", "hr", "manager"],
        featureKey: "teams",
      },
      {
        labelKey: "navigation.events",
        href: "/dashboard/events",
        icon: "events",
        featureKey: "events",
      },
    ],
  },
  {
    id: "commercial",
    labelKey: "navigation.sections.commercial",
    items: [
      {
        labelKey: "navigation.crm",
        href: "/dashboard/crm",
        icon: "crm",
        featureKey: "crm_sales",
      },
      {
        labelKey: "navigation.sales",
        href: "/dashboard/sales",
        icon: "sales",
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
    ],
  },
  {
    id: "administration",
    labelKey: "navigation.sections.administration",
    items: [
      {
        labelKey: "navigation.acquisition",
        href: "/dashboard/acquisition",
        icon: "acquisition",
        roles: ["owner", "admin", "hr"],
        platformOnly: true,
      },
      {
        labelKey: "navigation.subscription",
        href: "/dashboard/subscription",
        icon: "subscription",
        roles: ["owner", "admin"],
      },
      {
        labelKey: "navigation.reports",
        href: "/dashboard/reports",
        icon: "reports",
        roles: ["owner", "admin", "hr", "manager"],
        featureKey: "reports_advanced",
      },
    ],
  },
];

export const DASHBOARD_COMING_SOON_ITEMS: DashboardNavigationItem[] = [
  {
    labelKey: "navigation.settings",
    href: "/dashboard/settings",
    icon: "settings",
    roles: ["owner", "admin"],
  },
];
