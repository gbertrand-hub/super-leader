import {NextResponse} from "next/server";
import {buildHrDocumentTemporaryPath, HR_DOCUMENT_MIME_TYPES, MAX_HR_DOCUMENT_BYTES, PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/hr/document-storage";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const HR_ROLES = new Set(["owner", "admin", "hr"]);
type Membership = {organization_id: string; role: string};

async function context() {
  const supabase = await createClient();
  const {data} = await supabase.auth.getUser();
  if (!data.user) return null;
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", data.user.id).eq("is_active", true).limit(1).maybeSingle<Membership>();
  if (!membership || !HR_ROLES.has(membership.role)) return null;
  return {user: data.user, membership, admin};
}

export async function POST(request: Request) {
  const c = await context();
  if (!c) return NextResponse.json({error: "Forbidden"}, {status: 403});
  let input: {fileName?: string; mimeType?: string; sizeBytes?: number};
  try { input = await request.json(); } catch { return NextResponse.json({error: "Invalid request"}, {status: 400}); }
  const fileName = String(input.fileName ?? "").trim();
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase();
  const sizeBytes = Number(input.sizeBytes ?? 0);
  if (!fileName || !HR_DOCUMENT_MIME_TYPES.has(mimeType) || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_HR_DOCUMENT_BYTES) {
    return NextResponse.json({error: "Unsupported file or file larger than 30 MB"}, {status: 400});
  }
  const path = buildHrDocumentTemporaryPath({organizationId: c.membership.organization_id, userId: c.user.id, fileName});
  const {data, error} = await c.admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).createSignedUploadUrl(path, {upsert: false});
  if (error || !data) return NextResponse.json({error: error?.message ?? "Unable to prepare upload"}, {status: 500});
  return NextResponse.json({bucket: PRIVATE_ATTACHMENTS_BUCKET, path: data.path, token: data.token}, {status: 201, headers: {"Cache-Control": "no-store"}});
}

export async function DELETE(request: Request) {
  const c = await context();
  if (!c) return NextResponse.json({error: "Forbidden"}, {status: 403});
  let input: {path?: string};
  try { input = await request.json(); } catch { return NextResponse.json({error: "Invalid request"}, {status: 400}); }
  const path = String(input.path ?? "").trim();
  const expected = `${c.membership.organization_id}/temp/${c.user.id}/hr_documents/`;
  if (!path.startsWith(expected) || path.includes("..")) return NextResponse.json({error: "Invalid path"}, {status: 400});
  await c.admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).remove([path]);
  return new NextResponse(null, {status: 204});
}

