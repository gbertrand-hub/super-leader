import type {SupabaseClient, User} from "@supabase/supabase-js";
import {redirect} from "next/navigation";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export type AcademyAccessContext = {
  user: User;
  organizationId: string;
  role: string;
  admin: SupabaseClient;
};

export async function requireAcademyAccessContext(): Promise<AcademyAccessContext> {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id,role,is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();

  if (membershipError || !membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "academy");

  return {
    user: authData.user,
    organizationId: membership.organization_id,
    role: membership.role,
    admin,
  };
}
