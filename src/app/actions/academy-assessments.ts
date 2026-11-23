"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  academyGlobalRoles,
  getAcademyAssignments,
  hasAssignmentRole,
} from "@/lib/academy/access";
import { zonedLocalToIso } from "@/lib/academy/assessment-availability";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeTimeZone } from "@/lib/timezone";
const path = "/dashboard/academy/assessments",
  go = (m: string, e = false): never =>
    redirect(`${path}?${e ? "error" : "success"}=${encodeURIComponent(m)}`),
  txt = (v: FormDataEntryValue | null, n = 2000) =>
    String(v ?? "")
      .trim()
      .slice(0, n),
  iso = (v: FormDataEntryValue | null) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null;

function assessmentSchedule(fd: FormData) {
  const timeZone = normalizeTimeZone(txt(fd.get("schedule_time_zone"), 100));
  const opensRaw = txt(fd.get("opens_at"), 40);
  const closesRaw = txt(fd.get("closes_at"), 40);
  const opensAt = opensRaw ? zonedLocalToIso(opensRaw, timeZone) : null;
  const closesAt = closesRaw ? zonedLocalToIso(closesRaw, timeZone) : null;
  if ((opensRaw && !opensAt) || (closesRaw && !closesAt)) {
    go("La date ou l’heure programmée est invalide.", true);
  }
  if (
    opensAt &&
    closesAt &&
    new Date(closesAt).getTime() <= new Date(opensAt).getTime()
  ) {
    go("La fermeture doit être programmée après l’ouverture.", true);
  }
  return { opensAt, closesAt, timeZone };
}
async function ctx() {
  const s = await createClient(),
    { data } = await s.auth.getUser();
  if (!data.user) redirect("/login");
  const a = createAdminClient(),
    { data: m } = await a
      .from("organization_members")
      .select("organization_id,role")
      .eq("user_id", data.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<{ organization_id: string; role: string }>();
  if (!m) throw new Error("Action non autorisée.");
  return {
    a,
    user: data.user,
    m,
    assignments: await getAcademyAssignments(
      a,
      m.organization_id,
      data.user.id,
    ),
  };
}
function allowed(
  role: string,
  assignments: Awaited<ReturnType<typeof getAcademyAssignments>>,
  schoolId: string,
) {
  return (
    academyGlobalRoles.has(role) ||
    hasAssignmentRole(assignments, schoolId, [
      "director",
      "academic_coordinator",
      "instructor",
    ])
  );
}
async function validScope(
  a: ReturnType<typeof createAdminClient>,
  org: string,
  schoolId: string,
  programId: string | null,
  cohortId: string | null,
) {
  const { data: s } = await a
    .from("academy_schools")
    .select("id")
    .eq("id", schoolId)
    .eq("organization_id", org)
    .eq("is_active", true)
    .maybeSingle();
  if (!s) return false;
  if (programId) {
    const { data: p } = await a
      .from("academy_programs")
      .select("id")
      .eq("id", programId)
      .eq("school_id", schoolId)
      .eq("organization_id", org)
      .maybeSingle();
    if (!p) return false;
  }
  if (cohortId) {
    const { data: c } = await a
      .from("academy_cohorts")
      .select("id")
      .eq("id", cohortId)
      .eq("school_id", schoolId)
      .eq("organization_id", org)
      .maybeSingle();
    if (!c) return false;
  }
  return true;
}
export async function createAssessmentAction(fd: FormData) {
  const schoolId = txt(fd.get("school_id"), 80),
    programId = txt(fd.get("program_id"), 80) || null,
    cohortId = txt(fd.get("cohort_id"), 80) || null,
    title = txt(fd.get("title"), 200),
    type = txt(fd.get("assessment_type"), 20),
    types = ["quiz", "exam", "project", "practical", "oral", "other"],
    max = Number(fd.get("max_score")),
    pass = Number(fd.get("passing_score")),
    schedule = assessmentSchedule(fd);
  if (
    title.length < 2 ||
    !types.includes(type) ||
    !(max > 0) ||
    pass < 0 ||
    pass > max
  )
    go("Vérifiez le titre, le type et les notes maximales/de réussite.", true);
  const { a, user, m, assignments } = await ctx();
  if (!allowed(m.role, assignments, schoolId))
    throw new Error("Création non autorisée.");
  if (!(await validScope(a, m.organization_id, schoolId, programId, cohortId)))
    go("École, programme ou cohorte invalide.", true);
  const { data: item, error } = await a
    .from("academy_assessments")
    .insert({
      organization_id: m.organization_id,
      school_id: schoolId,
      program_id: programId,
      cohort_id: cohortId,
      evaluator_user_id: txt(fd.get("evaluator_user_id"), 80) || user.id,
      title,
      description: txt(fd.get("description"), 3000) || null,
      assessment_type: type,
      due_date: iso(fd.get("due_date")),
      opens_at: schedule.opensAt,
      closes_at: schedule.closesAt,
      schedule_time_zone: schedule.timeZone,
      max_score: max,
      passing_score: pass,
      status: schedule.opensAt || schedule.closesAt ? "open" : "draft",
      created_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !item) go(error?.message || "Création impossible.", true);
  let q = a
    .from("academy_school_enrollments")
    .select("id")
    .eq("organization_id", m.organization_id)
    .eq("school_id", schoolId)
    .in("academic_status", ["admitted", "enrolled", "active"]);
  if (programId) q = q.eq("program_id", programId);
  if (cohortId) q = q.eq("cohort_id", cohortId);
  const { data: students } = await q;
  if (students?.length)
    await a.from("academy_assessment_results").insert(
      students.map((x) => ({
        organization_id: m.organization_id,
        assessment_id: item!.id,
        enrollment_id: String(x.id),
      })),
    );
  revalidatePath(path);
  if (type === "quiz") {
    redirect(
      `/dashboard/academy/assessments/${item!.id}/quiz-builder?success=${encodeURIComponent(
        `Quiz créé et attribué à ${students?.length ?? 0} étudiant(s). Préparez maintenant les questions.`,
      )}`,
    );
  }
  go(`Évaluation créée pour ${students?.length ?? 0} étudiant(s).`);
}
export async function updateAssessmentAction(fd: FormData) {
  const id = txt(fd.get("assessment_id"), 80),
    title = txt(fd.get("title"), 200),
    type = txt(fd.get("assessment_type"), 20),
    max = Number(fd.get("max_score")),
    pass = Number(fd.get("passing_score")),
    schedule = assessmentSchedule(fd);
  if (
    title.length < 2 ||
    !["quiz", "exam", "project", "practical", "oral", "other"].includes(type) ||
    !(max > 0) ||
    pass < 0 ||
    pass > max
  )
    go("Paramètres d’évaluation invalides.", true);
  const { a, m, assignments } = await ctx(),
    { data: item } = await a
      .from("academy_assessments")
      .select("id,school_id,status")
      .eq("id", id)
      .eq("organization_id", m.organization_id)
      .maybeSingle<{ id: string; school_id: string; status: string }>();
  if (!item || !allowed(m.role, assignments, item.school_id))
    throw new Error("Modification non autorisée.");
  const { error } = await a
    .from("academy_assessments")
    .update({
      title,
      description: txt(fd.get("description"), 3000) || null,
      assessment_type: type,
      due_date: iso(fd.get("due_date")),
      opens_at: schedule.opensAt,
      closes_at: schedule.closesAt,
      schedule_time_zone: schedule.timeZone,
      status:
        item.status === "draft" && (schedule.opensAt || schedule.closesAt)
          ? "open"
          : item.status,
      evaluator_user_id: txt(fd.get("evaluator_user_id"), 80) || null,
      max_score: max,
      passing_score: pass,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", m.organization_id);
  if (error) go(error.message, true);
  revalidatePath(path);
  go("Évaluation mise à jour.");
}
export async function updateAssessmentStatusAction(fd: FormData) {
  const id = txt(fd.get("assessment_id"), 80),
    status = txt(fd.get("status"), 20);
  if (!["draft", "open", "closed", "archived"].includes(status))
    go("Statut invalide.", true);
  const { a, m, assignments } = await ctx(),
    { data: item } = await a
      .from("academy_assessments")
      .select("id,school_id")
      .eq("id", id)
      .eq("organization_id", m.organization_id)
      .maybeSingle<{ id: string; school_id: string }>();
  if (!item || !allowed(m.role, assignments, item.school_id))
    throw new Error("Changement non autorisé.");
  const { error } = await a
    .from("academy_assessments")
    .update(
      status === "open"
        ? {
            status,
            opens_at: null,
            closes_at: null,
            updated_at: new Date().toISOString(),
          }
        : { status, updated_at: new Date().toISOString() },
    )
    .eq("id", id);
  if (error) go(error.message, true);
  revalidatePath(path);
  go(
    status === "archived"
      ? "Évaluation archivée; les résultats sont conservés."
      : "Statut mis à jour.",
  );
}
export async function gradeAssessmentAction(fd: FormData) {
  const resultId = txt(fd.get("result_id"), 80),
    special = txt(fd.get("special_status"), 20),
    scoreText = txt(fd.get("score"), 30),
    score = scoreText === "" ? null : Number(scoreText);
  const { a, user, m, assignments } = await ctx(),
    { data: result } = await a
      .from("academy_assessment_results")
      .select(
        "id,assessment_id,academy_assessments!inner(school_id,max_score,passing_score)",
      )
      .eq("id", resultId)
      .eq("organization_id", m.organization_id)
      .maybeSingle<{
        id: string;
        assessment_id: string;
        academy_assessments:
          | { school_id: string; max_score: number; passing_score: number }
          | { school_id: string; max_score: number; passing_score: number }[];
      }>(),
    assessment = Array.isArray(result?.academy_assessments)
      ? result?.academy_assessments[0]
      : result?.academy_assessments;
  if (
    !result ||
    !assessment ||
    !allowed(m.role, assignments, assessment.school_id)
  )
    throw new Error("Notation non autorisée.");
  let status: string;
  if (["absent", "exempt", "ungraded"].includes(special)) {
    status = special;
  } else {
    if (
      score === null ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > Number(assessment.max_score)
    )
      go(
        `La note doit être comprise entre 0 et ${assessment.max_score}.`,
        true,
      );
    status = score! >= Number(assessment.passing_score) ? "passed" : "failed";
  }
  const { error } = await a
    .from("academy_assessment_results")
    .update({
      score: ["absent", "exempt", "ungraded"].includes(status) ? null : score,
      result_status: status,
      feedback: txt(fd.get("feedback"), 2000) || null,
      graded_by: user.id,
      graded_at: status === "ungraded" ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", resultId);
  if (error) go(error.message, true);
  revalidatePath(path);
  go("Résultat enregistré.");
}
