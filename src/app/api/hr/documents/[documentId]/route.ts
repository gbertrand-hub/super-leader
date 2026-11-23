import {NextResponse} from "next/server";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/hr/document-storage";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string};
type DocumentRow = {id: string; organization_id: string; employee_user_id: string | null; document_scope: string; status: string; confidential: boolean; storage_path: string; file_name: string};

export async function GET(request: Request, {params}: {params: Promise<{documentId: string}>}) {
  const {documentId} = await params;
  const supabase = await createClient();
  const {data: auth} = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", request.url));
  const admin = createAdminClient();
  const {data: document} = await admin.from("hr_documents").select("id,organization_id,employee_user_id,document_scope,status,confidential,storage_path,file_name").eq("id", documentId).maybeSingle<DocumentRow>();
  if (!document?.storage_path) return NextResponse.json({error: "Document introuvable"}, {status: 404});
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("organization_id", document.organization_id).eq("user_id", auth.user.id).eq("is_active", true).maybeSingle<Membership>();
  if (!membership) return NextResponse.json({error: "Forbidden"}, {status: 403});
  const hrAccess = ["owner","admin","hr"].includes(membership.role);
  let allowed = hrAccess;
  if (!allowed && !document.confidential && ["to_acknowledge","active"].includes(document.status)) {
    const {data: recipient} = await admin.from("hr_document_recipients").select("id").eq("document_id", document.id).eq("organization_id", document.organization_id).eq("employee_user_id", auth.user.id).maybeSingle<{id: string}>();
    allowed = Boolean(recipient);
  }
  if (!allowed) return NextResponse.json({error: "Forbidden"}, {status: 403});
  const {data, error} = await admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).createSignedUrl(document.storage_path, 60, {download: document.file_name || true});
  if (error || !data?.signedUrl) return NextResponse.json({error: error?.message ?? "Téléchargement impossible"}, {status: 500});
  await admin.from("hr_document_audit_log").insert({organization_id: document.organization_id, document_id: document.id, employee_user_id: auth.user.id, actor_id: auth.user.id, action: "opened", details: {fileName: document.file_name}});
  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
