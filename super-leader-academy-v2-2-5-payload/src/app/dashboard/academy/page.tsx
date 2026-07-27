import Link from "next/link";
import {redirect} from "next/navigation";
import {
  addAcademyQuestionAction,
  archiveAcademyCourseAction,
  archiveAcademyScheduleAction,
  cancelAcademySessionAction,
  createAcademyScheduleAction,
  assignAcademyCourseAction,
  deleteAcademyQuestionAction,
  exemptAcademyEnrollmentAction,
  markAcademySessionAttendanceAction,
  publishAcademyCourseAction,
  repairAcademyCourseSessionsAction,
  selfEnrollAcademyCourseAction,
  startAcademyCourseAction,
  submitAcademyQuizAction,
  updateAcademyCourseAction,
  updateAcademyScheduleAction,
  restoreAcademyScheduleAction,
} from "@/app/actions/academy";
import {AcademyCourseWizard} from "@/components/academy-course-wizard";
import {ConfirmSubmitButton} from "@/components/confirm-submit-button";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Props = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type Membership = {organization_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type CourseRow = {
  id: string;
  title: string;
  description: string;
  category: string;
  training_month: string;
  deadline: string;
  duration_minutes: number;
  is_required: boolean;
  passing_score: number | string;
  max_attempts: number;
  certificate_enabled: boolean;
  attendance_required_percent: number | string;
  resource_url: string | null;
  status: string;
  created_at: string;
};
type EnrollmentRow = {
  id: string;
  course_id: string;
  user_id: string;
  status: string;
  progress_percent: number | string;
  attempts_count: number;
  best_score: number | string | null;
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  exempted_reason: string | null;
  attendance_percent: number | string;
  sessions_expected: number;
  sessions_attended: number;
  quiz_passed_at: string | null;
};
type QuestionRow = {
  id: string;
  course_id: string;
  question_text: string;
  options: unknown;
  correct_option: number;
  points: number | string;
  position: number;
};
type ScheduleRow = {
  id: string;
  course_id: string;
  label: string;
  schedule_type: string;
  starts_on: string;
  ends_on: string;
  local_start_time: string;
  duration_minutes: number;
  timezone: string;
  weekdays: number[];
  monthly_start_day: number | null;
  consecutive_days: number | null;
  zoom_join_url: string | null;
  is_active: boolean;
  revision: number;
  archived_at: string | null;
};
type SessionRow = {
  id: string;
  course_id: string;
  schedule_id: string | null;
  title: string;
  session_date: string;
  local_start_time: string;
  timezone: string;
  starts_at: string;
  ends_at: string;
  delivery_mode: string;
  zoom_join_url: string | null;
  status: string;
};
type SessionAttendanceRow = {
  id: string;
  session_id: string;
  enrollment_id: string;
  user_id: string;
  status: string;
  notes: string | null;
};
type CertificateRow = {
  id: string;
  enrollment_id: string;
  user_id: string;
  course_id: string;
  certificate_number: string;
  final_score: number | string | null;
  issued_at: string;
  status: string;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function fieldClass() {
  return "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {dateStyle: "medium"}).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatSessionTime(value: string) {
  return value.slice(0, 5);
}

function scheduleSummary(schedule: ScheduleRow, locale: string) {
  if (schedule.schedule_type === "weekly") {
    const labels = locale === "fr" ? ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return schedule.weekdays.map((day) => labels[day - 1]).filter(Boolean).join(", ");
  }
  if (schedule.schedule_type === "monthly_intensive") {
    return locale === "fr" ? `${schedule.consecutive_days ?? 3} jours dès le ${schedule.monthly_start_day ?? 1} de chaque mois` : `${schedule.consecutive_days ?? 3} days from day ${schedule.monthly_start_day ?? 1} each month`;
  }
  return locale === "fr" ? "Séance unique" : "Single session";
}

function statusTone(status: string) {
  if (status === "completed") return "bg-emerald-100 text-emerald-800";
  if (status === "failed" || status === "overdue") return "bg-red-100 text-red-800";
  if (status === "in_progress") return "bg-indigo-100 text-indigo-800";
  if (status === "exempted") return "bg-slate-200 text-slate-700";
  return "bg-amber-100 text-amber-800";
}

function optionsFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export default async function AcademyPage({searchParams}: Props) {
  const params = (await searchParams) ?? {};
  const selectedCourseId = first(params.course);
  const success = first(params.success);
  const errorMessage = first(params.error);
  const {t, locale} = await getI18n();
  const supabase = await createClient();
  const {data: auth, error: authError} = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");

  const isAcademyAdmin = ["owner", "admin", "hr"].includes(membership.role);
  const canAssign = ["owner", "admin", "hr", "manager"].includes(membership.role);
  const academySchemaCheck = await admin.from("academy_courses").select("id", {head: true, count: "exact"}).limit(1);
  const recurringSchemaCheck = academySchemaCheck.error ? academySchemaCheck : await admin.from("academy_sessions").select("id", {head: true, count: "exact"}).limit(1);
  const editingSchemaCheck = recurringSchemaCheck.error ? recurringSchemaCheck : await admin.from("academy_schedule_revisions").select("id", {head: true, count: "exact"}).limit(1);
  const schemaCheck = editingSchemaCheck;
  if (schemaCheck.error) {
    const missingSchema = ["42P01", "PGRST205", "42703"].includes(schemaCheck.error.code);
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-4xl">
          <Link href="/dashboard" className="font-bold text-indigo-700">← {t("common.backToDashboard")}</Link>
          <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-400">{t("academy.eyebrow")}</p>
            <h1 className="mt-2 text-4xl font-black">Super Leader Academy</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">{missingSchema ? t("academy.databaseSetupTitle") : t("academy.loadFailedTitle")}</h2>
            <p className="mt-3 leading-7 text-amber-900">{missingSchema ? t("academy.databaseSetupDescription") : schemaCheck.error.message}</p>
            {missingSchema ? <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">{academySchemaCheck.error ? "supabase/021_super_leader_academy_v1.sql" : recurringSchemaCheck.error ? "supabase/022_academy_recurring_sessions_v2_2_1.sql" : "supabase/023_academy_schedule_editing_v2_2_2.sql"}</code> : null}
          </section>
        </div>
      </main>
    );
  }
  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: auth.user.id,
    role: membership.role,
  });

  const [{data: organization}, profilesResult, coursesResult, enrollmentsResult, certificatesResult] = await Promise.all([
    admin.from("organizations").select("name").eq("id", membership.organization_id).maybeSingle<{name: string}>(),
    admin.from("profiles").select("id, full_name, email").in("id", visibleUserIds),
    admin.from("academy_courses").select("id, title, description, category, training_month, deadline, duration_minutes, is_required, passing_score, max_attempts, certificate_enabled, attendance_required_percent, resource_url, status, created_at").eq("organization_id", membership.organization_id).order("training_month", {ascending: false}).order("created_at", {ascending: false}),
    admin.from("academy_enrollments").select("id, course_id, user_id, status, progress_percent, attempts_count, best_score, assigned_at, started_at, completed_at, exempted_reason, attendance_percent, sessions_expected, sessions_attended, quiz_passed_at").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds),
    admin.from("academy_certificates").select("id, enrollment_id, user_id, course_id, certificate_number, final_score, issued_at, status").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds),
  ]);

  let courses = (coursesResult.data ?? []) as CourseRow[];
  if (!isAcademyAdmin) courses = courses.filter((course) => course.status === "published");
  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const enrollments = (enrollmentsResult.data ?? []) as EnrollmentRow[];
  const certificates = (certificatesResult.data ?? []) as CertificateRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const certificateByEnrollment = new Map(certificates.map((certificate) => [certificate.enrollment_id, certificate]));
  const wizardParticipants = profiles.map((profile) => ({
    id: profile.id,
    label: profile.full_name || profile.email || profile.id,
  }));
  let wizardTeams: Array<{id: string; name: string; department: string; memberCount: number}> = [];
  if (isAcademyAdmin) {
    const {data: teamRows, error: teamError} = await admin
      .from("teams")
      .select("id, name, department")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .order("name");
    if (teamError) throw new Error(teamError.message);
    const teamIds = (teamRows ?? []).map((team) => String(team.id));
    const teamMemberRows = teamIds.length
      ? await admin.from("team_members").select("team_id").in("team_id", teamIds)
      : {data: [], error: null};
    if (teamMemberRows.error) throw new Error(teamMemberRows.error.message);
    const counts = new Map<string, number>();
    (teamMemberRows.data ?? []).forEach((row) => counts.set(String(row.team_id), (counts.get(String(row.team_id)) ?? 0) + 1));
    wizardTeams = (teamRows ?? []).map((team) => ({
      id: String(team.id),
      name: String(team.name),
      department: String(team.department ?? ""),
      memberCount: counts.get(String(team.id)) ?? 0,
    }));
  }
  const currentMonth = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? courses[0] ?? null;
  const {data: selectedQuestionsData} = selectedCourse
    ? await admin.from("academy_quiz_questions").select("id, course_id, question_text, options, correct_option, points, position").eq("organization_id", membership.organization_id).eq("course_id", selectedCourse.id).order("position")
    : {data: []};
  const selectedQuestions = (selectedQuestionsData ?? []) as QuestionRow[];
  const selectedEnrollments = selectedCourse ? enrollments.filter((row) => row.course_id === selectedCourse.id) : [];
  const enrollmentIds = selectedEnrollments.map((row) => row.id);
  const [schedulesResult, sessionsResult, attendanceResult] = selectedCourse
    ? await Promise.all([
        admin.from("academy_course_schedules").select("id, course_id, label, schedule_type, starts_on, ends_on, local_start_time, duration_minutes, timezone, weekdays, monthly_start_day, consecutive_days, zoom_join_url, is_active, revision, archived_at").eq("organization_id", membership.organization_id).eq("course_id", selectedCourse.id).order("starts_on"),
        admin.from("academy_sessions").select("id, course_id, schedule_id, title, session_date, local_start_time, timezone, starts_at, ends_at, delivery_mode, zoom_join_url, status").eq("organization_id", membership.organization_id).eq("course_id", selectedCourse.id).order("starts_at"),
        enrollmentIds.length ? admin.from("academy_session_attendance").select("id, session_id, enrollment_id, user_id, status, notes").eq("organization_id", membership.organization_id).in("enrollment_id", enrollmentIds) : Promise.resolve({data: [], error: null}),
      ])
    : [{data: []}, {data: []}, {data: []}];
  const selectedSchedules = (schedulesResult.data ?? []) as ScheduleRow[];
  const selectedSessions = (sessionsResult.data ?? []) as SessionRow[];
  const selectedAttendance = (attendanceResult.data ?? []) as SessionAttendanceRow[];
  const attendanceBySessionAndEnrollment = new Map(selectedAttendance.map((row) => [`${row.session_id}:${row.enrollment_id}`, row]));
  const ownEnrollment = selectedCourse ? selectedEnrollments.find((row) => row.user_id === auth.user.id) ?? null : null;
  const visibleSessions = canAssign || ownEnrollment ? selectedSessions : [];
  const activeSelectedSessions = selectedSessions.filter((session) => session.status !== "cancelled");
  const nowMs = Date.now();
  const finishedSelectedSessions = activeSelectedSessions.filter((session) =>
    session.status === "completed" || new Date(session.ends_at).getTime() <= nowMs,
  );
  const pendingSelectedSessions = activeSelectedSessions.filter((session) =>
    session.status !== "completed" && new Date(session.ends_at).getTime() > nowMs,
  );
  const nextPendingSession = [...pendingSelectedSessions].sort(
    (left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime(),
  )[0] ?? null;
  const ownAttendanceRows = ownEnrollment
    ? finishedSelectedSessions.map((session) => attendanceBySessionAndEnrollment.get(`${session.id}:${ownEnrollment.id}`)).filter(Boolean) as SessionAttendanceRow[]
    : [];
  const ownExcusedSessions = ownAttendanceRows.filter((row) => row.status === "excused").length;
  const ownExpectedSessions = Math.max(0, finishedSelectedSessions.length - ownExcusedSessions);
  const ownAttendedSessions = ownAttendanceRows.filter((row) => ["present", "late"].includes(row.status)).length;
  const ownAttendancePercent = ownExpectedSessions
    ? Math.round((ownAttendedSessions / ownExpectedSessions) * 10000) / 100
    : finishedSelectedSessions.length ? 100 : 0;
  const attendanceRequired = Number(selectedCourse?.attendance_required_percent ?? 0);
  const quizHasSessions = attendanceRequired <= 0 || activeSelectedSessions.length > 0;
  const quizSessionsFinished = attendanceRequired <= 0 || (activeSelectedSessions.length > 0 && pendingSelectedSessions.length === 0);
  const quizAttendanceEligible = attendanceRequired <= 0 || ownAttendancePercent >= attendanceRequired;
  const quizUnlocked = quizHasSessions && quizSessionsFinished && quizAttendanceEligible;
  const ownCertificate = ownEnrollment ? certificateByEnrollment.get(ownEnrollment.id) ?? null : null;
  const assignedUserIds = new Set(selectedEnrollments.map((row) => row.user_id));
  const assignableProfiles = profiles.filter((profile) => !assignedUserIds.has(profile.id));

  const visibleCourseIds = new Set(courses.filter((course) => course.status === "published").map((course) => course.id));
  const ownEnrollmentByCourse = new Map<string, EnrollmentRow>();
  for (const enrollment of enrollments.filter((row) => row.user_id === auth.user.id && visibleCourseIds.has(row.course_id))) {
    const existing = ownEnrollmentByCourse.get(enrollment.course_id);
    if (!existing || new Date(enrollment.assigned_at).getTime() > new Date(existing.assigned_at).getTime()) ownEnrollmentByCourse.set(enrollment.course_id, enrollment);
  }
  const ownEnrollments = [...ownEnrollmentByCourse.values()];
  const ownCompleted = ownEnrollments.filter((row) => row.status === "completed").length;
  const ownPending = ownEnrollments.filter((row) => !["completed", "exempted"].includes(row.status)).length;
  const ownCertificates = certificates.filter((row) => row.user_id === auth.user.id && row.status === "active").length;
  const monthlyRequired = courses.filter((course) => course.status === "published" && course.training_month.startsWith(currentMonth) && course.is_required).length;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <Link href="/dashboard" className="font-bold text-indigo-700">← {t("common.backToDashboard")}</Link>

        <header className="mt-5 rounded-3xl bg-slate-950 p-7 text-white">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-400">{t("academy.eyebrow")}</p>
          <h1 className="mt-2 text-4xl font-black">Super Leader Academy</h1>
          <p className="mt-2 max-w-3xl text-slate-300">{t("academy.subtitle")}</p>
          <p className="mt-4 text-sm font-bold text-amber-300">{organization?.name ?? "Super Leader"}</p>
        </header>

        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><p className="text-sm font-bold text-indigo-700">{t("academy.metrics.assigned")}</p><p className="mt-2 text-3xl font-black">{ownEnrollments.length}</p></article>
          <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-sm font-bold text-emerald-700">{t("academy.metrics.completed")}</p><p className="mt-2 text-3xl font-black">{ownCompleted}</p></article>
          <article className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="text-sm font-bold text-amber-700">{t("academy.metrics.pending")}</p><p className="mt-2 text-3xl font-black">{ownPending}</p></article>
          <article className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><p className="text-sm font-bold text-violet-700">{t("academy.metrics.certificates")}</p><p className="mt-2 text-3xl font-black">{ownCertificates}</p></article>
        </section>

        {isAcademyAdmin ? (
          <section className="mt-6">
            <AcademyCourseWizard
              locale={locale}
              currentMonth={currentMonth}
              participants={wizardParticipants}
              teams={wizardTeams}
            />
          </section>
        ) : null}

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
          <div className="space-y-6">
            {!isAcademyAdmin ? (
              <article className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6">
                <h2 className="text-2xl font-black text-indigo-950">{t("academy.monthlyCommitment")}</h2>
                <p className="mt-2 text-indigo-800">{t("academy.monthlyCommitmentHelp", {count: monthlyRequired})}</p>
              </article>
            ) : null}

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-black">{isAcademyAdmin ? t("academy.courseCatalogue") : t("academy.myCourses")}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black">{courses.length}</span></div>
              <div className="mt-5 space-y-3">
                {courses.map((course) => {
                  const enrollment = ownEnrollments.find((row) => row.course_id === course.id);
                  const computedStatus = enrollment && course.deadline < today && !["completed", "exempted"].includes(enrollment.status) ? "overdue" : enrollment?.status;
                  return (
                    <Link key={course.id} href={`/dashboard/academy?course=${course.id}`} className={`block rounded-2xl border p-4 transition hover:border-indigo-400 ${selectedCourse?.id === course.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white"}`}>
                      <div className="flex items-start justify-between gap-3"><div><p className="font-black">{course.title}</p><p className="mt-1 text-xs text-slate-500">{formatDate(course.training_month, locale)} · {course.duration_minutes} min</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-black ${course.status === "published" ? "bg-emerald-100 text-emerald-800" : course.status === "draft" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>{t(`academy.statuses.${course.status}`)}</span></div>
                      <div className="mt-3 flex flex-wrap gap-2">{course.is_required ? <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700">{t("academy.required")}</span> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{t("academy.optional")}</span>}{computedStatus ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusTone(computedStatus)}`}>{t(`academy.enrollmentStatuses.${computedStatus}`)}</span> : null}</div>
                    </Link>
                  );
                })}
                {!courses.length ? <p className="rounded-2xl bg-slate-50 p-8 text-center text-slate-500">{t("academy.noCourses")}</p> : null}
              </div>
            </article>
          </div>

          <div className="space-y-6">
            {selectedCourse ? (
              <>
                <article className="rounded-3xl bg-slate-950 p-7 text-white shadow-sm">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{selectedCourse.category.replaceAll("_", " ")}</p><h2 className="mt-2 text-3xl font-black">{selectedCourse.title}</h2><p className="mt-3 max-w-3xl text-slate-300">{selectedCourse.description || t("academy.noDescription")}</p></div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black ${selectedCourse.is_required ? "bg-red-500 text-white" : "bg-white/15 text-white"}`}>{selectedCourse.is_required ? t("academy.required") : t("academy.optional")}</span><span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black">{selectedCourse.duration_minutes} min</span></div></div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs uppercase text-slate-400">{t("academy.fields.deadline")}</p><p className="mt-1 font-black">{formatDate(selectedCourse.deadline, locale)}</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs uppercase text-slate-400">{t("academy.fields.passingScore")}</p><p className="mt-1 font-black">{Number(selectedCourse.passing_score)} %</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs uppercase text-slate-400">{t("academy.fields.attendanceRequired")}</p><p className="mt-1 font-black">{Number(selectedCourse.attendance_required_percent)} %</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs uppercase text-slate-400">{t("academy.questions")}</p><p className="mt-1 font-black">{selectedQuestions.length}</p></div></div>
                </article>

                {isAcademyAdmin ? (
                  <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-2xl font-black">{t("academy.configureCourse")}</h3>
                    <form action={updateAcademyCourseAction} className="mt-5 space-y-4">
                      <input type="hidden" name="courseId" value={selectedCourse.id} />
                      <label className="block text-sm font-black">{t("academy.fields.title")}<input name="title" defaultValue={selectedCourse.title} required className={fieldClass()} /></label>
                      <label className="block text-sm font-black">{t("academy.fields.description")}<textarea name="description" rows={4} defaultValue={selectedCourse.description} className={fieldClass()} /></label>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <label className="block text-sm font-black">{t("academy.fields.month")}<input name="trainingMonth" type="month" defaultValue={selectedCourse.training_month.slice(0, 7)} required className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.fields.deadline")}<input name="deadline" type="date" defaultValue={selectedCourse.deadline} required className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.fields.category")}<input name="category" defaultValue={selectedCourse.category} className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.fields.duration")}<input name="durationMinutes" type="number" min="1" defaultValue={selectedCourse.duration_minutes} required className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.fields.passingScore")}<input name="passingScore" type="number" min="0" max="100" defaultValue={Number(selectedCourse.passing_score)} required className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.fields.maxAttempts")}<input name="maxAttempts" type="number" min="1" max="20" defaultValue={selectedCourse.max_attempts} required className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.fields.attendanceRequired")}<input name="attendanceRequiredPercent" type="number" min="0" max="100" defaultValue={Number(selectedCourse.attendance_required_percent)} required className={fieldClass()} /></label>
                      </div>
                      <label className="block text-sm font-black">{t("academy.fields.resourceUrl")}<input name="resourceUrl" type="url" defaultValue={selectedCourse.resource_url ?? ""} className={fieldClass()} /></label>
                      <div className="grid gap-3 sm:grid-cols-2"><label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="isRequired" type="checkbox" defaultChecked={selectedCourse.is_required} />{t("academy.fields.required")}</label><label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="certificateEnabled" type="checkbox" defaultChecked={selectedCourse.certificate_enabled} />{t("academy.fields.certificate")}</label></div>
                      <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("academy.actions.save")}</button>
                    </form>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {selectedCourse.status === "draft" ? <form action={publishAcademyCourseAction}><input type="hidden" name="courseId" value={selectedCourse.id} /><button className="w-full rounded-xl bg-emerald-600 px-5 py-3 font-black text-white">{t("academy.actions.publish")}</button></form> : null}
                      {selectedCourse.status !== "archived" ? <form action={archiveAcademyCourseAction}><input type="hidden" name="courseId" value={selectedCourse.id} /><button className="w-full rounded-xl border border-red-300 bg-red-50 px-5 py-3 font-black text-red-700">{t("academy.actions.archive")}</button></form> : null}
                    </div>
                  </article>
                ) : null}

                {isAcademyAdmin ? (
                  <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-2xl font-black">{t("academy.recurring.title")}</h3>
                    <p className="mt-1 text-sm text-slate-500">{t("academy.recurring.help")}</p>
                    <form action={createAcademyScheduleAction} className="mt-5 space-y-4 rounded-2xl bg-slate-50 p-5">
                      <input type="hidden" name="courseId" value={selectedCourse.id} />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block text-sm font-black">{t("academy.recurring.label")}<input name="label" defaultValue={selectedCourse.title} required className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.recurring.type")}<select name="scheduleType" className={fieldClass()}><option value="weekly">{t("academy.recurring.weekly")}</option><option value="monthly_intensive">{t("academy.recurring.monthlyIntensive")}</option><option value="single">{t("academy.recurring.single")}</option></select></label>
                        <label className="block text-sm font-black">{t("academy.recurring.startsOn")}<input name="startsOn" type="date" defaultValue={selectedCourse.training_month} required className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.recurring.endsOn")}<input name="endsOn" type="date" defaultValue={selectedCourse.deadline} required className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.recurring.startTime")}<input name="startTime" type="time" defaultValue="18:00" required className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.recurring.duration")}<input name="sessionDurationMinutes" type="number" min="1" max="1440" defaultValue={selectedCourse.duration_minutes} required className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.recurring.timezone")}<select name="timezone" defaultValue="Europe/Dublin" className={fieldClass()}><option>Europe/Dublin</option><option>Europe/London</option><option>Africa/Douala</option><option>Africa/Lagos</option><option>America/Chicago</option><option>America/New_York</option><option>UTC</option></select></label>
                        <label className="block text-sm font-black">{t("academy.recurring.zoomUrl")}<input name="zoomJoinUrl" type="url" placeholder="https://zoom.us/j/..." className={fieldClass()} /></label>
                      </div>
                      <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                        <p className="text-sm font-black text-indigo-950">{t("academy.recurring.weekdays")}</p>
                        <div className="mt-3 flex flex-wrap gap-3">{[1,2,3,4,5,6,7].map((day) => <label key={day} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold"><input type="checkbox" name="weekdays" value={day} defaultChecked={[1,5].includes(day)} />{t(`academy.weekdays.${day}`)}</label>)}</div>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block text-sm font-black">{t("academy.recurring.monthlyStartDay")}<input name="monthlyStartDay" type="number" min="1" max="28" defaultValue="1" className={fieldClass()} /></label>
                        <label className="block text-sm font-black">{t("academy.recurring.consecutiveDays")}<input name="consecutiveDays" type="number" min="1" max="14" defaultValue="3" className={fieldClass()} /></label>
                      </div>
                      <p className="text-xs leading-5 text-slate-500">{t("academy.recurring.formHelp")}</p>
                      <button className="w-full rounded-xl bg-violet-700 px-5 py-3 font-black text-white">{t("academy.actions.generateSessions")}</button>
                    </form>
                    <div className="mt-5 space-y-3">
                      {selectedSchedules.map((schedule) => (
                        <details key={schedule.id} className={`rounded-2xl border p-4 ${schedule.is_active ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-80"}`}>
                          <summary className="cursor-pointer list-none">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-black">{schedule.label}</p>
                                  <span className={`rounded-full px-3 py-1 text-xs font-black ${schedule.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                                    {schedule.is_active ? t("academy.recurring.active") : t("academy.recurring.archived")}
                                  </span>
                                  <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">
                                    {t(`academy.recurring.${schedule.schedule_type === "monthly_intensive" ? "monthlyIntensive" : schedule.schedule_type}`)}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm text-slate-600">{scheduleSummary(schedule, locale)} · {formatSessionTime(schedule.local_start_time)} · {schedule.duration_minutes} min</p>
                                <p className="mt-1 text-xs text-slate-500">{formatDate(schedule.starts_on, locale)} → {formatDate(schedule.ends_on, locale)} · {schedule.timezone} · {t("academy.recurring.revision", {revision: schedule.revision})}</p>
                              </div>
                              <span className="text-sm font-black text-indigo-700">{schedule.is_active ? t("academy.actions.editSchedule") : t("academy.actions.viewSchedule")} ↓</span>
                            </div>
                          </summary>

                          <div className="mt-5 border-t border-slate-200 pt-5">
                            {schedule.is_active ? (
                              <>
                                <form action={updateAcademyScheduleAction} className="space-y-4 rounded-2xl bg-slate-50 p-5">
                                  <input type="hidden" name="courseId" value={selectedCourse.id} />
                                  <input type="hidden" name="scheduleId" value={schedule.id} />
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="block text-sm font-black">{t("academy.recurring.label")}<input name="label" defaultValue={schedule.label} required className={fieldClass()} /></label>
                                    <label className="block text-sm font-black">{t("academy.recurring.type")}<select name="scheduleType" defaultValue={schedule.schedule_type} className={fieldClass()}><option value="weekly">{t("academy.recurring.weekly")}</option><option value="monthly_intensive">{t("academy.recurring.monthlyIntensive")}</option><option value="single">{t("academy.recurring.single")}</option></select></label>
                                    <label className="block text-sm font-black">{t("academy.recurring.startsOn")}<input name="startsOn" type="date" defaultValue={schedule.starts_on} required className={fieldClass()} /></label>
                                    <label className="block text-sm font-black">{t("academy.recurring.endsOn")}<input name="endsOn" type="date" defaultValue={schedule.ends_on} required className={fieldClass()} /></label>
                                    <label className="block text-sm font-black">{t("academy.recurring.startTime")}<input name="startTime" type="time" defaultValue={formatSessionTime(schedule.local_start_time)} required className={fieldClass()} /></label>
                                    <label className="block text-sm font-black">{t("academy.recurring.duration")}<input name="sessionDurationMinutes" type="number" min="1" max="1440" defaultValue={schedule.duration_minutes} required className={fieldClass()} /></label>
                                    <label className="block text-sm font-black">{t("academy.recurring.timezone")}<select name="timezone" defaultValue={schedule.timezone} className={fieldClass()}><option>Europe/Dublin</option><option>Europe/London</option><option>Africa/Douala</option><option>Africa/Lagos</option><option>America/Chicago</option><option>America/New_York</option><option>UTC</option></select></label>
                                    <label className="block text-sm font-black">{t("academy.recurring.zoomUrl")}<input name="zoomJoinUrl" type="url" defaultValue={schedule.zoom_join_url ?? ""} placeholder="https://zoom.us/j/..." className={fieldClass()} /></label>
                                  </div>
                                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                                    <p className="text-sm font-black text-indigo-950">{t("academy.recurring.weekdays")}</p>
                                    <div className="mt-3 flex flex-wrap gap-3">{[1,2,3,4,5,6,7].map((day) => <label key={day} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold"><input type="checkbox" name="weekdays" value={day} defaultChecked={schedule.weekdays.includes(day)} />{t(`academy.weekdays.${day}`)}</label>)}</div>
                                  </div>
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="block text-sm font-black">{t("academy.recurring.monthlyStartDay")}<input name="monthlyStartDay" type="number" min="1" max="28" defaultValue={schedule.monthly_start_day ?? 1} className={fieldClass()} /></label>
                                    <label className="block text-sm font-black">{t("academy.recurring.consecutiveDays")}<input name="consecutiveDays" type="number" min="1" max="14" defaultValue={schedule.consecutive_days ?? 3} className={fieldClass()} /></label>
                                  </div>
                                  <label className="block text-sm font-black">{t("academy.recurring.changeReason")}<input name="reason" maxLength={500} placeholder={t("academy.recurring.changeReasonPlaceholder")} className={fieldClass()} /></label>
                                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">{t("academy.recurring.safeRegenerationHelp")}</p>
                                  <ConfirmSubmitButton confirmation={t("academy.recurring.updateConfirmation")} className="w-full rounded-xl bg-violet-700 px-5 py-3 font-black text-white">{t("academy.actions.saveSchedule")}</ConfirmSubmitButton>
                                </form>
                                <form action={archiveAcademyScheduleAction} className="mt-4 grid gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 sm:grid-cols-[1fr_auto]">
                                  <input type="hidden" name="courseId" value={selectedCourse.id} />
                                  <input type="hidden" name="scheduleId" value={schedule.id} />
                                  <label className="block text-sm font-black text-red-900">{t("academy.recurring.archiveReason")}<input name="reason" required minLength={3} maxLength={500} className={fieldClass()} /></label>
                                  <ConfirmSubmitButton confirmation={t("academy.recurring.archiveConfirmation")} className="self-end rounded-xl bg-red-700 px-5 py-3 font-black text-white">{t("academy.actions.archiveSchedule")}</ConfirmSubmitButton>
                                </form>
                              </>
                            ) : (
                              <form action={restoreAcademyScheduleAction} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                                <input type="hidden" name="courseId" value={selectedCourse.id} />
                                <input type="hidden" name="scheduleId" value={schedule.id} />
                                <p className="text-sm leading-6 text-emerald-900">{t("academy.recurring.restoreHelp")}</p>
                                <ConfirmSubmitButton confirmation={t("academy.recurring.restoreConfirmation")} className="mt-3 rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">{t("academy.actions.restoreSchedule")}</ConfirmSubmitButton>
                              </form>
                            )}
                          </div>
                        </details>
                      ))}
                      {!selectedSchedules.length ? <p className="rounded-2xl bg-slate-50 p-5 text-center text-slate-500">{t("academy.recurring.none")}</p> : null}
                    </div>
                  </article>
                ) : null}

                {isAcademyAdmin ? (
                  <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-2xl font-black">{t("academy.quizBuilder")}</h3>
                    <p className="mt-1 text-sm text-slate-500">{t("academy.quizBuilderHelp")}</p>
                    <div className="mt-5 space-y-3">
                      {selectedQuestions.map((question, index) => <div key={question.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{index + 1}. {question.question_text}</p><ol className="mt-2 space-y-1 text-sm text-slate-600">{optionsFrom(question.options).map((option, optionIndex) => <li key={optionIndex} className={optionIndex === question.correct_option ? "font-black text-emerald-700" : ""}>{String.fromCharCode(65 + optionIndex)}. {option}</li>)}</ol></div><form action={deleteAcademyQuestionAction}><input type="hidden" name="courseId" value={selectedCourse.id} /><input type="hidden" name="questionId" value={question.id} /><button className="rounded-lg bg-red-50 px-3 py-2 text-xs font-black text-red-700">{t("academy.actions.delete")}</button></form></div></div>)}
                    </div>
                    <form action={addAcademyQuestionAction} className="mt-6 space-y-4 rounded-2xl bg-slate-50 p-5">
                      <input type="hidden" name="courseId" value={selectedCourse.id} />
                      <label className="block text-sm font-black">{t("academy.fields.question")}<textarea name="questionText" required rows={3} className={fieldClass()} /></label>
                      <div className="grid gap-3 sm:grid-cols-2">{[1, 2, 3, 4].map((index) => <label key={index} className="block text-sm font-black">{t("academy.fields.option", {index})}<input name={`option${index}`} required={index <= 2} className={fieldClass()} /></label>)}</div>
                      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-black">{t("academy.fields.correctOption")}<select name="correctOption" className={fieldClass()}>{[0, 1, 2, 3].map((index) => <option key={index} value={index}>{String.fromCharCode(65 + index)}</option>)}</select></label><label className="block text-sm font-black">{t("academy.fields.points")}<input name="points" type="number" min="0.1" step="0.1" defaultValue="1" className={fieldClass()} /></label></div>
                      <button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("academy.actions.addQuestion")}</button>
                    </form>
                  </article>
                ) : null}

                <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-2xl font-black">{t("academy.sessions.title")}</h3><p className="mt-1 text-sm text-slate-500">{t("academy.sessions.help")}</p></div><span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-black text-violet-800">{visibleSessions.filter((session) => session.status !== "cancelled").length}</span></div>
                  <div className="mt-5 space-y-4">
                    {visibleSessions.map((session) => {
                      const ownAttendance = ownEnrollment ? attendanceBySessionAndEnrollment.get(`${session.id}:${ownEnrollment.id}`) : null;
                      return <div key={session.id} className={`rounded-2xl border p-4 ${session.status === "cancelled" ? "border-slate-200 bg-slate-50 opacity-70" : "border-violet-200 bg-violet-50/40"}`}><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><p className="font-black">{session.title}</p><p className="mt-1 text-sm text-slate-700">{formatDate(session.session_date, locale)} · {formatSessionTime(session.local_start_time)} · {session.timezone}</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold">{t(`academy.sessionStatuses.${session.status}`)}</span>{ownAttendance ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusTone(ownAttendance.status === "present" ? "completed" : ownAttendance.status === "late" ? "in_progress" : ownAttendance.status === "absent" ? "failed" : "assigned")}`}>{t(`academy.attendanceStatuses.${ownAttendance.status}`)}</span> : null}</div></div><div className="flex flex-wrap gap-2">{session.zoom_join_url && session.status !== "cancelled" && (ownEnrollment || canAssign) ? <a href={session.zoom_join_url} target="_blank" rel="noreferrer" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white">{t("academy.actions.joinZoom")}</a> : null}{isAcademyAdmin && session.status !== "cancelled" ? <form action={cancelAcademySessionAction}><input type="hidden" name="courseId" value={selectedCourse.id} /><input type="hidden" name="sessionId" value={session.id} /><button className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-700">{t("academy.actions.cancelSession")}</button></form> : null}</div></div>
                        {canAssign && selectedEnrollments.length && session.status !== "cancelled" ? <div className="mt-4 space-y-2 border-t border-violet-100 pt-4">{selectedEnrollments.map((enrollment) => {const profile = profileById.get(enrollment.user_id); const attendance = attendanceBySessionAndEnrollment.get(`${session.id}:${enrollment.id}`); return <form key={enrollment.id} action={markAcademySessionAttendanceAction} className="grid gap-2 rounded-xl bg-white p-3 sm:grid-cols-[1fr_170px_1fr_auto] sm:items-end"><input type="hidden" name="courseId" value={selectedCourse.id} /><input type="hidden" name="sessionId" value={session.id} /><input type="hidden" name="enrollmentId" value={enrollment.id} /><div><p className="text-sm font-black">{profile?.full_name || profile?.email || enrollment.user_id}</p><p className="text-xs text-slate-500">{t("academy.attendance")}: {Number(enrollment.attendance_percent)} %</p></div><label className="text-xs font-black">{t("academy.fields.attendanceStatus")}<select name="status" defaultValue={attendance?.status ?? "invited"} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="invited">{t("academy.attendanceStatuses.invited")}</option><option value="present">{t("academy.attendanceStatuses.present")}</option><option value="late">{t("academy.attendanceStatuses.late")}</option><option value="absent">{t("academy.attendanceStatuses.absent")}</option><option value="excused">{t("academy.attendanceStatuses.excused")}</option></select></label><label className="text-xs font-black">{t("academy.fields.notes")}<input name="notes" defaultValue={attendance?.notes ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white">{t("academy.actions.saveAttendance")}</button></form>})}</div> : null}
                      </div>;
                    })}
                    {!visibleSessions.length ? <div className="rounded-2xl bg-slate-50 p-8 text-center text-slate-600"><p>{t("academy.sessions.none")}</p>{isAcademyAdmin && selectedSchedules.some((schedule) => schedule.is_active) ? <form action={repairAcademyCourseSessionsAction} className="mt-4"><input type="hidden" name="courseId" value={selectedCourse.id} /><button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("academy.actions.repairSessions")}</button></form> : null}{isAcademyAdmin && !selectedSchedules.some((schedule) => schedule.is_active) ? <p className="mt-3 text-sm font-bold text-amber-700">{t("academy.sessions.scheduleRequired")}</p> : null}</div> : null}
                  </div>
                </article>

                {canAssign && selectedCourse.status === "published" ? (
                  <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-2xl font-black">{t("academy.assignParticipants")}</h3>
                    <p className="mt-1 text-sm text-slate-500">{membership.role === "manager" ? t("academy.assignTeamHelp") : t("academy.assignOrganisationHelp")}</p>
                    <form action={assignAcademyCourseAction} className="mt-5 flex flex-col gap-3 sm:flex-row"><input type="hidden" name="courseId" value={selectedCourse.id} /><select name="userId" required className={`${fieldClass()} mt-0 flex-1`}><option value="">{t("academy.chooseParticipant")}</option>{assignableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email || profile.id}</option>)}</select><button className="rounded-xl bg-indigo-700 px-6 py-3 font-black text-white disabled:opacity-40" disabled={!assignableProfiles.length}>{t("academy.actions.assign")}</button></form>
                    <div className="mt-5 space-y-3">{selectedEnrollments.map((enrollment) => {const profile = profileById.get(enrollment.user_id); const certificate = certificateByEnrollment.get(enrollment.id); return <div key={enrollment.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-black">{profile?.full_name || profile?.email || enrollment.user_id}</p><p className="mt-1 text-xs text-slate-500">{Number(enrollment.progress_percent)} % · {enrollment.attempts_count}/{selectedCourse.max_attempts} {t("academy.attempts")}</p></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(enrollment.status)}`}>{t(`academy.enrollmentStatuses.${enrollment.status}`)}</span>{certificate ? <Link href={`/dashboard/academy/certificate/${certificate.id}`} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">{t("academy.actions.certificate")}</Link> : null}</div></div>{isAcademyAdmin && !["completed", "exempted"].includes(enrollment.status) ? <form action={exemptAcademyEnrollmentAction} className="mt-3 flex gap-2"><input type="hidden" name="courseId" value={selectedCourse.id} /><input type="hidden" name="enrollmentId" value={enrollment.id} /><input name="reason" required placeholder={t("academy.exemptionReason")} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black">{t("academy.actions.exempt")}</button></form> : null}</div>;})}{!selectedEnrollments.length ? <p className="rounded-2xl bg-slate-50 p-6 text-center text-slate-500">{t("academy.noParticipants")}</p> : null}</div>
                  </article>
                ) : null}

                <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-2xl font-black">{t("academy.learningSpace")}</h3>
                    {!ownEnrollment ? (
                      <div className="mt-5 rounded-2xl bg-indigo-50 p-5"><p className="text-indigo-900">{t("academy.notEnrolled")}</p><form action={selfEnrollAcademyCourseAction} className="mt-4"><input type="hidden" name="courseId" value={selectedCourse.id} /><button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("academy.actions.enroll")}</button></form></div>
                    ) : (
                      <div className="mt-5">
                        <div className="flex flex-wrap items-center justify-between gap-3"><div><span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(ownEnrollment.status)}`}>{t(`academy.enrollmentStatuses.${ownEnrollment.status}`)}</span><p className="mt-2 text-sm text-slate-500">{t("academy.progress")}: {Number(ownEnrollment.progress_percent)} % · {t("academy.bestScore")}: {ownEnrollment.best_score == null ? "—" : `${Number(ownEnrollment.best_score)} %`} · {t("academy.attendance")}: {ownAttendancePercent} % ({ownAttendedSessions}/{ownExpectedSessions})</p></div>{ownCertificate ? <Link href={`/dashboard/academy/certificate/${ownCertificate.id}`} className="rounded-xl bg-emerald-600 px-5 py-3 font-black text-white">{t("academy.actions.openCertificate")}</Link> : null}</div>
                        {selectedCourse.resource_url ? <a href={selectedCourse.resource_url} target="_blank" rel="noreferrer" className="mt-5 inline-flex rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("academy.actions.openResource")} ↗</a> : <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{t("academy.resourceMissing")}</p>}
                        {ownEnrollment.status === "assigned" ? <form action={startAcademyCourseAction} className="mt-4"><input type="hidden" name="courseId" value={selectedCourse.id} /><input type="hidden" name="enrollmentId" value={ownEnrollment.id} /><button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("academy.actions.start")}</button></form> : null}
                        {["in_progress", "failed"].includes(ownEnrollment.status) && Number(ownEnrollment.best_score ?? 0) < Number(selectedCourse.passing_score) && ownEnrollment.attempts_count < selectedCourse.max_attempts && quizUnlocked ? (
                          <form action={submitAcademyQuizAction} className="mt-6 space-y-5">
                            <input type="hidden" name="courseId" value={selectedCourse.id} /><input type="hidden" name="enrollmentId" value={ownEnrollment.id} />
                            <div><h4 className="text-xl font-black">{t("academy.finalQuiz")}</h4><p className="mt-1 text-sm text-slate-500">{t("academy.finalQuizHelp", {score: selectedCourse.passing_score, attempts: selectedCourse.max_attempts - ownEnrollment.attempts_count})}</p></div>
                            {selectedQuestions.map((question, index) => <fieldset key={question.id} className="rounded-2xl border border-slate-200 p-5"><legend className="px-2 font-black">{index + 1}. {question.question_text}</legend><div className="mt-3 space-y-2">{optionsFrom(question.options).map((option, optionIndex) => <label key={optionIndex} className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm"><input type="radio" name={`question_${question.id}`} value={optionIndex} required className="mt-0.5" /><span>{String.fromCharCode(65 + optionIndex)}. {option}</span></label>)}</div></fieldset>)}
                            <button className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950">{t("academy.actions.submitQuiz")}</button>
                          </form>
                        ) : null}
                        {["in_progress", "failed"].includes(ownEnrollment.status) && Number(ownEnrollment.best_score ?? 0) < Number(selectedCourse.passing_score) && ownEnrollment.attempts_count < selectedCourse.max_attempts && !quizUnlocked ? <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950"><p className="text-xl font-black">{t("academy.quizLockedTitle")}</p><p className="mt-2">{!quizHasSessions ? t("academy.quizLockedNoSessions") : !quizSessionsFinished ? t("academy.quizLockedSessionsPending", {date: nextPendingSession ? formatDate(nextPendingSession.session_date, locale) : "—"}) : t("academy.quizLockedAttendance", {attendance: ownAttendancePercent, required: attendanceRequired})}</p></div> : null}
                        {Number(ownEnrollment.best_score ?? 0) >= Number(selectedCourse.passing_score) && ownEnrollment.status !== "completed" ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900"><p className="text-xl font-black">{t("academy.attendancePendingTitle")}</p><p className="mt-1">{t("academy.attendancePendingHelp", {attendance: ownAttendancePercent, required: selectedCourse.attendance_required_percent})}</p></div> : null}
                        {ownEnrollment.status === "completed" ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900"><p className="text-xl font-black">✓ {t("academy.completedCongratulations")}</p><p className="mt-1">{t("academy.completedHelp")}</p></div> : null}
                        {ownEnrollment.status === "failed" && ownEnrollment.attempts_count >= selectedCourse.max_attempts ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"><p className="font-black">{t("academy.noAttemptsLeftTitle")}</p><p className="mt-1 text-sm">{t("academy.noAttemptsLeftHelp")}</p></div> : null}
                      </div>
                    )}
                  </article>
              </>
            ) : <article className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500">{t("academy.selectCourse")}</article>}
          </div>
        </section>
      </div>
    </main>
  );
}
