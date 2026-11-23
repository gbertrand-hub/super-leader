import type { SupabaseClient } from "@supabase/supabase-js";

export type AcademyEnrollmentIdentity = {
  id: string;
  organization_id: string;
  crm_client_id: string | null;
  user_id: string | null;
};

export async function canAccessAcademyEnrollment(
  admin: SupabaseClient,
  userId: string,
  enrollment: AcademyEnrollmentIdentity | null | undefined,
) {
  if (!enrollment) return false;
  if (enrollment.user_id === userId) return true;
  if (!enrollment.crm_client_id) return false;

  const { data: identityAnchor, error } = await admin
    .from("academy_school_enrollments")
    .select("id")
    .eq("organization_id", enrollment.organization_id)
    .eq("crm_client_id", enrollment.crm_client_id)
    .eq("user_id", userId)
    .in("academic_status", ["admitted", "enrolled", "active"])
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("Vérification de l’identité étudiante impossible", error);
    return false;
  }
  return Boolean(identityAnchor);
}
