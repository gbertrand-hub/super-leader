import { redirect } from "next/navigation";
import { DashboardNavigation } from "@/components/dashboard/navigation";
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

  const fullName =
    String(authData.user.user_metadata?.full_name ?? "").trim() || "Leader";
  const email = authData.user.email ?? "";

  let role = "employee";
  let organizationName = "Super Leader";
  let hasOrganization = false;

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
    >
      {children}
    </DashboardNavigation>
  );
}
