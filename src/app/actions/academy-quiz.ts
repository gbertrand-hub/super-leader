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
const txt = (v: FormDataEntryValue | null, n = 2000) =>
    String(v ?? "")
      .trim()
      .slice(0, n),
  norm = (v: string) =>
    v
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase(),
  assessmentPath = (id: string) =>
    `/dashboard/academy/assessments/${id}/quiz-builder`,
  go = (path: string, m: string, e = false): never =>
    redirect(`${path}?${e ? "error" : "success"}=${encodeURIComponent(m)}`);
async function auth() {
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
  return { a, user: data.user, m };
}
async function manager(assessmentId: string) {
  const c = await auth();
  if (!c.m) throw new Error("Action non autorisée.");
  const { data: item } = await c.a
    .from("academy_assessments")
    .select("id,school_id,status,assessment_type,max_score,passing_score")
    .eq("id", assessmentId)
    .eq("organization_id", c.m.organization_id)
    .maybeSingle<{
      id: string;
      school_id: string;
      status: string;
      assessment_type: string;
      max_score: number;
      passing_score: number;
    }>();
  const assignments = await getAcademyAssignments(
    c.a,
    c.m.organization_id,
    c.user.id,
  );
  if (
    !item ||
    !(
      academyGlobalRoles.has(c.m.role) ||
      hasAssignmentRole(assignments, item.school_id, [
        "director",
        "academic_coordinator",
        "instructor",
      ])
    )
  )
    throw new Error("Gestion du quiz non autorisée.");
  return { ...c, m: c.m, item };
}
type QuizSubmissionResult = {
  id: string;
  assessment_id: string;
  enrollment_id: string;
  academy_school_enrollments:
    { user_id: string | null } | { user_id: string | null }[];
  academy_assessments:
    | {
        status: string;
        assessment_type: string;
        max_score: number;
        passing_score: number;
      }
    | {
        status: string;
        assessment_type: string;
        max_score: number;
        passing_score: number;
      }[];
};
export async function addQuizQuestionAction(fd: FormData) {
  const assessmentId = txt(fd.get("assessment_id"), 80),
    path = assessmentPath(assessmentId),
    prompt = txt(fd.get("prompt")),
    type = txt(fd.get("question_type"), 30),
    types = [
      "single_choice",
      "multiple_choice",
      "true_false",
      "short_answer",
      "long_answer",
    ],
    points = Number(fd.get("points") || 0);
  if (prompt.length < 2 || !types.includes(type) || !(points > 0))
    go(
      path,
      "Question, type ou points invalides. Votre brouillon a été conservé.",
      true,
    );
  const lines = txt(fd.get("options"), 6000)
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    accepted =
      type === "short_answer"
        ? lines.map((x) => x.replace(/^\*/, "").trim()).filter(Boolean)
        : [];
  let options: { text: string; correct: boolean }[] = [];
  if (type === "true_false")
    options = [
      {
        text: "Vrai",
        correct: txt(fd.get("true_false_answer"), 10) === "true",
      },
      {
        text: "Faux",
        correct: txt(fd.get("true_false_answer"), 10) === "false",
      },
    ];
  if (type === "single_choice" || type === "multiple_choice")
    options = lines.map((x) => ({
      text: x.replace(/^\*/, "").trim(),
      correct: x.startsWith("*"),
    }));
  if (
    (type === "single_choice" || type === "multiple_choice") &&
    (options.length < 2 || !options.some((x) => x.correct))
  )
    go(
      path,
      "Ajoutez au moins deux choix et marquez la bonne réponse avec *. Votre brouillon a été conservé.",
      true,
    );
  const { a, m, item } = await manager(assessmentId);
  if (item.assessment_type !== "quiz")
    go(path, "Cette évaluation n’est pas de type Quiz.", true);
  const { count } = await a
      .from("academy_assessment_quiz_questions")
      .select("id", { count: "exact", head: true })
      .eq("assessment_id", assessmentId),
    { data: q, error } = await a
      .from("academy_assessment_quiz_questions")
      .insert({
        organization_id: m.organization_id,
        assessment_id: assessmentId,
        prompt,
        question_type: type,
        points,
        position: (count ?? 0) + 1,
        required: fd.get("required") === "on",
        accepted_answers: accepted,
        explanation: txt(fd.get("explanation"), 2000) || null,
      })
      .select("id")
      .single<{ id: string }>();
  if (error || !q)
    go(
      path,
      error?.message || "Création impossible. Votre brouillon a été conservé.",
      true,
    );
  if (options.length) {
    const { error: oe } = await a
      .from("academy_assessment_quiz_options")
      .insert(
        options.map((x, i) => ({
          organization_id: m.organization_id,
          question_id: q!.id,
          option_text: x.text,
          is_correct: x.correct,
          position: i + 1,
        })),
      );
    if (oe) {
      await a
        .from("academy_assessment_quiz_questions")
        .delete()
        .eq("id", q!.id);
      go(path, `${oe.message} Votre brouillon a été conservé.`, true);
    }
  }
  revalidatePath(path);
  go(path, "Question ajoutée.");
}
export async function updateQuizQuestionAction(fd: FormData) {
  const assessmentId = txt(fd.get("assessment_id"), 80),
    questionId = txt(fd.get("question_id"), 80),
    path = assessmentPath(assessmentId),
    prompt = txt(fd.get("prompt")),
    type = txt(fd.get("question_type"), 30),
    types = [
      "single_choice",
      "multiple_choice",
      "true_false",
      "short_answer",
      "long_answer",
    ],
    points = Number(fd.get("points") || 0);
  if (
    !questionId ||
    prompt.length < 2 ||
    !types.includes(type) ||
    !(points > 0)
  )
    go(
      path,
      "Question, type ou points invalides. Vos modifications ont été conservées.",
      true,
    );
  const { a, m, item } = await manager(assessmentId);
  if (item.assessment_type !== "quiz")
    go(path, "Cette évaluation n’est pas de type Quiz.", true);
  const { count: attempts } = await a
    .from("academy_assessment_quiz_attempts")
    .select("id", { count: "exact", head: true })
    .eq("assessment_id", assessmentId);
  if ((attempts ?? 0) > 0)
    go(
      path,
      "Modification verrouillée : un étudiant a déjà commencé ce quiz.",
      true,
    );
  const lines = txt(fd.get("options"), 6000)
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    accepted =
      type === "short_answer"
        ? lines.map((x) => x.replace(/^\*/, "").trim()).filter(Boolean)
        : [];
  let options: { text: string; correct: boolean }[] = [];
  if (type === "true_false")
    options = [
      {
        text: "Vrai",
        correct: txt(fd.get("true_false_answer"), 10) === "true",
      },
      {
        text: "Faux",
        correct: txt(fd.get("true_false_answer"), 10) === "false",
      },
    ];
  if (type === "single_choice" || type === "multiple_choice")
    options = lines.map((x) => ({
      text: x.replace(/^\*/, "").trim(),
      correct: x.startsWith("*"),
    }));
  if (
    (type === "single_choice" || type === "multiple_choice") &&
    (options.length < 2 || !options.some((x) => x.correct))
  )
    go(
      path,
      "Ajoutez au moins deux choix et marquez la bonne réponse avec *. Vos modifications ont été conservées.",
      true,
    );
  const { data: question, error } = await a
    .from("academy_assessment_quiz_questions")
    .update({
      prompt,
      question_type: type,
      points,
      required: fd.get("required") === "on",
      accepted_answers: accepted,
      explanation: txt(fd.get("explanation"), 2000) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", questionId)
    .eq("assessment_id", assessmentId)
    .eq("organization_id", m.organization_id)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error || !question)
    go(
      path,
      error?.message ||
        "Modification impossible. Vos données ont été conservées.",
      true,
    );
  const { error: deleteError } = await a
    .from("academy_assessment_quiz_options")
    .delete()
    .eq("question_id", questionId)
    .eq("organization_id", m.organization_id);
  if (deleteError) go(path, deleteError.message, true);
  if (options.length) {
    const { error: insertError } = await a
      .from("academy_assessment_quiz_options")
      .insert(
        options.map((x, i) => ({
          organization_id: m.organization_id,
          question_id: questionId,
          option_text: x.text,
          is_correct: x.correct,
          position: i + 1,
        })),
      );
    if (insertError) go(path, insertError.message, true);
  }
  revalidatePath(path);
  go(path, "Question modifiée.");
}
export async function archiveQuizQuestionAction(fd: FormData) {
  const assessmentId = txt(fd.get("assessment_id"), 80),
    questionId = txt(fd.get("question_id"), 80),
    path = assessmentPath(assessmentId),
    { a, m } = await manager(assessmentId),
    { count: attempts } = await a
      .from("academy_assessment_quiz_attempts")
      .select("id", { count: "exact", head: true })
      .eq("assessment_id", assessmentId);
  if ((attempts ?? 0) > 0)
    go(
      path,
      "Archivage verrouillé : un étudiant a déjà commencé ce quiz.",
      true,
    );
  await a
    .from("academy_assessment_quiz_questions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", questionId)
    .eq("assessment_id", assessmentId)
    .eq("organization_id", m.organization_id);
  revalidatePath(path);
  go(path, "Question archivée.");
}
export async function syncAssessmentStudentsAction(fd: FormData) {
  const assessmentId = txt(fd.get("assessment_id"), 80),
    returnTo = txt(fd.get("return_to"), 300) || assessmentPath(assessmentId),
    { a, m, item } = await manager(assessmentId);
  const { data: scope, error: scopeError } = await a
    .from("academy_assessments")
    .select("school_id,program_id,cohort_id")
    .eq("id", assessmentId)
    .single<{
      school_id: string;
      program_id: string | null;
      cohort_id: string | null;
    }>();
  if (scopeError || !scope) {
    go(
      returnTo,
      scopeError?.message ?? "Périmètre de l’évaluation introuvable.",
      true,
    );
  }
  const resolvedScope = scope!;
  let q = a
    .from("academy_school_enrollments")
    .select("id")
    .eq("organization_id", m.organization_id)
    .eq("school_id", resolvedScope.school_id)
    .in("academic_status", ["admitted", "enrolled", "active"]);
  if (resolvedScope.program_id)
    q = q.eq("program_id", resolvedScope.program_id);
  if (resolvedScope.cohort_id)
    q = q.eq("cohort_id", resolvedScope.cohort_id);
  const { data: students, error: studentError } = await q,
    { data: existing, error: existingError } = await a
      .from("academy_assessment_results")
      .select("enrollment_id")
      .eq("assessment_id", assessmentId),
    known = new Set((existing ?? []).map((x) => String(x.enrollment_id))),
    missing = (students ?? []).filter((x) => !known.has(String(x.id)));
  if (studentError || existingError) {
    go(
      returnTo,
      studentError?.message ??
        existingError?.message ??
        "Synchronisation impossible.",
      true,
    );
  }
  if (missing.length) {
    const { error: insertError } = await a
      .from("academy_assessment_results")
      .insert(
        missing.map((x) => ({
          organization_id: m.organization_id,
          assessment_id: item.id,
          enrollment_id: String(x.id),
        })),
      );
    if (insertError) go(returnTo, insertError.message, true);
  }
  revalidatePath(returnTo);
  go(
    returnTo,
    `${students?.length ?? 0} étudiant(s) attribué(s) au total; ${missing.length} nouvel/nouveaux ajout(s).`,
  );
}
export async function submitQuizAction(fd: FormData) {
  const resultId = txt(fd.get("result_id"), 80),
    path = `/dashboard/academy/my-quizzes/${resultId}`,
    c = await auth();
  if (!c.m) throw new Error("Compte organisationnel requis.");
  const { data: r } = await c.a
      .from("academy_assessment_results")
      .select(
        "id,assessment_id,enrollment_id,academy_school_enrollments!inner(user_id),academy_assessments!inner(status,assessment_type,max_score,passing_score)",
      )
      .eq("id", resultId)
      .eq("organization_id", c.m.organization_id)
      .maybeSingle<QuizSubmissionResult>(),
    enrollment = Array.isArray(r?.academy_school_enrollments)
      ? r.academy_school_enrollments[0]
      : r?.academy_school_enrollments,
    item = Array.isArray(r?.academy_assessments)
      ? r.academy_assessments[0]
      : r?.academy_assessments;
  if (
    !r ||
    String(enrollment?.user_id) !== c.user.id ||
    item?.status !== "open" ||
    item?.assessment_type !== "quiz"
  )
    throw new Error("Quiz indisponible.");
  const { data: old } = await c.a
    .from("academy_assessment_quiz_attempts")
    .select("id,status")
    .eq("result_id", resultId)
    .maybeSingle<{ id: string; status: string }>();
  if (old && old.status !== "in_progress")
    go(path, "Ce quiz a déjà été soumis.", true);
  const { data: attempt } = old
    ? { data: old }
    : await c.a
        .from("academy_assessment_quiz_attempts")
        .insert({
          organization_id: c.m.organization_id,
          assessment_id: r.assessment_id,
          result_id: resultId,
          enrollment_id: r.enrollment_id,
          student_user_id: c.user.id,
        })
        .select("id,status")
        .single<{ id: string; status: string }>();
  if (!attempt) go(path, "Tentative impossible.", true);
  const { data: questions } = await c.a
      .from("academy_assessment_quiz_questions")
      .select("id,question_type,points,accepted_answers")
      .eq("assessment_id", r.assessment_id)
      .eq("is_active", true)
      .order("position"),
    qids = (questions ?? []).map((x) => String(x.id)),
    { data: options } = qids.length
      ? await c.a
          .from("academy_assessment_quiz_options")
          .select("id,question_id,is_correct")
          .in("question_id", qids)
      : { data: [] };
  let auto = 0,
    manual = false;
  const answers = (questions ?? []).map((q) => {
    const selected = fd.getAll(`q_${q!.id}`).map(String),
      textAnswer = txt(fd.get(`q_${q!.id}`), 4000),
      correctIds = (options ?? [])
        .filter((o) => String(o.question_id) === String(q!.id) && o.is_correct)
        .map((o) => String(o.id))
        .sort(),
      chosen = [...selected].sort();
    let correct: boolean | null = null,
      points = 0;
    if (
      ["single_choice", "multiple_choice", "true_false"].includes(
        String(q.question_type),
      )
    ) {
      correct = JSON.stringify(correctIds) === JSON.stringify(chosen);
      points = correct ? Number(q.points) : 0;
    } else if (q.question_type === "short_answer") {
      correct = (
        Array.isArray(q.accepted_answers) ? q.accepted_answers : []
      ).some((x: unknown) => norm(String(x)) === norm(textAnswer));
      points = correct ? Number(q.points) : 0;
    } else manual = true;
    auto += points;
    return {
      organization_id: c.m!.organization_id,
      attempt_id: attempt!.id,
      question_id: String(q!.id),
      selected_option_ids: selected,
      text_answer: textAnswer || null,
      awarded_points: points,
      auto_correct: correct,
    };
  });
  if (answers.length)
    await c.a
      .from("academy_assessment_quiz_answers")
      .upsert(answers, { onConflict: "attempt_id,question_id" });
  const status = manual ? "pending_review" : "graded",
    passed = auto >= Number(item.passing_score);
  await c.a
    .from("academy_assessment_quiz_attempts")
    .update({
      status,
      auto_score: auto,
      total_score: auto,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", attempt!.id);
  await c.a
    .from("academy_assessment_results")
    .update({
      score: auto,
      result_status: manual ? "ungraded" : passed ? "passed" : "failed",
      graded_by: manual ? null : c.user.id,
      graded_at: manual ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", resultId);
  revalidatePath(path);
  go(
    path,
    manual
      ? `Quiz soumis. Note automatique provisoire : ${auto}. Correction manuelle en attente.`
      : `Quiz corrigé automatiquement : ${auto}/${item.max_score}.`,
  );
}
