import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getVisibleUserIds} from "@/lib/auth/scope";

export async function getCustomerServiceContext() {
  const supabase = await createClient();
  const {data} = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership, error} = await admin.from("organization_members").select("organization_id,role").eq("user_id", data.user.id).eq("is_active", true).limit(1).maybeSingle<{organization_id: string; role: string}>();
  if (error) throw new Error(error.message);
  if (!membership) redirect("/dashboard/company");
  if (!["owner","admin","manager","employee"].includes(membership.role)) redirect("/dashboard?error=access-denied");
  const leader = ["owner","admin","manager"].includes(membership.role);
  const organizationWide = ["owner","admin"].includes(membership.role);
  const visibleOwnerIds = organizationWide ? [] : await getVisibleUserIds({admin, organizationId: membership.organization_id, actorId: data.user.id, role: membership.role});
  return {admin, user: data.user, membership, leader, organizationWide, visibleOwnerIds};
}

export async function canAccessCustomer(context: Awaited<ReturnType<typeof getCustomerServiceContext>>, clientId:string) {
  let query=context.admin.from("crm_clients").select("id").eq("id",clientId).eq("organization_id",context.membership.organization_id);
  if(!context.organizationWide) query=query.in("customer_service_owner_id",context.visibleOwnerIds);
  const {data}=await query.maybeSingle(); return Boolean(data);
}

export async function getVisibleCustomerIds(context: Awaited<ReturnType<typeof getCustomerServiceContext>>) {
  let query=context.admin.from("crm_clients").select("id").eq("organization_id",context.membership.organization_id);
  if(!context.organizationWide) query=query.in("customer_service_owner_id",context.visibleOwnerIds);
  const {data,error}=await query; if(error) throw new Error(error.message); return (data??[]).map(row=>String(row.id));
}

export async function hasCustomerServiceDepartment(admin: ReturnType<typeof createAdminClient>) {
  const result = await admin.from("customer_service_installments").select("id", {head: true, count: "exact"}).limit(1);
  return !result.error;
}
