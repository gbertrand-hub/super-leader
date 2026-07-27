import { redirect } from "next/navigation";
import { DashboardNavigation } from "@/components/dashboard/navigation";
import { readTemporaryAccessState } from "@/lib/auth/temporary-access";
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

  const fullName =
    String(authData.user.user_metadata?.full_name ?? "").trim() || "Leader";
  const email = authData.user.email ?? "";

  let role = "employee";
  let organizationName = "Super Leader";
  let hasOrganization = false;
  let unreadNotificationCount = 0;

  try {
    const admin = createAdminClient();
    const { data: membership } = await admin
      .from("organization_members")
      .select("role, organization_id, organizations(name)")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membership) {
      role = membership.role ?? "employee";
      organizationName =
        firstOrganization(membership.organizations as OrganizationRelation)
          ?.name ?? "Organisation";
      hasOrganization = true;

      const {count: unreadCount} = await admin
        .from("notifications")
        .select("id", {count: "exact", head: true})
        .eq("organization_id", membership.organization_id)
        .eq("user_id", authData.user.id)
        .eq("status", "unread");
      unreadNotificationCount = unreadCount ?? 0;
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
      hasOrganization={hasOrganization}
      unreadNotificationCount={unreadNotificationCount}
    >
      {children}
    </DashboardNavigation>
  );
}
