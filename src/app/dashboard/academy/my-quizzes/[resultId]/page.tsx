import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { submitStudentQuizAction } from "@/app/actions/academy-student-quiz";
import {
  assessmentAvailability,
  formatAssessmentDateTime,
} from "@/lib/academy/assessment-availability";
import { canAccessAcademyEnrollment } from "@/lib/academy/student-enrollment-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeTimeZone } from "@/lib/timezone";
type Props = {
  params: Promise<{ resultId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
type EnrollmentRelation = {
  id: string;
  organization_id: string;
  crm_client_id: string | null;
  user_id: string | null;
};
type AssessmentRelation = {
  title: string;
  description: string | null;
  status: string;
  assessment_type: string;
  max_score: number;
  passing_score: number;
  opens_at: string | null;
  closes_at: string | null;
  schedule_time_zone: string | null;
};
type QuizResult = {
  id: string;
  organization_id: string;
  assessment_id: string;
  enrollment_id: string;
  score: number | null;
  result_status: string;
  academy_school_enrollments: EnrollmentRelation | EnrollmentRelation[];
  academy_assessments: AssessmentRelation | AssessmentRelation[];
};
type QuizAttempt = {
  id: string;
  status: string;
  total_score: number | null;
  submitted_at: string | null;
};
const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? (v[0] ?? "") : (v ?? ""),
  input = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2";
export default async function TakeQuiz({ params, searchParams }: Props) {
  const { resultId } = await params,
    q = (await searchParams) ?? {},
    s = await createClient(),
    { data: auth } = await s.auth.getUser();
  if (!auth.user) redirect("/login");
  const a = createAdminClient(),
    { data: r } = await a
      .from("academy_assessment_results")
      .select(
        "id,organization_id,assessment_id,enrollment_id,score,result_status,academy_school_enrollments!inner(id,organization_id,crm_client_id,user_id),academy_assessments!inner(title,description,status,assessment_type,max_score,passing_score,opens_at,closes_at,schedule_time_zone)",
      )
      .eq("id", resultId)
      .maybeSingle<QuizResult>(),
    enrollment = Array.isArray(r?.academy_school_enrollments)
      ? r.academy_school_enrollments[0]
      : r?.academy_school_enrollments,
    item = Array.isArray(r?.academy_assessments)
      ? r.academy_assessments[0]
      : r?.academy_assessments;
  const enrollmentAllowed = await canAccessAcademyEnrollment(
    a,
    auth.user.id,
    enrollment,
  );
  if (!r || !enrollmentAllowed || item?.assessment_type !== "quiz") notFound();
  const availability = assessmentAvailability(item);
  const timeZone = normalizeTimeZone(item.schedule_time_zone);
  const opensLabel = formatAssessmentDateTime(item.opens_at, timeZone);
  const closesLabel = formatAssessmentDateTime(item.closes_at, timeZone);
  const [{ data: attempt }, { count: questionCount }] = await Promise.all([
    a
      .from("academy_assessment_quiz_attempts")
      .select("id,status,total_score,submitted_at")
      .eq("result_id", resultId)
      .maybeSingle<QuizAttempt>(),
    a
      .from("academy_assessment_quiz_questions")
      .select("id", { count: "exact", head: true })
      .eq("assessment_id", r.assessment_id)
      .eq("is_active", true),
  ]),
    submitted = attempt && attempt.status !== "in_progress";
  const { data: questions } =
      availability === "open" && !submitted
        ? await a
            .from("academy_assessment_quiz_questions")
            .select("id,prompt,question_type,points,position,required")
            .eq("assessment_id", r.assessment_id)
            .eq("is_active", true)
            .order("position")
        : { data: [] },
    ids = (questions ?? []).map((x) => String(x.id)),
    { data: options } = ids.length
      ? await a
          .from("academy_assessment_quiz_options")
          .select("id,question_id,option_text,position")
          .in("question_id", ids)
          .order("position")
      : { data: [] };
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/dashboard/academy/my-quizzes"
          className="font-black text-violet-700"
        >
          ← Mes quiz
        </Link>
        <header className="mt-5 rounded-3xl bg-slate-950 p-8 text-white">
          <p className="text-xs font-black uppercase tracking-[.2em] text-amber-400">
            Quiz étudiant
          </p>
          <h1 className="mt-2 text-3xl font-black">{String(item.title)}</h1>
          <p className="mt-2 text-slate-300">
            {String(item.description ?? "")}
          </p>
          <p className="mt-4 text-sm font-bold">
            {questionCount ?? 0} question(s) · note maximale{" "}
            {String(item.max_score)} · réussite {String(item.passing_score)}
          </p>
          {opensLabel || closesLabel ? (
            <p className="mt-2 text-sm font-bold text-amber-300">
              {opensLabel ? `Ouverture : ${opensLabel}` : ""}
              {opensLabel && closesLabel ? " · " : ""}
              {closesLabel ? `Fermeture : ${closesLabel}` : ""}
              {` · ${timeZone}`}
            </p>
          ) : null}
        </header>
        {first(q.success) ? (
          <p className="mt-5 rounded-xl bg-emerald-100 p-4 font-bold text-emerald-900">
            {first(q.success)}
          </p>
        ) : null}
        {first(q.error) ? (
          <p className="mt-5 rounded-xl bg-red-100 p-4 font-bold text-red-900">
            {first(q.error)}
          </p>
        ) : null}
        {availability !== "open" && !submitted ? (
          <p className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6 font-bold text-amber-900">
            {availability === "scheduled"
              ? `Ce quiz sera disponible${opensLabel ? ` le ${opensLabel}` : " prochainement"}.`
              : availability === "closed"
                ? `Ce quiz est fermé${closesLabel ? ` depuis le ${closesLabel}` : ""}.`
                : "Ce quiz n’est pas encore ouvert par le formateur."}
          </p>
        ) : submitted ? (
          <section className="mt-6 rounded-3xl border bg-white p-8 text-center">
            <p className="text-sm font-black uppercase text-violet-700">
              Quiz soumis
            </p>
            <p className="mt-3 text-4xl font-black">
              {String(attempt.total_score)} / {String(item.max_score)}
            </p>
            <p className="mt-3 text-slate-600">
              {attempt.status === "pending_review"
                ? "Des réponses longues attendent encore la correction du formateur."
                : r.result_status === "passed"
                  ? "Réussi"
                  : "Échoué"}
            </p>
          </section>
        ) : (
          <form action={submitStudentQuizAction} className="mt-6 space-y-5">
            <input type="hidden" name="result_id" value={resultId} />
            {(questions ?? []).map((question, index) => {
              const opts = (options ?? []).filter(
                (x) => String(x.question_id) === String(question.id),
              );
              return (
                <fieldset
                  key={String(question.id)}
                  className="rounded-3xl border bg-white p-6"
                >
                  <legend className="px-2 font-black">
                    {index + 1}. {String(question.prompt)}{" "}
                    <span className="text-sm text-violet-700">
                      ({String(question.points)} pt)
                    </span>
                  </legend>
                  {["single_choice", "true_false"].includes(
                    String(question.question_type),
                  ) ? (
                    <div className="mt-3 space-y-2">
                      {opts.map((o) => (
                        <label
                          key={String(o.id)}
                          className="flex gap-3 rounded-xl border p-3"
                        >
                          <input
                            type="radio"
                            name={`q_${question.id}`}
                            value={String(o.id)}
                            required={Boolean(question.required)}
                          />
                          {String(o.option_text)}
                        </label>
                      ))}
                    </div>
                  ) : question.question_type === "multiple_choice" ? (
                    <div className="mt-3 space-y-2">
                      {opts.map((o) => (
                        <label
                          key={String(o.id)}
                          className="flex gap-3 rounded-xl border p-3"
                        >
                          <input
                            type="checkbox"
                            name={`q_${question.id}`}
                            value={String(o.id)}
                          />
                          {String(o.option_text)}
                        </label>
                      ))}
                    </div>
                  ) : question.question_type === "long_answer" ? (
                    <textarea
                      name={`q_${question.id}`}
                      rows={7}
                      required={Boolean(question.required)}
                      className={input}
                    />
                  ) : (
                    <input
                      name={`q_${question.id}`}
                      required={Boolean(question.required)}
                      className={input}
                    />
                  )}
                </fieldset>
              );
            })}
            <button className="w-full rounded-2xl bg-violet-700 px-6 py-4 text-lg font-black text-white">
              Soumettre définitivement le quiz
            </button>
            <p className="text-center text-xs text-slate-500">
              La soumission est définitive. Les bonnes réponses restent
              protégées jusqu’à la correction.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
