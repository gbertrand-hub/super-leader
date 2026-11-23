import Link from "next/link";
import {redirect} from "next/navigation";
import {isAssessmentOpen} from "@/lib/academy/assessment-availability";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Enrollment = {
  id: string;
  organization_id: string;
  school_id: string;
  program_id: string | null;
  cohort_id: string | null;
  crm_client_id: string | null;
  academic_status: string;
  enrolled_on: string;
};

type StudentFinance = {
  enrollment_id: string;
  agreed_amount: number | string | null;
  currency: string | null;
  payment_status: string | null;
};

type ConfirmedAllocation = {
  enrollment_id: string;
  amount: number | string | null;
};

type StudentAssessment = {
  status: string;
  assessment_type: string;
  opens_at: string | null;
  closes_at: string | null;
};

type StudentResult = {
  id: string;
  enrollment_id: string;
  score: number | string | null;
  result_status: string;
  academy_assessments: StudentAssessment | StudentAssessment[];
};

const statusLabels: Record<string, string> = {
  admitted: "Admis",
  enrolled: "Inscrit",
  active: "Actif",
};

const paymentStatusLabels: Record<string, string> = {
  not_started: "Paiement à commencer",
  partial: "Paiement partiel",
  paid: "Payé",
  overdue: "En retard",
};

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("fr-CA", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("fr-FR", {dateStyle: "long", timeZone: "UTC"}).format(parsed);
}

export default async function AcademyStudentPage() {
  const supabase = await createClient();
  const {data: auth, error: authError} = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: directlyLinkedRows, error: enrollmentError} = await admin
    .from("academy_school_enrollments")
    .select("id,organization_id,school_id,program_id,cohort_id,crm_client_id,academic_status,enrolled_on")
    .eq("user_id", auth.user.id)
    .in("academic_status", ["admitted", "enrolled", "active"])
    .order("enrolled_on", {ascending: false});

  if (enrollmentError) throw new Error(enrollmentError.message);
  const directEnrollments = (directlyLinkedRows ?? []) as Enrollment[];
  if (!directEnrollments.length) redirect("/dashboard");

  const crmContexts = [
    ...new Map(
      directEnrollments
        .filter((row) => row.crm_client_id)
        .map((row) => [
          `${row.organization_id}:${row.crm_client_id}`,
          {organizationId: row.organization_id, crmClientId: row.crm_client_id as string},
        ]),
    ).values(),
  ];
  const relatedResults = await Promise.all(
    crmContexts.map(({organizationId, crmClientId}) =>
      admin
        .from("academy_school_enrollments")
        .select("id,organization_id,school_id,program_id,cohort_id,crm_client_id,academic_status,enrolled_on")
        .eq("organization_id", organizationId)
        .eq("crm_client_id", crmClientId)
        .in("academic_status", ["admitted", "enrolled", "active"]),
    ),
  );
  const relatedError = relatedResults.find((result) => result.error)?.error;
  if (relatedError) throw new Error(relatedError.message);

  const enrollmentById = new Map(
    [...directEnrollments, ...relatedResults.flatMap((result) => (result.data ?? []) as Enrollment[])]
      .map((row) => [row.id, row]),
  );
  const enrollments = [...enrollmentById.values()].sort((left, right) =>
    right.enrolled_on.localeCompare(left.enrolled_on),
  );

  const schoolIds = [...new Set(enrollments.map((row) => row.school_id))];
  const programIds = [...new Set(enrollments.map((row) => row.program_id).filter(Boolean) as string[])];
  const cohortIds = [...new Set(enrollments.map((row) => row.cohort_id).filter(Boolean) as string[])];
  const enrollmentIds = enrollments.map((row) => row.id);

  const [
    {data: schools},
    {data: programs},
    {data: cohorts},
    {data: resultRows},
    {data: financeRows},
    {data: allocationRows},
  ] = await Promise.all([
    admin.from("academy_schools").select("id,name").in("id", schoolIds),
    programIds.length
      ? admin.from("academy_programs").select("id,name").in("id", programIds)
      : Promise.resolve({data: []}),
    cohortIds.length
      ? admin.from("academy_cohorts").select("id,name,starts_on,ends_on").in("id", cohortIds)
      : Promise.resolve({data: []}),
    admin
      .from("academy_assessment_results")
      .select("id,enrollment_id,score,result_status,academy_assessments!inner(status,assessment_type,opens_at,closes_at)")
      .in("enrollment_id", enrollmentIds),
    admin
      .from("academy_student_finance")
      .select("enrollment_id,agreed_amount,currency,payment_status")
      .in("enrollment_id", enrollmentIds),
    admin
      .from("academy_student_confirmed_allocations")
      .select("enrollment_id,amount")
      .in("enrollment_id", enrollmentIds),
  ]);

  const schoolById = new Map((schools ?? []).map((row) => [String(row.id), String(row.name)]));
  const programById = new Map((programs ?? []).map((row) => [String(row.id), String(row.name)]));
  const cohortById = new Map(
    (cohorts ?? []).map((row) => [
      String(row.id),
      {name: String(row.name), startsOn: row.starts_on as string | null, endsOn: row.ends_on as string | null},
    ]),
  );
  const studentResults = (resultRows ?? []) as unknown as StudentResult[];
  const financeByEnrollment = new Map(
    ((financeRows ?? []) as StudentFinance[]).map((row) => [row.enrollment_id, row]),
  );
  const paidByEnrollment = new Map<string, number>();
  for (const row of (allocationRows ?? []) as ConfirmedAllocation[]) {
    paidByEnrollment.set(
      row.enrollment_id,
      (paidByEnrollment.get(row.enrollment_id) ?? 0) + Number(row.amount ?? 0),
    );
  }
  const visibleResults = studentResults.filter((row) => {
    const assessment = Array.isArray(row.academy_assessments)
      ? row.academy_assessments[0]
      : row.academy_assessments;
    return assessment?.assessment_type === "quiz" &&
      (assessment.status === "open" || row.score !== null);
  });
  const openQuizCount = visibleResults.filter((row) => {
    const assessment = Array.isArray(row.academy_assessments)
      ? row.academy_assessments[0]
      : row.academy_assessments;
    return row.score === null && Boolean(assessment) && isAssessmentOpen(assessment);
  }).length;
  const completedQuizCount = visibleResults.filter((row) => row.score !== null).length;
  const fullName = String(auth.user.user_metadata?.full_name ?? "Étudiant").trim() || "Étudiant";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <header className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950 p-8 text-white shadow-xl">
          <p className="text-xs font-black uppercase tracking-[.24em] text-amber-400">Super Leader Academy</p>
          <h1 className="mt-3 text-3xl font-black sm:text-4xl">Bienvenue, {fullName}</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Consultez vos inscriptions officielles et accédez aux quiz autorisés avec votre compte étudiant.
          </p>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <article className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-3xl font-black">{schoolIds.length}</p>
            <p className="text-sm font-semibold text-slate-500">École(s) d’inscription</p>
          </article>
          <article className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-3xl font-black text-violet-700">{openQuizCount}</p>
            <p className="text-sm font-semibold text-slate-500">Quiz disponibles</p>
          </article>
          <article className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-3xl font-black text-emerald-700">{completedQuizCount}</p>
            <p className="text-sm font-semibold text-slate-500">Quiz terminés</p>
          </article>
        </section>

        <section className="mt-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[.2em] text-violet-700">Mes inscriptions</p>
              <h2 className="mt-1 text-2xl font-black">École, programme et cohorte</h2>
            </div>
            <Link
              href="/dashboard/academy/my-quizzes"
              className="rounded-xl bg-violet-700 px-5 py-3 text-center font-black text-white"
            >
              Ouvrir mes quiz →
            </Link>
          </div>

          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            {enrollments.map((enrollment) => {
              const cohort = enrollment.cohort_id ? cohortById.get(enrollment.cohort_id) : null;
              const finance = financeByEnrollment.get(enrollment.id);
              const agreedAmount = Number(finance?.agreed_amount ?? 0);
              const paidAmount = paidByEnrollment.get(enrollment.id) ?? 0;
              const balance = Math.max(0, agreedAmount - paidAmount);
              const currency = finance?.currency || "USD";
              return (
                <article key={enrollment.id} className="overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-sm">
                  <div className="border-b border-violet-100 bg-violet-50 p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[.18em] text-violet-700">École</p>
                        <h3 className="mt-1 text-2xl font-black">
                          {schoolById.get(enrollment.school_id) ?? "École Academy"}
                        </h3>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
                        {statusLabels[enrollment.academic_status] ?? enrollment.academic_status}
                      </span>
                    </div>
                  </div>
                  <dl className="grid gap-5 p-6 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-black uppercase tracking-wide text-slate-400">Programme</dt>
                      <dd className="mt-1 font-black">
                        {enrollment.program_id
                          ? programById.get(enrollment.program_id) ?? "Programme à confirmer"
                          : "Programme non affecté"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-black uppercase tracking-wide text-slate-400">Cohorte</dt>
                      <dd className="mt-1 font-black">{cohort?.name ?? "Cohorte non affectée"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-black uppercase tracking-wide text-slate-400">Inscrit depuis</dt>
                      <dd className="mt-1 font-semibold">{formatDate(enrollment.enrolled_on)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-black uppercase tracking-wide text-slate-400">Période de cohorte</dt>
                      <dd className="mt-1 font-semibold">
                        {cohort?.startsOn ? formatDate(cohort.startsOn) : "Non précisée"}
                        {cohort?.endsOn ? ` — ${formatDate(cohort.endsOn)}` : ""}
                      </dd>
                    </div>
                  </dl>
                  <div className="mx-6 mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase tracking-[.16em] text-amber-800">
                        Ma situation financière
                      </p>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-amber-900">
                        {paymentStatusLabels[finance?.payment_status ?? ""] ?? "À vérifier"}
                      </span>
                    </div>
                    <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                      <div>
                        <dt className="text-xs font-bold text-amber-700">Frais convenus</dt>
                        <dd className="mt-1 text-lg font-black">{money(agreedAmount, currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold text-amber-700">Déjà payé</dt>
                        <dd className="mt-1 text-lg font-black text-emerald-700">{money(paidAmount, currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold text-amber-700">Solde</dt>
                        <dd className="mt-1 text-lg font-black text-amber-950">{money(balance, currency)}</dd>
                      </div>
                    </dl>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <p className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          Seule votre situation financière Academy personnelle est affichée ici. Les informations commerciales,
          professionnelles et les données des autres utilisateurs restent séparées et protégées.
        </p>
      </div>
    </main>
  );
}
