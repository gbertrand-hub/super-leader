import {NextResponse} from "next/server";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

export async function GET(
  request: Request,
  {params}: {params: Promise<{id: string}>},
) {
  const {id} = await params;
  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.redirect(new URL("/provider-login", request.url));

  const admin = createAdminClient();
  const {data: attachment} = await admin
    .from("service_provider_portal_attachments")
    .select("id,organization_id,provider_id,contract_id,storage_path,file_name")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      provider_id: string;
      contract_id: string;
      storage_path: string;
      file_name: string;
    }>();
  if (!attachment) return NextResponse.json({error: "Not found"}, {status: 404});

  const [{data: portalLink}, {data: membership}] = await Promise.all([
    admin
      .from("service_provider_portal_users")
      .select("id")
      .eq("organization_id", attachment.organization_id)
      .eq("provider_id", attachment.provider_id)
      .eq("user_id", authData.user.id)
      .eq("status", "active")
      .maybeSingle<{id: string}>(),
    admin
      .from("organization_members")
      .select("role,is_active")
      .eq("organization_id", attachment.organization_id)
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle<{role: string; is_active: boolean}>(),
  ]);

  let allowed = Boolean(portalLink);
  if (!allowed && membership) {
    if (["owner", "admin", "executive", "hr"].includes(membership.role)) {
      allowed = true;
    } else {
      const {data: contract} = await admin
        .from("service_contracts")
        .select("internal_owner_user_id")
        .eq("id", attachment.contract_id)
        .eq("organization_id", attachment.organization_id)
        .maybeSingle<{internal_owner_user_id: string}>();
      allowed = contract?.internal_owner_user_id === authData.user.id;
    }
  }
  if (!allowed) return NextResponse.json({error: "Forbidden"}, {status: 403});

  const {data, error} = await admin.storage
    .from(PRIVATE_ATTACHMENTS_BUCKET)
    .createSignedUrl(attachment.storage_path, 90, {download: attachment.file_name});
  if (error || !data?.signedUrl) return NextResponse.json({error: "File unavailable"}, {status: 404});
  return NextResponse.redirect(data.signedUrl);
}
