import {NextResponse} from "next/server";
import {
  buildStaffTrainingTemporaryPath,
  MAX_STAFF_TRAINING_BYTES,
  PRIVATE_ATTACHMENTS_BUCKET,
  STAFF_TRAINING_MIME_TYPES,
} from "@/lib/academy/staff-training-storage";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const ADMIN_ROLES = new Set(["owner", "admin", "hr"]);
type Membership = {organization_id: string; role: string; is_active: boolean};

async function getContext() {
  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) return null;
  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership || !ADMIN_ROLES.has(membership.role)) return null;
  return {user: authData.user, membership, admin};
}

export async function POST(request: Request) {
  const context = await getContext();
  if (!context) return NextResponse.json({error: "Forbidden"}, {status: 403});

  let input: {fileName?: string; mimeType?: string; sizeBytes?: number};
  try { input = await request.json(); } catch { return NextResponse.json({error: "Invalid request"}, {status: 400}); }

  const fileName = String(input.fileName ?? "").trim();
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase();
  const sizeBytes = Number(input.sizeBytes ?? 0);
  if (!fileName || !STAFF_TRAINING_MIME_TYPES.has(mimeType) || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_STAFF_TRAINING_BYTES) {
    return NextResponse.json({error: "Unsupported file or file larger than 30 MB"}, {status: 400});
  }

  const path = buildStaffTrainingTemporaryPath({organizationId: context.membership.organization_id, userId: context.user.id, fileName});
  const {data, error} = await context.admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).createSignedUploadUrl(path, {upsert: false});
  if (error || !data) return NextResponse.json({error: error?.message ?? "Unable to prepare upload"}, {status: 500});

  return NextResponse.json({bucket: PRIVATE_ATTACHMENTS_BUCKET, path: data.path, token: data.token}, {status: 201, headers: {"Cache-Control": "no-store"}});
}

export async function DELETE(request: Request) {
  const context = await getContext();
  if (!context) return NextResponse.json({error: "Forbidden"}, {status: 403});
  let input: {path?: string};
  try { input = await request.json(); } catch { return NextResponse.json({error: "Invalid request"}, {status: 400}); }
  const path = String(input.path ?? "").trim();
  const expected = `${context.membership.organization_id}/temp/${context.user.id}/academy_training/`;
  if (!path.startsWith(expected) || path.includes("..")) return NextResponse.json({error: "Invalid path"}, {status: 400});
  await context.admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).remove([path]);
  return new NextResponse(null, {status: 204});
}
