"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAssessmentOpen } from "@/lib/academy/assessment-availability";
import { canAccessAcademyEnrollment } from "@/lib/academy/student-enrollment-access";

const text = (value: FormDataEntryValue | null, max = 4000) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
const quizPath = (resultId: string) =>
  `/dashboard/academy/my-quizzes/${resultId}`;
const go = (resultId: string, message: string, error = false): never =>
  redirect(
    `${quizPath(resultId)}?${error ? "error" : "success"}=${encodeURIComponent(message)}`,
  );

type StudentQuizResult = {
  id: string;
  organization_id: string;
  assessment_id: string;
  enrollment_id: string;
  academy_school_enrollments:
    | {
        id: string;
        organization_id: string;
        crm_client_id: string | null;
        user_id: string | null;
      }
    | {
        id: string;
        organization_id: string;
        crm_client_id: string | null;
        user_id: string | null;
      }[];
  academy_assessments:
    | {
        status: string;
        assessment_type: string;
        max_score: number;
        passing_score: number;
        opens_at: string | null;
        closes_at: string | null;
      }
    | {
        status: string;
        assessment_type: string;
        max_score: number;
        passing_score: number;
        opens_at: string | null;
        closes_at: string | null;
      }[];
};

export async function submitStudentQuizAction(formData: FormData) {
  const resultId = text(formData.get("result_id"), 80);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  if (!resultId) go(resultId, "Quiz introuvable.", true);

  const admin = createAdminClient();
  const { data: result, error: resultError } = await admin
    .from("academy_assessment_results")
    .select(
      "id,organization_id,assessment_id,enrollment_id,academy_school_enrollments!inner(id,organization_id,crm_client_id,user_id),academy_assessments!inner(status,assessment_type,max_score,passing_score,opens_at,closes_at)",
    )
    .eq("id", resultId)
    .maybeSingle<StudentQuizResult>();

  const enrollment = Array.isArray(result?.academy_school_enrollments)
    ? result.academy_school_enrollments[0]
    : result?.academy_school_enrollments;
  const assessment = Array.isArray(result?.academy_assessments)
    ? result.academy_assessments[0]
    : result?.academy_assessments;

  const enrollmentAllowed = await canAccessAcademyEnrollment(
    admin,
    auth.user.id,
    enrollment,
  );
  if (
    resultError ||
    !result ||
    !enrollmentAllowed ||
    !assessment ||
    !isAssessmentOpen(assessment) ||
    assessment?.assessment_type !== "quiz"
  ) {
    return go(resultId, "Quiz indisponible ou non attribué à ce compte.", true);
  }

  if (enrollment && !enrollment.user_id) {
    await admin
      .from("academy_school_enrollments")
      .update({ user_id: auth.user.id })
      .eq("id", enrollment.id)
      .is("user_id", null);
  }

  const { data: previousAttempt, error: previousError } = await admin
    .from("academy_assessment_quiz_attempts")
    .select("id,status")
    .eq("result_id", resultId)
    .maybeSingle<{ id: string; status: string }>();
  if (previousError) go(resultId, previousError.message, true);
  if (previousAttempt && previousAttempt.status !== "in_progress") {
    go(resultId, "Ce quiz a déjà été soumis.", true);
  }

  const attempt = previousAttempt
    ? previousAttempt
    : (
        await admin
          .from("academy_assessment_quiz_attempts")
          .insert({
            organization_id: result.organization_id,
            assessment_id: result.assessment_id,
            result_id: resultId,
            enrollment_id: result.enrollment_id,
            student_user_id: auth.user.id,
          })
          .select("id,status")
          .single<{ id: string; status: string }>()
      ).data;
  const attemptId = attempt?.id;
  if (!attemptId) go(resultId, "Tentative impossible.", true);

  const { data: questions, error: questionError } = await admin
    .from("academy_assessment_quiz_questions")
    .select("id,question_type,points,accepted_answers")
    .eq("assessment_id", result.assessment_id)
    .eq("is_active", true)
    .order("position");
  if (questionError) go(resultId, questionError.message, true);

  const questionIds = (questions ?? []).map((question) => String(question.id));
  const { data: options, error: optionError } = questionIds.length
    ? await admin
        .from("academy_assessment_quiz_options")
        .select("id,question_id,is_correct")
        .in("question_id", questionIds)
    : { data: [], error: null };
  if (optionError) go(resultId, optionError.message, true);

  let automaticScore = 0;
  let requiresManualReview = false;
  const answers = (questions ?? []).map((question) => {
    const questionType = String(question.question_type);
    const isChoiceQuestion = [
      "single_choice",
      "multiple_choice",
      "true_false",
    ].includes(questionType);
    const availableOptionIds = new Set(
      (options ?? [])
        .filter(
          (option) => String(option.question_id) === String(question.id),
        )
        .map((option) => String(option.id)),
    );
    const selected = isChoiceQuestion
      ? formData
          .getAll(`q_${question.id}`)
          .map(String)
          .filter((optionId) => availableOptionIds.has(optionId))
      : [];
    const textAnswer = isChoiceQuestion
      ? ""
      : text(formData.get(`q_${question.id}`));
    const correctIds = (options ?? [])
      .filter(
        (option) =>
          String(option.question_id) === String(question.id) &&
          option.is_correct,
      )
      .map((option) => String(option.id))
      .sort();
    const chosenIds = [...selected].sort();
    let automaticallyCorrect: boolean | null = null;
    let awardedPoints = 0;

    if (
      isChoiceQuestion
    ) {
      automaticallyCorrect =
        JSON.stringify(correctIds) === JSON.stringify(chosenIds);
      awardedPoints = automaticallyCorrect ? Number(question.points) : 0;
    } else if (questionType === "short_answer") {
      automaticallyCorrect = (
        Array.isArray(question.accepted_answers)
          ? question.accepted_answers
          : []
      ).some(
        (accepted: unknown) =>
          normalize(String(accepted)) === normalize(textAnswer),
      );
      awardedPoints = automaticallyCorrect ? Number(question.points) : 0;
    } else {
      requiresManualReview = true;
    }

    automaticScore += awardedPoints;
    return {
      organization_id: result.organization_id,
      attempt_id: attemptId,
      question_id: String(question.id),
      selected_option_ids: selected,
      text_answer: textAnswer || null,
      awarded_points: awardedPoints,
      auto_correct: automaticallyCorrect,
    };
  });

  if (answers.length) {
    const { error: answerError } = await admin
      .from("academy_assessment_quiz_answers")
      .upsert(answers, { onConflict: "attempt_id,question_id" });
    if (answerError) go(resultId, answerError.message, true);
  }

  const passed = automaticScore >= Number(assessment.passing_score);
  const attemptStatus = requiresManualReview ? "pending_review" : "graded";
  const { error: attemptError } = await admin
    .from("academy_assessment_quiz_attempts")
    .update({
      status: attemptStatus,
      auto_score: automaticScore,
      total_score: automaticScore,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", attemptId)
    .eq("student_user_id", auth.user.id);
  if (attemptError) go(resultId, attemptError.message, true);

  const { error: scoreError } = await admin
    .from("academy_assessment_results")
    .update({
      score: automaticScore,
      result_status: requiresManualReview
        ? "ungraded"
        : passed
          ? "passed"
          : "failed",
      graded_by: requiresManualReview ? null : auth.user.id,
      graded_at: requiresManualReview ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", resultId)
    .eq("enrollment_id", result.enrollment_id);
  if (scoreError) go(resultId, scoreError.message, true);

  revalidatePath(quizPath(resultId));
  revalidatePath("/dashboard/academy/my-quizzes");
  go(
    resultId,
    requiresManualReview
      ? `Quiz soumis. Note automatique provisoire : ${automaticScore}. Correction manuelle en attente.`
      : `Quiz corrigé automatiquement : ${automaticScore}/${assessment.max_score}.`,
  );
}
