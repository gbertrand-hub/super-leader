import {redirect} from "next/navigation";
import { requireFeatureForCurrentOrganization } from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export default async function FeatureLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {data: auth} = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membership) {
    await requireFeatureForCurrentOrganization("academy");
  } else {
    const {count} = await admin
      .from("academy_school_enrollments")
      .select("id", {count: "exact", head: true})
      .eq("user_id", auth.user.id)
      .in("academic_status", ["admitted", "enrolled", "active"]);
    if (!(count && count > 0)) redirect("/dashboard");
  }
  return children;
}
