import { redirect } from "next/navigation";
import { DashboardNavigation } from "@/components/dashboard/navigation";
import { APP_VERSION } from "@/lib/app-version";
import { readTemporaryAccessState } from "@/lib/auth/temporary-access";
import { isPlatformOrganization } from "@/lib/acquisition/platform";
import { getOrganizationEntitlements } from "@/lib/billing/entitlements";
import { createProfileAvatarSignedUrl } from "@/lib/profile/avatar";
import { getPaymentReconciliationAccess } from "@/lib/auth/payment-reconciliation-access";
import { canManageAmbassadors } from "@/lib/crm/ambassador-access";
import { canVerifySalesForFinance } from "@/lib/auth/sensitive-finance-access";
import { getFinanceCustomerAccountAccess } from "@/lib/auth/finance-customer-account-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type OrganizationRelation =
  | { name?: string | null }
  | { name?: string | null }[]
  | null;

function firstOrganization(value: OrganizationRelation) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    redirect("/login");
  }

  let temporaryAccessRedirect: string | null = null;

  try {
    const securityAdmin = createAdminClient();
    const { data: securityProfile } = await securityAdmin
      .from("profiles")
      .select("must_change_password,temporary_password_expires_at")
      .eq("id", authData.user.id)
      .maybeSingle();
    const temporaryAccess = readTemporaryAccessState(
      securityProfile ?? authData.user.user_metadata,
      new Date().getTime(),
    );

    if (temporaryAccess.mustChangePassword) {
      temporaryAccessRedirect = temporaryAccess.expired
        ? "/auth/temporary-access-expired"
        : "/change-password-required";
    }
  } catch (error) {
    console.error("Temporary access verification unavailable", error);
  }

  if (temporaryAccessRedirect) {
    redirect(temporaryAccessRedirect);
  }

  let fullName =
    String(authData.user.user_metadata?.full_name ?? "").trim() || "Leader";
  const email = authData.user.email ?? "";
  let avatarUrl: string | null = null;

  let role = "prospect";
  let organizationName = "Super Leader";
  let organizationId: string | null = null;
  let hasOrganization = false;
  let unreadNotificationCount = 0;
  let unreadMessageCount = 0;
  let isPlatformWorkspace = false;
  let enabledFeatures: string[] = [];
  let subscriptionPlanName = "Accès actuel";
  let subscriptionStatus = "active";
  let canReconcilePayments = false;
  let canVerifyFinanceSales = false;
  let canAccessFinanceCustomerAccounts = false;
  let canManageAmbassadorRegister = false;
  let canAccessAcademyFinanceControl = false;
  let hasVipGrowthMembershipAssignment = false;

  try {
    const admin = createAdminClient();
    const {data: profile} = await admin
      .from("profiles")
      .select("full_name,avatar_storage_path")
      .eq("id", authData.user.id)
      .maybeSingle<{full_name: string | null; avatar_storage_path: string | null}>();
    fullName = profile?.full_name?.trim() || fullName;
    avatarUrl = await createProfileAvatarSignedUrl(admin, profile?.avatar_storage_path, 3600);

    const { data: membership } = await admin
      .from("organization_members")
      .select("role, organization_id, organizations(name)")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membership) {
      role = membership.role ?? "employee";
      organizationId = String(membership.organization_id);
      organizationName =
        firstOrganization(membership.organizations as OrganizationRelation)
          ?.name ?? "Organisation";
      hasOrganization = true;
      isPlatformWorkspace = isPlatformOrganization({
        organizationId: String(membership.organization_id),
        organizationName,
      });

      const {count: unreadCount} = await admin
        .from("notifications")
        .select("id", {count: "exact", head: true})
        .eq("organization_id", membership.organization_id)
        .eq("user_id", authData.user.id)
        .eq("status", "unread");
      unreadNotificationCount = unreadCount ?? 0;

      const {count: unreadMessages, error: unreadMessagesError} = await admin
        .from("internal_message_receipts")
        .select("id", {count: "exact", head: true})
        .eq("organization_id", membership.organization_id)
        .eq("user_id", authData.user.id)
        .is("read_at", null);
      if (!unreadMessagesError) unreadMessageCount = unreadMessages ?? 0;

      const entitlements = await getOrganizationEntitlements(String(membership.organization_id));
      enabledFeatures = entitlements.enabledFeatures;
      subscriptionPlanName = entitlements.planName;
      subscriptionStatus = entitlements.status;
      canReconcilePayments = (await getPaymentReconciliationAccess(
        admin,
        String(membership.organization_id),
        authData.user.id,
        role,
      )).allowed;
      canVerifyFinanceSales = await canVerifySalesForFinance(
        admin,
        String(membership.organization_id),
        authData.user.id,
        role,
      );
      canAccessFinanceCustomerAccounts = (await getFinanceCustomerAccountAccess(
        admin,
        String(membership.organization_id),
        authData.user.id,
        role,
      )).allowed;

      canManageAmbassadorRegister = await canManageAmbassadors(
        admin,
        String(membership.organization_id),
        authData.user.id,
        role,
      );

      const {data: vipGrowthSettings} = await admin
        .from("vip_program_settings")
        .select("vip_growth_membership_manager_user_id")
        .eq("organization_id", membership.organization_id)
        .maybeSingle<{vip_growth_membership_manager_user_id: string | null}>();
      hasVipGrowthMembershipAssignment =
        vipGrowthSettings?.vip_growth_membership_manager_user_id === authData.user.id;

      if (["owner", "admin", "hr"].includes(role)) {
        canAccessAcademyFinanceControl = true;
      } else {
        const {data: academyFinanceAssignments} = await admin
          .from("academy_staff_assignments")
          .select("id")
          .eq("organization_id", membership.organization_id)
          .eq("user_id", authData.user.id)
          .eq("is_active", true)
          .in("assignment_role", ["director", "academic_coordinator", "finance", "follow_up", "data_analyst", "observer"])
          .limit(1);
        canAccessAcademyFinanceControl = Boolean(academyFinanceAssignments?.length);
      }
    }
  } catch (error) {
    console.error("Navigation dashboard : profil organisation indisponible", error);
  }

  return (
    <DashboardNavigation
      fullName={fullName}
      email={email}
      role={role}
      organizationName={organizationName}
      organizationId={organizationId}
      hasOrganization={hasOrganization}
      unreadNotificationCount={unreadNotificationCount}
      unreadMessageCount={unreadMessageCount}
      isPlatformWorkspace={isPlatformWorkspace}
      enabledFeatures={enabledFeatures}
      subscriptionPlanName={subscriptionPlanName}
      subscriptionStatus={subscriptionStatus}
      avatarUrl={avatarUrl}
      appVersion={APP_VERSION}
      canReconcilePayments={canReconcilePayments}
      canAccessFinanceCustomerAccounts={canAccessFinanceCustomerAccounts}
      canVerifySalesForFinance={canVerifyFinanceSales}
      canManageAmbassadors={canManageAmbassadorRegister}
      canAccessAcademyFinanceControl={canAccessAcademyFinanceControl}
      hasVipGrowthMembershipAssignment={hasVipGrowthMembershipAssignment}
    >
      {children}
    </DashboardNavigation>
  );
}
