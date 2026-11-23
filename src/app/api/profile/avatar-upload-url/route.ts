import {NextResponse} from "next/server";
import {
  buildTemporaryProfileAvatarPath,
  PROFILE_AVATAR_MAX_BYTES,
  PROFILE_AVATAR_MIME_TYPES,
  validateProfileAvatar,
} from "@/lib/profile/avatar";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

async function getContext() {
  const supabase = await createClient();
  const {data: authData, error} = await supabase.auth.getUser();
  if (error || !authData.user) return null;
  return {user: authData.user, admin: createAdminClient()};
}

export async function POST(request: Request) {
  const context = await getContext();
  if (!context) return NextResponse.json({error: "Unauthorized"}, {status: 401});

  let input: {fileName?: string; mimeType?: string; sizeBytes?: number};
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({error: "Invalid request"}, {status: 400});
  }

  const fileName = String(input.fileName ?? "").trim();
  const mimeType = String(input.mimeType ?? "").trim().toLowerCase();
  const sizeBytes = Number(input.sizeBytes ?? 0);
  try {
    validateProfileAvatar({fileName, mimeType, sizeBytes});
  } catch (error) {
    return NextResponse.json(
      {error: error instanceof Error ? error.message : "Invalid avatar"},
      {status: 400},
    );
  }

  const path = buildTemporaryProfileAvatarPath(context.user.id, fileName);
  const {data, error} = await context.admin.storage
    .from(PRIVATE_ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path, {upsert: false});

  if (error || !data) {
    return NextResponse.json({error: error?.message ?? "Unable to prepare upload"}, {status: 500});
  }

  return NextResponse.json(
    {
      bucket: PRIVATE_ATTACHMENTS_BUCKET,
      path: data.path,
      token: data.token,
      maxBytes: PROFILE_AVATAR_MAX_BYTES,
      allowedMimeTypes: [...PROFILE_AVATAR_MIME_TYPES],
    },
    {status: 201, headers: {"Cache-Control": "no-store"}},
  );
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
  const expectedPrefix = `profiles/temp/${context.user.id}/`;
  if (!path.startsWith(expectedPrefix) || path.includes("..")) {
    return NextResponse.json({error: "Invalid path"}, {status: 400});
  }

  await context.admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).remove([path]);
  return new NextResponse(null, {status: 204});
}
