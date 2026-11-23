import {NextResponse} from "next/server";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const ADMIN_ROLES = new Set(["owner", "admin", "hr"]);

type Membership = {organization_id: string; role: string; is_active: boolean};

export async function GET(
  request: Request,
  {params}: {params: Promise<{resourceId: string}>},
) {
  const {resourceId} = await params;
  const supabase = await createClient();
  const {data: authData} = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.redirect(new URL("/login", request.url));

  const admin = createAdminClient();
  const {data: resource, error: resourceError} = await admin
    .from("academy_staff_training_resources")
    .select("id, organization_id, course_id, storage_path, file_name, is_published")
    .eq("id", resourceId)
    .maybeSingle();
  if (resourceError || !resource?.storage_path) {
    return NextResponse.json({error: "Document introuvable"}, {status: 404});
  }

  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("organization_id", resource.organization_id)
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle<Membership>();
  if (!membership) return NextResponse.json({error: "Forbidden"}, {status: 403});

  let allowed = ADMIN_ROLES.has(membership.role);
  if (!allowed && resource.is_published) {
    const {data: enrollment} = await admin
      .from("academy_enrollments")
      .select("id")
      .eq("organization_id", resource.organization_id)
      .eq("course_id", resource.course_id)
      .eq("user_id", authData.user.id)
      .limit(1)
      .maybeSingle();
    allowed = Boolean(enrollment);
  }
  if (!allowed) return NextResponse.json({error: "Forbidden"}, {status: 403});

  const {data, error} = await admin.storage
    .from(PRIVATE_ATTACHMENTS_BUCKET)
    .createSignedUrl(resource.storage_path, 60, {download: resource.file_name || true});
  if (error || !data?.signedUrl) {
    return NextResponse.json({error: error?.message ?? "Impossible de télécharger le document"}, {status: 500});
  }

  await admin.from("academy_staff_training_audit_log").insert({
    organization_id: resource.organization_id,
    course_id: resource.course_id,
    resource_id: resource.id,
    actor_id: authData.user.id,
    action: "resource_downloaded",
    details: {fileName: resource.file_name},
  });

  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
