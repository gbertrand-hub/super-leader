"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  academyGlobalRoles,
  getAcademyAssignments,
  hasAssignmentRole,
} from "@/lib/academy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const roles = new Set([
  "director",
  "academic_coordinator",
  "instructor",
  "follow_up",
  "finance",
  "communication",
  "marketing",
  "data_analyst",
  "observer",
]);
const go = (message: string, error = false): never =>
  redirect(
    `/dashboard/academy/trainers?${error ? "error" : "success"}=${encodeURIComponent(message)}`,
  );

async function context() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ organization_id: string; role: string }>();
  if (!membership) throw new Error("Action non autorisée.");
  const assignments = await getAcademyAssignments(
    admin,
    membership.organization_id,
    data.user.id,
  );
  return { admin, user: data.user, membership, assignments };
}

export async function assignAcademyTrainerAction(formData: FormData) {
  const schoolId = String(formData.get("school_id") ?? ""),
    userId = String(formData.get("user_id") ?? ""),
    programId = String(formData.get("program_id") ?? "") || null,
    cohortId = String(formData.get("cohort_id") ?? "") || null,
    assignmentRole = String(formData.get("assignment_role") ?? "");
  const { admin, user, membership, assignments } = await context();
  const global = academyGlobalRoles.has(membership.role);
  const director = hasAssignmentRole(assignments, schoolId, ["director"]);
  if (!global && !director) throw new Error("Affectation non autorisée.");
  if (!roles.has(assignmentRole)) go("Fonction académique invalide.", true);
  if (
    !global &&
    ["director", "academic_coordinator", "finance"].includes(assignmentRole)
  )
    go("Seule l’administration peut attribuer cette fonction.", true);

  const [{ data: school }, { data: member }, { data: program }, { data: cohort }] =
    await Promise.all([
      admin
        .from("academy_schools")
        .select("id")
        .eq("id", schoolId)
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true)
        .maybeSingle(),
      admin
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", membership.organization_id)
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle(),
      programId
        ? admin
            .from("academy_programs")
            .select("id")
            .eq("id", programId)
            .eq("school_id", schoolId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      cohortId
        ? admin
            .from("academy_cohorts")
            .select("id")
            .eq("id", cohortId)
            .eq("school_id", schoolId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
  if (!school || !member) go("École ou membre introuvable.", true);
  if (programId && !program) go("Le programme ne dépend pas de cette école.", true);
  if (cohortId && !cohort) go("La cohorte ne dépend pas de cette école.", true);

  let duplicateQuery = admin
    .from("academy_staff_assignments")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("school_id", schoolId)
    .eq("user_id", userId)
    .eq("assignment_role", assignmentRole);
  duplicateQuery = programId
    ? duplicateQuery.eq("program_id", programId)
    : duplicateQuery.is("program_id", null);
  duplicateQuery = cohortId
    ? duplicateQuery.eq("cohort_id", cohortId)
    : duplicateQuery.is("cohort_id", null);
  const { data: duplicate } = await duplicateQuery.limit(1).maybeSingle();
  if (duplicate) {
    await admin
      .from("academy_staff_assignments")
      .update({ is_active: true, assigned_by: user.id })
      .eq("id", duplicate.id);
  } else {
    const { error } = await admin.from("academy_staff_assignments").insert({
      organization_id: membership.organization_id,
      school_id: schoolId,
      program_id: programId,
      cohort_id: cohortId,
      user_id: userId,
      assignment_role: assignmentRole,
      is_active: true,
      assigned_by: user.id,
    });
    if (error) go(error.message, true);
  }
  revalidatePath("/dashboard/academy/trainers");
  go("Formateur affecté avec succès.");
}

export async function removeAcademyTrainerAssignmentAction(formData: FormData) {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  const { admin, membership, assignments } = await context();
  const { data: assignment } = await admin
    .from("academy_staff_assignments")
    .select("id,school_id,assignment_role")
    .eq("id", assignmentId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{ id: string; school_id: string; assignment_role: string }>();
  if (!assignment) go("Affectation introuvable.", true);
  const global = academyGlobalRoles.has(membership.role);
  const director = hasAssignmentRole(assignments, assignment!.school_id, ["director"]);
  if (
    !global &&
    (!director ||
      ["director", "academic_coordinator", "finance"].includes(
        assignment!.assignment_role,
      ))
  )
    throw new Error("Retrait non autorisé.");
  await admin
    .from("academy_staff_assignments")
    .update({ is_active: false })
    .eq("id", assignment!.id);
  revalidatePath("/dashboard/academy/trainers");
  go("Affectation retirée.");
}
