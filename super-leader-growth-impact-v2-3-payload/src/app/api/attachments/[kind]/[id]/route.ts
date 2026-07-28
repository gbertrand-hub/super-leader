import {NextResponse} from "next/server";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/storage/private-attachments";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string; is_active: boolean};

type AttachmentRecord = {
  organizationId: string;
  ownerId: string;
  secondaryOwnerId?: string | null;
  storagePath: string | null;
  fileName: string | null;
};

async function loadRecord(kind: string, id: string, admin: ReturnType<typeof createAdminClient>): Promise<AttachmentRecord | null> {
  if (kind === "leave") {
    const {data} = await admin
      .from("leave_requests")
      .select("organization_id, user_id, document_storage_path, document_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.user_id,
      storagePath: data.document_storage_path,
      fileName: data.document_file_name,
    };
  }

  if (kind === "sale") {
    const {data} = await admin
      .from("sales_records")
      .select("organization_id, seller_id, collection_owner_id, proof_storage_path, proof_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.seller_id,
      secondaryOwnerId: data.collection_owner_id,
      storagePath: data.proof_storage_path,
      fileName: data.proof_file_name,
    };
  }

  if (kind === "payment") {
    const {data: payment} = await admin
      .from("sales_payments")
      .select("organization_id, sale_id, recorded_by, proof_storage_path, proof_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!payment) return null;

    const {data: sale} = await admin
      .from("sales_records")
      .select("seller_id, collection_owner_id")
      .eq("id", payment.sale_id)
      .eq("organization_id", payment.organization_id)
      .maybeSingle();

    return {
      organizationId: payment.organization_id,
      ownerId: sale?.seller_id ?? payment.recorded_by,
      secondaryOwnerId: sale?.collection_owner_id ?? payment.recorded_by,
      storagePath: payment.proof_storage_path,
      fileName: payment.proof_file_name,
    };
  }

  if (kind === "impact") {
    const {data} = await admin
      .from("impact_contributions")
      .select("organization_id, user_id, proof_storage_path, proof_file_name")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      organizationId: data.organization_id,
      ownerId: data.user_id,
      storagePath: data.proof_storage_path,
      fileName: data.proof_file_name,
    };
  }

  return null;
}

export async function GET(
  _request: Request,
  {params}: {params: Promise<{kind: string; id: string}>},
) {
  const {kind, id} = await params;
  if (!new Set(["leave", "sale", "payment", "impact"]).has(kind)) {
    return NextResponse.json({error: "Not found"}, {status: 404});
  }

  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.redirect(new URL("/login", _request.url));

  const admin = createAdminClient();
  const record = await loadRecord(kind, id, admin);
  if (!record?.storagePath) return NextResponse.json({error: "Attachment not found"}, {status: 404});

  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("organization_id", record.organizationId)
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle<Membership>();
  if (!membership) return NextResponse.json({error: "Forbidden"}, {status: 403});

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: record.organizationId,
    actorId: authData.user.id,
    role: membership.role,
  });

  let allowed = membership.role === "owner"
    || membership.role === "admin"
    || (membership.role === "hr" && ["leave", "impact"].includes(kind))
    || record.ownerId === authData.user.id
    || record.secondaryOwnerId === authData.user.id;

  if (!allowed && membership.role === "manager") {
    allowed = visibleUserIds.includes(record.ownerId)
      || Boolean(record.secondaryOwnerId && visibleUserIds.includes(record.secondaryOwnerId));
  }

  if (!allowed) return NextResponse.json({error: "Forbidden"}, {status: 403});

  const {data, error} = await admin.storage
    .from(PRIVATE_ATTACHMENTS_BUCKET)
    .createSignedUrl(record.storagePath, 60, {download: record.fileName || true});
  if (error || !data?.signedUrl) {
    return NextResponse.json({error: error?.message ?? "Unable to open attachment"}, {status: 500});
  }

  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
