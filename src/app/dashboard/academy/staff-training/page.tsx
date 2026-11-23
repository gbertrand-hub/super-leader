// V4_10_111_DAY_QUIZ_BUILDER
// V4_10_110_R2_SELECTED_DAY_FILTER
// V4_10_110_STAFF_MODULE_UX
// V4_10_109_R4_ACADEMY_ACCESS
// V4_10_109_R3_ACCESS_CONTEXT
// V4_10_109_MONTHLY_ISOLATION
import Link from "next/link";
import {redirect} from "next/navigation";
import {
  activateStaffTrainingCourseAction,
  assignAllActiveStaffTrainingAction,
  addStaffTrainingResourceAction,
  addStaffTrainingModuleAction,
  deactivateStaffTrainingCourseAction,
  deleteStaffTrainingResourceAction,
  toggleStaffTrainingResourceAction,
  submitStaffTrainingModuleQuizAction,
  setStaffTrainingModuleQuizAvailabilityAction,
} from "@/app/actions/academy-staff-training";
import {StaffTrainingResourceUpload} from "@/components/academy/staff-training-resource-upload";
import {getI18n} from "@/i18n/server";
import {requireAcademyAccessContext} from "@/lib/academy/access-context";

type Props = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string; is_active: boolean};
type Course = {
  id: string;
  title: string;
  description: string;
  training_month: string;
  deadline: string;
  duration_minutes: number;
  is_required: boolean;
  passing_score: number | string;
  max_attempts: number;
  certificate_enabled: boolean;
  status: string;
  is_staff_training: boolean;
};
type MonthlyCycle = {
  id: string;
  training_month: string;
  academy_course_id: string | null;
  title: string;
  starts_on: string;
  due_on: string;
  status: string;
};
type StaffTrainingModule = {
  id: string;
  course_id: string;
  module_label: string;
  title: string;
  module_date: string | null;
  sort_order: number;
  is_published: boolean;
};
type Enrollment = {
  id: string;
  course_id: string;
  user_id: string;
  status: string;
  progress_percent: number | string;
  attempts_count: number;
  best_score: number | string | null;
  completed_at: string | null;
};
type Resource = {
  id: string;
  course_id: string;
  module_label: string;
  title: string;
  description: string;
  resource_type: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sort_order: number;
  is_published: boolean;
  created_at: string;
};
type ModuleQuiz = {
  id: string;
  course_id: string;
  module_label: string;
  title: string;
  passing_score: number | string;
  max_attempts: number;
  is_required: boolean;
  is_published: boolean;
  available_from: string | null;
  available_until: string | null;
};
type ModuleQuizQuestion = {
  id: string;
  quiz_id: string;
  question_text: string;
  options: unknown;
  points: number | string;
  position: number;
};
type ModuleQuizAttempt = {
  id: string;
  quiz_id: string;
  user_id: string;
  score: number | string;
  passed: boolean;
  attempt_no: number;
  attempted_at: string;
};

const ADMIN_ROLES = new Set(["owner", "admin", "hr"]);
const RESULTS_ROLES = new Set(["owner", "admin", "hr", "manager"]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function fieldClass() {
  return "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function resourceIcon(type: string) {
  if (type === "presentation") return "▣";
  if (type === "worksheet") return "✎";
  if (type === "spreadsheet") return "▦";
  if (type === "guide") return "◎";
  if (type === "template") return "◇";
  return "▤";
}


function normalizeOptions(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function quizAvailabilityState(quiz: ModuleQuiz, now = new Date()) {
  if (!quiz.is_published) return {open: false, reason: "locked" as const};
  const opensAt = quiz.available_from ? new Date(quiz.available_from) : null;
  const closesAt = quiz.available_until ? new Date(quiz.available_until) : null;
  if (opensAt && now < opensAt) return {open: false, reason: "scheduled" as const};
  if (closesAt && now > closesAt) return {open: false, reason: "closed" as const};
  return {open: true, reason: "open" as const};
}

function formatUtc(value: string | null, fr: boolean) {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function statusTone(status: string) {
  if (status === "completed") return "bg-emerald-100 text-emerald-800";
  if (status === "in_progress") return "bg-violet-100 text-violet-800";
  if (status === "failed" || status === "overdue") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

function monthLabel(value: string, fr: boolean) {
  const month = value.slice(0, 7);
  const date = new Date(`${month}-01T12:00:00Z`);
  const label = new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {month: "long", year: "numeric", timeZone: "UTC"}).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default async function StaffTrainingPage({searchParams}: Props) {
  const params = (await searchParams) ?? {};
  const requestedCourseId = first(params.course);
  const requestedMonth = first(params.month);
  const requestedModule = first(params.module);
  const success = first(params.success);
  const errorMessage = first(params.error);
  const {locale} = await getI18n();
  const fr = locale === "fr";

  // Centralized access resolution: do not silently turn a membership query error into /dashboard.
  const access = await requireAcademyAccessContext();
  const admin = access.admin;
  const authData = {user: access.user};
  const membership: Membership = {
    organization_id: access.organizationId,
    role: access.role,
    is_active: true,
  };
  const canManage = ADMIN_ROLES.has(membership.role);
  const canViewResults = RESULTS_ROLES.has(membership.role);

  const [coursesResult, enrollmentsResult, resourcesResult, cyclesResult] = await Promise.all([
    admin
      .from("academy_courses")
      .select("id, title, description, training_month, deadline, duration_minutes, is_required, passing_score, max_attempts, certificate_enabled, status, is_staff_training")
      .eq("organization_id", membership.organization_id)
      .order("training_month", {ascending: false})
      .order("created_at", {ascending: false}),
    admin
      .from("academy_enrollments")
      .select("id, course_id, user_id, status, progress_percent, attempts_count, best_score, completed_at")
      .eq("organization_id", membership.organization_id),
    admin
      .from("academy_staff_training_resources")
      .select("id, course_id, module_label, title, description, resource_type, file_name, mime_type, size_bytes, sort_order, is_published, created_at")
      .eq("organization_id", membership.organization_id)
      .order("module_label", {ascending: true})
      .order("sort_order", {ascending: true})
      .order("created_at", {ascending: true}),
    admin
      .from("academy_staff_monthly_training_cycles")
      .select("id, training_month, academy_course_id, title, starts_on, due_on, status")
      .eq("organization_id", membership.organization_id)
      .order("training_month", {ascending: false}),
  ]);

  if (coursesResult.error) {
    return <main className="p-6 lg:p-10"><div className="mx-auto max-w-5xl rounded-3xl border border-red-200 bg-red-50 p-8 text-red-900"><h1 className="text-2xl font-black">Staff Training Center</h1><p className="mt-3">{coursesResult.error.message}</p><code className="mt-4 block rounded-xl bg-slate-950 p-4 text-white">supabase/131_academy_staff_training_center_v4_9_4.sql</code></div></main>;
  }

  const allCourses = (coursesResult.data ?? []) as Course[];
  const allEnrollments = (enrollmentsResult.data ?? []) as Enrollment[];
  const allResources = (resourcesResult.data ?? []) as Resource[];
  const allCycles = (cyclesResult.data ?? []) as MonthlyCycle[];
  const ownEnrollmentCourseIds = new Set(allEnrollments.filter((row) => row.user_id === authData.user.id).map((row) => row.course_id));

  const visibleCourses = allCourses.filter((course) => course.is_staff_training && (canManage || ownEnrollmentCourseIds.has(course.id)));
  const visibleCourseIds = new Set(visibleCourses.map((course) => course.id));
  const visibleCycles = allCycles.filter((cycle) => cycle.academy_course_id && visibleCourseIds.has(cycle.academy_course_id));
  const selectedCycle =
    visibleCycles.find((cycle) => cycle.academy_course_id === requestedCourseId) ??
    visibleCycles.find((cycle) => cycle.training_month.slice(0, 7) === requestedMonth) ??
    visibleCycles[0] ?? null;
  const selectedCourse = selectedCycle?.academy_course_id
    ? visibleCourses.find((course) => course.id === selectedCycle.academy_course_id) ?? null
    : visibleCourses.find((course) => course.id === requestedCourseId) ?? visibleCourses[0] ?? null;
  const ownEnrollment = selectedCourse
    ? allEnrollments.find((row) => row.course_id === selectedCourse.id && row.user_id === authData.user.id) ?? null
    : null;
  const selectedResources = selectedCourse
    ? allResources.filter((resource) => resource.course_id === selectedCourse.id && (canManage || resource.is_published))
    : [];
  const selectedEnrollments = selectedCourse ? allEnrollments.filter((row) => row.course_id === selectedCourse.id) : [];
  const candidateCourses = allCourses.filter((course) => !course.is_staff_training);

  let trainingModules: StaffTrainingModule[] = [];
  let moduleQuizzes: ModuleQuiz[] = [];
  let moduleQuizQuestions: ModuleQuizQuestion[] = [];
  let moduleQuizAttempts: ModuleQuizAttempt[] = [];
  let moduleQuizSetupError = "";
  if (selectedCourse) {
    const [trainingModulesResult, moduleQuizzesResult, moduleQuestionsResult, moduleAttemptsResult] = await Promise.all([
      admin
        .from("academy_staff_training_modules")
        .select("id, course_id, module_label, title, module_date, sort_order, is_published")
        .eq("organization_id", membership.organization_id)
        .eq("course_id", selectedCourse.id)
        .order("sort_order", {ascending: true})
        .order("module_date", {ascending: true}),
      admin
        .from("academy_staff_training_module_quizzes")
        .select("id, course_id, module_label, title, passing_score, max_attempts, is_required, is_published, available_from, available_until")
        .eq("organization_id", membership.organization_id)
        .eq("course_id", selectedCourse.id)
        .order("module_label", {ascending: true})
        .order("created_at", {ascending: true}),
      admin
        .from("academy_staff_training_module_quiz_questions")
        .select("id, quiz_id, question_text, options, points, position")
        .eq("organization_id", membership.organization_id)
        .eq("course_id", selectedCourse.id)
        .order("position", {ascending: true}),
      admin
        .from("academy_staff_training_module_quiz_attempts")
        .select("id, quiz_id, user_id, score, passed, attempt_no, attempted_at")
        .eq("organization_id", membership.organization_id)
        .eq("course_id", selectedCourse.id)
        .order("attempted_at", {ascending: false}),
    ]);
    const firstQuizError = trainingModulesResult.error ?? moduleQuizzesResult.error ?? moduleQuestionsResult.error ?? moduleAttemptsResult.error;
    if (firstQuizError) {
      moduleQuizSetupError = firstQuizError.message;
    } else {
      trainingModules = (trainingModulesResult.data ?? []) as StaffTrainingModule[];
      moduleQuizzes = (moduleQuizzesResult.data ?? []) as ModuleQuiz[];
      moduleQuizQuestions = (moduleQuestionsResult.data ?? []) as ModuleQuizQuestion[];
      moduleQuizAttempts = (moduleAttemptsResult.data ?? []) as ModuleQuizAttempt[];
    }
  }

  const groupedResources = new Map<string, Resource[]>();
  for (const resource of selectedResources) {
    const key = resource.module_label || (fr ? "Ressources générales" : "General resources");
    groupedResources.set(key, [...(groupedResources.get(key) ?? []), resource]);
  }

  const legacyModuleLabels = [...new Set([
    ...selectedResources.map((resource) => resource.module_label),
    ...moduleQuizzes.map((quiz) => quiz.module_label),
  ].filter(Boolean))];
  const moduleLabels = trainingModules.length ? trainingModules.map((module) => module.module_label) : legacyModuleLabels;
  const selectedModuleLabel = moduleLabels.includes(requestedModule) ? requestedModule : (moduleLabels[0] ?? "");
  const selectedModule = trainingModules.find((module) => module.module_label === selectedModuleLabel) ?? null;
  const visibleModuleQuizzes = selectedModuleLabel
    ? moduleQuizzes.filter((quiz) => quiz.module_label === selectedModuleLabel)
    : moduleQuizzes;
  const visibleResources = selectedModuleLabel
    ? selectedResources.filter((resource) => resource.module_label === selectedModuleLabel)
    : selectedResources;
  const visibleGroupedResources = new Map<string, Resource[]>();
  for (const resource of visibleResources) {
    const key = resource.module_label || (fr ? "Ressources générales" : "General resources");
    visibleGroupedResources.set(key, [...(visibleGroupedResources.get(key) ?? []), resource]);
  }
  const contextBase = selectedCycle
    ? `/dashboard/academy/staff-training?month=${selectedCycle.training_month.slice(0, 7)}`
    : selectedCourse ? `/dashboard/academy/staff-training?course=${selectedCourse.id}` : `/dashboard/academy/staff-training`;

  const completedCount = canManage
    ? selectedEnrollments.filter((row) => row.status === "completed").length
    : ownEnrollment?.status === "completed" ? 1 : 0;
  const inProgressCount = canManage
    ? selectedEnrollments.filter((row) => row.status === "in_progress").length
    : ownEnrollment?.status === "in_progress" ? 1 : 0;
  const openModuleQuizzes = moduleQuizzes.filter((quiz) => quizAvailabilityState(quiz).open);
  const ownModuleQuizAttempts = moduleQuizAttempts.filter((attempt) => attempt.user_id === authData.user.id);
  const quizPendingCount = canManage
    ? openModuleQuizzes.length
    : openModuleQuizzes.filter((quiz) => {
        const attempts = ownModuleQuizAttempts.filter((attempt) => attempt.quiz_id === quiz.id);
        return quiz.is_required && !attempts.some((attempt) => attempt.passed) && attempts.length < Number(quiz.max_attempts);
      }).length;
  const publishedResourcesCount = selectedResources.filter((row) => row.is_published).length;

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-violet-950 to-indigo-950 p-7 text-white shadow-xl lg:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">Super Leader Academy · Staff</p>
              <h1 className="mt-3 text-3xl font-black sm:text-4xl lg:text-5xl">{fr ? "Centre de formation du personnel" : "Staff Training Center"}</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-200 sm:text-base">
                {fr
                  ? "Un espace professionnel pour préparer les formations internes, distribuer les supports, suivre la progression, faire passer les quiz et conserver une trace complète de l'apprentissage."
                  : "A professional space to prepare internal training, distribute resources, track progress, run quizzes and keep a complete learning record."}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {canManage ? (
                <Link href="/dashboard/academy" className="rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm font-black hover:bg-white/20">
                  {fr ? "Ouvrir Academy" : "Open Academy"}
                </Link>
              ) : null}
              {selectedCourse && canViewResults ? (
                <Link href={`/dashboard/academy/staff-training/results?course=${selectedCourse.id}`} className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-emerald-300">
                  {fr ? "Résultats des évaluations" : "Assessment results"}
                </Link>
              ) : null}
              {selectedCourse ? (
                <Link href={`/dashboard/academy?course=${selectedCourse.id}#academy-course-detail`} className="rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-amber-300">
                  {fr ? "Quiz final & progression" : "Final quiz & progress"}
                </Link>
              ) : null}
            </div>
          </div>
        </section>

        {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900">{success}</div> : null}
        {errorMessage ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-900">{errorMessage}</div> : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{fr ? "Formations visibles" : "Visible trainings"}</p><p className="mt-2 text-3xl font-black text-slate-950">{visibleCycles.length || visibleCourses.length}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{fr ? "Documents publiés" : "Published resources"}</p><p className="mt-2 text-3xl font-black text-slate-950">{selectedCourse ? publishedResourcesCount : 0}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{fr ? "Ma progression" : "My progress"}</p><p className="mt-2 text-3xl font-black text-slate-950">{ownEnrollment ? `${Math.round(Number(ownEnrollment.progress_percent ?? 0))}%` : "—"}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{canManage ? (fr ? "Évaluations ouvertes" : "Open assessments") : (fr ? "Quiz à finaliser" : "Quizzes to finish")}</p><p className="mt-2 text-3xl font-black text-slate-950">{selectedCourse ? quizPendingCount : 0}</p></div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-violet-700">{fr ? "Archives mensuelles" : "Monthly archive"}</p><h2 className="mt-1 text-xl font-black text-slate-950">{fr ? "Mois de formation" : "Training months"}</h2></div></div>
              <div className="mt-4 space-y-3">
                {visibleCycles.length ? visibleCycles.map((cycle) => {
                  const course = visibleCourses.find((item) => item.id === cycle.academy_course_id);
                  if (!course) return null;
                  const active = cycle.id === selectedCycle?.id;
                  const enrollment = allEnrollments.find((row) => row.course_id === course.id && row.user_id === authData.user.id);
                  return (
                    <Link key={cycle.id} href={`/dashboard/academy/staff-training?month=${cycle.training_month.slice(0, 7)}`} className={`block rounded-2xl border p-4 transition ${active ? "border-violet-400 bg-violet-50 ring-2 ring-violet-100" : "border-slate-200 bg-white hover:border-violet-200"}`}>
                      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-violet-700">{monthLabel(cycle.training_month, fr)}</p><p className="mt-1 font-black text-slate-950">{cycle.title}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${cycle.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{cycle.status}</span></div>
                      <p className="mt-2 text-xs text-slate-500">{cycle.starts_on} → {cycle.due_on}</p>
                      {enrollment ? <div className="mt-2"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${statusTone(enrollment.status)}`}>{Math.round(Number(enrollment.progress_percent ?? 0))}%</span></div> : null}
                    </Link>
                  );
                }) : visibleCourses.length ? visibleCourses.map((course) => {
                  const active = course.id === selectedCourse?.id;
                  const enrollment = allEnrollments.find((row) => row.course_id === course.id && row.user_id === authData.user.id);
                  return (
                    <Link key={course.id} href={`/dashboard/academy/staff-training?course=${course.id}`} className={`block rounded-2xl border p-4 transition ${active ? "border-violet-400 bg-violet-50" : "border-slate-200 bg-white hover:border-violet-200"}`}>
                      <p className="font-black text-slate-950">{course.title}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-700">{course.training_month?.slice(0, 7) || "—"}</span>{enrollment ? <span className={`rounded-full px-2.5 py-1 font-black ${statusTone(enrollment.status)}`}>{Math.round(Number(enrollment.progress_percent ?? 0))}%</span> : null}</div>
                    </Link>
                  );
                }) : <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{fr ? "Aucune formation du staff ne t'est encore affectée." : "No staff training has been assigned to you yet."}</p>}
              </div>
            </div>

            {canManage ? (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-wider text-amber-700">Administration</p>
                <h3 className="mt-1 text-lg font-black text-amber-950">{fr ? "Ajouter une formation hors cycle" : "Add a course outside a cycle"}</h3>
                <p className="mt-2 text-xs leading-5 text-amber-900">{fr ? "Pour la formation mensuelle, crée d’abord une formation distincte pour le mois puis rattache-la au cycle mensuel dans Academy. Cet outil reste réservé aux formations hors cycle." : "For monthly training, first create a distinct course for the month, then attach it to the monthly cycle in Academy. This tool remains for non-cycle courses."}</p>
                {candidateCourses.length ? (
                  <form action={activateStaffTrainingCourseAction} className="mt-4 space-y-3">
                    <select name="courseId" required className={fieldClass()}>
                      <option value="">{fr ? "Sélectionner..." : "Select..."}</option>
                      {candidateCourses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                    </select>
                    <button className="w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-amber-300">{fr ? "Ajouter au centre" : "Add to center"}</button>
                  </form>
                ) : <p className="mt-4 text-sm font-bold text-amber-900">{fr ? "Toutes les formations Academy sont déjà classées." : "All Academy courses are already classified."}</p>}
              </div>
            ) : null}
          </aside>

          <div className="space-y-6">
            {selectedCourse ? (
              <>
                {selectedCycle ? (
                  <section className="rounded-3xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-700">{fr ? "CONTEXTE MENSUEL ACTIF" : "ACTIVE MONTH CONTEXT"}</p><h2 className="mt-1 text-2xl font-black text-violet-950">{monthLabel(selectedCycle.training_month, fr)}</h2><p className="mt-1 text-sm text-violet-800">{fr ? "Tous les documents, quiz, participants, présences et résultats affichés ci-dessous appartiennent uniquement à ce mois." : "All documents, quizzes, participants, attendance and results shown below belong only to this month."}</p></div><span className="rounded-full bg-white px-4 py-2 text-xs font-black text-violet-800 shadow-sm">{selectedCycle.starts_on} → {selectedCycle.due_on}</span></div>
                  </section>
                ) : null}
                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:p-7">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-3xl">
                      <div className="flex flex-wrap gap-2"><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">{fr ? "FORMATION DU STAFF" : "STAFF TRAINING"}</span>{selectedCourse.is_required ? <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-800">{fr ? "OBLIGATOIRE" : "REQUIRED"}</span> : null}</div>
                      <h2 className="mt-4 text-3xl font-black text-slate-950">{selectedCourse.title}</h2>
                      <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-600">{selectedCourse.description || (fr ? "Aucune description ajoutée." : "No description added.")}</p>
                    </div>
                    <div className="grid min-w-[260px] grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Durée" : "Duration"}</p><p className="mt-1 text-xl font-black">{selectedCourse.duration_minutes} min</p></div>
                      <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Quiz final" : "Final quiz"}</p><p className="mt-1 text-xl font-black">{Number(selectedCourse.passing_score)}%</p></div>
                      <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "Terminés" : "Completed"}</p><p className="mt-1 text-xl font-black">{completedCount}</p></div>
                      <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-500">{fr ? "En cours" : "In progress"}</p><p className="mt-1 text-xl font-black">{inProgressCount}</p></div>
                    </div>
                  </div>
                  {ownEnrollment ? (
                    <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50 p-5">
                      <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-black text-violet-950">{fr ? "Ma progression" : "My progress"}</p><p className="mt-1 text-xs text-violet-700">{fr ? `Meilleur score : ${Number(ownEnrollment.best_score ?? 0)}% · ${ownEnrollment.attempts_count} tentative(s)` : `Best score: ${Number(ownEnrollment.best_score ?? 0)}% · ${ownEnrollment.attempts_count} attempt(s)`}</p></div><p className="text-2xl font-black text-violet-950">{Math.round(Number(ownEnrollment.progress_percent ?? 0))}%</p></div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-600" style={{width: `${Math.max(0, Math.min(100, Number(ownEnrollment.progress_percent ?? 0)))}%`}} /></div>
                    </div>
                  ) : null}
                </section>

                <section className="rounded-3xl border border-violet-200 bg-white p-6 shadow-sm lg:p-7">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider text-violet-700">{fr ? "Parcours de la formation" : "Training journey"}</p>
                      <h3 className="mt-1 text-2xl font-black text-slate-950">{fr ? "Jours de formation" : "Training days"}</h3>
                      <p className="mt-2 text-sm text-slate-600">{fr ? "Choisis un jour pour gérer ses supports et son quiz. Les jours existent indépendamment des fichiers téléversés." : "Choose a day to manage its resources and quiz. Days exist independently from uploaded files."}</p>
                    </div>
                    {canManage ? (
                      <details className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                        <summary className="cursor-pointer list-none text-sm font-black text-violet-900">+ {fr ? "Ajouter un jour" : "Add a day"}</summary>
                        <form action={addStaffTrainingModuleAction} className="mt-4 grid gap-3 sm:grid-cols-2 lg:min-w-[620px]">
                          <input type="hidden" name="courseId" value={selectedCourse.id} />
                          <input type="hidden" name="month" value={selectedCycle?.training_month.slice(0, 7) ?? ""} />
                          <label className="text-xs font-black text-violet-950">{fr ? "Libellé" : "Label"}<input name="moduleLabel" required placeholder={fr ? "Ex. Jour 4" : "Ex. Day 4"} className={fieldClass()} /></label>
                          <label className="text-xs font-black text-violet-950">{fr ? "Date" : "Date"}<input name="moduleDate" type="date" className={fieldClass()} /></label>
                          <label className="text-xs font-black text-violet-950 sm:col-span-2">{fr ? "Titre du jour" : "Day title"}<input name="title" required placeholder={fr ? "Objectif principal de la journée" : "Main objective for the day"} className={fieldClass()} /></label>
                          <button className="sm:col-span-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white hover:bg-violet-600">{fr ? "Créer le jour" : "Create day"}</button>
                        </form>
                      </details>
                    ) : null}
                  </div>

                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    {trainingModules.length ? trainingModules.map((module, index) => {
                      const active = module.module_label === selectedModuleLabel;
                      const resourceCount = selectedResources.filter((resource) => resource.module_label === module.module_label).length;
                      const quizCount = moduleQuizzes.filter((quiz) => quiz.module_label === module.module_label).length;
                      return (
                        <Link key={module.id} href={`${contextBase}&module=${encodeURIComponent(module.module_label)}`} className={`rounded-2xl border p-5 transition ${active ? "border-violet-400 bg-violet-50 ring-2 ring-violet-100" : "border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-violet-50/50"}`}>
                          <div className="flex items-start justify-between gap-3"><span className="rounded-xl bg-violet-700 px-3 py-2 text-sm font-black text-white">{String(index + 1).padStart(2, "0")}</span>{module.module_date ? <span className="text-xs font-bold text-slate-500">{module.module_date}</span> : null}</div>
                          <p className="mt-4 text-xs font-black uppercase tracking-wider text-violet-700">{module.module_label}</p>
                          <h4 className="mt-1 text-base font-black leading-6 text-slate-950">{module.title || module.module_label}</h4>
                          <p className="mt-3 text-xs text-slate-500">{resourceCount} {fr ? "support(s)" : "resource(s)"} · {quizCount} quiz</p>
                          <p className="mt-3 text-xs font-black text-violet-700">{active ? (fr ? "Jour sélectionné" : "Selected day") : (fr ? "Gérer ce jour →" : "Manage this day →")}</p>
                        </Link>
                      );
                    }) : moduleLabels.length ? moduleLabels.map((label) => (
                      <Link key={label} href={`${contextBase}&module=${encodeURIComponent(label)}`} className={`rounded-2xl border p-5 ${label === selectedModuleLabel ? "border-violet-400 bg-violet-50" : "border-slate-200 bg-slate-50"}`}>
                        <p className="font-black text-slate-950">{label}</p>
                      </Link>
                    )) : <p className="md:col-span-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">{fr ? "Aucun jour n'est encore configuré." : "No training day has been configured yet."}</p>}
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:p-7">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-amber-700">{fr ? "Évaluations par jour / module" : "Day / module assessments"}</p>
                    <h3 className="mt-1 text-2xl font-black text-slate-950">{fr ? "Quiz de formation" : "Training quizzes"}</h3>
                    <p className="mt-2 text-sm text-slate-600">{fr ? "Chaque évaluation reste rattachée à son jour de formation et ne remplace pas le quiz final Academy." : "Each assessment stays attached to its training day and does not replace the final Academy quiz."}</p>
                    {canManage && selectedModuleLabel && selectedCourse ? <div className="mt-4 flex flex-wrap gap-2"><Link href={`/dashboard/academy/staff-training/quiz-builder?course=${selectedCourse.id}&module=${encodeURIComponent(selectedModuleLabel)}${selectedCycle ? `&month=${selectedCycle.training_month.slice(0, 7)}` : ""}`} className="rounded-xl bg-violet-700 px-4 py-2.5 text-xs font-black text-white hover:bg-violet-800">{visibleModuleQuizzes.length ? (fr ? `Modifier le quiz de ${selectedModuleLabel}` : `Edit ${selectedModuleLabel} quiz`) : (fr ? `+ Créer le quiz de ${selectedModuleLabel}` : `+ Create ${selectedModuleLabel} quiz`)}</Link></div> : null}
                    {canViewResults ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div><p className="font-black text-emerald-950">{fr ? "Suivi consolidé du staff" : "Consolidated staff tracking"}</p><p className="mt-1 text-xs leading-5 text-emerald-800">{membership.role === "manager" ? (fr ? "Tu vois uniquement les résultats des collaborateurs de ton périmètre." : "You only see results for employees in your management scope.") : (fr ? "Consulte les résultats de tous les participants, les tentatives et les personnes qui n'ont pas encore commencé." : "Review all participant results, attempts, and people who have not started yet.")}</p></div><Link href={`/dashboard/academy/staff-training/results?course=${selectedCourse.id}`} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-600">{fr ? "Voir tous les résultats" : "View all results"}</Link></div> : null}
                  </div>

                  {moduleQuizSetupError ? (
                    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      <p className="font-black">{fr ? "Module d'évaluation à installer" : "Assessment module setup required"}</p>
                      <p className="mt-1">{fr ? "Exécute la dernière migration Staff Training (V4.9.8) avant d'utiliser le contrôle d'ouverture des quiz." : "Run the latest Staff Training migration (V4.9.8) before using quiz release controls."}</p>
                    </div>
                  ) : visibleModuleQuizzes.length ? (
                    <div className="mt-6 space-y-4">
                      {visibleModuleQuizzes.map((quiz) => {
                        const questions = moduleQuizQuestions.filter((question) => question.quiz_id === quiz.id);
                        const attempts = ownModuleQuizAttempts.filter((attempt) => attempt.quiz_id === quiz.id).sort((a, b) => a.attempt_no - b.attempt_no);
                        const passedAttempt = attempts.find((attempt) => attempt.passed);
                        const bestScore = attempts.length ? Math.max(...attempts.map((attempt) => Number(attempt.score) || 0)) : null;
                        const attemptsRemaining = Math.max(0, Number(quiz.max_attempts) - attempts.length);
                        const availability = quizAvailabilityState(quiz);
                        const canTake = Boolean(ownEnrollment) && availability.open && !passedAttempt && attemptsRemaining > 0;
                        return (
                          <details key={quiz.id} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5" open={!canManage && canTake}>
                            <summary className="cursor-pointer list-none">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-800">{quiz.module_label}</span>
                                    {quiz.is_required ? <span className="rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase text-red-800">{fr ? "Obligatoire" : "Required"}</span> : null}
                                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${availability.open ? "bg-emerald-100 text-emerald-800" : availability.reason === "closed" ? "bg-slate-200 text-slate-700" : "bg-violet-100 text-violet-800"}`}>
                                      {availability.open ? (fr ? "Ouvert" : "Open") : availability.reason === "closed" ? (fr ? "Fermé" : "Closed") : (fr ? "Verrouillé" : "Locked")}
                                    </span>
                                  </div>
                                  <h4 className="mt-2 text-lg font-black text-slate-950">{quiz.title}</h4>
                                  <p className="mt-1 text-xs text-slate-600">{questions.length} {fr ? "question(s)" : "question(s)"} · {Number(quiz.passing_score)}% {fr ? "requis" : "required"} · {quiz.max_attempts} {fr ? "tentative(s) max" : "max attempt(s)"}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {passedAttempt ? <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-black text-emerald-800">{fr ? `Réussi · ${Number(passedAttempt.score)}%` : `Passed · ${Number(passedAttempt.score)}%`}</span> : null}
                                  {!passedAttempt && bestScore !== null ? <span className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-700">{fr ? `Meilleur score ${bestScore}%` : `Best score ${bestScore}%`}</span> : null}
                                  {!canManage && !passedAttempt ? <span className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-700">{attemptsRemaining} {fr ? "tentative(s) restante(s)" : "attempt(s) left"}</span> : null}
                                </div>
                              </div>
                            </summary>

                            {canManage ? (
                              <div className="mt-4 space-y-4 rounded-xl bg-white p-4 text-sm text-slate-600">
                                <div>
                                  <p className="font-black text-slate-900">{fr ? "Contrôle d'ouverture" : "Release control"}</p>
                                  <p className="mt-1">{availability.open
                                    ? (quiz.available_until ? (fr ? `Ouvert temporairement jusqu'au ${formatUtc(quiz.available_until, fr)}.` : `Temporarily open until ${formatUtc(quiz.available_until, fr)}.`) : (fr ? "Ouvert sans fermeture automatique." : "Open with no automatic closing."))
                                    : availability.reason === "closed"
                                      ? (fr ? "La fenêtre d'accès est terminée. Tu peux rouvrir le quiz." : "The access window has ended. You can reopen the quiz.")
                                      : (fr ? "Les participants voient le quiz verrouillé et ne peuvent pas accéder aux questions." : "Participants see the quiz as locked and cannot access the questions.")}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Link href={`/dashboard/academy/staff-training/quiz-preview?course=${selectedCourse.id}&quiz=${quiz.id}${selectedCycle ? `&month=${selectedCycle.training_month.slice(0, 7)}` : ""}`} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-800 hover:bg-violet-100">{fr ? "Prévisualiser" : "Preview"}</Link>
                                  {moduleQuizAttempts.filter((attempt) => attempt.quiz_id === quiz.id).length === 0 ? <Link href={`/dashboard/academy/staff-training/quiz-builder?course=${selectedCourse.id}&module=${encodeURIComponent(quiz.module_label)}&quiz=${quiz.id}${selectedCycle ? `&month=${selectedCycle.training_month.slice(0, 7)}` : ""}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50">{fr ? "Modifier le quiz" : "Edit quiz"}</Link> : <span className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-black text-slate-500">{fr ? "Questions protégées après tentative" : "Questions locked after attempt"}</span>}
                                  {[
                                    ["open", fr ? "Ouvrir maintenant" : "Open now"],
                                    ["open_6h", fr ? "Ouvrir 6 h" : "Open 6h"],
                                    ["open_12h", fr ? "Ouvrir 12 h" : "Open 12h"],
                                    ["open_24h", fr ? "Ouvrir 24 h" : "Open 24h"],
                                    ["open_48h", fr ? "Ouvrir 48 h" : "Open 48h"],
                                  ].map(([mode, label]) => (
                                    <form action={setStaffTrainingModuleQuizAvailabilityAction} key={mode}>
                                      <input type="hidden" name="courseId" value={selectedCourse.id} />
                                      <input type="hidden" name="quizId" value={quiz.id} />
                                      <input type="hidden" name="mode" value={mode} />
                                      <button className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100">{label}</button>
                                    </form>
                                  ))}
                                  <form action={setStaffTrainingModuleQuizAvailabilityAction}>
                                    <input type="hidden" name="courseId" value={selectedCourse.id} />
                                    <input type="hidden" name="quizId" value={quiz.id} />
                                    <input type="hidden" name="mode" value="lock" />
                                    <button className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-200">{fr ? "Verrouiller" : "Lock"}</button>
                                  </form>
                                </div>
                                <p className="text-xs text-slate-500">{fr ? "Conseil : à la fin de chaque journée de formation, ouvre uniquement le quiz du jour pendant 24 h." : "Tip: at the end of each training day, open only that day's quiz for 24 hours."}</p>
                              </div>
                            ) : passedAttempt ? (
                              <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-900">{fr ? "Évaluation validée. Aucune nouvelle tentative n'est nécessaire." : "Assessment passed. No further attempt is required."}</div>
                            ) : !ownEnrollment ? (
                              <div className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600">{fr ? "Cette évaluation est réservée aux participants affectés à la formation." : "This assessment is reserved for assigned participants."}</div>
                            ) : !availability.open ? (
                              <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm font-bold text-violet-900">
                                {availability.reason === "closed"
                                  ? (fr ? "La période d'accès à ce quiz est terminée. Le formateur peut le rouvrir si nécessaire." : "The access window for this quiz has ended. The trainer can reopen it if needed.")
                                  : (fr ? "Quiz verrouillé. Il sera ouvert par le formateur à la fin de la journée de formation." : "Quiz locked. The trainer will open it at the end of the training day.")}
                              </div>
                            ) : attemptsRemaining <= 0 ? (
                              <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800">{fr ? "Nombre maximum de tentatives atteint." : "Maximum number of attempts reached."}</div>
                            ) : (
                              <form action={submitStaffTrainingModuleQuizAction} className="mt-5 space-y-5">
                                <input type="hidden" name="courseId" value={selectedCourse.id} />
                                <input type="hidden" name="quizId" value={quiz.id} />
                                {questions.map((question, questionIndex) => {
                                  const options = normalizeOptions(question.options);
                                  return (
                                    <fieldset key={question.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                                      <legend className="px-1 text-sm font-black text-slate-950">{questionIndex + 1}. {question.question_text}</legend>
                                      <div className="mt-3 grid gap-2">
                                        {options.map((option, optionIndex) => (
                                          <label key={`${question.id}-${optionIndex}`} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700 hover:border-violet-300 hover:bg-violet-50">
                                            <input type="radio" name={`staff_quiz_${question.id}`} value={optionIndex} required className="mt-0.5" />
                                            <span>{option}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </fieldset>
                                  );
                                })}
                                <button className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800">{fr ? "Soumettre l'évaluation" : "Submit assessment"}</button>
                              </form>
                            )}
                          </details>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">{selectedModuleLabel ? (fr ? `Aucun quiz configuré pour ${selectedModuleLabel}.` : `No quiz configured for ${selectedModuleLabel}.`) : (fr ? "Aucune évaluation par jour/module n'est encore configurée." : "No day/module assessment has been configured yet.")}</div>
                  )}
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:p-7">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-violet-700">{fr ? "Bibliothèque de formation" : "Training library"}</p><h3 className="mt-1 text-2xl font-black text-slate-950">{fr ? "Documents & ressources" : "Documents & resources"}</h3><p className="mt-2 text-sm text-slate-600">{fr ? "Télécharge les présentations, worksheets, guides et modèles de la formation." : "Download presentations, worksheets, guides and templates for this training."}</p></div><Link href={`/dashboard/academy?course=${selectedCourse.id}#academy-course-detail`} className="text-sm font-black text-violet-700 underline">{fr ? "Ouvrir le quiz final & progression" : "Open final quiz & progress"}</Link></div>

                  <div className="mt-6 space-y-6">
                    {visibleGroupedResources.size ? [...visibleGroupedResources.entries()].map(([moduleLabel, resources]) => (
                      <div key={moduleLabel}>
                        <div className="mb-3 flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">{moduleLabel}</p><div className="h-px flex-1 bg-slate-200" /></div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {resources.map((resource) => (
                            <article key={resource.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                              <div className="flex gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-xl shadow-sm">{resourceIcon(resource.resource_type)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-black text-slate-950">{resource.title}</h4>{!resource.is_published ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">BROUILLON</span> : null}</div><p className="mt-1 text-xs text-slate-500">{resource.file_name} · {formatBytes(resource.size_bytes)}</p>{resource.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{resource.description}</p> : null}</div></div>
                              <div className="mt-4 flex flex-wrap gap-2">
                                {(resource.is_published || canManage) ? <a href={`/api/academy/staff-training/resources/${resource.id}`} className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">{fr ? "Télécharger" : "Download"}</a> : null}
                                {canManage ? <form action={toggleStaffTrainingResourceAction}><input type="hidden" name="courseId" value={selectedCourse.id} /><input type="hidden" name="resourceId" value={resource.id} /><input type="hidden" name="publish" value={resource.is_published ? "false" : "true"} /><button className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-black text-slate-800">{resource.is_published ? (fr ? "Retirer" : "Unpublish") : (fr ? "Publier" : "Publish")}</button></form> : null}
                                {canManage ? <form action={deleteStaffTrainingResourceAction}><input type="hidden" name="courseId" value={selectedCourse.id} /><input type="hidden" name="resourceId" value={resource.id} /><button className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-black text-red-700">{fr ? "Supprimer" : "Delete"}</button></form> : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    )) : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><p className="font-black text-slate-700">{selectedModuleLabel ? (fr ? `Aucun document pour ${selectedModuleLabel}.` : `No resources for ${selectedModuleLabel}.`) : (fr ? "Aucun document publié pour le moment." : "No published resources yet.")}</p><p className="mt-2 text-sm text-slate-500">{fr ? "Les supports apparaîtront ici dès qu'ils seront ajoutés." : "Resources will appear here once they are added."}</p></div>}
                  </div>
                </section>

                {canManage ? (
                  <section className="rounded-3xl border border-violet-200 bg-violet-50 p-6 shadow-sm lg:p-7">
                    <p className="text-xs font-black uppercase tracking-wider text-violet-700">Administration</p>
                    <h3 className="mt-1 text-2xl font-black text-violet-950">{fr ? "Ajouter un support de formation" : "Add a training resource"}</h3>
                    <p className="mt-2 text-sm leading-6 text-violet-800">{fr ? "Les fichiers sont stockés dans l'espace privé Super Leader. Seuls les participants de la formation et l'administration autorisée peuvent les télécharger." : "Files are stored in Super Leader private storage. Only enrolled participants and authorized administrators can download them."}</p>
                    {selectedModuleLabel ? <div className="mt-4 rounded-2xl border border-violet-200 bg-white p-4"><p className="text-xs font-black uppercase tracking-wider text-violet-700">{fr ? "Jour sélectionné" : "Selected day"}</p><p className="mt-1 font-black text-violet-950">{selectedModuleLabel}{selectedModule?.title ? ` — ${selectedModule.title}` : ""}</p><p className="mt-1 text-xs text-violet-700">{fr ? "Le formulaire ci-dessous est préconfiguré sur ce jour. Tu peux changer de jour dans la liste sans retaper son nom." : "The form below is preconfigured for this day. You can switch days from the list without retyping its name."}</p></div> : null}
                    <form action={addStaffTrainingResourceAction} className="mt-6 space-y-4">
                      <input type="hidden" name="courseId" value={selectedCourse.id} />
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="text-sm font-black text-violet-950">{fr ? "Jour / module" : "Day / module"}{trainingModules.length ? <select name="moduleLabel" required defaultValue={selectedModuleLabel} className={fieldClass()}>{trainingModules.map((module) => <option key={module.id} value={module.module_label}>{module.module_label} — {module.title}</option>)}</select> : <input name="moduleLabel" required defaultValue={selectedModuleLabel} placeholder={fr ? "Ex. Jour 1" : "Ex. Day 1"} className={fieldClass()} />}</label>
                        <label className="text-sm font-black text-violet-950 sm:col-span-2">{fr ? "Titre du document" : "Resource title"}<input name="title" required placeholder={fr ? "Ex. Manuel participant" : "Ex. Participant manual"} className={fieldClass()} /></label>
                        <label className="text-sm font-black text-violet-950">{fr ? "Type" : "Type"}<select name="resourceType" defaultValue="document" className={fieldClass()}><option value="document">Document</option><option value="presentation">PowerPoint / Présentation</option><option value="worksheet">Worksheet</option><option value="guide">Guide</option><option value="template">Modèle</option><option value="spreadsheet">Excel / Tableur</option><option value="other">Autre</option></select></label>
                      </div>
                      <label className="block text-sm font-black text-violet-950">{fr ? "Description" : "Description"}<textarea name="description" rows={3} className={fieldClass()} placeholder={fr ? "Ce que le collaborateur trouvera dans ce document..." : "What the employee will find in this resource..."} /></label>
                      <StaffTrainingResourceUpload prefix="resource" label={fr ? "Fichier" : "File"} help={fr ? "PDF, Word, PowerPoint, Excel, CSV ou image. 30 Mo maximum." : "PDF, Word, PowerPoint, Excel, CSV or image. 30 MB maximum."} uploadingLabel={fr ? "Téléversement sécurisé..." : "Secure upload..."} uploadedLabel={fr ? "Fichier prêt" : "File ready"} removeLabel={fr ? "Retirer" : "Remove"} errorLabel={fr ? "Fichier non accepté ou trop volumineux." : "Unsupported or oversized file."} />
                      <div className="flex flex-wrap items-center gap-4"><label className="text-sm font-black text-violet-950">{fr ? "Ordre" : "Order"}<input name="sortOrder" type="number" min="0" max="9999" defaultValue="0" className="ml-3 w-24 rounded-xl border border-violet-200 bg-white px-3 py-2" /></label><label className="flex items-center gap-2 text-sm font-black text-violet-950"><input type="checkbox" name="publishNow" defaultChecked />{fr ? "Publier immédiatement" : "Publish immediately"}</label><button className="ml-auto rounded-xl bg-violet-700 px-5 py-3 text-sm font-black text-white hover:bg-violet-600">{fr ? "Ajouter le document" : "Add resource"}</button></div>
                    </form>
                  </section>
                ) : null}

                {canManage ? (
                  <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-xl font-black text-slate-950">{fr ? "Gouvernance de la formation" : "Training governance"}</h3><p className="mt-1 text-sm text-slate-500">{selectedEnrollments.length} {fr ? "participant(s) affecté(s)" : "assigned participant(s)"}</p></div><div className="flex flex-wrap gap-2"><form action={assignAllActiveStaffTrainingAction}><input type="hidden" name="courseId" value={selectedCourse.id} /><button className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-amber-300">{fr ? "Affecter tout le staff actif" : "Assign all active staff"}</button></form><form action={deactivateStaffTrainingCourseAction}><input type="hidden" name="courseId" value={selectedCourse.id} /><button className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700">{fr ? "Retirer du Centre staff" : "Remove from staff center"}</button></form></div></div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-black uppercase text-emerald-700">{fr ? "Terminés" : "Completed"}</p><p className="mt-1 text-2xl font-black text-emerald-950">{completedCount}</p></div><div className="rounded-2xl bg-violet-50 p-4"><p className="text-xs font-black uppercase text-violet-700">{fr ? "En cours" : "In progress"}</p><p className="mt-1 text-2xl font-black text-violet-950">{inProgressCount}</p></div><div className="rounded-2xl bg-amber-50 p-4"><p className="text-xs font-black uppercase text-amber-700">{fr ? "Évaluations ouvertes" : "Open assessments"}</p><p className="mt-1 text-2xl font-black text-amber-950">{quizPendingCount}</p></div></div>
                  </section>
                ) : null}
              </>
            ) : (
              <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm"><p className="text-2xl font-black text-slate-950">{fr ? "Le Centre de formation du personnel est prêt." : "The Staff Training Center is ready."}</p><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">{canManage ? (fr ? "Ajoute une formation Academy existante depuis le panneau de gauche, puis téléverse les supports pour les participants." : "Add an existing Academy course from the left panel, then upload resources for participants.") : (fr ? "Aucune formation du staff ne t'est encore affectée." : "No staff training has been assigned to you yet.")}</p></section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
