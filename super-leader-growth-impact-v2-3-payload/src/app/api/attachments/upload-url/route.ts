import {NextResponse} from "next/server";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  buildTemporaryAttachmentPath,
  MAX_ATTACHMENT_BYTES,
  PRIVATE_ATTACHMENTS_BUCKET,
  type AttachmentPurpose,
  validateAttachmentInput,
} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const purposes = new Set<AttachmentPurpose>(["leave", "sale", "payment", "impact"]);

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
  if (!membership) return null;

  return {user: authData.user, membership, admin};
}

export async function POST(request: Request) {
  const context = await getContext();
  if (!context) return NextResponse.json({error: "Unauthorized"}, {status: 401});

  let input: {purpose?: string; fileName?: string; mimeType?: string; sizeBytes?: number};
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({error: "Invalid request"}, {status: 400});
  }

  const purpose = String(input.purpose ?? "") as AttachmentPurpose;
  const fileName = String(input.fileName ?? "").trim();
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase();
  const sizeBytes = Number(input.sizeBytes ?? 0);

  if (!purposes.has(purpose)) {
    return NextResponse.json({error: "Invalid attachment purpose"}, {status: 400});
  }

  if (context.membership.role === "hr" && !["leave", "impact"].includes(purpose)) {
    return NextResponse.json({error: "Forbidden"}, {status: 403});
  }

  try {
    validateAttachmentInput({fileName, mimeType, sizeBytes});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "Invalid attachment"}, {status: 400});
  }

  const path = buildTemporaryAttachmentPath({
    organizationId: context.membership.organization_id,
    userId: context.user.id,
    purpose,
    fileName,
  });
  const {data, error} = await context.admin.storage
    .from(PRIVATE_ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path, {upsert: false});

  if (error || !data) {
    return NextResponse.json({error: error?.message ?? "Unable to prepare upload"}, {status: 500});
  }

  return NextResponse.json({
    bucket: PRIVATE_ATTACHMENTS_BUCKET,
    path: data.path,
    token: data.token,
    maxBytes: MAX_ATTACHMENT_BYTES,
    allowedMimeTypes: [...ALLOWED_ATTACHMENT_MIME_TYPES],
  }, {status: 201, headers: {"Cache-Control": "no-store"}});
}

export async function DELETE(request: Request) {
  const context = await getContext();
  if (!context) return NextResponse.json({error: "Unauthorized"}, {status: 401});

  let input: {path?: string};
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({error: "Invalid request"}, {status: 400});
  }

  const path = String(input.path ?? "").trim();
  const expectedPrefix = `${context.membership.organization_id}/temp/${context.user.id}/`;
  if (!path.startsWith(expectedPrefix) || path.includes("..")) {
    return NextResponse.json({error: "Invalid path"}, {status: 400});
  }

  await context.admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).remove([path]);
  return new NextResponse(null, {status: 204});
}
