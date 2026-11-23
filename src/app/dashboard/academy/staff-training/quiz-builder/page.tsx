// V4_10_111_DAY_QUIZ_BUILDER
import {notFound, redirect} from "next/navigation";
import {StaffTrainingDayQuizBuilder} from "@/components/academy/staff-training-day-quiz-builder";
import {getI18n} from "@/i18n/server";
import {requireAcademyAccessContext} from "@/lib/academy/access-context";

type Props = {searchParams?: Promise<Record<string, string | string[] | undefined>>};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function options4(value: unknown): [string, string, string, string] {
  const source = Array.isArray(value) ? value.map((item) => String(item ?? "")) : [];
  return [source[0] ?? "", source[1] ?? "", source[2] ?? "", source[3] ?? ""];
}

export default async function StaffTrainingDayQuizBuilderPage({searchParams}: Props) {
  const sp = (await searchParams) ?? {};
  const courseId = first(sp.course).trim();
  const moduleLabel = first(sp.module).trim();
  const month = first(sp.month).trim();
  const requestedQuizId = first(sp.quiz).trim();
  if (!courseId || !moduleLabel) redirect("/dashboard/academy/staff-training?error=Quiz%20Builder%20incomplet");

  const access = await requireAcademyAccessContext();
  if (!new Set(["owner", "admin", "hr"]).has(access.role)) redirect("/dashboard/academy/staff-training?error=Acc%C3%A8s%20administrateur%20requis");
  const i18n = await getI18n();

  const [{data: course}, {data: module}, {data: quizzes}] = await Promise.all([
    access.admin.from("academy_courses").select("id,title,is_staff_training").eq("id", courseId).eq("organization_id", access.organizationId).maybeSingle(),
    access.admin.from("academy_staff_training_modules").select("id,module_label,title").eq("course_id", courseId).eq("organization_id", access.organizationId).eq("module_label", moduleLabel).maybeSingle(),
    access.admin.from("academy_staff_training_module_quizzes").select("id,module_label,title,passing_score,max_attempts,is_required").eq("course_id", courseId).eq("organization_id", access.organizationId).eq("module_label", moduleLabel).order("created_at", {ascending: true}),
  ]);

  if (!course || !course.is_staff_training || !module) notFound();
  const existing = requestedQuizId
    ? (quizzes ?? []).find((quiz) => String(quiz.id) === requestedQuizId)
    : (quizzes ?? [])[0];
  if (requestedQuizId && !existing) notFound();

  const quizId = existing ? String(existing.id) : "";
  const [{data: questions}, {count: attemptCount}] = quizId ? await Promise.all([
    access.admin.from("academy_staff_training_module_quiz_questions").select("id,question_text,options,correct_option,position").eq("quiz_id", quizId).eq("course_id", courseId).eq("organization_id", access.organizationId).order("position", {ascending: true}),
    access.admin.from("academy_staff_training_module_quiz_attempts").select("id", {count: "exact", head: true}).eq("quiz_id", quizId).eq("course_id", courseId).eq("organization_id", access.organizationId),
  ]) : [{data: []}, {count: 0}];

  const initialQuestions = (questions ?? []).map((question) => ({
    id: String(question.id),
    questionText: String(question.question_text ?? ""),
    options: options4(question.options),
    correctOption: Math.max(0, Math.min(3, Number(question.correct_option ?? 0))),
  }));

  return <StaffTrainingDayQuizBuilder
    locale={i18n.locale}
    courseId={courseId}
    courseTitle={String(course.title)}
    month={month}
    moduleLabel={moduleLabel}
    moduleTitle={String(module.title || module.module_label)}
    quizId={quizId || undefined}
    initialTitle={existing ? String(existing.title) : `Évaluation ${moduleLabel} — ${String(module.title || module.module_label)}`}
    initialPassingScore={existing ? Number(existing.passing_score) : 70}
    initialMaxAttempts={existing ? Number(existing.max_attempts) : 2}
    initialRequired={existing ? Boolean(existing.is_required) : true}
    initialQuestions={initialQuestions}
    attemptCount={Number(attemptCount ?? 0)}
  />;
}
