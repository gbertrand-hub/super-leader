import { redirect } from "next/navigation";
import { isPlatformOrganization } from "@/lib/acquisition/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type BillingContext = {
  userId: string;
  organizationId: string;
  organizationName: string;
  role: string;
  isPlatformWorkspace: boolean;
};

type OrganizationRelation =
  | { name?: string | null }
  | { name?: string | null }[]
  | null;

function firstOrganization(value: OrganizationRelation) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function getBillingContext(
  allowedRoles: string[] = ["owner", "admin"],
): Promise<BillingContext> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role,is_active,organizations(name)")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!membership || !allowedRoles.includes(String(membership.role))) {
    redirect("/dashboard");
  }

  const organization = firstOrganization(
    membership.organizations as OrganizationRelation,
  );
  const organizationName = organization?.name ?? "Organisation";

  return {
    userId: authData.user.id,
    organizationId: String(membership.organization_id),
    organizationName,
    role: String(membership.role),
    isPlatformWorkspace: isPlatformOrganization({
      organizationId: String(membership.organization_id),
      organizationName,
    }),
  };
}
