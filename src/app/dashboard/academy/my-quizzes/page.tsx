import Link from "next/link";
import {redirect} from "next/navigation";
import {
  assessmentAvailability,
  formatAssessmentDateTime,
} from "@/lib/academy/assessment-availability";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";

type EnrollmentIdentity = {id: string; organization_id: string; crm_client_id: string | null};
type Assessment = {
  title: string;
  status: string;
  assessment_type: string;
  due_date: string | null;
  opens_at: string | null;
  closes_at: string | null;
  schedule_time_zone: string | null;
};
type QuizResult = {
  id: string;
  score: number | null;
  result_status: string;
  academy_assessments: Assessment | Assessment[];
};

export default async function MyQuizzes() {
  const supabase = await createClient();
  const {data: auth} = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: directRows, error: directError} = await admin
    .from("academy_school_enrollments")
    .select("id,organization_id,crm_client_id")
    .eq("user_id", auth.user.id)
    .in("academic_status", ["admitted", "enrolled", "active"]);
  if (directError) throw new Error(directError.message);

  const directEnrollments = (directRows ?? []) as EnrollmentIdentity[];
  const crmContexts = [...new Map(
    directEnrollments
      .filter((row) => row.crm_client_id)
      .map((row) => [
        `${row.organization_id}:${row.crm_client_id}`,
        {organizationId: row.organization_id, crmClientId: row.crm_client_id as string},
      ]),
  ).values()];
  const relatedResults = await Promise.all(
    crmContexts.map(({organizationId, crmClientId}) =>
      admin
        .from("academy_school_enrollments")
        .select("id,organization_id,crm_client_id")
        .eq("organization_id", organizationId)
        .eq("crm_client_id", crmClientId)
        .in("academic_status", ["admitted", "enrolled", "active"]),
    ),
  );
  const relatedError = relatedResults.find((result) => result.error)?.error;
  if (relatedError) throw new Error(relatedError.message);

  const enrollmentIds = [...new Set([
    ...directEnrollments.map((row) => row.id),
    ...relatedResults.flatMap((result) =>
      ((result.data ?? []) as EnrollmentIdentity[]).map((row) => row.id),
    ),
  ])];
  const {data: resultRows, error: resultError} = enrollmentIds.length
    ? await admin
        .from("academy_assessment_results")
        .select("id,score,result_status,academy_assessments!inner(title,status,assessment_type,due_date,max_score,opens_at,closes_at,schedule_time_zone)")
        .in("enrollment_id", enrollmentIds)
    : {data: [], error: null};
  if (resultError) throw new Error(resultError.message);

  const quizzes = ((resultRows ?? []) as unknown as QuizResult[]).filter((row) => {
    const assessment = Array.isArray(row.academy_assessments)
      ? row.academy_assessments[0]
      : row.academy_assessments;
    return assessment?.assessment_type === "quiz" &&
      (assessment.status === "open" || row.score !== null);
  });

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/dashboard/academy/student" className="font-black text-violet-700">
          ← Mon espace étudiant
        </Link>
        <header className="mt-5 rounded-3xl bg-slate-950 p-8 text-white">
          <p className="text-xs font-black uppercase tracking-[.2em] text-amber-400">Espace étudiant</p>
          <h1 className="mt-2 text-3xl font-black">Mes quiz et évaluations</h1>
          <p className="mt-2 text-slate-300">Retrouvez ici les quiz ouverts et vos résultats pour toutes vos écoles.</p>
        </header>
        <section className="mt-6 space-y-3">
          {quizzes.map((row) => {
            const assessment = Array.isArray(row.academy_assessments)
              ? row.academy_assessments[0]
              : row.academy_assessments;
            const availability = assessmentAvailability(assessment);
            const timeZone = normalizeTimeZone(assessment.schedule_time_zone);
            const opensLabel = formatAssessmentDateTime(
              assessment.opens_at,
              timeZone,
            );
            const closesLabel = formatAssessmentDateTime(
              assessment.closes_at,
              timeZone,
            );
            const actionLabel = row.score !== null
              ? "Voir le résultat"
              : availability === "scheduled"
                ? "Voir la programmation"
                : availability === "closed"
                  ? "Fermé"
                  : "Commencer";
            return (
              <Link key={row.id} href={`/dashboard/academy/my-quizzes/${row.id}`} className="flex items-center justify-between gap-4 rounded-2xl border bg-white p-5">
                <div>
                  <p className="font-black">{assessment.title}</p>
                  <p className="text-sm text-slate-500">Échéance : {assessment.due_date ?? "Non définie"} · {row.result_status}</p>
                  {opensLabel || closesLabel ? (
                    <p className="mt-1 text-xs font-bold text-violet-700">
                      {opensLabel ? `Ouverture : ${opensLabel}` : ""}
                      {opensLabel && closesLabel ? " · " : ""}
                      {closesLabel ? `Fermeture : ${closesLabel}` : ""}
                      {` · ${timeZone}`}
                    </p>
                  ) : null}
                </div>
                <span className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-black text-white">
                  {actionLabel}
                </span>
              </Link>
            );
          })}
          {!quizzes.length ? (
            <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-slate-500">
              Aucun quiz ouvert n’est encore rattaché à votre compte.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
