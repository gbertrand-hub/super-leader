import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export type ProviderPortalLink = {
  id: string;
  organization_id: string;
  provider_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  status: "active" | "revoked";
  password_setup_required: boolean;
  password_set_at: string | null;
};

export type ProviderPortalContext = {
  userId: string;
  email: string;
  admin: ReturnType<typeof createAdminClient>;
  links: ProviderPortalLink[];
};

export async function getProviderPortalContext(options?: {redirectIfMissing?: boolean}): Promise<ProviderPortalContext | null> {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) {
    if (options?.redirectIfMissing !== false) redirect("/provider-login");
    return null;
  }

  const admin = createAdminClient();
  const {data, error} = await admin
    .from("service_provider_portal_users")
    .select("id,organization_id,provider_id,user_id,email,display_name,status,password_setup_required,password_set_at")
    .eq("user_id", authData.user.id)
    .eq("status", "active")
    .order("created_at", {ascending: true});

  if (error) {
    console.error("Provider portal access lookup failed", error);
    if (options?.redirectIfMissing !== false) redirect("/provider-login?error=portal-access");
    return null;
  }

  const links = (data ?? []) as ProviderPortalLink[];
  if (!links.length) {
    if (options?.redirectIfMissing !== false) redirect("/provider-login?error=no-access");
    return null;
  }

  return {
    userId: authData.user.id,
    email: authData.user.email ?? "",
    admin,
    links,
  };
}

export function linkedProviderIds(context: ProviderPortalContext) {
  return Array.from(new Set(context.links.map((link) => link.provider_id)));
}

export async function requireProviderContract(context: ProviderPortalContext, contractId: string) {
  const providerIds = linkedProviderIds(context);
  const {data, error} = await context.admin
    .from("service_contracts")
    .select("id,organization_id,provider_id,internal_owner_user_id,title,contract_number,status")
    .eq("id", contractId)
    .in("provider_id", providerIds)
    .maybeSingle<{
      id: string;
      organization_id: string;
      provider_id: string;
      internal_owner_user_id: string;
      title: string;
      contract_number: string;
      status: string;
    }>();

  if (error || !data) throw new Error("Contract outside provider portal scope.");
  const matchingLink = context.links.find(
    (link) => link.provider_id === data.provider_id && link.organization_id === data.organization_id,
  );
  if (!matchingLink) throw new Error("Provider portal access is not active for this contract.");
  return data;
}
