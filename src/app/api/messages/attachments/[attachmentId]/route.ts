import {NextResponse} from "next/server";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type AttachmentRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  message_id: string;
  storage_path: string;
  file_name: string;
};

export async function GET(
  request: Request,
  {params}: {params: Promise<{attachmentId: string}>},
) {
  const {attachmentId} = await params;
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.redirect(new URL("/login", request.url));

  const admin = createAdminClient();
  const {data: attachment, error} = await admin
    .from("internal_message_attachments")
    .select("id,organization_id,conversation_id,message_id,storage_path,file_name")
    .eq("id", attachmentId)
    .maybeSingle<AttachmentRow>();
  if (error || !attachment) return NextResponse.json({error: "Attachment not found"}, {status: 404});

  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", attachment.organization_id)
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle<{organization_id: string}>();
  if (!membership) return NextResponse.json({error: "Forbidden"}, {status: 403});

  const {data: participant} = await admin
    .from("internal_conversation_members")
    .select("id")
    .eq("conversation_id", attachment.conversation_id)
    .eq("organization_id", attachment.organization_id)
    .eq("user_id", authData.user.id)
    .is("left_at", null)
    .maybeSingle<{id: string}>();
  if (!participant) return NextResponse.json({error: "Forbidden"}, {status: 403});

  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const bucket = admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET);
  const {data: signed, error: signedError} = inline
    ? await bucket.createSignedUrl(attachment.storage_path, 60)
    : await bucket.createSignedUrl(attachment.storage_path, 60, {download: attachment.file_name || true});
  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({error: signedError?.message ?? "Unable to open attachment"}, {status: 500});
  }

  const {error: auditError} = await admin.from("internal_messaging_audit_log").insert({
    organization_id: attachment.organization_id,
    conversation_id: attachment.conversation_id,
    message_id: attachment.message_id,
    actor_id: authData.user.id,
    action: inline ? "attachment_opened_inline" : "attachment_downloaded",
    details: {attachmentId: attachment.id, fileName: attachment.file_name},
  });
  if (auditError) console.error("Messaging attachment audit failed", auditError);

  const response = NextResponse.redirect(signed.signedUrl, 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
