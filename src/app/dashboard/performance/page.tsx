import type {ReactNode} from "react";
import Link from "next/link";
import {redirect} from "next/navigation";
import {
  calculateMonthlyPerformanceAction,
  clockInAction,
  clockOutAction,
  createPerformanceMeetingAction,
  markMeetingAttendanceAction,
  publishEmployeeOfMonthAction,
  reviewPerformanceAppealAction,
  recordAttendanceAction,
  reviewDailyReportAction,
  reviewLeaveRequestAction,
  submitDailyReportAction,
  submitLeaveRequestAction,
  submitPerformanceAppealAction,
  updatePerformanceSettingsAction,
  upsertMemberScheduleAction,
  upsertMonthlyKpiScoreAction,
} from "@/app/actions/performance";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type SearchParams = {
  view?: string | string[];
  month?: string | string[];
  success?: string | string[];
  error?: string | string[];
};

type PageProps = {searchParams?: Promise<SearchParams>};
type Membership = {organization_id: string; role: string};
type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type SettingsRow = {
  timezone: string;
  default_start_time: string;
  default_end_time: string;
  grace_minutes: number;
  report_deadline_time: string;
  minimum_work_days: number;
  minimum_report_rate: number | string;
  minimum_score: number | string;
  maximum_unexcused_absences: number;
  attendance_weight: number | string;
  punctuality_weight: number | string;
  meetings_weight: number | string;
  reports_weight: number | string;
  collaboration_weight: number | string;
  role_kpi_weight: number | string;
};
type ScheduleRow = {
  id: string;
  user_id: string;
  timezone: string;
  work_days: number[];
  start_time: string;
  end_time: string;
  grace_minutes: number;
  report_deadline_time: string;
};
type AttendanceRow = {
  id: string;
  user_id: string;
  work_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  status: string;
  late_minutes: number;
  justification: string | null;
  source: string;
};
type LeaveRow = {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  review_note: string | null;
  created_at: string;
};
type DailyReportRow = {
  id: string;
  user_id: string;
  report_date: string;
  accomplishments: string;
  results: string;
  blockers: string;
  next_priorities: string;
  status: string;
  review_note: string | null;
  submitted_at: string;
};
type MeetingRow = {
  id: string;
  title: string;
  meeting_type: string;
  mandatory: boolean;
  starts_at: string;
  ends_at: string | null;
  notes: string | null;
};
type MeetingAttendanceRow = {
  id: string;
  meeting_id: string;
  user_id: string;
  status: string;
  late_minutes: number;
  notes: string | null;
};
type KpiRow = {user_id: string; score: number | string; notes: string | null};
type ScoreRow = {
  user_id: string;
  score_month: string;
  attendance_score: number | string;
  punctuality_score: number | string;
  meetings_score: number | string;
  reports_score: number | string;
  collaboration_score: number | string;
  role_kpi_score: number | string;
  total_score: number | string;
  scheduled_days: number;
  attended_days: number;
  late_days: number;
  unexcused_absences: number;
  reports_expected: number;
  reports_submitted: number;
  mandatory_meetings: number;
  meetings_attended: number;
  eligible: boolean;
  eligibility_note: string | null;
  position: number | null;
  calculated_at: string;
  locked_at: string | null;
};
type AwardRow = {
  award_month: string;
  winner_id: string;
  final_score: number | string;
  announcement_note: string | null;
  published_at: string;
};
type AppealRow = {
  id: string;
  user_id: string;
  score_month: string;
  reason: string;
  status: string;
  resolution_note: string | null;
  created_at: string;
};

const views = ["overview", "attendance", "absences", "reports", "meetings", "ranking", "settings"] as const;
const leaderRoles = new Set(["owner", "admin", "hr", "manager"]);
const hrRoles = new Set(["owner", "admin", "hr"]);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function monthValue(value: string) {
  return /^\d{4}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 7);
}

function zonedDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function number(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fieldClass() {
  return "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
}

function Metric({label, value, detail, tone = "slate"}: {label: string; value: string | number; detail?: string; tone?: "slate" | "indigo" | "emerald" | "amber" | "red"}) {
  const tones = {
    slate: "border-slate-200 bg-white",
    indigo: "border-indigo-200 bg-indigo-50",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
  };
  return (
    <article className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
      {detail ? <p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p> : null}
    </article>
  );
}

function Badge({children, tone = "slate"}: {children: ReactNode; tone?: "slate" | "indigo" | "emerald" | "amber" | "red"}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    indigo: "bg-indigo-100 text-indigo-800",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${tones[tone]}`}>{children}</span>;
}

function statusTone(status: string): "slate" | "indigo" | "emerald" | "amber" | "red" {
  if (["present", "approved", "accepted", "validated", "on_time", "published"].includes(status)) return "emerald";
  if (["late", "pending", "submitted", "invited"].includes(status)) return "amber";
  if (["remote", "training"].includes(status)) return "indigo";
  if (["absent", "rejected", "incomplete", "needs_revision"].includes(status)) return "red";
  return "slate";
}

export default async function PerformancePage({searchParams}: PageProps) {
  const {t, locale} = await getI18n();
  const params = (await searchParams) ?? {};
  const rawView = firstValue(params.view);
  const view = views.includes(rawView as (typeof views)[number]) ? rawView : "overview";
  const month = monthValue(firstValue(params.month));
  const scoreMonth = `${month}-01`;
  const success = firstValue(params.success);
  const errorMessage = firstValue(params.error);
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";

  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) redirect("/dashboard/company");

  const isLeader = leaderRoles.has(membership.role);
  const canConfigure = hrRoles.has(membership.role);

  const schemaCheck = await admin.from("performance_settings").select("organization_id", {head: true, count: "exact"}).limit(1);
  if (schemaCheck.error) {
    const missingTable = schemaCheck.error.code === "42P01" || schemaCheck.error.code === "PGRST205";
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-4xl">
          <header className="rounded-3xl bg-slate-950 p-7 text-white">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("performance.eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-black">{t("performance.title")}</h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">{missingTable ? t("performance.databaseSetupTitle") : t("performance.loadFailedTitle")}</h2>
            <p className="mt-3 leading-7 text-amber-900">{missingTable ? t("performance.databaseSetupDescription") : schemaCheck.error.message}</p>
            {missingTable ? <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">supabase/012_performance_employee_of_month.sql</code> : null}
          </section>
        </div>
      </main>
    );
  }

  let {data: settings} = await admin.from("performance_settings").select("*").eq("organization_id", membership.organization_id).maybeSingle<SettingsRow>();
  if (!settings) {
    const {data} = await admin.from("performance_settings").upsert({organization_id: membership.organization_id}, {onConflict: "organization_id"}).select("*").single<SettingsRow>();
    settings = data;
  }
  if (!settings) throw new Error(t("performance.messages.settingsMissing"));

  const membersResult = await admin.from("organization_members").select("user_id, role").eq("organization_id", membership.organization_id).eq("is_active", true).order("created_at");
  if (membersResult.error) throw new Error(membersResult.error.message);
  const members = (membersResult.data ?? []) as MemberRow[];
  const memberIds = members.map((member) => member.user_id);
  const profilesResult = memberIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", memberIds)
    : {data: [] as ProfileRow[], error: null};
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const roleById = new Map(members.map((member) => [member.user_id, member.role]));
  const memberOptions = memberIds.map((id) => ({
    id,
    name: profileById.get(id)?.full_name?.trim() || profileById.get(id)?.email || t("common.member"),
    email: profileById.get(id)?.email || "",
    role: roleById.get(id) || "employee",
  })).sort((a, b) => a.name.localeCompare(b.name));
  const memberName = (id: string) => memberOptions.find((member) => member.id === id)?.name || t("common.member");

  const today = zonedDate(new Date(), settings.timezone);
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);

  const [schedulesResult, attendanceResult, leavesResult, reportsResult, meetingsResult, meetingAttendanceResult, kpiResult, scoresResult, awardsResult, appealsResult] = await Promise.all([
    admin.from("member_work_schedules").select("id, user_id, timezone, work_days, start_time, end_time, grace_minutes, report_deadline_time").eq("organization_id", membership.organization_id).eq("is_active", true),
    admin.from("attendance_records").select("id, user_id, work_date, clock_in_at, clock_out_at, status, late_minutes, justification, source").eq("organization_id", membership.organization_id).gte("work_date", monthStart).lte("work_date", monthEnd).order("work_date", {ascending: false}).limit(500),
    admin.from("leave_requests").select("id, user_id, leave_type, start_date, end_date, reason, status, review_note, created_at").eq("organization_id", membership.organization_id).order("created_at", {ascending: false}).limit(300),
    admin.from("daily_reports").select("id, user_id, report_date, accomplishments, results, blockers, next_priorities, status, review_note, submitted_at").eq("organization_id", membership.organization_id).gte("report_date", monthStart).lte("report_date", monthEnd).order("report_date", {ascending: false}).limit(500),
    admin.from("performance_meetings").select("id, title, meeting_type, mandatory, starts_at, ends_at, notes").eq("organization_id", membership.organization_id).gte("starts_at", `${monthStart}T00:00:00Z`).lte("starts_at", `${monthEnd}T23:59:59Z`).order("starts_at", {ascending: false}).limit(200),
    admin.from("performance_meeting_attendance").select("id, meeting_id, user_id, status, late_minutes, notes").eq("organization_id", membership.organization_id),
    admin.from("monthly_kpi_scores").select("user_id, score, notes").eq("organization_id", membership.organization_id).eq("score_month", scoreMonth),
    admin.from("employee_month_scores").select("user_id, score_month, attendance_score, punctuality_score, meetings_score, reports_score, collaboration_score, role_kpi_score, total_score, scheduled_days, attended_days, late_days, unexcused_absences, reports_expected, reports_submitted, mandatory_meetings, meetings_attended, eligible, eligibility_note, position, calculated_at, locked_at").eq("organization_id", membership.organization_id).eq("score_month", scoreMonth).order("total_score", {ascending: false}),
    admin.from("employee_month_awards").select("award_month, winner_id, final_score, announcement_note, published_at").eq("organization_id", membership.organization_id).order("award_month", {ascending: false}).limit(12),
    admin.from("performance_score_appeals").select("id, user_id, score_month, reason, status, resolution_note, created_at").eq("organization_id", membership.organization_id).eq("score_month", scoreMonth).order("created_at", {ascending: false}),
  ]);

  const loadError = [schedulesResult.error, attendanceResult.error, leavesResult.error, reportsResult.error, meetingsResult.error, meetingAttendanceResult.error, kpiResult.error, scoresResult.error, awardsResult.error, appealsResult.error].find(Boolean);
  if (loadError) throw new Error(t("performance.messages.loadFailed", {message: loadError.message}));

  const schedules = (schedulesResult.data ?? []) as ScheduleRow[];
  const allAttendance = (attendanceResult.data ?? []) as AttendanceRow[];
  const allLeaves = (leavesResult.data ?? []) as LeaveRow[];
  const allReports = (reportsResult.data ?? []) as DailyReportRow[];
  const meetings = (meetingsResult.data ?? []) as MeetingRow[];
  const meetingAttendance = (meetingAttendanceResult.data ?? []) as MeetingAttendanceRow[];
  const kpis = (kpiResult.data ?? []) as KpiRow[];
  const scores = (scoresResult.data ?? []) as ScoreRow[];
  const awards = (awardsResult.data ?? []) as AwardRow[];
  const appeals = (appealsResult.data ?? []) as AppealRow[];
  const visibleAttendance = isLeader ? allAttendance : allAttendance.filter((row) => row.user_id === authData.user.id);
  const visibleLeaves = isLeader ? allLeaves : allLeaves.filter((row) => row.user_id === authData.user.id);
  const visibleReports = isLeader ? allReports : allReports.filter((row) => row.user_id === authData.user.id);
  const visibleMeetingAttendance = isLeader ? meetingAttendance : meetingAttendance.filter((row) => row.user_id === authData.user.id);
  const ownAttendanceToday = allAttendance.find((row) => row.user_id === authData.user.id && row.work_date === today);
  const ownScore = scores.find((score) => score.user_id === authData.user.id);
  const publishedAward = awards.find((award) => award.award_month === scoreMonth);
  const visibleScores = isLeader || publishedAward ? scores : scores.filter((score) => score.user_id === authData.user.id);
  const visibleAppeals = isLeader ? appeals : appeals.filter((appeal) => appeal.user_id === authData.user.id);
  const ownAppeal = appeals.find((appeal) => appeal.user_id === authData.user.id);
  const currentReport = allReports.find((row) => row.user_id === authData.user.id && row.report_date === today);
  const currentSchedule = schedules.find((row) => row.user_id === authData.user.id);
  const reportRate = ownScore?.reports_expected ? Math.round((ownScore.reports_submitted / ownScore.reports_expected) * 100) : 0;

  const tabHref = (target: string) => `/dashboard/performance?view=${target}&month=${month}`;
  const formatDate = (value: string) => new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium"}).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
  const formatDateTime = (value: string) => new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium", timeStyle: "short", timeZone: settings.timezone}).format(new Date(value));
  const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat(dateLocale, {hour: "2-digit", minute: "2-digit", timeZone: settings.timezone}).format(new Date(value)) : "—";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("performance.eyebrow")}</p>
              <h1 className="mt-2 text-3xl font-black">{t("performance.title")}</h1>
              <p className="mt-2 max-w-3xl text-slate-300">{t("performance.subtitle")}</p>
            </div>
            <form method="get" className="flex items-end gap-3">
              <input type="hidden" name="view" value={view} />
              <label className="text-sm font-bold text-slate-300">
                {t("performance.month")}
                <input name="month" type="month" defaultValue={month} className="mt-2 block rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-white" />
              </label>
              <button className="rounded-xl bg-amber-400 px-4 py-2.5 font-black text-slate-950">{t("performance.apply")}</button>
            </form>
          </div>
        </header>

        {success ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">{success}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">{errorMessage}</div> : null}

        <nav className="mt-6 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {views.filter((item) => item !== "settings" || isLeader).map((item) => (
            <Link key={item} href={tabHref(item)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${view === item ? "bg-indigo-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {t(`performance.tabs.${item}`)}
            </Link>
          ))}
        </nav>

        {view === "overview" ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label={t("performance.currentScore")} value={ownScore ? `${number(ownScore.total_score).toFixed(1)} / 100` : "—"} detail={ownScore ? (ownScore.eligible ? t("performance.eligible") : t("performance.notEligible")) : t("performance.awaitingCalculation")} tone={ownScore?.eligible ? "emerald" : "slate"} />
              <Metric label={t("performance.attendanceRate")} value={ownScore?.scheduled_days ? `${Math.round((ownScore.attended_days / ownScore.scheduled_days) * 100)}%` : "—"} detail={t("performance.daysSummary", {present: ownScore?.attended_days ?? 0, expected: ownScore?.scheduled_days ?? 0})} tone="indigo" />
              <Metric label={t("performance.punctuality")} value={ownScore?.attended_days ? `${Math.round(((ownScore.attended_days - ownScore.late_days) / ownScore.attended_days) * 100)}%` : "—"} detail={t("performance.lateCount", {count: ownScore?.late_days ?? 0})} />
              <Metric label={t("performance.dailyReports") } value={ownScore ? `${reportRate}%` : "—"} detail={t("performance.reportsSummary", {submitted: ownScore?.reports_submitted ?? 0, expected: ownScore?.reports_expected ?? 0})} tone="amber" />
              <Metric label={t("performance.position")} value={ownScore?.position ? `#${ownScore.position}` : "—"} detail={t("performance.monthlyRanking")} tone="emerald" />
            </section>

            {publishedAward ? (
              <section className="mt-6 rounded-3xl border border-amber-300 bg-gradient-to-r from-amber-100 to-yellow-50 p-7 shadow-sm">
                <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-700">{t("performance.employeeOfMonth")}</p>
                <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-3xl font-black">🏆 {memberName(publishedAward.winner_id)}</h2>
                    <p className="mt-2 text-slate-700">{publishedAward.announcement_note || t("performance.awardDefaultMessage")}</p>
                  </div>
                  <div className="rounded-2xl bg-white px-6 py-4 text-center shadow-sm">
                    <p className="text-xs font-black uppercase text-slate-500">{t("performance.finalScore")}</p>
                    <p className="mt-1 text-3xl font-black text-amber-700">{number(publishedAward.final_score).toFixed(1)}</p>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{t("performance.today")}</h2>
                <p className="mt-1 text-sm text-slate-500">{formatDate(today)} · {currentSchedule?.start_time?.slice(0, 5) || settings.default_start_time.slice(0, 5)}–{currentSchedule?.end_time?.slice(0, 5) || settings.default_end_time.slice(0, 5)}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <form action={clockInAction}><button disabled={Boolean(ownAttendanceToday?.clock_in_at)} className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{ownAttendanceToday?.clock_in_at ? t("performance.clockedInAt", {time: formatTime(ownAttendanceToday.clock_in_at)}) : t("performance.clockIn")}</button></form>
                  <form action={clockOutAction}><button disabled={!ownAttendanceToday?.clock_in_at || Boolean(ownAttendanceToday?.clock_out_at)} className="w-full rounded-xl border border-indigo-300 bg-indigo-50 px-5 py-3 font-black text-indigo-800 disabled:cursor-not-allowed disabled:opacity-40">{ownAttendanceToday?.clock_out_at ? t("performance.clockedOutAt", {time: formatTime(ownAttendanceToday.clock_out_at)}) : t("performance.clockOut")}</button></form>
                </div>
                {ownAttendanceToday ? <div className="mt-4 flex flex-wrap gap-2"><Badge tone={statusTone(ownAttendanceToday.status)}>{t(`performance.statuses.${ownAttendanceToday.status}`)}</Badge>{ownAttendanceToday.late_minutes ? <Badge tone="red">{t("performance.minutesLate", {count: ownAttendanceToday.late_minutes})}</Badge> : null}</div> : null}
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{t("performance.transparentFormula")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("performance.transparentFormulaHelp")}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["attendance", settings.attendance_weight],
                    ["punctuality", settings.punctuality_weight],
                    ["meetings", settings.meetings_weight],
                    ["reports", settings.reports_weight],
                    ["collaboration", settings.collaboration_weight],
                    ["roleKpi", settings.role_kpi_weight],
                  ].map(([key, weight]) => (
                    <div key={String(key)} className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-sm font-bold text-slate-600">{t(`performance.criteria.${key}`)}</p>
                      <p className="mt-1 text-2xl font-black">{number(weight)} pts</p>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </>
        ) : null}

        {view === "attendance" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-6">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{t("performance.clockTitle")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("performance.clockHelp")}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <form action={clockInAction}><button disabled={Boolean(ownAttendanceToday?.clock_in_at)} className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white disabled:opacity-40">{t("performance.clockIn")}</button></form>
                  <form action={clockOutAction}><button disabled={!ownAttendanceToday?.clock_in_at || Boolean(ownAttendanceToday?.clock_out_at)} className="w-full rounded-xl border border-indigo-300 px-5 py-3 font-black text-indigo-800 disabled:opacity-40">{t("performance.clockOut")}</button></form>
                </div>
              </article>

              {isLeader ? (
                <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-2xl font-black">{t("performance.manualAttendance")}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t("performance.manualAttendanceHelp")}</p>
                  <form action={recordAttendanceAction} className="mt-5 space-y-4">
                    <label className="block text-sm font-black">{t("performance.employee")}<select name="userId" required className={fieldClass()}>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block text-sm font-black">{t("performance.date")}<input name="workDate" type="date" defaultValue={today} required className={fieldClass()} /></label>
                      <label className="block text-sm font-black">{t("common.status")}<select name="status" className={fieldClass()}>{["present", "late", "absent", "excused", "remote"].map((status) => <option key={status} value={status}>{t(`performance.statuses.${status}`)}</option>)}</select></label>
                    </div>
                    <label className="block text-sm font-black">{t("performance.lateMinutes")}<input name="lateMinutes" type="number" min="0" defaultValue="0" className={fieldClass()} /></label>
                    <label className="block text-sm font-black">{t("performance.justification")}<textarea name="justification" rows={3} className={fieldClass()} /></label>
                    <button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("performance.saveAttendance")}</button>
                  </form>
                </article>
              ) : null}
            </div>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{t("performance.attendanceHistory")}</h2>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">{t("performance.date")}</th>{isLeader ? <th className="px-3 py-3">{t("performance.employee")}</th> : null}<th className="px-3 py-3">{t("performance.clockIn")}</th><th className="px-3 py-3">{t("performance.clockOut")}</th><th className="px-3 py-3">{t("common.status")}</th><th className="px-3 py-3">{t("performance.details")}</th></tr></thead>
                  <tbody>{visibleAttendance.map((row) => <tr key={row.id} className="border-b border-slate-100"><td className="px-3 py-4 font-bold">{formatDate(row.work_date)}</td>{isLeader ? <td className="px-3 py-4">{memberName(row.user_id)}</td> : null}<td className="px-3 py-4">{formatTime(row.clock_in_at)}</td><td className="px-3 py-4">{formatTime(row.clock_out_at)}</td><td className="px-3 py-4"><Badge tone={statusTone(row.status)}>{t(`performance.statuses.${row.status}`)}</Badge></td><td className="px-3 py-4 text-slate-500">{row.late_minutes ? t("performance.minutesLate", {count: row.late_minutes}) : row.justification || "—"}</td></tr>)}</tbody>
                </table>
                {!visibleAttendance.length ? <p className="py-12 text-center text-slate-500">{t("performance.noAttendance")}</p> : null}
              </div>
            </article>
          </section>
        ) : null}

        {view === "absences" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{t("performance.requestLeave")}</h2>
              <p className="mt-1 text-sm text-slate-500">{t("performance.requestLeaveHelp")}</p>
              <form action={submitLeaveRequestAction} className="mt-5 space-y-4">
                <label className="block text-sm font-black">{t("performance.leaveType")}<select name="leaveType" className={fieldClass()}>{["annual", "sick", "family", "training", "unpaid", "other"].map((type) => <option key={type} value={type}>{t(`performance.leaveTypes.${type}`)}</option>)}</select></label>
                <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-black">{t("performance.startDate")}<input name="startDate" type="date" required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.endDate")}<input name="endDate" type="date" required className={fieldClass()} /></label></div>
                <label className="block text-sm font-black">{t("performance.reason")}<textarea name="reason" rows={4} required className={fieldClass()} /></label>
                <label className="block text-sm font-black">{t("performance.documentUrl")}<input name="documentUrl" type="url" placeholder="https://..." className={fieldClass()} /></label>
                <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("performance.submitRequest")}</button>
              </form>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{t("performance.leaveRequests")}</h2>
              <div className="mt-5 space-y-4">{visibleLeaves.map((leave) => <div key={leave.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{isLeader ? `${memberName(leave.user_id)} · ` : ""}{t(`performance.leaveTypes.${leave.leave_type}`)}</p><p className="mt-1 text-sm text-slate-500">{formatDate(leave.start_date)} → {formatDate(leave.end_date)}</p></div><Badge tone={statusTone(leave.status)}>{t(`performance.leaveStatuses.${leave.status}`)}</Badge></div><p className="mt-3 text-sm leading-6 text-slate-700">{leave.reason}</p>{leave.review_note ? <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{leave.review_note}</p> : null}{isLeader && leave.status === "pending" ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><form action={reviewLeaveRequestAction} className="space-y-2"><input type="hidden" name="requestId" value={leave.id} /><input type="hidden" name="status" value="approved" /><input name="reviewNote" placeholder={t("performance.reviewNote")} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /><button className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 font-black text-white">{t("performance.approve")}</button></form><form action={reviewLeaveRequestAction} className="space-y-2"><input type="hidden" name="requestId" value={leave.id} /><input type="hidden" name="status" value="rejected" /><input name="reviewNote" required placeholder={t("performance.reviewNote")} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /><button className="w-full rounded-xl bg-red-600 px-4 py-2.5 font-black text-white">{t("performance.reject")}</button></form></div> : null}</div>)}</div>
              {!visibleLeaves.length ? <p className="py-12 text-center text-slate-500">{t("performance.noLeaveRequests")}</p> : null}
            </article>
          </section>
        ) : null}

        {view === "reports" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{t("performance.dailyReportTitle")}</h2>
              <p className="mt-1 text-sm text-slate-500">{t("performance.dailyReportHelp", {deadline: (currentSchedule?.report_deadline_time || settings.report_deadline_time).slice(0, 5)})}</p>
              <form action={submitDailyReportAction} className="mt-5 space-y-4">
                <label className="block text-sm font-black">{t("performance.reportDate")}<input name="reportDate" type="date" max={today} defaultValue={today} required className={fieldClass()} /></label>
                <label className="block text-sm font-black">{t("performance.accomplishments")}<textarea name="accomplishments" rows={4} defaultValue={currentReport?.accomplishments || ""} required className={fieldClass()} /></label>
                <label className="block text-sm font-black">{t("performance.results")}<textarea name="results" rows={3} defaultValue={currentReport?.results || ""} required className={fieldClass()} /></label>
                <label className="block text-sm font-black">{t("performance.blockers")}<textarea name="blockers" rows={3} defaultValue={currentReport?.blockers || ""} className={fieldClass()} /></label>
                <label className="block text-sm font-black">{t("performance.nextPriorities")}<textarea name="nextPriorities" rows={3} defaultValue={currentReport?.next_priorities || ""} required className={fieldClass()} /></label>
                <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{currentReport ? t("performance.updateReport") : t("performance.submitReport")}</button>
              </form>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">{t("performance.reportHistory")}</h2>
              <div className="mt-5 space-y-4">{visibleReports.map((report) => <details key={report.id} className="rounded-2xl border border-slate-200 p-5"><summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black">{isLeader ? `${memberName(report.user_id)} · ` : ""}{formatDate(report.report_date)}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(report.submitted_at)}</p></div><Badge tone={statusTone(report.status)}>{t(`performance.reportStatuses.${report.status}`)}</Badge></div></summary><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><p className="text-xs font-black uppercase text-slate-500">{t("performance.accomplishments")}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{report.accomplishments}</p></div><div><p className="text-xs font-black uppercase text-slate-500">{t("performance.results")}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{report.results}</p></div><div><p className="text-xs font-black uppercase text-slate-500">{t("performance.blockers")}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{report.blockers}</p></div><div><p className="text-xs font-black uppercase text-slate-500">{t("performance.nextPriorities")}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{report.next_priorities}</p></div></div>{report.review_note ? <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{report.review_note}</p> : null}{isLeader ? <form action={reviewDailyReportAction} className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><input type="hidden" name="reportId" value={report.id} /><select name="status" className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm">{["validated", "needs_revision", "incomplete"].map((status) => <option key={status} value={status}>{t(`performance.reportStatuses.${status}`)}</option>)}</select><input name="reviewNote" placeholder={t("performance.reviewNote")} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /><button className="rounded-xl bg-slate-950 px-4 py-2.5 font-black text-white">{t("performance.review")}</button></form> : null}</details>)}</div>
              {!visibleReports.length ? <p className="py-12 text-center text-slate-500">{t("performance.noReports")}</p> : null}
            </article>
          </section>
        ) : null}

        {view === "meetings" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            {isLeader ? <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{t("performance.createMeeting")}</h2><p className="mt-1 text-sm text-slate-500">{t("performance.createMeetingHelp")}</p><form action={createPerformanceMeetingAction} className="mt-5 space-y-4"><label className="block text-sm font-black">{t("performance.meetingTitle")}<input name="title" required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.meetingType")}<select name="meetingType" className={fieldClass()}>{["team", "training", "client", "company", "other"].map((type) => <option key={type} value={type}>{t(`performance.meetingTypes.${type}`)}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-black">{t("performance.startsAt")}<input name="startsAt" type="datetime-local" required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.endsAt")}<input name="endsAt" type="datetime-local" className={fieldClass()} /></label></div><label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold"><input name="mandatory" type="checkbox" defaultChecked />{t("performance.mandatoryMeeting")}</label><fieldset><legend className="text-sm font-black">{t("performance.participants")}</legend><div className="mt-2 max-h-60 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">{memberOptions.map((member) => <label key={member.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"><input name="participantIds" type="checkbox" value={member.id} defaultChecked /><span className="text-sm font-semibold">{member.name} · {t(`roles.${member.role}`)}</span></label>)}</div></fieldset><label className="block text-sm font-black">{t("performance.notes")}<textarea name="notes" rows={3} className={fieldClass()} /></label><button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("performance.createMeetingButton")}</button></form></article> : <article className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6"><h2 className="text-2xl font-black text-indigo-950">{t("performance.meetingsTitle")}</h2><p className="mt-2 text-indigo-800">{t("performance.employeeMeetingsHelp")}</p></article>}

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{t("performance.meetingsTitle")}</h2><div className="mt-5 space-y-5">{meetings.map((meeting) => {const attendees = visibleMeetingAttendance.filter((row) => row.meeting_id === meeting.id); if (!isLeader && !attendees.length) return null; return <div key={meeting.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-lg font-black">{meeting.title}</p><p className="mt-1 text-sm text-slate-500">{formatDateTime(meeting.starts_at)} · {t(`performance.meetingTypes.${meeting.meeting_type}`)}</p></div><Badge tone={meeting.mandatory ? "red" : "slate"}>{meeting.mandatory ? t("performance.mandatory") : t("performance.optionalMeeting")}</Badge></div>{meeting.notes ? <p className="mt-3 text-sm text-slate-600">{meeting.notes}</p> : null}<div className="mt-4 space-y-3">{attendees.map((attendee) => <div key={attendee.id} className="rounded-xl bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-bold">{memberName(attendee.user_id)}</p><Badge tone={statusTone(attendee.status)}>{t(`performance.meetingStatuses.${attendee.status}`)}</Badge></div>{isLeader ? <form action={markMeetingAttendanceAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px_1fr_auto]"><input type="hidden" name="attendanceId" value={attendee.id} /><select name="status" defaultValue={attendee.status === "invited" ? "present" : attendee.status} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">{["present", "late", "absent", "excused"].map((status) => <option key={status} value={status}>{t(`performance.meetingStatuses.${status}`)}</option>)}</select><input name="lateMinutes" type="number" min="0" defaultValue={attendee.late_minutes} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" /><input name="notes" defaultValue={attendee.notes || ""} placeholder={t("performance.notes")} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" /><button className="rounded-xl bg-slate-950 px-4 py-2 font-black text-white">{t("performance.save")}</button></form> : null}</div>)}</div></div>})}</div>{!meetings.length ? <p className="py-12 text-center text-slate-500">{t("performance.noMeetings")}</p> : null}</article>
          </section>
        ) : null}

        {view === "ranking" ? (
          <section className="mt-6 space-y-6">
            {isLeader ? <div className="grid gap-6 xl:grid-cols-3"><article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{t("performance.roleKpiTitle")}</h2><p className="mt-1 text-sm text-slate-500">{t("performance.roleKpiHelp")}</p><form action={upsertMonthlyKpiScoreAction} className="mt-5 space-y-4"><input type="hidden" name="month" value={month} /><label className="block text-sm font-black">{t("performance.employee")}<select name="userId" className={fieldClass()}>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label className="block text-sm font-black">{t("performance.kpiScore")}<input name="score" type="number" min="0" max="30" step="0.1" required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.notes")}<textarea name="notes" rows={3} className={fieldClass()} /></label><button className="w-full rounded-xl bg-indigo-700 px-4 py-3 font-black text-white">{t("performance.saveKpi")}</button></form></article><article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-black">{t("performance.calculateRanking")}</h2><p className="mt-1 text-sm text-slate-500">{t("performance.calculateRankingHelp")}</p><form action={calculateMonthlyPerformanceAction} className="mt-5"><input type="hidden" name="month" value={month} /><button disabled={Boolean(scores[0]?.locked_at)} className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-40">{scores[0]?.locked_at ? t("performance.rankingLocked") : t("performance.calculateButton")}</button></form><p className="mt-4 text-xs text-slate-500">{scores[0] ? t("performance.lastCalculated", {date: formatDateTime(scores[0].calculated_at)}) : t("performance.neverCalculated")}</p></article>{canConfigure ? <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm"><h2 className="text-xl font-black text-amber-950">{t("performance.publishWinner")}</h2><p className="mt-1 text-sm text-amber-800">{t("performance.publishWinnerHelp")}</p><form action={publishEmployeeOfMonthAction} className="mt-5 space-y-4"><input type="hidden" name="month" value={month} /><textarea name="announcementNote" rows={3} placeholder={t("performance.announcementNote")} className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm" /><button disabled={!scores.length || Boolean(publishedAward)} className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-40">{publishedAward ? t("performance.alreadyPublished") : t("performance.publishButton")}</button></form></article> : null}</div> : null}

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black">{t("performance.monthlyRanking")}</h2><p className="mt-1 text-sm text-slate-500">{t("performance.rankingTransparency")}</p></div>{publishedAward ? <Badge tone="emerald">{t("performance.publishedAndLocked")}</Badge> : null}</div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">#</th><th className="px-3 py-3">{t("performance.employee")}</th><th className="px-3 py-3">{t("performance.criteria.attendance")}</th><th className="px-3 py-3">{t("performance.criteria.punctuality")}</th><th className="px-3 py-3">{t("performance.criteria.meetings")}</th><th className="px-3 py-3">{t("performance.criteria.reports")}</th><th className="px-3 py-3">{t("performance.criteria.collaboration")}</th><th className="px-3 py-3">{t("performance.criteria.roleKpi")}</th><th className="px-3 py-3">{t("performance.total")}</th><th className="px-3 py-3">{t("performance.eligibility")}</th></tr></thead><tbody>{visibleScores.map((score) => <tr key={score.user_id} className="border-b border-slate-100"><td className="px-3 py-4 text-xl font-black">{score.position ? `#${score.position}` : "—"}</td><td className="px-3 py-4"><p className="font-black">{memberName(score.user_id)}</p><p className="text-xs text-slate-500">{t(`roles.${roleById.get(score.user_id) || "employee"}`)}</p></td><td className="px-3 py-4 font-bold">{number(score.attendance_score).toFixed(1)}</td><td className="px-3 py-4 font-bold">{number(score.punctuality_score).toFixed(1)}</td><td className="px-3 py-4 font-bold">{number(score.meetings_score).toFixed(1)}</td><td className="px-3 py-4 font-bold">{number(score.reports_score).toFixed(1)}</td><td className="px-3 py-4 font-bold">{number(score.collaboration_score).toFixed(1)}</td><td className="px-3 py-4 font-bold">{number(score.role_kpi_score).toFixed(1)}</td><td className="px-3 py-4 text-xl font-black text-indigo-700">{number(score.total_score).toFixed(1)}</td><td className="px-3 py-4"><Badge tone={score.eligible ? "emerald" : "red"}>{score.eligible ? t("performance.eligible") : t("performance.notEligible")}</Badge>{!score.eligible && score.eligibility_note ? <p className="mt-2 max-w-48 text-xs text-red-600">{score.eligibility_note.split(",").map((reason) => t(`performance.eligibilityReasons.${reason}`)).join(" · ")}</p> : null}</td></tr>)}</tbody></table>{!visibleScores.length ? <p className="py-14 text-center text-slate-500">{t("performance.noScores")}</p> : null}</div></article>

            <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{t("performance.appealTitle")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("performance.appealHelp")}</p>
                {ownScore && !ownScore.locked_at ? (
                  <form action={submitPerformanceAppealAction} className="mt-5 space-y-4">
                    <input type="hidden" name="month" value={month} />
                    <label className="block text-sm font-black">{t("performance.appealReason")}<textarea name="reason" minLength={10} rows={4} defaultValue={ownAppeal?.reason || ""} required className={fieldClass()} /></label>
                    <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{ownAppeal ? t("performance.updateAppeal") : t("performance.submitAppeal")}</button>
                  </form>
                ) : <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{ownScore?.locked_at ? t("performance.appealClosed") : t("performance.calculateBeforeAppeal")}</p>}
              </article>
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">{t("performance.appealsList")}</h2>
                <div className="mt-5 space-y-4">{visibleAppeals.map((appeal) => <div key={appeal.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-black">{memberName(appeal.user_id)}</p><Badge tone={statusTone(appeal.status)}>{t(`performance.appealStatuses.${appeal.status}`)}</Badge></div><p className="mt-3 text-sm leading-6 text-slate-700">{appeal.reason}</p>{appeal.resolution_note ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{appeal.resolution_note}</p> : null}{canConfigure && appeal.status === "pending" ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><form action={reviewPerformanceAppealAction} className="space-y-2"><input type="hidden" name="appealId" value={appeal.id} /><input type="hidden" name="status" value="accepted" /><input name="resolutionNote" required placeholder={t("performance.resolutionNote")} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /><button className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 font-black text-white">{t("performance.acceptAppeal")}</button></form><form action={reviewPerformanceAppealAction} className="space-y-2"><input type="hidden" name="appealId" value={appeal.id} /><input type="hidden" name="status" value="rejected" /><input name="resolutionNote" required placeholder={t("performance.resolutionNote")} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /><button className="w-full rounded-xl bg-red-600 px-4 py-2.5 font-black text-white">{t("performance.rejectAppeal")}</button></form></div> : null}</div>)}</div>
                {!visibleAppeals.length ? <p className="py-10 text-center text-slate-500">{t("performance.noAppeals")}</p> : null}
              </article>
            </section>

            {isLeader ? <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{t("performance.kpiEntries")}</h2><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{memberOptions.map((member) => {const kpi = kpis.find((item) => item.user_id === member.id); return <div key={member.id} className="rounded-2xl bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><p className="font-black">{member.name}</p><Badge tone={kpi ? "indigo" : "slate"}>{kpi ? `${number(kpi.score).toFixed(1)} / 30` : t("performance.notEntered")}</Badge></div>{kpi?.notes ? <p className="mt-2 text-sm text-slate-600">{kpi.notes}</p> : null}</div>})}</div></article> : null}
          </section>
        ) : null}

        {view === "settings" && isLeader ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            {canConfigure ? <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{t("performance.scoringSettings")}</h2><p className="mt-1 text-sm text-slate-500">{t("performance.scoringSettingsHelp")}</p><form action={updatePerformanceSettingsAction} className="mt-5 space-y-5"><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-black">{t("performance.timezone")}<input name="timezone" defaultValue={settings.timezone} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.graceMinutes")}<input name="graceMinutes" type="number" min="0" max="180" defaultValue={settings.grace_minutes} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.defaultStart")}<input name="defaultStart" type="time" defaultValue={settings.default_start_time.slice(0, 5)} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.defaultEnd")}<input name="defaultEnd" type="time" defaultValue={settings.default_end_time.slice(0, 5)} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.reportDeadline")}<input name="reportDeadline" type="time" defaultValue={settings.report_deadline_time.slice(0, 5)} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.minimumWorkDays")}<input name="minimumWorkDays" type="number" min="1" max="31" defaultValue={settings.minimum_work_days} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.minimumReportRate")}<input name="minimumReportRate" type="number" min="0" max="100" step="0.1" defaultValue={number(settings.minimum_report_rate)} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.minimumScore")}<input name="minimumScore" type="number" min="0" max="100" step="0.1" defaultValue={number(settings.minimum_score)} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.maximumUnexcusedAbsences")}<input name="maximumUnexcusedAbsences" type="number" min="0" max="31" defaultValue={settings.maximum_unexcused_absences} required className={fieldClass()} /></label></div><div><h3 className="font-black">{t("performance.weights")}</h3><p className="mt-1 text-xs text-slate-500">{t("performance.weightsHelp")}</p><div className="mt-3 grid gap-4 sm:grid-cols-2">{[["attendanceWeight", "attendance", settings.attendance_weight], ["punctualityWeight", "punctuality", settings.punctuality_weight], ["meetingsWeight", "meetings", settings.meetings_weight], ["reportsWeight", "reports", settings.reports_weight], ["collaborationWeight", "collaboration", settings.collaboration_weight], ["roleKpiWeight", "roleKpi", settings.role_kpi_weight]].map(([name, key, value]) => <label key={String(name)} className="block text-sm font-black">{t(`performance.criteria.${key}`)}<input name={String(name)} type="number" min="0" max="100" step="0.1" defaultValue={number(value)} required className={fieldClass()} /></label>)}</div></div><button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">{t("performance.saveSettings")}</button></form></article> : <article className="rounded-3xl border border-slate-200 bg-white p-6"><h2 className="text-2xl font-black">{t("performance.scoringSettings")}</h2><p className="mt-2 text-slate-600">{t("performance.hrOnlySettings")}</p></article>}

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">{t("performance.memberSchedule")}</h2><p className="mt-1 text-sm text-slate-500">{t("performance.memberScheduleHelp")}</p><form action={upsertMemberScheduleAction} className="mt-5 space-y-4"><label className="block text-sm font-black">{t("performance.employee")}<select name="userId" className={fieldClass()}>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label className="block text-sm font-black">{t("performance.timezone")}<input name="timezone" defaultValue={settings.timezone} required className={fieldClass()} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-black">{t("performance.startTime")}<input name="startTime" type="time" defaultValue={settings.default_start_time.slice(0, 5)} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.endTime")}<input name="endTime" type="time" defaultValue={settings.default_end_time.slice(0, 5)} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.graceMinutes")}<input name="graceMinutes" type="number" min="0" max="180" defaultValue={settings.grace_minutes} required className={fieldClass()} /></label><label className="block text-sm font-black">{t("performance.reportDeadline")}<input name="reportDeadline" type="time" defaultValue={settings.report_deadline_time.slice(0, 5)} required className={fieldClass()} /></label></div><fieldset><legend className="text-sm font-black">{t("performance.workDays")}</legend><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{[1,2,3,4,5,6,7].map((day) => <label key={day} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold"><input name="workDays" type="checkbox" value={day} defaultChecked={day <= 5} />{t(`performance.weekdays.${day}`)}</label>)}</div></fieldset><button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">{t("performance.saveSchedule")}</button></form><div className="mt-6 space-y-3">{schedules.map((schedule) => <div key={schedule.id} className="rounded-xl bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-black">{memberName(schedule.user_id)}</p><Badge tone="indigo">{schedule.start_time.slice(0,5)}–{schedule.end_time.slice(0,5)}</Badge></div><p className="mt-2 text-xs text-slate-500">{schedule.work_days.map((day) => t(`performance.weekdays.${day}`)).join(" · ")} · {schedule.timezone}</p></div>)}</div></article>
          </section>
        ) : null}
      </div>
    </main>
  );
}
