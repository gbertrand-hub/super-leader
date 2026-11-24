import {
  DASHBOARD_NAVIGATION_SECTIONS,
  type DashboardNavigationItem,
  type DashboardNavigationSection,
} from "@/lib/navigation/dashboard-menu";

/** One policy for the sidebar, sitemap and administrator diagnostics.
 * Menu visibility is only a UX decision; each destination must still
 * enforce authorization on the server. */
export type NavigationAccess = {
  role: string;
  organizationId: string | null;
  hasOrganization: boolean;
  isPlatformWorkspace: boolean;
  enabledFeatures: string[];
  canReconcilePayments: boolean;
  canVerifySalesForFinance: boolean;
  canAccessFinanceCustomerAccounts: boolean;
  canManageAmbassadors: boolean;
  canAccessAcademyFinanceControl: boolean;
  hasVipGrowthMembershipAssignment: boolean;
};

export type ResolvedNavigationItem = DashboardNavigationItem & {
  lockedByPlan: boolean;
  resolvedHref: string;
};
export type ResolvedNavigationSection = Omit<DashboardNavigationSection, "items"> & {
  items: ResolvedNavigationItem[];
};

export const CANTON_VISITORS_LINK: DashboardNavigationItem = {
  href: "/dashboard/canton-visitors",
  labelKey: "navigation.cantonVisitors",
  label: {fr: "Visiteurs & Rendez-vous", en: "Visitors & Appointments"},
  icon: "schedule",
};

export const SITEMAP_LINK: DashboardNavigationItem = {
  href: "/dashboard/my-pages",
  labelKey: "navigation.myPages",
  label: {fr: "Mes pages · Plan du site", en: "My pages · Site map"},
  icon: "menu",
};

const adminDashboard: DashboardNavigationItem = {
  href: "/dashboard/admin",
  labelKey: "navigation.adminDashboard",
  label: {fr: "Tableau de bord", en: "Dashboard"},
  icon: "dashboard",
  roles: ["owner","admin","hr"],
};

export function getNavigationSourceSections() {
  return DASHBOARD_NAVIGATION_SECTIONS.map(section=>({
    ...section,
    items: section.id==="administration"
      ? [adminDashboard, SITEMAP_LINK, ...section.items]
      : section.items,
  }));
}

export function navigationItemDecision(item: DashboardNavigationItem, access: NavigationAccess): {
  visible: boolean;
  reason: "no_organization" | "platform_only" | "role" | "reconciliation" |
    "ambassadors" | "academy_finance" | "subscription" | "allowed";
  lockedByPlan: boolean;
  resolvedHref: string;
} {
  if (!access.hasOrganization && item.href!=="/dashboard") {
    return {visible:false,reason:"no_organization",lockedByPlan:false,resolvedHref:item.href};
  }
  if(item.platformOnly&&!access.isPlatformWorkspace)
    return {visible:false,reason:"platform_only",lockedByPlan:false,resolvedHref:item.href};

  const vip = item.href==="/dashboard/vip/growth"&&access.hasVipGrowthMembershipAssignment;
  const verification = item.href==="/dashboard/finance?view=overview"&&access.canVerifySalesForFinance;
  const customerAccounts = item.href==="/dashboard/finance/customer-accounts"&&access.canAccessFinanceCustomerAccounts;
  if(item.roles&&!item.roles.includes(access.role)&&!vip&&!verification&&!customerAccounts)
    return {visible:false,reason:"role",lockedByPlan:false,resolvedHref:item.href};
  if(item.paymentReconciliationOnly&&!access.canReconcilePayments)
    return {visible:false,reason:"reconciliation",lockedByPlan:false,resolvedHref:item.href};
  if(item.ambassadorManagementOnly&&!access.canManageAmbassadors)
    return {visible:false,reason:"ambassadors",lockedByPlan:false,resolvedHref:item.href};
  if(item.academyFinanceControlOnly&&!access.canAccessAcademyFinanceControl)
    return {visible:false,reason:"academy_finance",lockedByPlan:false,resolvedHref:item.href};
  const lockedByPlan=Boolean(item.featureKey&&!access.enabledFeatures.includes(item.featureKey));
  if(lockedByPlan&&!["owner","admin"].includes(access.role))
    return {visible:false,reason:"subscription",lockedByPlan:true,resolvedHref:item.href};
  const scopedHref=item.organizationScoped&&access.organizationId
    ? item.href+(item.href.includes("?")?"&":"?")+"organization="+encodeURIComponent(access.organizationId)
    : item.href;
  const resolvedHref=lockedByPlan&&item.featureKey
    ? "/dashboard/subscription?upgrade="+encodeURIComponent(item.featureKey)
    : scopedHref;
  return {visible:true,reason:"allowed",lockedByPlan,resolvedHref};
}

export function resolveDashboardNavigation(access:NavigationAccess):ResolvedNavigationSection[] {
  return getNavigationSourceSections()
    .map(section=>{
      const items=section.items.flatMap((item):ResolvedNavigationItem[]=>{
        const decision=navigationItemDecision(item,access);
        return decision.visible?[{...item,lockedByPlan:decision.lockedByPlan,resolvedHref:decision.resolvedHref}]:[];
      });
      const orderedItems=section.id==="finance"
        ? [...items].sort((a,b)=>{
            const priority=(href:string)=>href==="/dashboard/finance?view=overview"?0:href==="/dashboard/finance/payments"?1:href==="/dashboard/finance/customer-accounts"?2:3;
            return priority(a.href)-priority(b.href);
          })
        : items;
      return {...section,items:orderedItems};
    })
    .filter(section=>section.items.length>0);
}
