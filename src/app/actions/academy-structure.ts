"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canEnrollStudents, getAcademyAssignments } from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const text = (value: FormDataEntryValue | null, max = 500) =>
  String(value ?? "").trim().slice(0, max);

const uniqueIds = (values: FormDataEntryValue[]) =>
  [...new Set(values.map((value) => text(value, 80)).filter(Boolean))];

function route(organizationId: string, schoolId: string) {
  return `/dashboard/academy/structure/${schoolId}?organization=${encodeURIComponent(organizationId)}`;
}

function go(
  organizationId: string,
  schoolId: string,
  message: string,
  kind: "success" | "error" = "success",
): never {
  redirect(`${route(organizationId, schoolId)}&${kind}=${encodeURIComponent(message)}`);
}

async function context(organizationId: string, schoolId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("organization_id", organizationId)
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .maybeSingle<{ organization_id: string; role: string }>();

  if (!membership) throw new Error("Organisation non autorisée.");

  const assignments = await getAcademyAssignments(
    admin,
    organizationId,
    auth.user.id,
  );
  if (!canEnrollStudents(membership.role, assignments, schoolId)) {
    throw new Error("Correction de structure non autorisée pour cette école.");
  }

  const { data: school } = await admin
    .from("academy_schools")
    .select("id")
    .eq("id", schoolId)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();
  if (!school) throw new Error("École introuvable.");

  return { admin, user: auth.user, membership };
}

export async function restructureAcademySchoolAction(fd: FormData) {
  const organizationId = text(fd.get("organization_id"), 80);
  const schoolId = text(fd.get("school_id"), 80);
  const canonicalProgramId = text(fd.get("canonical_program_id"), 80);
  const targetCohortId = text(fd.get("target_cohort_id"), 80);
  const targetCohortName = text(fd.get("target_cohort_name"), 180) || null;
  const sourceCohortId = text(fd.get("source_cohort_id"), 80) || null;
  const archiveProgramIds = uniqueIds(fd.getAll("archive_program_ids"));
  const archiveCohortIds = uniqueIds(fd.getAll("archive_cohort_ids"));
  const copySourceTariff = fd.get("copy_source_tariff") === "on";

  if (!organizationId || !schoolId || !canonicalProgramId || !targetCohortId) {
    go(
      organizationId,
      schoolId,
      "Programme officiel et cohorte officielle obligatoires.",
      "error",
    );
  }

  if (sourceCohortId && sourceCohortId === targetCohortId) {
    go(
      organizationId,
      schoolId,
      "La cohorte à fusionner doit être différente de la cohorte officielle.",
      "error",
    );
  }

  const { admin, user } = await context(organizationId, schoolId);

  const { data, error } = await admin.rpc("restructure_academy_school", {
    target_organization_id: organizationId,
    target_school_id: schoolId,
    canonical_program_id: canonicalProgramId,
    target_cohort_id: targetCohortId,
    target_cohort_name: targetCohortName,
    source_cohort_id: sourceCohortId,
    archive_program_ids: archiveProgramIds,
    archive_cohort_ids: archiveCohortIds,
    copy_source_tariff: copySourceTariff,
    target_actor_id: user.id,
  });

  if (error) go(organizationId, schoolId, error.message, "error");

  const result = (data ?? {}) as {
    moved_enrollments?: number;
    copied_cohort_tariff?: boolean;
  };
  const moved = Number(result.moved_enrollments ?? 0);
  const tariff = result.copied_cohort_tariff
    ? " Tarif homologué transféré vers la cohorte officielle."
    : "";

  revalidatePath(`/dashboard/academy/schools/${schoolId}`);
  revalidatePath("/dashboard/academy/cohorts");
  revalidatePath("/dashboard/academy/students");
  revalidatePath("/dashboard/academy/pricing");
  revalidatePath("/dashboard/academy/attendance");
  revalidatePath("/dashboard/academy/structure");
  revalidatePath(route(organizationId, schoolId));

  go(
    organizationId,
    schoolId,
    `Structure corrigée. ${moved} inscription(s) déplacée(s) sans changer leur identité financière ou académique.${tariff}`,
  );
}
