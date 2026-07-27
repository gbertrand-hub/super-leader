import Link from "next/link";
import {redirect} from "next/navigation";
import {
  addAcademyQuestionAction,
  archiveAcademyCourseAction,
  assignAcademyCourseAction,
  createAcademyCourseAction,
  deleteAcademyQuestionAction,
  exemptAcademyEnrollmentAction,
  publishAcademyCourseAction,
  selfEnrollAcademyCourseAction,
  startAcademyCourseAction,
  submitAcademyQuizAction,
  updateAcademyCourseAction,
} from "@/app/actions/academy";
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
  const schemaCheck = await admin.from("academy_courses").select("id", {head: true, count: "exact"}).limit(1);
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
            {missingSchema ? <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/021_super_leader_academy_v1.sql</code> : null}
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
    admin.from("academy_courses").select("id, title, description, category, training_month, deadline, duration_minutes, is_required, passing_score, max_attempts, certificate_enabled, resource_url, status, created_at").eq("organization_id", membership.organization_id).order("training_month", {ascending: false}).order("created_at", {ascending: false}),
    admin.from("academy_enrollments").select("id, course_id, user_id, status, progress_percent, attempts_count, best_score, assigned_at, started_at, completed_at, exempted_reason").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds),
    admin.from("academy_certificates").select("id, enrollment_id, user_id, course_id, certificate_number, final_score, issued_at, status").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds),
  ]);

  let courses = (coursesResult.data ?? []) as CourseRow[];
  if (!isAcademyAdmin) courses = courses.filter((course) => course.status === "published");
  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const enrollments = (enrollmentsResult.data ?? []) as EnrollmentRow[];
  const certificates = (certificatesResult.data ?? []) as CertificateRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const certificateByEnrollment = new Map(certificates.map((certificate) => [certificate.enrollment_id, certificate]));
  const currentMonth = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? courses[0] ?? null;
  const {data: selectedQuestionsData} = selectedCourse
    ? await admin.from("academy_quiz_questions").select("id, course_id, question_text, options, correct_option, points, position").eq("organization_id", membership.organization_id).eq("course_id", selectedCourse.id).order("position")
    : {data: []};
  const selectedQuestions = (selectedQuestionsData ?? []) as QuestionRow[];
  const selectedEnrollments = selectedCourse ? enrollments.filter((row) => row.course_id === selectedCourse.id) : [];
  const ownEnrollment = selectedCourse ? selectedEnrollments.find((row) => row.user_id === auth.user.id) ?? null : null;
  const ownCertificate = ownEnrollment ? certificateByEnrollment.get(ownEnrollment.id) ?? null : null;
  const assignedUserIds = new Set(selectedEnrollments.map((row) => row.user_id));
  const assignableProfiles = profiles.filter((profile) => !assignedUserIds.has(profile.id));

  const ownEnrollments = enrollments.filter((row) => row.user_id === auth.user.id);
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

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
          <div className="space-y-6">
            {isAcademyAdmin ? (
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{t("academy.createCourse")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("academy.createCourseHelp")}</p>
                <form action={createAcademyCourseAction} className="mt-5 space-y-4">
                  <label className="block text-sm font-black">{t("academy.fields.title")}<input name="title" required className={fieldClass()} /></label>
                  <label className="block text-sm font-black">{t("academy.fields.description")}<textarea name="description" rows={4} className={fieldClass()} /></label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-black">{t("academy.fields.month")}<input name="trainingMonth" type="month" defaultValue={currentMonth} required className={fieldClass()} /></label>
                    <label className="block text-sm font-black">{t("academy.fields.deadline")}<input name="deadline" type="date" defaultValue={`${currentMonth}-28`} required className={fieldClass()} /></label>
                    <label className="block text-sm font-black">{t("academy.fields.category")}<input name="category" defaultValue="professional_development" className={fieldClass()} /></label>
                    <label className="block text-sm font-black">{t("academy.fields.duration")}<input name="durationMinutes" type="number" min="1" defaultValue="60" required className={fieldClass()} /></label>
                    <label className="block text-sm font-black">{t("academy.fields.passingScore")}<input name="passingScore" type="number" min="0" max="100" defaultValue="70" required className={fieldClass()} /></label>
                    <label className="block text-sm font-black">{t("academy.fields.maxAttempts")}<input name="maxAttempts" type="number" min="1" max="20" defaultValue="3" required className={fieldClass()} /></label>
                  </div>
                  <label className="block text-sm font-black">{t("academy.fields.resourceUrl")}<input name="resourceUrl" type="url" placeholder="https://..." className={fieldClass()} /></label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="isRequired" type="checkbox" defaultChecked />{t("academy.fields.required")}</label>
                    <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="certificateEnabled" type="checkbox" defaultChecked />{t("academy.fields.certificate")}</label>
                  </div>
                  <button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("academy.actions.create")}</button>
                </form>
              </article>
            ) : (
              <article className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6">
                <h2 className="text-2xl font-black text-indigo-950">{t("academy.monthlyCommitment")}</h2>
                <p className="mt-2 text-indigo-800">{t("academy.monthlyCommitmentHelp", {count: monthlyRequired})}</p>
              </article>
            )}

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
                  <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs uppercase text-slate-400">{t("academy.fields.deadline")}</p><p className="mt-1 font-black">{formatDate(selectedCourse.deadline, locale)}</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs uppercase text-slate-400">{t("academy.fields.passingScore")}</p><p className="mt-1 font-black">{Number(selectedCourse.passing_score)} %</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs uppercase text-slate-400">{t("academy.questions")}</p><p className="mt-1 font-black">{selectedQuestions.length}</p></div></div>
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
                        <div className="flex flex-wrap items-center justify-between gap-3"><div><span className={`rounded-full px-3 py-1 text-xs font-black ${statusTone(ownEnrollment.status)}`}>{t(`academy.enrollmentStatuses.${ownEnrollment.status}`)}</span><p className="mt-2 text-sm text-slate-500">{t("academy.progress")}: {Number(ownEnrollment.progress_percent)} % · {t("academy.bestScore")}: {ownEnrollment.best_score == null ? "—" : `${Number(ownEnrollment.best_score)} %`}</p></div>{ownCertificate ? <Link href={`/dashboard/academy/certificate/${ownCertificate.id}`} className="rounded-xl bg-emerald-600 px-5 py-3 font-black text-white">{t("academy.actions.openCertificate")}</Link> : null}</div>
                        {selectedCourse.resource_url ? <a href={selectedCourse.resource_url} target="_blank" rel="noreferrer" className="mt-5 inline-flex rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("academy.actions.openResource")} ↗</a> : <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{t("academy.resourceMissing")}</p>}
                        {ownEnrollment.status === "assigned" ? <form action={startAcademyCourseAction} className="mt-4"><input type="hidden" name="courseId" value={selectedCourse.id} /><input type="hidden" name="enrollmentId" value={ownEnrollment.id} /><button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("academy.actions.start")}</button></form> : null}
                        {["in_progress", "failed"].includes(ownEnrollment.status) && ownEnrollment.attempts_count < selectedCourse.max_attempts ? (
                          <form action={submitAcademyQuizAction} className="mt-6 space-y-5">
                            <input type="hidden" name="courseId" value={selectedCourse.id} /><input type="hidden" name="enrollmentId" value={ownEnrollment.id} />
                            <div><h4 className="text-xl font-black">{t("academy.finalQuiz")}</h4><p className="mt-1 text-sm text-slate-500">{t("academy.finalQuizHelp", {score: selectedCourse.passing_score, attempts: selectedCourse.max_attempts - ownEnrollment.attempts_count})}</p></div>
                            {selectedQuestions.map((question, index) => <fieldset key={question.id} className="rounded-2xl border border-slate-200 p-5"><legend className="px-2 font-black">{index + 1}. {question.question_text}</legend><div className="mt-3 space-y-2">{optionsFrom(question.options).map((option, optionIndex) => <label key={optionIndex} className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm"><input type="radio" name={`question_${question.id}`} value={optionIndex} required className="mt-0.5" /><span>{String.fromCharCode(65 + optionIndex)}. {option}</span></label>)}</div></fieldset>)}
                            <button className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950">{t("academy.actions.submitQuiz")}</button>
                          </form>
                        ) : null}
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
