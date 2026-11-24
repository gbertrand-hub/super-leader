import type {ReactNode} from "react";
import Link from "next/link";
import {redirect} from "next/navigation";
import {clockInAction, clockOutAction, openAbsenceContactAction, pauseWorkdayAction, resumeWorkdayAction} from "@/app/actions/performance";
import {ConfirmSubmitButton} from "@/components/confirm-submit-button";
import {DailyWorkPlanPanel, type DailyWorkPlanView, type DailyWorkTaskView} from "@/components/performance/daily-execution";
import {AbsenceContactPanel, type AbsenceContactPanelProps, type AbsenceFollowupItem} from "@/components/absence-contact-panel";
import {dailyExecutionCopy} from "@/i18n/daily-execution";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";
import {isSitemapLocalQaSandbox} from "@/lib/navigation/sitemap-qa-sandbox";

type SearchParams = {
  contact?: string | string[];
  contactDate?: string | string[];
  success?: string | string[];
  error?: string | string[];
  plan?: string | string[];
};

type PageProps = {searchParams?: Promise<SearchParams>};
type Membership = {organization_id: string; role: string};
type TimeZoneProfileRow = {time_zone: string | null};
type SettingsRow = {
  timezone: string;
  default_start_time: string;
  default_end_time: string;
  grace_minutes: number;
  report_deadline_time: string;
  report_lock_enabled: boolean;
  long_day_warning_minutes: number;
};
type ScheduleRow = {
  user_id: string;
  timezone: string;
  work_days: number[];
  start_time: string;
  end_time: string;
  grace_minutes: number;
  report_deadline_time: string;
  supervisor_id: string | null;
  work_policy?: "fixed" | "flexible" | "autonomous";
  start_window_from?: string;
  start_window_until?: string;
  daily_target_minutes?: number;
  weekly_target_minutes?: number;
  core_hours_start?: string | null;
  core_hours_end?: string | null;
  latest_end_time?: string | null;
  allow_overnight?: boolean;
  pause_tracking_enabled?: boolean;
  short_day_justification_required?: boolean;
  report_required_before_clock_out?: boolean;
  attendance_tracking_required?: boolean;
  employee_alert_delay_minutes?: number;
  supervisor_alert_delay_minutes?: number;
};
type ScheduleEntryRow = {
  user_id: string;
  work_date: string;
  timezone: string;
  start_time: string | null;
  end_time: string | null;
  grace_minutes: number;
  report_deadline_time: string | null;
  work_mode: "onsite" | "remote" | "hybrid" | "off";
  location: string | null;
  report_required: boolean;
  status: "draft" | "published" | "cancelled";
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
  total_work_minutes: number;
  outside_schedule_minutes: number;
  night_minutes: number;
  weekend_minutes: number;
  closure_count: number;
  reopening_reason: string | null;
  work_policy?: "fixed" | "flexible" | "autonomous";
  target_work_minutes?: number;
  gross_work_minutes?: number;
  pause_minutes?: number;
  short_day?: boolean;
  short_day_justification?: string | null;
  target_met?: boolean;
};
type AttendanceBreakRow = {id: string; started_at: string; ended_at: string | null; duration_minutes: number; reason: string | null};
type ReportRow = {user_id: string; report_date: string; status: string; submitted_at: string};
type ReopeningRow = {report_date: string; expires_at: string; status: string};
type PriorityReopeningRow = {id: string; work_date: string; expires_at: string; reason: string; status: string};
type MeetingRow = {id: string; title: string; meeting_type: string; mandatory: boolean; starts_at: string; ends_at: string | null; meeting_url: string | null; provider: string};
type MeetingAttendanceRow = {meeting_id: string; user_id: string; status: string};
type CrmTaskRow = {id: string; client_id: string; title: string; due_at: string | null; priority: string; status: string};
type ClientRow = {id: string; full_name: string};
type CollectionRow = {
  id: string;
  customer_name: string;
  product_name: string;
  next_payment_due_date: string | null;
  next_payment_amount: number | string | null;
  currency: string;
  collection_status: string;
};
type FeedbackRow = {id: string; client_id: string; rating: number; comment: string | null; resolution_status: string; submitted_at: string};
type NotificationRow = {id: string; priority: string; title_fr: string; title_en: string; body_fr: string; body_en: string; action_url: string | null; requires_action: boolean; created_at: string};
type ScoreRow = {total_score: number | string; position: number | null; eligible: boolean; reports_expected: number; reports_submitted: number};
type ActionPlanRow = {id: string; action_title: string; due_date: string | null; priority: string; status: string; progress: number};
type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type WorkContactRow = {user_id: string; work_phone: string | null; work_whatsapp: string | null; position_title: string | null};
type AbsenceFollowupRow = {id: string; subject_user_id: string; attendance_id: string | null; work_date: string; contact_channel: string; outcome: string; note: string; next_follow_up_at: string | null; created_by: string; created_at: string};
type TeamAssignmentRow = {team_id: string};
type TeamDetailRow = {id: string; name: string; department: string | null};
type LeaveRow = {user_id: string; status: string; start_date: string; end_date: string};
type PersonalLeaveRow = {leave_type: string; status: string; start_date: string; end_date: string};
type PersonalLeaveBalanceRow = {annual_allowance: number | string; prior_used_days: number | string};
type AcademyEnrollmentRow = {
  id: string;
  course_id: string;
  status: string;
  progress_percent: number | string;
};
type AcademyCourseRow = {
  id: string;
  title: string;
  deadline: string;
  is_required: boolean;
  status: string;
};
type DailyExecutionSettingsRow = {
  enabled: boolean;
  minimum_tasks: number;
  maximum_tasks: number;
  required_from: string;
  require_task_outcomes_for_report: boolean;
};
type AcademySessionRow = {
  id: string;
  course_id: string;
  title: string;
  session_date: string;
  local_start_time: string;
  timezone: string;
  zoom_join_url: string | null;
  status: string;
};
type DashboardAnnouncementRecipientRow = {announcement_id: string; acknowledged_at: string | null};
type DashboardAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  title_fr: string | null;
  body_fr: string | null;
  title_en: string | null;
  body_en: string | null;
  category: string;
  priority: string;
  acknowledgement_required: boolean;
  publish_at: string | null;
  expires_at: string | null;
  published_at: string | null;
};

function dashboardAnnouncementText(item: DashboardAnnouncementRow, locale: string) {
  if (locale === "en") {
    return {
      title: item.title_en?.trim() || item.title_fr?.trim() || item.title,
      body: item.body_en?.trim() || item.body_fr?.trim() || item.body,
    };
  }
  return {
    title: item.title_fr?.trim() || item.title,
    body: item.body_fr?.trim() || item.body,
  };
}

type PriorityItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: "urgent" | "today" | "soon" | "info";
  rank: number;
};

const leaderRoles = new Set(["owner", "admin", "executive", "hr", "manager"]);

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}`};
}

function timeToMinutes(value: string) {
  const [hour = 0, minute = 0] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function number(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMinutes(total: number | string | null | undefined) {
  const minutes = Math.max(0, Math.round(number(total)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function formatMoney(locale: string, currency: string, value: number | string | null) {
  try {
    return new Intl.NumberFormat(locale, {style: "currency", currency, maximumFractionDigits: currency === "XAF" ? 0 : 2}).format(number(value));
  } catch {
    return `${number(value).toFixed(2)} ${currency}`;
  }
}

function Metric({label, value, detail, tone = "slate"}: {label: string; value: string | number; detail?: string; tone?: "slate" | "indigo" | "emerald" | "amber" | "red"}) {
  const classes = {
    slate: "border-slate-200 bg-white",
    indigo: "border-indigo-200 bg-indigo-50",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
  };
  return (
    <article className={`relative min-w-0 overflow-hidden rounded-2xl border p-5 shadow-sm ${classes[tone]}`}>
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${tone === "red" ? "bg-red-400" : tone === "amber" ? "bg-amber-400" : tone === "emerald" ? "bg-emerald-500" : tone === "indigo" ? "bg-indigo-500" : "bg-slate-300"}`} />
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-3 break-words text-2xl font-black leading-tight text-slate-950 2xl:text-3xl">{value}</p>
      {detail ? <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-500">{detail}</p> : null}
    </article>
  );
}

function StatusPill({children, tone = "slate"}: {children: ReactNode; tone?: "slate" | "indigo" | "emerald" | "amber" | "red"}) {
  const classes = {
    slate: "bg-slate-100 text-slate-700",
    indigo: "bg-indigo-100 text-indigo-800",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${classes[tone]}`}>{children}</span>;
}

function priorityTone(tone: PriorityItem["tone"]) {
  if (tone === "urgent") return "border-red-200 bg-red-50 text-red-950";
  if (tone === "today") return "border-amber-200 bg-amber-50 text-amber-950";
  if (tone === "soon") return "border-indigo-200 bg-indigo-50 text-indigo-950";
  return "border-slate-200 bg-white text-slate-950";
}

function statusTone(status: string): "slate" | "indigo" | "emerald" | "amber" | "red" {
  if (["present", "on_time", "validated", "completed", "paid"].includes(status)) return "emerald";
  if (["late", "pending", "submitted", "invited", "in_progress", "todo"].includes(status)) return "amber";
  if (["remote", "reopened_employee"].includes(status)) return "indigo";
  if (["absent", "overdue", "needs_revision", "rejected"].includes(status)) return "red";
  return "slate";
}

function workdaysInYear(start: string, end: string, year: number) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const from = new Date(`${start < yearStart ? yearStart : start}T12:00:00Z`);
  const to = new Date(`${end > yearEnd ? yearEnd : end}T12:00:00Z`);
  if (from > to) return 0;
  let total = 0;
  for (const day = new Date(from); day <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) total += 1;
  }
  return total;
}

export default async function MyDayPage({searchParams}: PageProps) {
  // V4.10.140 sitemap QA must not execute modules with missing QA tables.
  if (isSitemapLocalQaSandbox()) redirect("/dashboard/my-pages?qaUnsupported=1");
  const params = (await searchParams) ?? {};
  const firstParam = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
  const contactUserId = firstParam(params.contact);
  const contactDate = firstParam(params.contactDate);
  const successMessage = firstParam(params.success);
  const errorMessage = firstParam(params.error);
  const planPrompt = firstParam(params.plan);
  const {t, locale} = await getI18n();
  const dailyCopy = dailyExecutionCopy(locale);
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const requestNow = new Date();
  const requestNowIso = requestNow.toISOString();
  const requestNowTimestamp = requestNow.getTime();

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

  const [{data: settingsData}, {data: currentScheduleData}, {data: timeZoneProfileData, error: timeZoneProfileError}] = await Promise.all([
    admin.from("performance_settings").select("timezone, default_start_time, default_end_time, report_deadline_time, report_lock_enabled, long_day_warning_minutes").eq("organization_id", membership.organization_id).maybeSingle<SettingsRow>(),
    admin.from("member_work_schedules").select("*").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).eq("is_active", true).maybeSingle<ScheduleRow>(),
    admin.from("profiles").select("time_zone").eq("id", authData.user.id).maybeSingle<TimeZoneProfileRow>(),
  ]);
  if (timeZoneProfileError) console.error("Ma journée : fuseau personnel indisponible", timeZoneProfileError.message);

  const settings: SettingsRow = settingsData ?? {
    timezone: "Europe/Dublin",
    default_start_time: "09:00",
    default_end_time: "17:00",
    grace_minutes: 0,
    report_deadline_time: "18:00",
    report_lock_enabled: true,
    long_day_warning_minutes: 720,
  };
  const currentSchedule = currentScheduleData ?? null;
  const scheduleTimezone = normalizeTimeZone(currentSchedule?.timezone, settings.timezone);
  const personalTimezone = timeZoneProfileData?.time_zone
    ? normalizeTimeZone(timeZoneProfileData.time_zone, scheduleTimezone)
    : scheduleTimezone;
  const baselineTimezone = personalTimezone;
  const baselineLocalNow = zonedParts(requestNow, baselineTimezone);
  const today = baselineLocalNow.date;
  const {data: todayScheduleData, error: todayScheduleError} = await admin
    .from("work_schedule_entries")
    .select("user_id, work_date, timezone, start_time, end_time, grace_minutes, report_deadline_time, work_mode, location, report_required, status")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", authData.user.id)
    .eq("work_date", today)
    .eq("status", "published")
    .maybeSingle<ScheduleEntryRow>();
  if (todayScheduleError && todayScheduleError.code !== "42P01" && todayScheduleError.code !== "PGRST205") {
    console.error("Ma journée : planning détaillé indisponible", todayScheduleError.message);
  }
  const todaySchedule = todayScheduleData ?? null;
  const timezone = personalTimezone;
  const localNow = zonedParts(requestNow, timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const scoreMonth = monthStart;
  const startTime = (todaySchedule?.start_time || currentSchedule?.start_time || settings.default_start_time).slice(0, 5);
  const endTime = (todaySchedule?.end_time || currentSchedule?.end_time || settings.default_end_time).slice(0, 5);
  const reportDeadline = (todaySchedule?.report_deadline_time || currentSchedule?.report_deadline_time || settings.report_deadline_time).slice(0, 5);
  const graceMinutes = todaySchedule?.grace_minutes ?? currentSchedule?.grace_minutes ?? settings.grace_minutes ?? 0;
  const workPolicy = currentSchedule?.work_policy || "fixed";
  const startWindowFrom = String(currentSchedule?.start_window_from || startTime).slice(0, 5);
  const startWindowUntil = String(currentSchedule?.start_window_until || startTime).slice(0, 5);
  const dailyTargetMinutes = Math.max(0, Number(currentSchedule?.daily_target_minutes ?? 0) || Math.max(0, timeToMinutes(endTime) - timeToMinutes(startTime)));
  const weeklyTargetMinutes = Math.max(0, Number(currentSchedule?.weekly_target_minutes ?? 0));
  const latestEndTime = currentSchedule?.latest_end_time ? String(currentSchedule.latest_end_time).slice(0, 5) : null;
  const pauseTrackingEnabled = currentSchedule?.pause_tracking_enabled !== false;
  const attendanceTrackingRequired = currentSchedule?.attendance_tracking_required !== false;
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
  const ownWorkDays = currentSchedule?.work_days ?? [1, 2, 3, 4, 5];
  const isScheduledToday = todaySchedule
    ? todaySchedule.work_mode !== "off"
    : ownWorkDays.includes(weekday);
  const reportRequiredToday = todaySchedule ? todaySchedule.report_required && todaySchedule.work_mode !== "off" : isScheduledToday;
  const reportWindowOpen = reportRequiredToday && (settings.report_lock_enabled === false || timeToMinutes(localNow.time) <= timeToMinutes(reportDeadline));

  const meetingWindowStart = new Date(`${today}T00:00:00Z`);
  meetingWindowStart.setUTCDate(meetingWindowStart.getUTCDate() - 1);
  const meetingWindowEnd = new Date(`${today}T23:59:59Z`);
  meetingWindowEnd.setUTCDate(meetingWindowEnd.getUTCDate() + 1);

  const leaveYear = Number(today.slice(0, 4));
  const [attendanceResult, reportResult, reopeningResult, meetingsResult, tasksResult, collectionsResult, feedbackResult, notificationsResult, scoreResult, plansResult, academyEnrollmentsResult, personalLeavesResult, personalLeaveBalanceResult] = await Promise.all([
    admin.from("attendance_records").select("*").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).eq("work_date", today).maybeSingle<AttendanceRow>(),
    admin.from("daily_reports").select("user_id, report_date, status, submitted_at").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).eq("report_date", today).maybeSingle<ReportRow>(),
    admin.from("daily_report_reopenings").select("report_date, expires_at, status").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).eq("status", "active").gt("expires_at", requestNowIso).order("expires_at", {ascending: false}).limit(5),
    admin.from("performance_meetings").select("id, title, meeting_type, mandatory, starts_at, ends_at, meeting_url, provider").eq("organization_id", membership.organization_id).gte("starts_at", meetingWindowStart.toISOString()).lte("starts_at", meetingWindowEnd.toISOString()).order("starts_at", {ascending: true}).limit(50),
    admin.from("crm_follow_up_tasks").select("id, client_id, title, due_at, priority, status").eq("organization_id", membership.organization_id).eq("assigned_to", authData.user.id).in("status", ["todo", "in_progress", "overdue"]).order("due_at", {ascending: true, nullsFirst: false}).limit(50),
    admin.from("sales_records").select("id, customer_name, product_name, next_payment_due_date, next_payment_amount, currency, collection_status").eq("organization_id", membership.organization_id).eq("collection_owner_id", authData.user.id).in("collection_status", ["assigned", "in_progress", "overdue"]).order("next_payment_due_date", {ascending: true, nullsFirst: false}).limit(50),
    admin.from("crm_feedback_responses").select("id, client_id, rating, comment, resolution_status, submitted_at").eq("organization_id", membership.organization_id).eq("resolution_assigned_to", authData.user.id).in("resolution_status", ["open", "in_progress"]).lte("rating", 2).order("submitted_at", {ascending: false}).limit(30),
    admin.from("notifications").select("id, priority, title_fr, title_en, body_fr, body_en, action_url, requires_action, created_at").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).eq("status", "unread").order("created_at", {ascending: false}).limit(30),
    admin.from("employee_month_scores").select("total_score, position, eligible, reports_expected, reports_submitted").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).eq("score_month", scoreMonth).maybeSingle<ScoreRow>(),
    admin.from("action_plans").select("id, action_title, due_date, priority, status, progress").eq("organization_id", membership.organization_id).eq("owner_id", authData.user.id).in("status", ["todo", "in_progress", "blocked"]).order("due_date", {ascending: true, nullsFirst: false}).limit(40),
    admin.from("academy_enrollments").select("id, course_id, status, progress_percent").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).in("status", ["assigned", "in_progress", "failed", "overdue"]),
    admin.from("leave_requests").select("leave_type, status, start_date, end_date").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).eq("leave_type", "annual").in("status", ["pending", "approved"]).lte("start_date", `${leaveYear}-12-31`).gte("end_date", `${leaveYear}-01-01`),
    admin.from("leave_annual_balances").select("annual_allowance, prior_used_days").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).eq("leave_year", leaveYear).maybeSingle<PersonalLeaveBalanceRow>(),
  ]);

  const optionalErrors = [reopeningResult.error, meetingsResult.error, tasksResult.error, collectionsResult.error, feedbackResult.error, notificationsResult.error, scoreResult.error, plansResult.error, academyEnrollmentsResult.error, personalLeavesResult.error, personalLeaveBalanceResult.error].filter(Boolean);
  optionalErrors.forEach((error) => console.error("Ma journée : module optionnel indisponible", error?.message));
  if (attendanceResult.error) console.error("Ma journée : présence indisponible", attendanceResult.error.message);
  if (reportResult.error) console.error("Ma journée : rapport indisponible", reportResult.error.message);

  let attendance = attendanceResult.data ?? null;
  if (!attendance?.clock_in_at || attendance.clock_out_at) {
    const {data: openAttendanceData, error: openAttendanceError} = await admin
      .from("attendance_records")
      .select("*")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", authData.user.id)
      .not("clock_in_at", "is", null)
      .is("clock_out_at", null)
      .order("work_date", {ascending: false})
      .limit(1)
      .maybeSingle<AttendanceRow>();
    if (openAttendanceError) console.error("Ma journée : présence ouverte indisponible", openAttendanceError.message);
    if (openAttendanceData) attendance = openAttendanceData;
  }

  const breakSchemaCheck = await admin.from("attendance_breaks").select("id", {head: true, count: "exact"}).limit(1);
  const flexibleWorkReady = !breakSchemaCheck.error;
  let attendanceBreaks: AttendanceBreakRow[] = [];
  if (attendance?.id && flexibleWorkReady) {
    const {data: breakData, error: breakError} = await admin
      .from("attendance_breaks")
      .select("id, started_at, ended_at, duration_minutes, reason")
      .eq("organization_id", membership.organization_id)
      .eq("attendance_id", attendance.id)
      .order("started_at", {ascending: true});
    if (breakError) console.error("Ma journée : pauses indisponibles", breakError.message);
    attendanceBreaks = (breakData ?? []) as AttendanceBreakRow[];
  }
  const activeBreak = attendanceBreaks.find((item) => !item.ended_at) ?? null;
  const elapsedGrossMinutes = attendance?.clock_in_at && !attendance.clock_out_at
    ? Math.max(0, Math.round((requestNowTimestamp - new Date(attendance.clock_in_at).getTime()) / 60000))
    : Number(attendance?.gross_work_minutes ?? attendance?.total_work_minutes ?? 0);
  const recordedPauseMinutes = attendanceBreaks.reduce((sum, item) => {
    if (item.ended_at) return sum + Math.max(0, Number(item.duration_minutes || 0));
    const startedAt = new Date(item.started_at).getTime();
    return sum + (Number.isFinite(startedAt) ? Math.max(0, Math.round((requestNowTimestamp - startedAt) / 60000)) : 0);
  }, 0);
  const elapsedNetMinutes = attendance?.clock_out_at
    ? Number(attendance.total_work_minutes || 0)
    : Math.max(0, elapsedGrossMinutes - recordedPauseMinutes);
  const remainingTargetMinutes = Math.max(0, dailyTargetMinutes - elapsedNetMinutes);
  const report = reportResult.data ?? null;

  const [dailyExecutionSettingsResult, dailyPlanResult] = await Promise.all([
    admin.from("daily_execution_settings").select("enabled, minimum_tasks, maximum_tasks, required_from, require_task_outcomes_for_report").eq("organization_id", membership.organization_id).maybeSingle<DailyExecutionSettingsRow>(),
    admin.from("daily_work_plans").select("id, status, revision_count, submitted_at, completed_at").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).eq("work_date", today).maybeSingle<DailyWorkPlanView>(),
  ]);
  const dailyExecutionErrors = [dailyExecutionSettingsResult.error, dailyPlanResult.error].filter(Boolean);
  const dailyExecutionReady = !dailyExecutionErrors.length;
  dailyExecutionErrors.forEach((error) => {
    if (error && !["42P01", "PGRST205"].includes(error.code)) console.error("Ma journée : priorités quotidiennes indisponibles", error.message);
  });
  const dailyExecutionSettings: DailyExecutionSettingsRow = dailyExecutionSettingsResult.data ?? {
    enabled: true,
    minimum_tasks: 6,
    maximum_tasks: 12,
    required_from: today,
    require_task_outcomes_for_report: true,
  };
  const dailyPlan = dailyPlanResult.data ?? null;
  const {data: activePriorityReopeningData, error: activePriorityReopeningError} = dailyExecutionReady
    ? await admin.from("daily_priority_reopenings")
        .select("id,work_date,expires_at,reason,status")
        .eq("organization_id", membership.organization_id)
        .eq("user_id", authData.user.id)
        .eq("work_date", today)
        .eq("status", "active")
        .gt("expires_at", requestNowIso)
        .maybeSingle<PriorityReopeningRow>()
    : {data: null as PriorityReopeningRow | null, error: null};
  if (activePriorityReopeningError && !["42P01", "PGRST205"].includes(activePriorityReopeningError.code)) {
    console.error("Ma journée : réouverture des priorités indisponible", activePriorityReopeningError.message);
  }
  const activePriorityReopening = activePriorityReopeningData ?? null;
  const dailyTasksResult = dailyExecutionReady && dailyPlan?.id
    ? await admin.from("daily_work_tasks").select("id, position, title, expected_outcome, priority, due_time, category, progress_status, actual_outcome, outcome_reason, next_action, next_action_date").eq("plan_id", dailyPlan.id).order("position")
    : {data: [] as DailyWorkTaskView[], error: null};
  if (dailyTasksResult.error) console.error("Ma journée : tâches quotidiennes indisponibles", dailyTasksResult.error.message);
  const dailyWorkTasks = (dailyTasksResult.data ?? []) as DailyWorkTaskView[];
  const dailyTasksCompleted = dailyWorkTasks.filter((task) => task.progress_status === "completed").length;
  const dailyMinimumTasks = Math.max(1, Number(dailyExecutionSettings.minimum_tasks || 6));
  const dailyMaximumTasks = Math.min(12, Math.max(dailyMinimumTasks, Number(dailyExecutionSettings.maximum_tasks || 12)));
  const dailyPlanRequiredToday = dailyExecutionReady && dailyExecutionSettings.enabled && today >= dailyExecutionSettings.required_from;
  const dailyPlanIncomplete = dailyPlanRequiredToday && Boolean(attendance?.clock_in_at) && !report && (!dailyPlan || dailyWorkTasks.length < dailyMinimumTasks);

  const activeReopenings = (reopeningResult.data ?? []) as ReopeningRow[];
  const allMeetings = (meetingsResult.data ?? []) as MeetingRow[];
  const todayMeetings = allMeetings.filter((meeting) => zonedParts(new Date(meeting.starts_at), timezone).date === today);
  const meetingIds = todayMeetings.map((meeting) => meeting.id);
  const {data: meetingAttendanceData, error: meetingAttendanceError} = meetingIds.length
    ? await admin.from("performance_meeting_attendance").select("meeting_id, user_id, status").eq("organization_id", membership.organization_id).eq("user_id", authData.user.id).in("meeting_id", meetingIds)
    : {data: [] as MeetingAttendanceRow[], error: null};
  if (meetingAttendanceError) console.error("Ma journée : présence aux réunions indisponible", meetingAttendanceError.message);
  const ownMeetingAttendance = (meetingAttendanceData ?? []) as MeetingAttendanceRow[];
  const assignedMeetingIds = new Set(ownMeetingAttendance.map((row) => row.meeting_id));
  const ownMeetings = todayMeetings.filter((meeting) => assignedMeetingIds.has(meeting.id));

  const tasks = (tasksResult.data ?? []) as CrmTaskRow[];
  const collections = (collectionsResult.data ?? []) as CollectionRow[];
  const feedbacks = (feedbackResult.data ?? []) as FeedbackRow[];
  const notifications = (notificationsResult.data ?? []) as NotificationRow[];
  const score = scoreResult.data ?? null;
  const plans = (plansResult.data ?? []) as ActionPlanRow[];
  const academyEnrollments = (academyEnrollmentsResult.data ?? []) as AcademyEnrollmentRow[];
  const annualLeaveAllowance = Number(personalLeaveBalanceResult.data?.annual_allowance ?? 20);
  const priorAnnualLeaveDays = Number(personalLeaveBalanceResult.data?.prior_used_days ?? 0);
  const personalAnnualLeaves = (personalLeavesResult.data ?? []) as PersonalLeaveRow[];
  const approvedAnnualLeaveDays = personalAnnualLeaves
    .filter((leave) => leave.status === "approved")
    .reduce((sum, leave) => sum + workdaysInYear(leave.start_date, leave.end_date, leaveYear), 0);
  const pendingAnnualLeaveDays = personalAnnualLeaves
    .filter((leave) => leave.status === "pending")
    .reduce((sum, leave) => sum + workdaysInYear(leave.start_date, leave.end_date, leaveYear), 0);
  const totalUsedAnnualLeaveDays = approvedAnnualLeaveDays + priorAnnualLeaveDays;
  const remainingAnnualLeaveDays = Math.max(0, annualLeaveAllowance - totalUsedAnnualLeaveDays);
  const academyCourseIds = Array.from(new Set(academyEnrollments.map((row) => row.course_id)));
  const {data: academyCoursesData, error: academyCoursesError} = academyCourseIds.length
    ? await admin
        .from("academy_courses")
        .select("id, title, deadline, is_required, status")
        .eq("organization_id", membership.organization_id)
        .in("id", academyCourseIds)
    : {data: [] as AcademyCourseRow[], error: null};
  if (academyCoursesError) console.error("Ma journée : formations indisponibles", academyCoursesError.message);
  const academyCourses = (academyCoursesData ?? []) as AcademyCourseRow[];
  const academyCourseById = new Map(academyCourses.map((course) => [course.id, course]));
  const {data: academySessionsData, error: academySessionsError} = academyCourseIds.length
    ? await admin
        .from("academy_sessions")
        .select("id, course_id, title, session_date, local_start_time, timezone, zoom_join_url, status")
        .eq("organization_id", membership.organization_id)
        .in("course_id", academyCourseIds)
        .eq("session_date", today)
        .eq("status", "scheduled")
        .order("local_start_time")
    : {data: [] as AcademySessionRow[], error: null};
  if (academySessionsError && !["42P01", "PGRST205"].includes(academySessionsError.code)) console.error("Ma journée : séances Academy indisponibles", academySessionsError.message);
  const academySessions = (academySessionsData ?? []) as AcademySessionRow[];

  const referencedClientIds = Array.from(new Set([...tasks.map((task) => task.client_id), ...feedbacks.map((feedback) => feedback.client_id)]));
  const {data: clientsData} = referencedClientIds.length
    ? await admin.from("crm_clients").select("id, full_name").in("id", referencedClientIds)
    : {data: [] as ClientRow[]};
  const clients = (clientsData ?? []) as ClientRow[];
  const clientName = (id: string) => clients.find((client) => client.id === id)?.full_name || t("myDay.client");

  const endOfToday = new Date(`${today}T23:59:59Z`).getTime();
  const startOfToday = new Date(`${today}T00:00:00Z`).getTime();
  const dueTasks = tasks.filter((task) => task.due_at && new Date(task.due_at).getTime() <= endOfToday);
  const overdueTasks = tasks.filter((task) => task.due_at && new Date(task.due_at).getTime() < startOfToday);
  const dueCollections = collections.filter((item) => item.next_payment_due_date && item.next_payment_due_date <= today);
  const overdueCollections = collections.filter((item) => item.next_payment_due_date && item.next_payment_due_date < today);
  const duePlans = plans.filter((plan) => plan.due_date && plan.due_date <= today);
  const urgentNotifications = notifications.filter((notification) => notification.priority === "urgent");
  const pendingTrainings = academyEnrollments
    .map((enrollment) => ({enrollment, course: academyCourseById.get(enrollment.course_id)}))
    .filter((item): item is {enrollment: AcademyEnrollmentRow; course: AcademyCourseRow} => Boolean(item.course && item.course.status === "published"))
    .sort((a, b) => a.course.deadline.localeCompare(b.course.deadline));
  const activeReopening = activeReopenings.find((row) => row.report_date === today || row.report_date < today);

  const priorities: PriorityItem[] = [];
  const localMinute = timeToMinutes(localNow.time);
  const clockInReference = workPolicy === "flexible" ? startWindowUntil : startTime;
  const clockInDeadlineMinute = timeToMinutes(clockInReference) + graceMinutes;
  if (isScheduledToday && attendanceTrackingRequired && !attendance?.clock_in_at) {
    const detail = workPolicy === "flexible"
      ? t("myDay.priorities.clockInFlexibleDetail", {from: startWindowFrom, until: startWindowUntil})
      : workPolicy === "autonomous"
        ? t("myDay.priorities.clockInAutonomousDetail")
        : t("myDay.priorities.clockInDetail", {time: startTime});
    const urgent = workPolicy !== "autonomous" && localMinute > clockInDeadlineMinute;
    priorities.push({key: "clock-in", title: t("myDay.priorities.clockIn"), detail, href: "/dashboard/performance?view=attendance", tone: urgent ? "urgent" : "today", rank: urgent ? 1 : 3});
  }
  const fixedEndReached = workPolicy === "fixed" && localMinute >= timeToMinutes(endTime);
  const flexibleTargetReached = workPolicy !== "fixed" && dailyTargetMinutes > 0 && elapsedNetMinutes >= dailyTargetMinutes;
  const latestEndReached = Boolean(latestEndTime && localMinute >= timeToMinutes(latestEndTime));
  if (attendance?.clock_in_at && !attendance.clock_out_at && !activeBreak && (fixedEndReached || flexibleTargetReached || latestEndReached)) {
    const detail = flexibleTargetReached
      ? t("myDay.priorities.clockOutTargetDetail", {target: formatMinutes(dailyTargetMinutes)})
      : t("myDay.priorities.clockOutDetail", {time: latestEndReached && latestEndTime ? latestEndTime : endTime});
    priorities.push({key: "clock-out", title: t("myDay.priorities.clockOut"), detail, href: "/dashboard/performance?view=attendance", tone: "today", rank: 2});
  }
  if (reportRequiredToday && !report && reportWindowOpen) {
    priorities.push({key: "report", title: t("myDay.priorities.report"), detail: t("myDay.priorities.reportDetail", {time: reportDeadline}), href: "/dashboard/performance?view=reports", tone: timeToMinutes(localNow.time) + 60 >= timeToMinutes(reportDeadline) ? "urgent" : "today", rank: 2});
  } else if (reportRequiredToday && !report && !reportWindowOpen && activeReopening) {
    priorities.push({key: "reopened-report", title: t("myDay.priorities.reopenedReport"), detail: t("myDay.priorities.reopenedReportDetail", {date: new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium", timeStyle: "short", timeZone: timezone}).format(new Date(activeReopening.expires_at))}), href: "/dashboard/performance?view=reports", tone: "urgent", rank: 1});
  } else if (reportRequiredToday && !report && !reportWindowOpen) {
    priorities.push({key: "missing-report", title: t("myDay.priorities.missingReport"), detail: t("myDay.priorities.missingReportDetail"), href: "/dashboard/performance?view=reports", tone: "urgent", rank: 1});
  }

  ownMeetings.forEach((meeting) => {
    if (new Date(meeting.starts_at).getTime() >= requestNowTimestamp) {
      const time = new Intl.DateTimeFormat(dateLocale, {hour: "2-digit", minute: "2-digit", timeZone: timezone}).format(new Date(meeting.starts_at));
      priorities.push({key: `meeting-${meeting.id}`, title: meeting.title, detail: t("myDay.priorities.meetingDetail", {time}), href: "/dashboard/performance?view=meetings", tone: meeting.mandatory ? "today" : "soon", rank: 3});
    }
  });
  overdueTasks.slice(0, 3).forEach((task) => priorities.push({key: `task-${task.id}`, title: task.title, detail: t("myDay.priorities.overdueClientTask", {client: clientName(task.client_id)}), href: "/dashboard/crm", tone: "urgent", rank: 1}));
  dueTasks.filter((task) => !overdueTasks.some((row) => row.id === task.id)).slice(0, 3).forEach((task) => priorities.push({key: `task-${task.id}`, title: task.title, detail: t("myDay.priorities.clientTask", {client: clientName(task.client_id)}), href: "/dashboard/crm", tone: "today", rank: 3}));
  if (dailyPlanIncomplete) priorities.push({key: "daily-plan", title: dailyCopy.triggerTitle, detail: dailyCopy.triggerHelp, href: "/dashboard/my-day?plan=required#daily-priorities", tone: "urgent", rank: 1});
  overdueCollections.slice(0, 3).forEach((item) => priorities.push({key: `collection-${item.id}`, title: t("myDay.priorities.overduePayment", {client: item.customer_name}), detail: `${item.product_name} · ${formatMoney(dateLocale, item.currency, item.next_payment_amount)}`, href: "/dashboard/collections", tone: "urgent", rank: 1}));
  dueCollections.filter((item) => !overdueCollections.some((row) => row.id === item.id)).slice(0, 3).forEach((item) => priorities.push({key: `collection-${item.id}`, title: t("myDay.priorities.paymentDue", {client: item.customer_name}), detail: `${item.product_name} · ${formatMoney(dateLocale, item.currency, item.next_payment_amount)}`, href: "/dashboard/collections", tone: "today", rank: 2}));
  feedbacks.slice(0, 3).forEach((feedback) => priorities.push({key: `feedback-${feedback.id}`, title: t("myDay.priorities.lowFeedback", {client: clientName(feedback.client_id), rating: feedback.rating}), detail: feedback.comment || t("myDay.priorities.feedbackNoComment"), href: "/dashboard/crm", tone: "urgent", rank: 1}));
  duePlans.slice(0, 2).forEach((plan) => priorities.push({key: `plan-${plan.id}`, title: plan.action_title, detail: t("myDay.priorities.actionPlanDue", {progress: plan.progress}), href: "/dashboard/actions", tone: plan.due_date && plan.due_date < today ? "urgent" : "today", rank: 2}));
  urgentNotifications.slice(0, 2).forEach((notification) => priorities.push({key: `notification-${notification.id}`, title: locale === "fr" ? notification.title_fr : notification.title_en, detail: locale === "fr" ? notification.body_fr : notification.body_en, href: notification.action_url || "/dashboard/notifications", tone: "urgent", rank: 1}));
  academySessions.forEach((session) => {
    priorities.push({
      key: `academy-session-${session.id}`,
      title: session.title,
      detail: t("myDay.priorities.academySession", {time: session.local_start_time.slice(0, 5), timezone: session.timezone}),
      href: session.zoom_join_url || `/dashboard/academy?course=${session.course_id}`,
      tone: "today",
      rank: 2,
    });
  });
  pendingTrainings.slice(0, 3).forEach(({enrollment, course}) => {
    const overdue = course.deadline < today;
    const dueToday = course.deadline === today;
    const deadline = new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium"}).format(new Date(`${course.deadline}T12:00:00Z`));
    priorities.push({
      key: `academy-${enrollment.id}`,
      title: course.title,
      detail: overdue
        ? t("myDay.priorities.trainingOverdue", {date: deadline})
        : t("myDay.priorities.trainingDue", {date: deadline, progress: Number(enrollment.progress_percent)}),
      href: `/dashboard/academy?course=${course.id}`,
      tone: overdue ? "urgent" : dueToday || course.is_required ? "today" : "soon",
      rank: overdue ? 1 : dueToday ? 2 : 4,
    });
  });
  priorities.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));

  const formatDate = (value: string) => new Intl.DateTimeFormat(dateLocale, {dateStyle: "full"}).format(new Date(`${value}T00:00:00Z`));
  const formatDateTime = (value: string) => new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium", timeStyle: "short", timeZone: timezone}).format(new Date(value));
  const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat(dateLocale, {hour: "2-digit", minute: "2-digit", timeZone: timezone}).format(new Date(value)) : "—";

  let teamSection: null | {
    planned: number;
    present: number;
    late: number;
    absent: number;
    missingReports: number;
    missingDailyPlans: number;
    overdueTasks: number;
    urgentFeedback: number;
    members: Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      attendance: AttendanceRow | null;
      report: ReportRow | null;
      dailyPlan: {status: string; taskCount: number; completedCount: number; blockedCount: number} | null;
      onLeave: boolean;
      displayStatus: string;
      contactEligible: boolean;
      schedule: {startTime: string; endTime: string; timezone: string; workPolicy: "fixed" | "flexible" | "autonomous"; startWindowFrom: string; startWindowUntil: string; dailyTargetMinutes: number} | null;
    }>;
  } = null;

  if (leaderRoles.has(membership.role)) {
    const [{data: memberData}, {data: schedulesData}] = await Promise.all([
      admin.from("organization_members").select("user_id, role").eq("organization_id", membership.organization_id).eq("is_active", true).order("created_at"),
      admin.from("member_work_schedules").select("*").eq("organization_id", membership.organization_id).eq("is_active", true),
    ]);
    const members = (memberData ?? []) as MemberRow[];
    const schedules = (schedulesData ?? []) as ScheduleRow[];
    const candidateIds = membership.role === "manager"
      ? schedules.filter((schedule) => schedule.supervisor_id === authData.user.id).map((schedule) => schedule.user_id)
      : membership.role === "executive"
        ? (await getVisibleUserIds({
            admin,
            organizationId: membership.organization_id,
            actorId: authData.user.id,
            role: membership.role,
          })).filter((id) => id !== authData.user.id)
        : members.map((member) => member.user_id).filter((id) => id !== authData.user.id);
    const teamIds = Array.from(new Set(candidateIds));

    if (teamIds.length) {
      const [profilesResult, attendanceTeamResult, reportsTeamResult, leavesTeamResult, tasksTeamResult, feedbackTeamResult, detailedSchedulesResult, dailyPlansTeamResult, dailyTasksTeamResult] = await Promise.all([
        admin.from("profiles").select("id, full_name, email").in("id", teamIds),
        admin.from("attendance_records").select("*").eq("organization_id", membership.organization_id).eq("work_date", today).in("user_id", teamIds),
        admin.from("daily_reports").select("user_id, report_date, status, submitted_at").eq("organization_id", membership.organization_id).eq("report_date", today).in("user_id", teamIds),
        admin.from("leave_requests").select("user_id, status, start_date, end_date").eq("organization_id", membership.organization_id).eq("status", "approved").lte("start_date", today).gte("end_date", today).in("user_id", teamIds),
        admin.from("crm_follow_up_tasks").select("id, client_id, title, due_at, priority, status, assigned_to").eq("organization_id", membership.organization_id).in("assigned_to", teamIds).in("status", ["todo", "in_progress", "overdue"]).lt("due_at", `${today}T00:00:00Z`),
        admin.from("crm_feedback_responses").select("id, client_id, rating, resolution_status, resolution_assigned_to").eq("organization_id", membership.organization_id).in("resolution_assigned_to", teamIds).in("resolution_status", ["open", "in_progress"]).lte("rating", 2),
        admin.from("work_schedule_entries").select("user_id, work_date, timezone, start_time, end_time, grace_minutes, report_deadline_time, work_mode, location, report_required, status").eq("organization_id", membership.organization_id).eq("work_date", today).eq("status", "published").in("user_id", teamIds),
        dailyExecutionReady
          ? admin.from("daily_work_plans").select("id, user_id, status").eq("organization_id", membership.organization_id).eq("work_date", today).in("user_id", teamIds)
          : Promise.resolve({data: [] as Array<{id: string; user_id: string; status: string}>, error: null}),
        dailyExecutionReady
          ? admin.from("daily_work_tasks").select("plan_id, user_id, progress_status").eq("organization_id", membership.organization_id).eq("work_date", today).in("user_id", teamIds)
          : Promise.resolve({data: [] as Array<{plan_id: string; user_id: string; progress_status: string}>, error: null}),
      ]);

      const profiles = (profilesResult.data ?? []) as ProfileRow[];
      const teamAttendance = (attendanceTeamResult.data ?? []) as AttendanceRow[];
      const teamReports = (reportsTeamResult.data ?? []) as ReportRow[];
      const teamLeaves = (leavesTeamResult.data ?? []) as LeaveRow[];
      const teamDailyPlans = (dailyPlansTeamResult.data ?? []) as Array<{id: string; user_id: string; status: string}>;
      const teamDailyTasks = (dailyTasksTeamResult.data ?? []) as Array<{plan_id: string; user_id: string; progress_status: string}>;
      const dailyPlanByUser = new Map(teamDailyPlans.map((plan) => [plan.user_id, plan]));
      const dailyTaskSummaryByPlan = new Map<string, {taskCount: number; completedCount: number; blockedCount: number}>();
      for (const task of teamDailyTasks) {
        const summary = dailyTaskSummaryByPlan.get(task.plan_id) ?? {taskCount: 0, completedCount: 0, blockedCount: 0};
        summary.taskCount += 1;
        if (task.progress_status === "completed") summary.completedCount += 1;
        if (task.progress_status === "blocked") summary.blockedCount += 1;
        dailyTaskSummaryByPlan.set(task.plan_id, summary);
      }
      const hasValidDailyPlan = (userId: string) => {
        const plan = dailyPlanByUser.get(userId);
        if (!plan) return false;
        return (dailyTaskSummaryByPlan.get(plan.id)?.taskCount ?? 0) >= dailyMinimumTasks;
      };
      const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
      const scheduleById = new Map(schedules.map((schedule) => [schedule.user_id, schedule]));
      const detailedSchedules = (detailedSchedulesResult.data ?? []) as ScheduleEntryRow[];
      const detailedById = new Map(detailedSchedules.map((schedule) => [schedule.user_id, schedule]));
      const plannedIds = teamIds.filter((id) => {
        const detailed = detailedById.get(id);
        if (detailed) return detailed.work_mode !== "off";
        return (scheduleById.get(id)?.work_days ?? [1, 2, 3, 4, 5]).includes(weekday);
      });
      const onLeaveIds = new Set(teamLeaves.map((leave) => leave.user_id));
      const presentIds = new Set(teamAttendance.filter((row) => Boolean(row.clock_in_at) && row.status !== "absent").map((row) => row.user_id));
      const lateIds = new Set(teamAttendance.filter((row) => row.status === "late" || row.late_minutes > 0).map((row) => row.user_id));
      const reportIds = new Set(teamReports.map((row) => row.user_id));
      const roleById = new Map(members.map((member) => [member.user_id, member.role]));
      const teamMemberRows = plannedIds.map((id) => {
        const profile = profileById.get(id);
        const attendanceRow = teamAttendance.find((row) => row.user_id === id) ?? null;
        const regularSchedule = scheduleById.get(id) ?? null;
        const detailedSchedule = detailedById.get(id) ?? null;
        const memberTimezone = normalizeTimeZone(detailedSchedule?.timezone || regularSchedule?.timezone || settings.timezone);
        const startTime = (detailedSchedule?.start_time || regularSchedule?.start_time || settings.default_start_time).slice(0, 5);
        const endTime = (detailedSchedule?.end_time || regularSchedule?.end_time || settings.default_end_time).slice(0, 5);
        const graceMinutes = detailedSchedule?.grace_minutes ?? regularSchedule?.grace_minutes ?? 0;
        const memberPolicy = regularSchedule?.work_policy || "fixed";
        const startWindowFrom = String(regularSchedule?.start_window_from || startTime).slice(0, 5);
        const startWindowUntil = String(regularSchedule?.start_window_until || startTime).slice(0, 5);
        const trackingRequired = regularSchedule?.attendance_tracking_required !== false;
        const attendanceDeadline = memberPolicy === "flexible" ? startWindowUntil : startTime;
        const memberLocalNow = zonedParts(requestNow, memberTimezone);
        const afterStartWindow = trackingRequired && memberPolicy !== "autonomous" && (
          memberLocalNow.date > today ||
          (memberLocalNow.date === today && timeToMinutes(memberLocalNow.time) > timeToMinutes(attendanceDeadline) + graceMinutes)
        );
        const onLeave = onLeaveIds.has(id);
        const isLate = Boolean(attendanceRow && (attendanceRow.status === "late" || attendanceRow.late_minutes > 0));
        const isExplicitlyAbsent = attendanceRow?.status === "absent";
        const missingAfterStart = !attendanceRow?.clock_in_at && afterStartWindow;
        const displayStatus = onLeave
          ? "excused"
          : isLate
            ? "late"
            : attendanceRow?.status || (missingAfterStart ? "absent" : "pending");
        const contactEligible = !onLeave && (isLate || isExplicitlyAbsent || missingAfterStart);

        return {
          id,
          name: profile?.full_name?.trim() || profile?.email || t("common.member"),
          email: profile?.email || "",
          role: roleById.get(id) || "employee",
          attendance: attendanceRow,
          report: teamReports.find((row) => row.user_id === id) ?? null,
          dailyPlan: (() => {
            const plan = dailyPlanByUser.get(id);
            if (!plan || !hasValidDailyPlan(id)) return null;
            const summary = dailyTaskSummaryByPlan.get(plan.id) ?? {taskCount: 0, completedCount: 0, blockedCount: 0};
            return {status: plan.status, ...summary};
          })(),
          onLeave,
          displayStatus,
          contactEligible,
          schedule: {
            startTime,
            endTime,
            timezone: memberTimezone,
            workPolicy: memberPolicy,
            startWindowFrom,
            startWindowUntil,
            dailyTargetMinutes: Math.max(0, Number(regularSchedule?.daily_target_minutes ?? 0)),
          },
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      teamSection = {
        planned: plannedIds.length,
        present: teamMemberRows.filter((member) => Boolean(member.attendance?.clock_in_at) && member.displayStatus !== "absent").length,
        late: teamMemberRows.filter((member) => member.displayStatus === "late").length,
        absent: teamMemberRows.filter((member) => member.displayStatus === "absent").length,
        missingReports: plannedIds.filter((id) => !reportIds.has(id)).length,
        missingDailyPlans: dailyExecutionReady && dailyExecutionSettings.enabled && today >= dailyExecutionSettings.required_from
          ? plannedIds.filter((id) => presentIds.has(id) && !hasValidDailyPlan(id)).length
          : 0,
        overdueTasks: (tasksTeamResult.data ?? []).length,
        urgentFeedback: (feedbackTeamResult.data ?? []).length,
        members: teamMemberRows,
      };
    }
  }

  let absencePanel: AbsenceContactPanelProps | null = null;
  const contactReturnTo = "/dashboard/my-day";
  const selectedMember = teamSection?.members.find((member) => member.id === contactUserId) ?? null;
  if (
    leaderRoles.has(membership.role) &&
    selectedMember &&
    contactDate === today &&
    /^\d{4}-\d{2}-\d{2}$/.test(contactDate) &&
    selectedMember.id !== authData.user.id
  ) {
    const [workContactResult, assignmentResult, lastAttendanceResult, followupsResult] = await Promise.all([
      admin
        .from("employee_work_contacts")
        .select("user_id,work_phone,work_whatsapp,position_title")
        .eq("organization_id", membership.organization_id)
        .eq("user_id", selectedMember.id)
        .maybeSingle<WorkContactRow>(),
      admin.from("team_members").select("team_id").eq("user_id", selectedMember.id),
      admin
        .from("attendance_records")
        .select("clock_in_at")
        .eq("organization_id", membership.organization_id)
        .eq("user_id", selectedMember.id)
        .lt("work_date", contactDate)
        .not("clock_in_at", "is", null)
        .order("work_date", {ascending: false})
        .limit(1)
        .maybeSingle<{clock_in_at: string | null}>(),
      admin
        .from("absence_contact_followups")
        .select("id,subject_user_id,attendance_id,work_date,contact_channel,outcome,note,next_follow_up_at,created_by,created_at")
        .eq("organization_id", membership.organization_id)
        .eq("subject_user_id", selectedMember.id)
        .eq("work_date", contactDate)
        .order("created_at", {ascending: false})
        .limit(50),
    ]);

    const workContact: WorkContactRow = workContactResult.data ?? {
      user_id: selectedMember.id,
      work_phone: null,
      work_whatsapp: null,
      position_title: null,
    };
    const assignments = (assignmentResult.data ?? []) as TeamAssignmentRow[];
    const teamIds = assignments.map((row) => row.team_id);
    const teamsResult = teamIds.length
      ? await admin
          .from("teams")
          .select("id,name,department")
          .eq("organization_id", membership.organization_id)
          .in("id", teamIds)
      : {data: [] as TeamDetailRow[], error: null};
    const teams = (teamsResult.data ?? []) as TeamDetailRow[];
    const followupRows = (followupsResult.data ?? []) as AbsenceFollowupRow[];
    const actorIds = Array.from(new Set(followupRows.map((row) => row.created_by)));
    const actorResult = actorIds.length
      ? await admin.from("profiles").select("id,full_name,email").in("id", actorIds)
      : {data: [] as ProfileRow[], error: null};
    const actorById = new Map(
      ((actorResult.data ?? []) as ProfileRow[]).map((profile) => [
        profile.id,
        profile.full_name?.trim() || profile.email || t("common.member"),
      ]),
    );
    const history: AbsenceFollowupItem[] = followupRows.map((row) => ({
      id: row.id,
      contact_channel: row.contact_channel,
      outcome: row.outcome,
      note: row.note,
      next_follow_up_at: row.next_follow_up_at,
      created_at: row.created_at,
      actor_name: actorById.get(row.created_by) || t("common.member"),
    }));
    const department = teams.find((team) => team.department?.trim())?.department?.trim() || "";

    absencePanel = {
      locale,
      closeHref: contactReturnTo,
      returnTo: contactReturnTo,
      workDate: contactDate,
      timezone: selectedMember.schedule?.timezone || timezone,
      canEditContact: ["owner", "admin", "hr"].includes(membership.role),
      member: {
        id: selectedMember.id,
        name: selectedMember.name,
        email: selectedMember.email,
        workPhone: workContact.work_phone || "",
        workWhatsapp: workContact.work_whatsapp || "",
        positionTitle: workContact.position_title || "",
        roleLabel: t(`roles.${selectedMember.role}`),
        department,
        teams: teams.map((team) => team.name),
      },
      attendance: selectedMember.attendance ? {
        status: selectedMember.displayStatus,
        clockInAt: selectedMember.attendance.clock_in_at,
        lateMinutes: selectedMember.attendance.late_minutes,
        justification: selectedMember.attendance.justification,
      } : {
        status: selectedMember.displayStatus,
        clockInAt: null,
        lateMinutes: 0,
        justification: null,
      },
      schedule: selectedMember.schedule,
      onLeave: selectedMember.onLeave,
      lastAttendanceAt: lastAttendanceResult.data?.clock_in_at ?? null,
      followups: history,
    };
  }

  const fullName = String(authData.user.user_metadata?.full_name ?? "").trim() || t("common.user");
  const workPolicyLabel = t(`performance.workPolicies.${workPolicy}`);
  const policyScheduleDescription = workPolicy === "flexible"
    ? t("myDay.workPolicy.flexibleSchedule", {from: startWindowFrom, until: startWindowUntil, target: formatMinutes(dailyTargetMinutes)})
    : workPolicy === "autonomous"
      ? t("myDay.workPolicy.autonomousSchedule", {target: formatMinutes(weeklyTargetMinutes)})
      : t("myDay.workPolicy.fixedSchedule", {start: startTime, end: endTime});
  const attendanceLabel = attendance?.clock_out_at
    ? t("myDay.attendance.completed")
    : activeBreak
      ? t("myDay.attendance.paused")
      : attendance?.clock_in_at
        ? t("myDay.attendance.inProgress")
        : isScheduledToday
          ? t("myDay.attendance.notStarted")
          : t("myDay.attendance.notScheduled");
  const reportLabel = report
    ? t("myDay.report.submitted")
    : !reportRequiredToday
      ? t("myDay.report.notRequired")
      : reportWindowOpen
      ? t("myDay.report.toSubmit")
      : activeReopening
        ? t("myDay.report.reopened")
        : t("myDay.report.locked");
  const attendanceDetail = activeBreak
    ? t("myDay.metrics.pauseStartedAt", {time: formatTime(activeBreak.started_at)})
    : attendance?.clock_in_at
      ? t("myDay.metrics.clockedInAt", {time: formatTime(attendance.clock_in_at)})
      : policyScheduleDescription;
  const reportDetail = report
    ? t("myDay.metrics.submittedAt", {time: formatTime(report.submitted_at)})
    : activeReopening
      ? t("myDay.metrics.reopenedUntil", {time: formatTime(activeReopening.expires_at)})
      : reportWindowOpen
        ? t("myDay.metrics.deadline", {time: reportDeadline})
        : t("myDay.metrics.reopeningRequired");

  const {data: announcementRecipientData, error: announcementRecipientError} = await admin
    .from("official_announcement_recipients")
    .select("announcement_id,acknowledged_at")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", authData.user.id);
  if (announcementRecipientError && !["42P01", "PGRST205"].includes(announcementRecipientError.code)) {
    console.error("Ma journée : annonces officielles indisponibles", announcementRecipientError.message);
  }
  const announcementRecipients = (announcementRecipientData ?? []) as DashboardAnnouncementRecipientRow[];
  const announcementRecipientById = new Map(announcementRecipients.map((row) => [row.announcement_id, row]));
  const announcementIds = announcementRecipients.map((row) => row.announcement_id);
  const {data: dashboardAnnouncementData, error: dashboardAnnouncementError} = announcementIds.length
    ? await admin
        .from("official_announcements")
        .select("id,title,body,title_fr,body_fr,title_en,body_en,category,priority,acknowledgement_required,publish_at,expires_at,published_at")
        .eq("organization_id", membership.organization_id)
        .eq("status", "published")
        .in("id", announcementIds)
        .lte("publish_at", requestNowIso)
        .order("published_at", {ascending: false})
    : {data: [] as DashboardAnnouncementRow[], error: null};
  if (dashboardAnnouncementError && !["42P01", "PGRST205"].includes(dashboardAnnouncementError.code)) {
    console.error("Ma journée : contenu des annonces indisponible", dashboardAnnouncementError.message);
  }
  const dashboardAnnouncements = ((dashboardAnnouncementData ?? []) as DashboardAnnouncementRow[])
    .filter((announcement) => !announcement.expires_at || new Date(announcement.expires_at).getTime() > requestNowTimestamp)
    .sort((a, b) => {
      const weight = (priority: string) => priority === "urgent" ? 0 : priority === "important" ? 1 : 2;
      const acknowledgementDifference = Number(Boolean(announcementRecipientById.get(a.id)?.acknowledged_at)) - Number(Boolean(announcementRecipientById.get(b.id)?.acknowledged_at));
      return acknowledgementDifference || weight(a.priority) - weight(b.priority) || new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime();
    });

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-xl">
          <div className="grid gap-8 p-7 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">{t("myDay.eyebrow")}</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">{t("myDay.greeting", {name: fullName})}</h1>
              <p className="mt-3 max-w-3xl text-slate-300">{t("myDay.subtitle")}</p>
              <p className="mt-4 text-sm font-bold text-slate-400">{formatDate(today)} · {timezone}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-center">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{t("myDay.currentTime")}</p>
              <p className="mt-1 text-4xl font-black text-amber-400">{localNow.time}</p>
              <p className="mt-2 max-w-xs text-xs text-slate-400">{workPolicyLabel} · {policyScheduleDescription}</p>
            </div>
          </div>
        </header>

        {dashboardAnnouncements.length ? <section aria-label={locale === "fr" ? "Annonces officielles" : "Official announcements"} className="mt-4 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 shadow-sm">
          <div className="flex items-stretch">
            <div className="relative z-10 flex shrink-0 items-center gap-2 bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-amber-300 sm:px-5">
              <span aria-hidden="true">📢</span>
              <span className="hidden sm:inline">{locale === "fr" ? "Annonce officielle" : "Official announcement"}</span>
            </div>
            <div className="group min-w-0 flex-1 overflow-hidden py-3">
              <div className="official-announcement-track flex w-max items-center gap-12 px-6 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
                {[...dashboardAnnouncements, ...dashboardAnnouncements].map((announcement, index) => {
                  const acknowledged = Boolean(announcementRecipientById.get(announcement.id)?.acknowledged_at);
                  const localizedAnnouncement = dashboardAnnouncementText(announcement, locale);
                  return <Link key={`${announcement.id}-${index}`} href={`/dashboard/announcements#announcement-${announcement.id}`} className="flex items-center gap-3 whitespace-nowrap text-sm font-black text-slate-950 underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950">
                    <span className={announcement.priority === "urgent" ? "text-red-700" : announcement.priority === "important" ? "text-amber-700" : "text-indigo-700"}>{announcement.priority === "urgent" ? "URGENT" : announcement.priority === "important" ? "IMPORTANT" : (locale === "fr" ? "INFORMATION" : "INFORMATION")}</span>
                    <span>{localizedAnnouncement.title}</span>
                    <span className="max-w-[70vw] truncate font-semibold text-slate-600">— {localizedAnnouncement.body}</span>
                    {announcement.acknowledgement_required && !acknowledged ? <span className="rounded-full bg-red-700 px-2.5 py-1 text-[10px] uppercase tracking-wide text-white">{locale === "fr" ? "À confirmer" : "Acknowledgement required"}</span> : null}
                  </Link>;
                })}
              </div>
            </div>
            <Link href="/dashboard/announcements" className="relative z-10 flex shrink-0 items-center bg-amber-400 px-4 text-xs font-black text-slate-950 hover:bg-amber-300 sm:px-5">{locale === "fr" ? "Ouvrir" : "Open"}</Link>
          </div>
        </section> : null}

        {successMessage ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-black text-emerald-800">{successMessage}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-black text-red-800">{errorMessage}</p> : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label={t("myDay.metrics.attendance")} value={attendanceLabel} detail={attendanceDetail} tone={activeBreak ? "amber" : attendance?.clock_in_at ? (attendance.status === "late" ? "amber" : "emerald") : "slate"} />
          <Metric label={t("myDay.metrics.report")} value={reportLabel} detail={reportDetail} tone={report ? "emerald" : !isScheduledToday ? "slate" : reportWindowOpen || activeReopening ? "amber" : "red"} />
          <Metric label={t("myDay.metrics.meetings")} value={ownMeetings.length} detail={t("myDay.metrics.today")} tone={ownMeetings.length ? "indigo" : "slate"} />
          <Metric label={t("myDay.metrics.tasks")} value={dailyWorkTasks.length || dueTasks.length + duePlans.length} detail={dailyWorkTasks.length ? `${dailyTasksCompleted}/${dailyWorkTasks.length} ${locale === "fr" ? "terminées" : "completed"}` : t("myDay.metrics.overdue", {count: overdueTasks.length + duePlans.filter((plan) => plan.due_date && plan.due_date < today).length})} tone={dailyPlanIncomplete ? "red" : dailyWorkTasks.length && dailyTasksCompleted < dailyWorkTasks.length ? "amber" : dailyWorkTasks.length ? "emerald" : overdueTasks.length ? "red" : dueTasks.length ? "amber" : "slate"} />
          <Metric label={t("myDay.metrics.notifications")} value={notifications.length} detail={t("myDay.metrics.urgent", {count: urgentNotifications.length})} tone={urgentNotifications.length ? "red" : notifications.length ? "amber" : "slate"} />
          <Metric label={t("myDay.metrics.score")} value={score ? `${number(score.total_score).toFixed(1)}/100` : "—"} detail={score?.position ? t("myDay.metrics.position", {position: score.position}) : t("myDay.metrics.awaitingScore")} tone={score?.eligible ? "emerald" : "slate"} />
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">{t("myDay.workPolicy.eyebrow")}</p>
                <StatusPill tone={workPolicy === "fixed" ? "slate" : workPolicy === "flexible" ? "indigo" : "emerald"}>{workPolicyLabel}</StatusPill>
                {activeBreak ? <StatusPill tone="amber">{t("myDay.attendance.paused")}</StatusPill> : null}
              </div>
              <h2 className="mt-2 text-2xl font-black">{t("myDay.workPolicy.title")}</h2>
              <p className="mt-2 text-sm text-slate-600">{policyScheduleDescription}</p>
              {currentSchedule?.core_hours_start && currentSchedule?.core_hours_end ? <p className="mt-2 text-xs font-bold text-slate-500">{t("myDay.workPolicy.coreHours", {start: currentSchedule.core_hours_start.slice(0,5), end: currentSchedule.core_hours_end.slice(0,5)})}</p> : null}
            </div>
            <div className="grid min-w-full grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[560px]">
              <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-bold text-slate-500">{t("myDay.workPolicy.worked")}</p><p className="mt-1 font-black">{formatMinutes(elapsedNetMinutes)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-bold text-slate-500">{t("myDay.workPolicy.target")}</p><p className="mt-1 font-black">{formatMinutes(dailyTargetMinutes)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-bold text-slate-500">{t("myDay.workPolicy.remaining")}</p><p className="mt-1 font-black">{formatMinutes(remainingTargetMinutes)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-xs font-bold text-slate-500">{t("myDay.workPolicy.pauses")}</p><p className="mt-1 font-black">{formatMinutes(recordedPauseMinutes)}</p></div>
            </div>
          </div>
          {!flexibleWorkReady ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">{t("myDay.workPolicy.migrationRequired")}</p> : null}
          {!attendanceTrackingRequired ? <p className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm font-bold text-indigo-900">{t("myDay.workPolicy.trackingOptional")}</p> : null}
        </section>

        {activePriorityReopening ? (
          <section className="mt-6 rounded-3xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">{locale === "fr" ? "Réouverture exceptionnelle" : "Exceptional reopening"}</p>
            <h2 className="mt-1 text-xl font-black text-amber-950">{locale === "fr" ? "Tes priorités du jour sont de nouveau ouvertes" : "Your daily priorities are open again"}</h2>
            <p className="mt-2 text-sm leading-6 text-amber-900">
              {locale === "fr"
                ? `Tu peux soumettre ou corriger tes priorités jusqu’au ${new Intl.DateTimeFormat("fr-FR", {dateStyle: "medium", timeStyle: "short", timeZone: timezone}).format(new Date(activePriorityReopening.expires_at))}. Motif : ${activePriorityReopening.reason}`
                : `You can submit or revise your priorities until ${new Intl.DateTimeFormat("en-GB", {dateStyle: "medium", timeStyle: "short", timeZone: timezone}).format(new Date(activePriorityReopening.expires_at))}. Reason: ${activePriorityReopening.reason}`}
            </p>
            <p className="mt-2 text-xs font-bold text-amber-800">{locale === "fr" ? "La réouverture se ferme automatiquement dès ta soumission." : "The reopening closes automatically as soon as you submit."}</p>
          </section>
        ) : null}

        <DailyWorkPlanPanel
          locale={locale}
          workDate={today}
          attendanceStarted={Boolean(attendance?.clock_in_at)}
          attendanceClosed={Boolean(attendance?.clock_out_at)}
          migrationReady={dailyExecutionReady}
          enabled={dailyExecutionSettings.enabled && today >= dailyExecutionSettings.required_from}
          minimumTasks={dailyMinimumTasks}
          maximumTasks={dailyMaximumTasks}
          plan={dailyPlan}
          tasks={dailyWorkTasks}
          highlight={planPrompt === "required" || dailyPlanIncomplete}
          reportSubmitted={Boolean(report)}
          draftScope={`${membership.organization_id}:${authData.user.id}`}
          planSaved={planPrompt === "saved"}
        />

        {attendance?.clock_out_at ? (
          <section className="mt-6 rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">{t("myDay.timeSummary.eyebrow")}</p>
                <h2 className="mt-1 text-2xl font-black text-indigo-950">{t("myDay.timeSummary.title")}</h2>
                <p className="mt-1 text-sm text-indigo-800">{t("myDay.timeSummary.help")}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-xl bg-white p-3 text-center"><p className="text-xs font-bold text-slate-500">{t("myDay.timeSummary.worked")}</p><p className="mt-1 font-black">{formatMinutes(attendance.total_work_minutes)}</p></div>
                <div className="rounded-xl bg-white p-3 text-center"><p className="text-xs font-bold text-slate-500">{t("myDay.workPolicy.target")}</p><p className="mt-1 font-black">{formatMinutes(attendance.target_work_minutes ?? dailyTargetMinutes)}</p></div>
                <div className="rounded-xl bg-white p-3 text-center"><p className="text-xs font-bold text-slate-500">{t("myDay.workPolicy.pauses")}</p><p className="mt-1 font-black">{formatMinutes(attendance.pause_minutes ?? 0)}</p></div>
                <div className="rounded-xl bg-white p-3 text-center"><p className="text-xs font-bold text-slate-500">{t("myDay.timeSummary.outside")}</p><p className="mt-1 font-black">{formatMinutes(attendance.outside_schedule_minutes)}</p></div>
                <div className="rounded-xl bg-white p-3 text-center"><p className="text-xs font-bold text-slate-500">{t("myDay.timeSummary.night")}</p><p className="mt-1 font-black">{formatMinutes(attendance.night_minutes)}</p></div>
                <div className="rounded-xl bg-white p-3 text-center"><p className="text-xs font-bold text-slate-500">{t("myDay.timeSummary.weekend")}</p><p className="mt-1 font-black">{formatMinutes(attendance.weekend_minutes)}</p></div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {attendance.target_met ? <StatusPill tone="emerald">{t("myDay.workPolicy.targetMet")}</StatusPill> : null}
              {attendance.short_day ? <StatusPill tone="amber">{t("myDay.workPolicy.shortDay")}</StatusPill> : null}
            </div>
            {attendance.short_day && attendance.short_day_justification ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>{t("myDay.workPolicy.shortDayReason")}:</strong> {attendance.short_day_justification}</p> : null}
            {attendance.total_work_minutes >= Number(settings.long_day_warning_minutes || 720) || attendance.night_minutes > 0 || attendance.weekend_minutes > 0 ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">{t("myDay.timeSummary.wellbeing")}</p> : null}
          </section>
        ) : null}

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">{t("myDay.quickActions.eyebrow")}</p>
                <h2 className="mt-1 text-2xl font-black">{t("myDay.quickActions.title")}</h2>
              </div>
              <Link href="/dashboard/performance" className="text-sm font-black text-indigo-700 hover:text-indigo-900">{t("myDay.viewPerformance")}</Link>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <form action={clockInAction}>
                <input type="hidden" name="returnTo" value="/dashboard/my-day" />
                <button disabled={Boolean(attendance?.clock_in_at) || !isScheduledToday || !flexibleWorkReady} className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-40">
                  {attendance?.clock_in_at ? t("myDay.quickActions.alreadyClockedIn") : t("myDay.quickActions.clockIn")}
                </button>
              </form>
              {attendance?.clock_in_at && !attendance.clock_out_at && pauseTrackingEnabled ? (
                activeBreak ? (
                  <form action={resumeWorkdayAction}>
                    <input type="hidden" name="returnTo" value="/dashboard/my-day" />
                    <button disabled={!flexibleWorkReady} className="w-full rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3 font-black text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40">{t("myDay.quickActions.resume")}</button>
                  </form>
                ) : (
                  <form action={pauseWorkdayAction}>
                    <input type="hidden" name="returnTo" value="/dashboard/my-day" />
                    <input type="hidden" name="pauseReason" value="Pause de travail" />
                    <button disabled={!flexibleWorkReady} className="w-full rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 font-black text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40">{t("myDay.quickActions.pause")}</button>
                  </form>
                )
              ) : (
                <button disabled className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-5 py-3 font-black text-slate-400">{t("myDay.quickActions.pause")}</button>
              )}
              <form action={clockOutAction} className="space-y-3 sm:col-span-2">
                <input type="hidden" name="returnTo" value="/dashboard/my-day" />
                {attendance?.clock_in_at && !attendance.clock_out_at && remainingTargetMinutes > 0 ? (
                  <label className="block text-sm font-black text-slate-700">
                    {t("myDay.quickActions.shortDayJustification")}
                    <textarea name="shortDayJustification" minLength={5} required={currentSchedule?.short_day_justification_required !== false} rows={3} placeholder={t("myDay.quickActions.shortDayPlaceholder")} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium outline-none focus:border-indigo-500" />
                    <span className="mt-1 block text-xs font-medium text-slate-500">{t("myDay.quickActions.remainingBeforeClose", {remaining: formatMinutes(remainingTargetMinutes)})}</span>
                  </label>
                ) : <input type="hidden" name="shortDayJustification" value="" />}
                {currentSchedule?.report_required_before_clock_out && !report ? <p className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm font-bold text-indigo-900">{t("myDay.quickActions.reportRequiredBeforeClose")}</p> : null}
                <ConfirmSubmitButton confirmation={t("myDay.quickActions.clockOutConfirmation")} dialogTitle={t("common.confirmationTitle")} confirmLabel={t("common.confirm")} cancelLabel={t("common.cancel")} disabled={!attendance?.clock_in_at || Boolean(attendance.clock_out_at) || !flexibleWorkReady} className="w-full rounded-xl border border-indigo-300 bg-indigo-50 px-5 py-3 font-black text-indigo-800 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40">
                  {attendance?.clock_out_at ? t("myDay.quickActions.alreadyClockedOut") : t("myDay.quickActions.clockOut")}
                </ConfirmSubmitButton>
              </form>
              <Link href="/dashboard/performance?view=reports" className="rounded-xl border border-slate-200 px-5 py-3 text-center font-black text-slate-800 transition hover:bg-slate-50">{t("myDay.quickActions.dailyReport")}</Link>
              <Link href="/dashboard/notifications" className="rounded-xl border border-slate-200 px-5 py-3 text-center font-black text-slate-800 transition hover:bg-slate-50">{t("myDay.quickActions.notifications")}</Link>
              <Link href="/dashboard/performance?view=meetings" className="rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3 text-center font-black text-indigo-800 transition hover:bg-indigo-100">{t("myDay.quickActions.meetings")}</Link>
              <Link href="/dashboard/schedule" className="rounded-xl border border-slate-200 px-5 py-3 text-center font-black text-slate-800 transition hover:bg-slate-50">{t("myDay.quickActions.schedule")}</Link>
              <Link href="/dashboard/crm" className="rounded-xl border border-slate-200 px-5 py-3 text-center font-black text-slate-800 transition hover:bg-slate-50">{t("myDay.quickActions.crm")}</Link>
              <Link href="/dashboard/collections" className="rounded-xl border border-slate-200 px-5 py-3 text-center font-black text-slate-800 transition hover:bg-slate-50">{t("myDay.quickActions.collections")}</Link>
              <Link href="/dashboard/academy" className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 text-center font-black text-amber-900 transition hover:bg-amber-100">{t("myDay.quickActions.academy")}</Link>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.16em] text-red-600">{t("myDay.priorities.eyebrow")}</p>
                <h2 className="mt-1 text-2xl font-black">{t("myDay.priorities.title")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("myDay.priorities.subtitle")}</p>
              </div>
              <StatusPill tone={priorities.some((item) => item.tone === "urgent") ? "red" : priorities.length ? "amber" : "emerald"}>{priorities.length}</StatusPill>
            </div>
            <div className="mt-5 space-y-3">
              {priorities.length ? priorities.slice(0, 10).map((item) => (
                <Link key={item.key} href={item.href} className={`block rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${priorityTone(item.tone)}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-black">{item.title}</p>
                      <p className="mt-1 line-clamp-2 text-sm opacity-75">{item.detail}</p>
                    </div>
                    <span className="shrink-0 text-lg">→</span>
                  </div>
                </Link>
              )) : (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
                  <p className="text-xl font-black text-emerald-900">{t("myDay.priorities.emptyTitle")}</p>
                  <p className="mt-2 text-sm text-emerald-700">{t("myDay.priorities.emptyDescription")}</p>
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-3">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black">{t("myDay.agenda.meetings")}</h2>
              <Link href="/dashboard/performance?view=meetings" className="text-sm font-black text-indigo-700">{t("myDay.open")}</Link>
            </div>
            <div className="mt-4 space-y-3">
              {ownMeetings.length ? ownMeetings.map((meeting) => {
                const attendanceStatus = ownMeetingAttendance.find((row) => row.meeting_id === meeting.id)?.status || "invited";
                return (
                  <div key={meeting.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3"><p className="font-black">{meeting.title}</p><StatusPill tone={meeting.mandatory ? "amber" : "slate"}>{meeting.mandatory ? t("myDay.mandatory") : t("myDay.optional")}</StatusPill></div>
                    <p className="mt-2 text-sm text-slate-500">{formatDateTime(meeting.starts_at)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill tone={statusTone(attendanceStatus)}>{t(`performance.meetingStatuses.${attendanceStatus}`)}</StatusPill>{meeting.provider === "zoom" ? <StatusPill tone="indigo">Zoom</StatusPill> : null}</div>
                    {meeting.meeting_url ? <a href={meeting.meeting_url} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl bg-blue-600 px-4 py-2 text-center text-sm font-black text-white">{locale === "fr" ? "Rejoindre sur Zoom" : "Join on Zoom"}</a> : null}
                  </div>
                );
              }) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{t("myDay.agenda.noMeetings")}</p>}
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black">{t("myDay.agenda.clientTasks")}</h2><Link href="/dashboard/crm" className="text-sm font-black text-indigo-700">{t("myDay.open")}</Link></div>
            <div className="mt-4 space-y-3">
              {tasks.length ? tasks.slice(0, 6).map((task) => (
                <div key={task.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3"><p className="font-black">{task.title}</p><StatusPill tone={task.priority === "urgent" ? "red" : task.priority === "high" ? "amber" : "slate"}>{task.priority}</StatusPill></div>
                  <p className="mt-1 text-sm text-slate-500">{clientName(task.client_id)}</p>
                  <p className="mt-2 text-xs font-bold text-slate-500">{task.due_at ? formatDateTime(task.due_at) : t("myDay.noDeadline")}</p>
                </div>
              )) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{t("myDay.agenda.noClientTasks")}</p>}
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black">{t("myDay.agenda.collections")}</h2><Link href="/dashboard/collections" className="text-sm font-black text-indigo-700">{t("myDay.open")}</Link></div>
            <div className="mt-4 space-y-3">
              {collections.length ? collections.slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3"><p className="font-black">{item.customer_name}</p><StatusPill tone={item.collection_status === "overdue" || (item.next_payment_due_date && item.next_payment_due_date < today) ? "red" : "amber"}>{t(`collections.statuses.${item.collection_status}`)}</StatusPill></div>
                  <p className="mt-1 text-sm text-slate-500">{item.product_name}</p>
                  <p className="mt-2 text-sm font-black text-slate-800">{formatMoney(dateLocale, item.currency, item.next_payment_amount)}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.next_payment_due_date ? new Intl.DateTimeFormat(dateLocale, {dateStyle: "medium"}).format(new Date(`${item.next_payment_due_date}T00:00:00Z`)) : t("myDay.noDeadline")}</p>
                </div>
              )) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">{t("myDay.agenda.noCollections")}</p>}
            </div>
          </article>
        </section>

        {teamSection ? (
          <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div><p className="text-sm font-black uppercase tracking-[0.16em] text-indigo-700">{t("myDay.team.eyebrow")}</p><h2 className="mt-1 text-3xl font-black">{t("myDay.team.title")}</h2><p className="mt-2 text-slate-500">{t("myDay.team.subtitle")}</p></div>
              <Link href="/dashboard/performance?view=attendance" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white">{t("myDay.team.manage")}</Link>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-8">
              <Metric label={t("myDay.team.planned")} value={teamSection.planned} />
              <Metric label={t("myDay.team.present")} value={teamSection.present} tone="emerald" />
              <Metric label={t("myDay.team.late")} value={teamSection.late} tone={teamSection.late ? "amber" : "slate"} />
              <Metric label={t("myDay.team.absent")} value={teamSection.absent} tone={teamSection.absent ? "red" : "slate"} />
              <Metric label={dailyCopy.planStatus} value={teamSection.missingDailyPlans} tone={teamSection.missingDailyPlans ? "amber" : "emerald"} />
              <Metric label={t("myDay.team.missingReports")} value={teamSection.missingReports} tone={teamSection.missingReports ? "amber" : "slate"} />
              <Metric label={t("myDay.team.overdueTasks")} value={teamSection.overdueTasks} tone={teamSection.overdueTasks ? "red" : "slate"} />
              <Metric label={t("myDay.team.urgentFeedback")} value={teamSection.urgentFeedback} tone={teamSection.urgentFeedback ? "red" : "slate"} />
            </div>
            <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">{t("myDay.team.employee")}</th><th className="px-4 py-3">{t("myDay.team.attendance")}</th><th className="px-4 py-3">{t("myDay.team.arrival")}</th><th className="px-4 py-3">{dailyCopy.planStatus}</th><th className="px-4 py-3">{dailyCopy.teamTasks}</th><th className="px-4 py-3">{t("myDay.team.report")}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {teamSection.members.map((member) => {
                    const attendanceStatus = member.displayStatus;
                    return (
                      <tr key={member.id} className="bg-white">
                        <td className="px-4 py-3 font-black">
                          {member.contactEligible ? (
                            <form action={openAbsenceContactAction}>
                              <input type="hidden" name="subjectUserId" value={member.id} />
                              <input type="hidden" name="workDate" value={today} />
                              <input type="hidden" name="returnTo" value="/dashboard/my-day" />
                              <button
                                className={`rounded-lg px-2 py-1 text-left underline decoration-2 underline-offset-4 transition hover:-translate-y-0.5 hover:shadow-sm ${
                                  attendanceStatus === "late"
                                    ? "bg-amber-50 text-amber-800 decoration-amber-400 hover:bg-amber-100"
                                    : "bg-red-50 text-red-800 decoration-red-400 hover:bg-red-100"
                                }`}
                                title={locale === "fr" ? `Contacter et suivre ${member.name}` : `Contact and follow up with ${member.name}`}
                              >
                                {member.name}
                              </button>
                            </form>
                          ) : member.name}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill tone={statusTone(attendanceStatus)}>
                            {member.onLeave ? t("myDay.team.onLeave") : t(`performance.statuses.${attendanceStatus}`)}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{member.attendance?.clock_in_at ? formatTime(member.attendance.clock_in_at) : "—"}</td>
                        <td className="px-4 py-3"><StatusPill tone={member.dailyPlan ? "emerald" : member.attendance?.clock_in_at ? "amber" : "slate"}>{member.dailyPlan ? dailyCopy.teamReady : dailyCopy.teamMissing}</StatusPill></td>
                        <td className="px-4 py-3 text-sm font-black text-slate-700">{member.dailyPlan ? `${member.dailyPlan.completedCount}/${member.dailyPlan.taskCount}${member.dailyPlan.blockedCount ? ` · ${member.dailyPlan.blockedCount} ${dailyCopy.progressStatuses.blocked.toLowerCase()}` : ""}` : "—"}</td>
                        <td className="px-4 py-3"><StatusPill tone={member.report ? "emerald" : "amber"}>{member.report ? t("myDay.report.submitted") : t("myDay.report.missing")}</StatusPill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="mt-8 overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm">
          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em] text-emerald-700">{t("myDay.leaveBalance.eyebrow")}</p>
              <h2 className="mt-2 text-2xl font-black">{t("myDay.leaveBalance.title", {year: leaveYear})}</h2>
              <p className="mt-2 text-sm text-slate-600">{t("myDay.leaveBalance.help")}</p>
            </div>
            <Link href="/dashboard/performance?view=absences" className="rounded-xl bg-emerald-700 px-5 py-3 text-center font-black text-white transition hover:bg-emerald-800">{t("myDay.leaveBalance.request")}</Link>
          </div>
          <div className="grid border-t border-emerald-100 bg-emerald-50/60 sm:grid-cols-2 xl:grid-cols-4">
            {[
              [t("myDay.leaveBalance.granted"), annualLeaveAllowance],
              [t("myDay.leaveBalance.used"), totalUsedAnnualLeaveDays],
              [t("myDay.leaveBalance.pending"), pendingAnnualLeaveDays],
              [t("myDay.leaveBalance.remaining"), remainingAnnualLeaveDays],
            ].map(([label, value], index) => <div key={String(label)} className={`p-5 ${index ? "border-t border-emerald-100 sm:border-l sm:border-t-0" : ""}`}><p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 text-3xl font-black ${index === 3 ? "text-emerald-700" : "text-slate-950"}`}>{value} <span className="text-sm">{t("myDay.leaveBalance.days")}</span></p></div>)}
          </div>
        </section>
      </div>
      {absencePanel ? <AbsenceContactPanel {...absencePanel} /> : null}
    </main>
  );
}
