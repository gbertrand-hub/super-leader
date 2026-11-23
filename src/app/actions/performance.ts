"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {dailyExecutionCopy} from "@/i18n/daily-execution";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {
  calculatePerformanceScore,
  type AttendanceRecord,
  type DailyReportRecord,
  type FeedbackRecord,
  type KpiScoreRecord,
  type LeaveRequest,
  type MeetingAttendanceRecord,
  type MeetingRecord,
  type MemberSchedule,
  type PerformanceSettings,
  type TrainingRecord,
  type WorkScheduleEntry,
} from "@/lib/performance/scoring";
import {
  finalizeTemporaryAttachment,
  readPendingAttachment,
  removePrivateAttachment,
} from "@/lib/storage/private-attachments";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createNotification} from "@/lib/notifications/service";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";
import {createZoomMeeting, deleteZoomMeeting, updateZoomMeeting} from "@/lib/zoom/client";
import {assertZoomHostAvailability, resolveZoomHost, zoomAvailableForOrganization, zoomDepartmentKey} from "@/lib/zoom/settings";

const leaderRoles = new Set(["owner", "admin", "executive", "hr", "manager"]);
const hrRoles = new Set(["owner", "admin", "hr"]);
const attendanceStatuses = new Set(["present", "late", "absent", "excused", "remote"]);
const leaveTypes = new Set(["annual", "sick", "family", "training", "unpaid", "other"]);
const leaveReviewStatuses = new Set(["approved", "rejected"]);
const annualLeaveAllowance = 20;
const reportReviewStatuses = new Set(["validated", "needs_revision", "incomplete"]);
const meetingTypes = new Set(["team", "training", "client", "company", "other"]);
const meetingAttendanceStatuses = new Set(["present", "late", "absent", "excused"]);
const workPolicies = new Set(["fixed", "flexible", "autonomous"]);
const dailyTaskFinalStatuses = new Set(["completed", "partial", "blocked", "deferred", "cancelled"]);
const dailyTaskNextActions = new Set(["none", "tomorrow", "reschedule", "follow_up", "request_help", "cancel"]);

type Membership = {
  organization_id: string;
  role: string;
  is_active: boolean;
};

type ScheduleRow = MemberSchedule & {id: string};

type DetailedScheduleRow = {
  user_id: string;
  work_date: string;
  timezone: string;
  start_time: string | null;
  end_time: string | null;
  grace_minutes: number;
  report_deadline_time: string | null;
  work_mode: "onsite" | "remote" | "hybrid" | "off";
  report_required: boolean;
  status: "published" | "draft" | "cancelled";
};

type ReopeningRow = {
  id: string;
  user_id: string;
  report_date: string;
  score_factor: number | string;
  status: string;
  expires_at: string;
};

type AttendanceBreakRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
};

type DailyExecutionSettingsRow = {
  enabled: boolean;
  minimum_tasks: number;
  require_task_outcomes_for_report: boolean;
  required_from: string;
};

type DailyWorkPlanRow = {
  id: string;
  status: string;
  minimum_tasks_snapshot: number;
};

type DailyWorkTaskRow = {
  id: string;
  plan_id: string;
  position: number;
  title: string;
  expected_outcome: string;
  priority: string;
  progress_status: string;
};

type DailyTaskOutcomeInput = DailyWorkTaskRow & {
  finalStatus: string;
  actualOutcome: string;
  reason: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
};

function go(message: string, kind: "success" | "error" = "success", view = "overview"): never {
  redirect(`/dashboard/performance?view=${encodeURIComponent(view)}&${kind}=${encodeURIComponent(message)}`);
}

function safeDailyReportGovernanceReturn(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("/dashboard/hr/daily-reports") || raw.startsWith("/dashboard/performance")) return raw;
  return "/dashboard/performance?view=reports";
}

function goDailyReportGovernance(returnTo: string, message: string, kind: "success" | "error" = "success"): never {
  const url = new URL(returnTo, "https://super-leader.local");
  url.searchParams.delete("success");
  url.searchParams.delete("error");
  url.searchParams.set(kind, message);
  redirect(`${url.pathname}${url.search}${url.hash}`);
}

function safeOperationalReturn(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("/dashboard/my-day") || raw.startsWith("/dashboard/performance")) return raw;
  return "/dashboard/my-day";
}

function operationalUrl(path: string, values: Record<string, string | null | undefined>) {
  const url = new URL(path, "https://super-leader.local");
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}`;
}

function goOperational(path: string, message: string, kind: "success" | "error" = "success"): never {
  redirect(operationalUrl(path, {[kind]: message}));
}

function cleanText(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeDate(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : raw;
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

async function ensureAnnualLeaveBalance(input: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  userId: string;
  startDate: string;
  endDate: string;
  excludedRequestId?: string;
  t: Awaited<ReturnType<typeof getI18n>>["t"];
  fail: (message: string) => never;
}) {
  const firstYear = Number(input.startDate.slice(0, 4));
  const lastYear = Number(input.endDate.slice(0, 4));
  const query = input.admin
    .from("leave_requests")
    .select("id, start_date, end_date")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .eq("leave_type", "annual")
    .eq("status", "approved")
    .lte("start_date", `${lastYear}-12-31`)
    .gte("end_date", `${firstYear}-01-01`);
  if (input.excludedRequestId) query.neq("id", input.excludedRequestId);
  const [{data: approvedRequests, error}, {data: configuredBalances, error: balanceError}] = await Promise.all([
    query,
    input.admin
      .from("leave_annual_balances")
      .select("leave_year, annual_allowance, prior_used_days")
      .eq("organization_id", input.organizationId)
      .eq("user_id", input.userId)
      .gte("leave_year", firstYear)
      .lte("leave_year", lastYear),
  ]);
  if (error || balanceError) {
    input.fail(input.t("performance.messages.leaveCreateFailed", {message: error?.message || balanceError?.message || "Unable to load annual leave balance."}));
  }
  const balanceByYear = new Map(
    (configuredBalances ?? []).map((balance) => [Number(balance.leave_year), {
      allowance: Number(balance.annual_allowance),
      priorUsed: Number(balance.prior_used_days),
    }]),
  );

  for (let year = firstYear; year <= lastYear; year += 1) {
    const requested = workdaysInYear(input.startDate, input.endDate, year);
    if (!requested) continue;
    const used = (approvedRequests ?? []).reduce(
      (sum, leave) => sum + workdaysInYear(leave.start_date, leave.end_date, year),
      0,
    );
    const configured = balanceByYear.get(year);
    const allowance = configured?.allowance ?? annualLeaveAllowance;
    const priorUsed = configured?.priorUsed ?? 0;
    const available = Math.max(0, allowance - priorUsed - used);
    if (requested > available) {
      input.fail(input.t("performance.messages.leaveBalanceExceeded", {year, requested, available}));
    }
  }
}

function normalizeMonth(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return "";
  return raw;
}

function normalizeTime(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : "";
}

function parseInteger(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const number = Number(String(value ?? "").trim());
  return Number.isInteger(number) ? number : fallback;
}

function parseNumber(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const number = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function timeToMinutes(value: string) {
  const [hour = 0, minute = 0] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function normalizeWorkPolicy(value: FormDataEntryValue | string | null | undefined) {
  const policy = String(value ?? "fixed").trim();
  return workPolicies.has(policy) ? policy as "fixed" | "flexible" | "autonomous" : "fixed";
}

function scheduleDurationMinutes(startTime: string, endTime: string, allowOvernight = false) {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (allowOvernight && end <= start) end += 24 * 60;
  return Math.max(0, end - start);
}

function resolveDailyTargetMinutes(schedule: ScheduleRow | null, startTime: string, endTime: string) {
  const configured = Number(schedule?.daily_target_minutes ?? 0);
  if (Number.isFinite(configured) && configured > 0) return Math.round(configured);
  return scheduleDurationMinutes(startTime, endTime, Boolean(schedule?.allow_overnight));
}

function buildWorkedIntervals(clockIn: Date, clockOut: Date, breaks: AttendanceBreakRow[]) {
  const intervals: Array<{clockIn: Date; clockOut: Date}> = [];
  let cursor = clockIn;
  const sorted = [...breaks].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());

  for (const item of sorted) {
    const breakStart = new Date(item.started_at);
    const breakEnd = item.ended_at ? new Date(item.ended_at) : clockOut;
    if (Number.isNaN(breakStart.getTime()) || Number.isNaN(breakEnd.getTime())) continue;
    const boundedStart = new Date(Math.max(clockIn.getTime(), Math.min(clockOut.getTime(), breakStart.getTime())));
    const boundedEnd = new Date(Math.max(boundedStart.getTime(), Math.min(clockOut.getTime(), breakEnd.getTime())));
    if (boundedStart > cursor) intervals.push({clockIn: cursor, clockOut: boundedStart});
    if (boundedEnd > cursor) cursor = boundedEnd;
  }

  if (cursor < clockOut) intervals.push({clockIn: cursor, clockOut});
  return intervals;
}

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
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    start: `${month}-01`,
    end: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
  };
}

function zonedLocalToUtc(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const desired = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(new Date(guess), timezone);
    const actualUtc = Date.UTC(
      Number(actual.date.slice(0, 4)),
      Number(actual.date.slice(5, 7)) - 1,
      Number(actual.date.slice(8, 10)),
      Number(actual.time.slice(0, 2)),
      Number(actual.time.slice(3, 5)),
    );
    const adjustment = desired - actualUtc;
    guess += adjustment;
    if (adjustment === 0) break;
  }
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function overlapMinutes(start: Date, end: Date, windowStart: Date, windowEnd: Date) {
  const overlapStart = Math.max(start.getTime(), windowStart.getTime());
  const overlapEnd = Math.min(end.getTime(), windowEnd.getTime());
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 60000));
}

function enumerateDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate && dates.length < 10) {
    dates.push(current);
    current = shiftIsoDate(current, 1);
  }
  return dates;
}

function calculateWorkTimeBreakdown(input: {
  clockIn: Date;
  clockOut: Date;
  workDate: string;
  timezone: string;
  scheduledStart: string;
  scheduledEnd: string;
  nightStart: string;
  nightEnd: string;
}) {
  const totalWorkMinutes = Math.max(0, Math.round((input.clockOut.getTime() - input.clockIn.getTime()) / 60000));
  const scheduledEndDate = timeToMinutes(input.scheduledEnd) <= timeToMinutes(input.scheduledStart)
    ? shiftIsoDate(input.workDate, 1)
    : input.workDate;
  const scheduledStartUtc = zonedLocalToUtc(`${input.workDate}T${input.scheduledStart}`, input.timezone);
  const scheduledEndUtc = zonedLocalToUtc(`${scheduledEndDate}T${input.scheduledEnd}`, input.timezone);
  const scheduledWorkMinutes = scheduledStartUtc && scheduledEndUtc
    ? Math.max(0, Math.round((scheduledEndUtc.getTime() - scheduledStartUtc.getTime()) / 60000))
    : 0;
  const insideScheduleMinutes = scheduledStartUtc && scheduledEndUtc
    ? overlapMinutes(input.clockIn, input.clockOut, scheduledStartUtc, scheduledEndUtc)
    : 0;

  const localStartDate = zonedParts(input.clockIn, input.timezone).date;
  const localEndDate = zonedParts(input.clockOut, input.timezone).date;
  const dates = enumerateDates(shiftIsoDate(localStartDate, -1), shiftIsoDate(localEndDate, 1));

  let nightMinutes = 0;
  for (const date of dates) {
    const nightEndDate = timeToMinutes(input.nightEnd) <= timeToMinutes(input.nightStart)
      ? shiftIsoDate(date, 1)
      : date;
    const nightStartUtc = zonedLocalToUtc(`${date}T${input.nightStart}`, input.timezone);
    const nightEndUtc = zonedLocalToUtc(`${nightEndDate}T${input.nightEnd}`, input.timezone);
    if (nightStartUtc && nightEndUtc) nightMinutes += overlapMinutes(input.clockIn, input.clockOut, nightStartUtc, nightEndUtc);
  }

  let weekendMinutes = 0;
  for (const date of enumerateDates(localStartDate, localEndDate)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) continue;
    const dayStartUtc = zonedLocalToUtc(`${date}T00:00`, input.timezone);
    const dayEndUtc = zonedLocalToUtc(`${shiftIsoDate(date, 1)}T00:00`, input.timezone);
    if (dayStartUtc && dayEndUtc) weekendMinutes += overlapMinutes(input.clockIn, input.clockOut, dayStartUtc, dayEndUtc);
  }

  return {
    totalWorkMinutes,
    scheduledWorkMinutes,
    outsideScheduleMinutes: Math.max(0, totalWorkMinutes - insideScheduleMinutes),
    nightMinutes: Math.min(totalWorkMinutes, nightMinutes),
    weekendMinutes: Math.min(totalWorkMinutes, weekendMinutes),
  };
}

async function getContext() {
  const {t, locale} = await getI18n();
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (membershipError) go(t("performance.messages.organisationLoadFailed", {message: membershipError.message}), "error");
  if (!membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "performance");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });

  return {user: authData.user, membership, admin, t, locale, visibleUserIds};
}

async function ensureMember(
  organizationId: string,
  userId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  const {data} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}

async function leaveRequesterName(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const {data} = await admin
    .from("profiles")
    .select("full_name,email")
    .eq("id", userId)
    .maybeSingle<{full_name: string | null; email: string | null}>();
  return data?.full_name?.trim() || data?.email || "Collaborateur";
}

async function notifyHrAboutLeave(input: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  requesterId: string;
  actorId: string;
  requestId: string;
  titleFr: string;
  titleEn: string;
  bodyFr: string;
  bodyEn: string;
  requiresAction?: boolean;
  priority?: "info" | "success" | "warning" | "urgent";
  eventType: string;
}) {
  const {data: hrMembers, error} = await input.admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", input.organizationId)
    .eq("is_active", true)
    .eq("role", "hr");
  if (error) {
    console.error("Leave HR recipients unavailable", error);
    return;
  }
  await Promise.allSettled((hrMembers ?? [])
    .filter((member) => member.user_id !== input.actorId)
    .map((member) => createNotification({
      organizationId: input.organizationId,
      userId: member.user_id,
      actorId: input.actorId,
      category: "absences",
      eventType: input.eventType,
      titleFr: input.titleFr,
      titleEn: input.titleEn,
      bodyFr: input.bodyFr,
      bodyEn: input.bodyEn,
      actionUrl: "/dashboard/hr/leave",
      priority: input.priority ?? "info",
      requiresAction: input.requiresAction ?? false,
      dedupeKey: `leave:${input.requestId}:${input.eventType}:${member.user_id}`,
      metadata: {request_id: input.requestId, requester_id: input.requesterId},
    })));
}

async function loadSettingsAndSchedule(
  organizationId: string,
  userId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  const [{data: settings}, {data: schedule}] = await Promise.all([
    admin.from("performance_settings").select("*").eq("organization_id", organizationId).maybeSingle<PerformanceSettings>(),
    admin.from("member_work_schedules").select("*").eq("organization_id", organizationId).eq("user_id", userId).eq("is_active", true).maybeSingle<ScheduleRow>(),
  ]);
  if (!settings) throw new Error("performance_settings_missing");
  return {settings, schedule};
}

async function loadPublishedDetailedSchedule(
  organizationId: string,
  userId: string,
  workDate: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  const {data, error} = await admin
    .from("work_schedule_entries")
    .select("user_id, work_date, timezone, start_time, end_time, grace_minutes, report_deadline_time, work_mode, report_required, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("work_date", workDate)
    .eq("status", "published")
    .maybeSingle<DetailedScheduleRow>();
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
  return data ?? null;
}

async function canSuperviseEmployee(
  membership: Membership,
  actorId: string,
  employeeId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  if (actorId === employeeId) return false;
  if (hrRoles.has(membership.role)) return true;
  if (membership.role === "executive") {
    const visibleUserIds = await getVisibleUserIds({
      admin,
      organizationId: membership.organization_id,
      actorId,
      role: membership.role,
    });
    return visibleUserIds.includes(employeeId);
  }
  if (membership.role !== "manager") return false;
  const {data} = await admin
    .from("member_work_schedules")
    .select("user_id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", employeeId)
    .eq("supervisor_id", actorId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}

async function canGovernEmployee(
  membership: Membership,
  actorId: string,
  employeeId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  if (actorId === employeeId) return hrRoles.has(membership.role);
  return canSuperviseEmployee(membership, actorId, employeeId, admin);
}

async function isActiveLeader(
  organizationId: string,
  userId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  const {data} = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle<{role: string}>();
  return Boolean(data && leaderRoles.has(data.role));
}

function reportWindowState(
  reportDate: string,
  now: Date,
  settings: PerformanceSettings,
  schedule: ScheduleRow | null,
  detailedSchedule: DetailedScheduleRow | null = null,
) {
  const timezone = detailedSchedule?.timezone || schedule?.timezone || settings.timezone;
  const local = zonedParts(now, timezone);
  const deadline = (detailedSchedule?.report_deadline_time || schedule?.report_deadline_time || settings.report_deadline_time).slice(0, 5);
  const reportRequired = detailedSchedule ? detailedSchedule.report_required && detailedSchedule.work_mode !== "off" : true;
  const isFuture = reportDate > local.date;
  const isNormallyOpen = reportRequired && reportDate === local.date && timeToMinutes(local.time) <= timeToMinutes(deadline);
  return {local, deadline, reportRequired, isFuture, isNormallyOpen, isClosed: !isFuture && !isNormallyOpen};
}

async function expireReopenings(
  organizationId: string,
  userId: string,
  reportDate: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  await admin
    .from("daily_report_reopenings")
    .update({status: "expired"})
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("report_date", reportDate)
    .eq("status", "active")
    .lte("expires_at", new Date().toISOString());
}

async function audit(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    organizationId: string;
    actorId: string;
    subjectUserId?: string | null;
    entityType: string;
    entityId?: string | null;
    action: string;
    details?: Record<string, unknown>;
  },
) {
  const {error} = await admin.from("performance_audit_log").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    subject_user_id: input.subjectUserId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Performance audit log failed", error);
}


type DailyReportSnapshot = {
  id: string;
  user_id: string;
  report_date: string;
  accomplishments: string;
  results: string;
  blockers: string;
  next_priorities: string;
  status: string;
  submitted_at: string;
  submitted_by: string;
  submission_mode: string;
  submission_score_factor: number | string;
  supervisor_reason: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  revision_number: number | null;
};

async function archiveDailyReportVersion(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    organizationId: string;
    report: DailyReportSnapshot;
    actorId: string;
    reason: string;
    reopeningId?: string | null;
  },
) {
  const versionNumber = Math.max(1, Number(input.report.revision_number ?? 1));
  const {error} = await admin.from("daily_report_versions").upsert({
    organization_id: input.organizationId,
    report_id: input.report.id,
    user_id: input.report.user_id,
    report_date: input.report.report_date,
    version_number: versionNumber,
    accomplishments: input.report.accomplishments,
    results: input.report.results,
    blockers: input.report.blockers,
    next_priorities: input.report.next_priorities,
    status: input.report.status,
    submitted_at: input.report.submitted_at,
    submitted_by: input.report.submitted_by,
    submission_mode: input.report.submission_mode,
    submission_score_factor: Number(input.report.submission_score_factor ?? 1),
    supervisor_reason: input.report.supervisor_reason,
    review_note: input.report.review_note,
    reviewed_by: input.report.reviewed_by,
    reviewed_at: input.report.reviewed_at,
    archived_by: input.actorId,
    archive_reason: input.reason,
    reopening_id: input.reopeningId ?? null,
  }, {onConflict: "report_id,version_number"});
  if (error) throw error;
}

export async function clockInAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const returnTo = safeOperationalReturn(formData.get("returnTo"));
  const finish: (message: string, kind?: "success" | "error") => never = (message, kind = "success") => goOperational(returnTo, message, kind);
  let settings!: PerformanceSettings;
  let schedule: ScheduleRow | null = null;
  try {
    ({settings, schedule} = await loadSettingsAndSchedule(membership.organization_id, user.id, admin));
  } catch {
    finish(t("performance.messages.databaseSetupRequired"), "error");
  }

  const baselineTimezone = schedule?.timezone || settings.timezone;
  const now = new Date();
  const baselineLocal = zonedParts(now, baselineTimezone);
  let detailedSchedule: DetailedScheduleRow | null = null;
  try {
    detailedSchedule = await loadPublishedDetailedSchedule(membership.organization_id, user.id, baselineLocal.date, admin);
  } catch (error) {
    finish(t("performance.messages.clockInFailed", {message: error instanceof Error ? error.message : String(error)}), "error");
  }
  if (detailedSchedule?.work_mode === "off") finish(t("performance.messages.notScheduledToday"), "error");
  if (!detailedSchedule && schedule?.work_days?.length) {
    const weekday = new Date(`${baselineLocal.date}T00:00:00Z`).getUTCDay() || 7;
    if (!schedule.work_days.includes(weekday)) finish(t("performance.messages.notScheduledToday"), "error");
  }

  const timezone = detailedSchedule?.timezone || baselineTimezone;
  const local = zonedParts(now, timezone);
  const scheduledStart = (detailedSchedule?.start_time || schedule?.start_time || settings.default_start_time).slice(0, 5);
  const scheduledEnd = (detailedSchedule?.end_time || schedule?.end_time || settings.default_end_time).slice(0, 5);
  const graceMinutes = detailedSchedule?.grace_minutes ?? schedule?.grace_minutes ?? settings.grace_minutes;
  const workPolicy = normalizeWorkPolicy(schedule?.work_policy);
  const flexibleDeadline = String(schedule?.start_window_until || scheduledStart).slice(0, 5);
  const lateReference = workPolicy === "flexible" ? flexibleDeadline : scheduledStart;
  const lateMinutes = workPolicy === "autonomous"
    ? 0
    : Math.max(0, timeToMinutes(local.time) - timeToMinutes(lateReference) - graceMinutes);
  const targetWorkMinutes = resolveDailyTargetMinutes(schedule, scheduledStart, scheduledEnd);

  const {data: openAttendance} = await admin
    .from("attendance_records")
    .select("id, work_date, clock_in_at")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .not("clock_in_at", "is", null)
    .is("clock_out_at", null)
    .order("work_date", {ascending: false})
    .limit(1)
    .maybeSingle<{id: string; work_date: string; clock_in_at: string | null}>();
  if (openAttendance?.clock_in_at) finish(t("performance.messages.alreadyClockedIn"), "error");

  const {data: existing} = await admin
    .from("attendance_records")
    .select("id, clock_in_at")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("work_date", local.date)
    .maybeSingle<{id: string; clock_in_at: string | null}>();
  if (existing?.clock_in_at) finish(t("performance.messages.alreadyClockedIn"), "error");

  const payload = {
    organization_id: membership.organization_id,
    user_id: user.id,
    work_date: local.date,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    clock_in_at: now.toISOString(),
    status: lateMinutes > 0 ? "late" : detailedSchedule?.work_mode === "remote" ? "remote" : "present",
    late_minutes: lateMinutes,
    source: "web",
    work_policy: workPolicy,
    target_work_minutes: targetWorkMinutes,
    gross_work_minutes: 0,
    pause_minutes: 0,
    short_day: false,
    short_day_justification: null,
    target_met: false,
  };

  const result = existing
    ? await admin.from("attendance_records").update(payload).eq("id", existing.id).select("id").single<{id: string}>()
    : await admin.from("attendance_records").insert(payload).select("id").single<{id: string}>();
  if (result.error) finish(t("performance.messages.clockInFailed", {message: result.error.message}), "error");

  const attendanceId = result.data?.id;
  if (!attendanceId) {
    finish(
      t("performance.messages.clockInFailed", {
        message: "Attendance identifier missing.",
      }),
      "error",
    );
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: user.id,
    entityType: "attendance",
    entityId: attendanceId,
    action: "clock_in",
    details: {
      work_date: local.date,
      late_minutes: lateMinutes,
      work_policy: workPolicy,
      start_window_until: workPolicy === "flexible" ? flexibleDeadline : null,
      target_work_minutes: targetWorkMinutes,
    },
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/my-day");
  redirect(operationalUrl(returnTo, {success: t("performance.messages.clockedIn"), plan: "required"}));
}

export async function clockOutAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const returnTo = safeOperationalReturn(formData.get("returnTo"));
  const finish: (message: string, kind?: "success" | "error") => never = (message, kind = "success") => goOperational(returnTo, message, kind);
  let settings!: PerformanceSettings & {
    night_work_start?: string;
    night_work_end?: string;
    long_day_warning_minutes?: number;
  };
  let schedule: ScheduleRow | null = null;
  try {
    ({settings, schedule} = await loadSettingsAndSchedule(membership.organization_id, user.id, admin));
  } catch {
    finish(t("performance.messages.databaseSetupRequired"), "error");
  }

  const now = new Date();
  const baselineTimezone = schedule?.timezone || settings.timezone;
  const {data: record, error: recordError} = await admin
    .from("attendance_records")
    .select("id, work_date, clock_in_at, clock_out_at, scheduled_start, scheduled_end, closure_count, work_policy, target_work_minutes")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .not("clock_in_at", "is", null)
    .is("clock_out_at", null)
    .order("work_date", {ascending: false})
    .limit(1)
    .maybeSingle<{
      id: string;
      work_date: string;
      clock_in_at: string | null;
      clock_out_at: string | null;
      scheduled_start: string | null;
      scheduled_end: string | null;
      closure_count: number | null;
      work_policy: string | null;
      target_work_minutes: number | null;
    }>();
  if (recordError || !record?.clock_in_at) finish(t("performance.messages.clockInFirst"), "error");

  let detailedSchedule: DetailedScheduleRow | null = null;
  try {
    detailedSchedule = await loadPublishedDetailedSchedule(membership.organization_id, user.id, record.work_date, admin);
  } catch (error) {
    finish(t("performance.messages.clockOutFailed", {message: error instanceof Error ? error.message : String(error)}), "error");
  }
  const timezone = detailedSchedule?.timezone || baselineTimezone;
  const clockIn = new Date(record.clock_in_at);
  if (Number.isNaN(clockIn.getTime()) || now <= clockIn) finish(t("performance.messages.invalidClockRange"), "error");

  if (schedule?.report_required_before_clock_out && (detailedSchedule?.report_required ?? true)) {
    const {data: report} = await admin
      .from("daily_reports")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", user.id)
      .eq("report_date", record.work_date)
      .maybeSingle<{id: string}>();
    if (!report) finish(t("performance.messages.reportRequiredBeforeClockOut"), "error");
  }

  const {data: breakData, error: breakError} = await admin
    .from("attendance_breaks")
    .select("id, started_at, ended_at, duration_minutes")
    .eq("organization_id", membership.organization_id)
    .eq("attendance_id", record.id)
    .order("started_at", {ascending: true});
  if (breakError) finish(t("performance.messages.flexibleWorkSetupRequired"), "error");
  const breaks = (breakData ?? []) as AttendanceBreakRow[];
  const activeBreak = breaks.find((item) => !item.ended_at) ?? null;
  if (activeBreak) {
    const activeStartedAt = new Date(activeBreak.started_at);
    const durationMinutes = Number.isNaN(activeStartedAt.getTime())
      ? 0
      : Math.max(0, Math.round((now.getTime() - activeStartedAt.getTime()) / 60000));
    const {error: closeBreakError} = await admin
      .from("attendance_breaks")
      .update({ended_at: now.toISOString(), duration_minutes: durationMinutes})
      .eq("id", activeBreak.id)
      .eq("user_id", user.id);
    if (closeBreakError) finish(t("performance.messages.clockOutFailed", {message: closeBreakError.message}), "error");
    activeBreak.ended_at = now.toISOString();
    activeBreak.duration_minutes = durationMinutes;
  }

  const scheduledStart = (record.scheduled_start || detailedSchedule?.start_time || schedule?.start_time || settings.default_start_time).slice(0, 5);
  const scheduledEnd = (record.scheduled_end || detailedSchedule?.end_time || schedule?.end_time || settings.default_end_time).slice(0, 5);
  const grossBreakdown = calculateWorkTimeBreakdown({
    clockIn,
    clockOut: now,
    workDate: record.work_date,
    timezone,
    scheduledStart,
    scheduledEnd,
    nightStart: String(settings.night_work_start || "22:00").slice(0, 5),
    nightEnd: String(settings.night_work_end || "06:00").slice(0, 5),
  });
  const intervals = buildWorkedIntervals(clockIn, now, breaks);
  const netBreakdowns = intervals.map((interval) => calculateWorkTimeBreakdown({
    clockIn: interval.clockIn,
    clockOut: interval.clockOut,
    workDate: record.work_date,
    timezone,
    scheduledStart,
    scheduledEnd,
    nightStart: String(settings.night_work_start || "22:00").slice(0, 5),
    nightEnd: String(settings.night_work_end || "06:00").slice(0, 5),
  }));
  const totalWorkMinutes = netBreakdowns.reduce((sum, item) => sum + item.totalWorkMinutes, 0);
  const outsideScheduleMinutes = netBreakdowns.reduce((sum, item) => sum + item.outsideScheduleMinutes, 0);
  const nightMinutes = netBreakdowns.reduce((sum, item) => sum + item.nightMinutes, 0);
  const weekendMinutes = netBreakdowns.reduce((sum, item) => sum + item.weekendMinutes, 0);
  const pauseMinutes = Math.max(0, grossBreakdown.totalWorkMinutes - totalWorkMinutes);
  const workPolicy = normalizeWorkPolicy(record.work_policy || schedule?.work_policy);
  const targetWorkMinutes = Math.max(0, Number(record.target_work_minutes ?? 0) || resolveDailyTargetMinutes(schedule, scheduledStart, scheduledEnd));
  const scheduledWorkMinutes = workPolicy === "fixed" ? grossBreakdown.scheduledWorkMinutes : targetWorkMinutes;
  const targetMet = targetWorkMinutes > 0 && totalWorkMinutes >= targetWorkMinutes;
  const shortDay = targetWorkMinutes > 0 && totalWorkMinutes < targetWorkMinutes;
  const shortDayJustification = cleanText(formData.get("shortDayJustification"), 2000);
  if (shortDay && (schedule?.short_day_justification_required ?? true) && shortDayJustification.length < 5) {
    finish(t("performance.messages.shortDayJustificationRequired", {
      worked: totalWorkMinutes,
      target: targetWorkMinutes,
    }), "error");
  }

  const {error} = await admin.from("attendance_records").update({
    clock_out_at: now.toISOString(),
    total_work_minutes: totalWorkMinutes,
    scheduled_work_minutes: scheduledWorkMinutes,
    outside_schedule_minutes: outsideScheduleMinutes,
    night_minutes: nightMinutes,
    weekend_minutes: weekendMinutes,
    work_timezone: timezone,
    closure_count: Number(record.closure_count ?? 0) + 1,
    last_closed_at: now.toISOString(),
    work_policy: workPolicy,
    target_work_minutes: targetWorkMinutes,
    gross_work_minutes: grossBreakdown.totalWorkMinutes,
    pause_minutes: pauseMinutes,
    short_day: shortDay,
    short_day_justification: shortDay ? shortDayJustification || null : null,
    target_met: targetMet,
  }).eq("id", record.id);
  if (error) finish(t("performance.messages.clockOutFailed", {message: error.message}), "error");

  await admin
    .from("attendance_reopenings")
    .update({status: "closed", closed_at: now.toISOString(), new_clock_out_at: now.toISOString()})
    .eq("attendance_id", record.id)
    .eq("status", "active");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: user.id,
    entityType: "attendance",
    entityId: record.id,
    action: Number(record.closure_count ?? 0) > 0 ? "clock_out_after_reopening" : "clock_out",
    details: {
      work_date: record.work_date,
      timezone,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      work_policy: workPolicy,
      target_work_minutes: targetWorkMinutes,
      gross_work_minutes: grossBreakdown.totalWorkMinutes,
      pause_minutes: pauseMinutes,
      total_work_minutes: totalWorkMinutes,
      outside_schedule_minutes: outsideScheduleMinutes,
      night_minutes: nightMinutes,
      weekend_minutes: weekendMinutes,
      target_met: targetMet,
      short_day: shortDay,
      short_day_justification: shortDay ? shortDayJustification || null : null,
    },
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/my-day");
  const warningThreshold = Number(settings.long_day_warning_minutes ?? 720);
  finish(
    shortDay
      ? t("performance.messages.clockedOutShortDay")
      : targetMet
        ? t("performance.messages.clockedOutTargetMet")
        : totalWorkMinutes >= warningThreshold || nightMinutes > 0 || weekendMinutes > 0
          ? t("performance.messages.clockedOutWithWellbeingNotice")
          : t("performance.messages.clockedOut"),
  );
}


export async function pauseWorkdayAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const returnTo = safeOperationalReturn(formData.get("returnTo"));
  const finish: (message: string, kind?: "success" | "error") => never = (message, kind = "success") => goOperational(returnTo, message, kind);
  const {schedule} = await loadSettingsAndSchedule(membership.organization_id, user.id, admin).catch(() => ({schedule: null as ScheduleRow | null}));
  if (schedule?.pause_tracking_enabled === false) finish(t("performance.messages.pauseTrackingDisabled"), "error");

  const {data: record, error: recordError} = await admin
    .from("attendance_records")
    .select("id, work_date")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .not("clock_in_at", "is", null)
    .is("clock_out_at", null)
    .order("work_date", {ascending: false})
    .limit(1)
    .maybeSingle<{id: string; work_date: string}>();
  if (recordError || !record) finish(t("performance.messages.clockInFirst"), "error");

  const {data: activeBreak, error: activeBreakError} = await admin
    .from("attendance_breaks")
    .select("id")
    .eq("attendance_id", record.id)
    .is("ended_at", null)
    .maybeSingle<{id: string}>();
  if (activeBreakError) finish(t("performance.messages.flexibleWorkSetupRequired"), "error");
  if (activeBreak) finish(t("performance.messages.alreadyPaused"), "error");

  const reason = cleanText(formData.get("pauseReason"), 500) || null;
  const {data: created, error} = await admin.from("attendance_breaks").insert({
    organization_id: membership.organization_id,
    attendance_id: record.id,
    user_id: user.id,
    started_at: new Date().toISOString(),
    reason,
  }).select("id").single<{id: string}>();
  if (error || !created) finish(t("performance.messages.pauseFailed", {message: error?.message || "Unknown error"}), "error");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: user.id,
    entityType: "attendance_break",
    entityId: created.id,
    action: "paused",
    details: {attendance_id: record.id, work_date: record.work_date, reason},
  });
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/performance");
  finish(t("performance.messages.workdayPaused"));
}

export async function resumeWorkdayAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const returnTo = safeOperationalReturn(formData.get("returnTo"));
  const finish: (message: string, kind?: "success" | "error") => never = (message, kind = "success") => goOperational(returnTo, message, kind);
  const {data: record, error: recordError} = await admin
    .from("attendance_records")
    .select("id, work_date")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .not("clock_in_at", "is", null)
    .is("clock_out_at", null)
    .order("work_date", {ascending: false})
    .limit(1)
    .maybeSingle<{id: string; work_date: string}>();
  if (recordError || !record) finish(t("performance.messages.clockInFirst"), "error");

  const {data: activeBreak, error: activeBreakError} = await admin
    .from("attendance_breaks")
    .select("id, started_at")
    .eq("attendance_id", record.id)
    .eq("user_id", user.id)
    .is("ended_at", null)
    .maybeSingle<{id: string; started_at: string}>();
  if (activeBreakError) finish(t("performance.messages.flexibleWorkSetupRequired"), "error");
  if (!activeBreak) finish(t("performance.messages.notPaused"), "error");

  const now = new Date();
  const startedAt = new Date(activeBreak.started_at);
  const durationMinutes = Number.isNaN(startedAt.getTime())
    ? 0
    : Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 60000));
  const {error} = await admin.from("attendance_breaks").update({
    ended_at: now.toISOString(),
    duration_minutes: durationMinutes,
  }).eq("id", activeBreak.id).eq("user_id", user.id);
  if (error) finish(t("performance.messages.resumeFailed", {message: error.message}), "error");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: user.id,
    entityType: "attendance_break",
    entityId: activeBreak.id,
    action: "resumed",
    details: {attendance_id: record.id, work_date: record.work_date, duration_minutes: durationMinutes},
  });
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/performance");
  finish(t("performance.messages.workdayResumed"));
}

export async function reopenWorkdayAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "attendance");
  const attendanceId = String(formData.get("attendanceId") ?? "").trim();
  const reason = cleanText(formData.get("reason"), 2000);
  if (!attendanceId || reason.length < 10) go(t("performance.messages.invalidWorkdayReopening"), "error", "attendance");

  const {data: record} = await admin
    .from("attendance_records")
    .select("id, user_id, work_date, clock_out_at, total_work_minutes, outside_schedule_minutes, night_minutes, weekend_minutes")
    .eq("id", attendanceId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{
      id: string;
      user_id: string;
      work_date: string;
      clock_out_at: string | null;
      total_work_minutes: number | null;
      outside_schedule_minutes: number | null;
      night_minutes: number | null;
      weekend_minutes: number | null;
    }>();
  if (!record?.clock_out_at) go(t("performance.messages.workdayNotClosed"), "error", "attendance");
  if (!(await canGovernEmployee(membership, user.id, record.user_id, admin))) go(t("performance.messages.notAssignedSupervisor"), "error", "attendance");

  const {data: settings} = await admin
    .from("performance_settings")
    .select("workday_reopen_enabled, maximum_workday_reopenings_per_day")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{workday_reopen_enabled: boolean; maximum_workday_reopenings_per_day: number}>();
  if (settings?.workday_reopen_enabled === false) go(t("performance.messages.workdayReopeningDisabled"), "error", "attendance");

  const {data: active} = await admin
    .from("attendance_reopenings")
    .select("id")
    .eq("attendance_id", attendanceId)
    .eq("status", "active")
    .maybeSingle<{id: string}>();
  if (active) go(t("performance.messages.workdayAlreadyReopened"), "error", "attendance");

  const {count} = await admin
    .from("attendance_reopenings")
    .select("id", {head: true, count: "exact"})
    .eq("attendance_id", attendanceId);
  if ((count ?? 0) >= Number(settings?.maximum_workday_reopenings_per_day ?? 1)) {
    go(t("performance.messages.workdayReopeningLimitReached"), "error", "attendance");
  }

  const now = new Date().toISOString();
  const {data: reopening, error: reopeningError} = await admin.from("attendance_reopenings").insert({
    organization_id: membership.organization_id,
    attendance_id: record.id,
    user_id: record.user_id,
    work_date: record.work_date,
    reason,
    previous_clock_out_at: record.clock_out_at,
    previous_total_work_minutes: Number(record.total_work_minutes ?? 0),
    previous_outside_schedule_minutes: Number(record.outside_schedule_minutes ?? 0),
    previous_night_minutes: Number(record.night_minutes ?? 0),
    previous_weekend_minutes: Number(record.weekend_minutes ?? 0),
    status: "active",
    reopened_by: user.id,
    reopened_at: now,
  }).select("id").single<{id: string}>();
  if (reopeningError || !reopening) go(t("performance.messages.workdayReopeningFailed", {message: reopeningError?.message || "Reopening identifier missing."}), "error", "attendance");

  const {error: updateError} = await admin.from("attendance_records").update({
    clock_out_at: null,
    total_work_minutes: 0,
    scheduled_work_minutes: 0,
    outside_schedule_minutes: 0,
    night_minutes: 0,
    weekend_minutes: 0,
    reopened_at: now,
    reopened_by: user.id,
    reopening_reason: reason,
  }).eq("id", record.id).eq("organization_id", membership.organization_id);
  if (updateError) {
    await admin.from("attendance_reopenings").delete().eq("id", reopening.id);
    go(t("performance.messages.workdayReopeningFailed", {message: updateError.message}), "error", "attendance");
  }

  await createNotification({
    organizationId: membership.organization_id,
    userId: record.user_id,
    actorId: user.id,
    category: "performance",
    eventType: "workday_reopened",
    titleFr: "Votre journée a été rouverte",
    titleEn: "Your workday was reopened",
    bodyFr: `La journée du ${record.work_date} a été rouverte. Motif : ${reason}`,
    bodyEn: `The workday for ${record.work_date} was reopened. Reason: ${reason}`,
    actionUrl: "/dashboard/my-day",
    priority: "warning",
    requiresAction: true,
    dedupeKey: `workday-reopened:${reopening.id}`,
  });
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: record.user_id,
    entityType: "attendance_reopening",
    entityId: reopening.id,
    action: "opened",
    details: {attendance_id: record.id, work_date: record.work_date, reason, previous_clock_out_at: record.clock_out_at},
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/my-day");
  go(t("performance.messages.workdayReopened"), "success", "attendance");
}

export async function recordAttendanceAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "attendance");
  const userId = String(formData.get("userId") ?? "").trim();
  const workDate = normalizeDate(formData.get("workDate"));
  const status = String(formData.get("status") ?? "").trim();
  const lateMinutes = Math.max(0, parseInteger(formData.get("lateMinutes"), 0));
  const justification = cleanText(formData.get("justification"), 1200) || null;
  if (!userId || !workDate || !attendanceStatuses.has(status)) go(t("performance.messages.invalidAttendance"), "error", "attendance");
  if (!(await ensureMember(membership.organization_id, userId, admin))) go(t("performance.messages.memberNotFound"), "error", "attendance");
  if (!(await canSuperviseEmployee(membership, user.id, userId, admin))) go(t("performance.messages.notAssignedSupervisor"), "error", "attendance");

  const {data, error} = await admin.from("attendance_records").upsert({
    organization_id: membership.organization_id,
    user_id: userId,
    work_date: workDate,
    status,
    late_minutes: status === "late" ? lateMinutes : 0,
    justification,
    source: "manual",
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }, {onConflict: "organization_id,user_id,work_date"}).select("id").single<{id: string}>();
  if (error || !data) go(t("performance.messages.attendanceSaveFailed", {message: error?.message || "Attendance identifier missing."}), "error", "attendance");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: userId,
    entityType: "attendance",
    entityId: data.id,
    action: "manual_update",
    details: {work_date: workDate, status, late_minutes: lateMinutes, justification},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.attendanceSaved"), "success", "attendance");
}

export async function submitLeaveRequestAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const leaveType = String(formData.get("leaveType") ?? "").trim();
  const startDate = normalizeDate(formData.get("startDate"));
  const endDate = normalizeDate(formData.get("endDate"));
  const reason = cleanText(formData.get("reason"), 2000);
  const documentUrl = cleanText(formData.get("documentUrl"), 1000) || null;
  const pendingDocument = readPendingAttachment(formData, "document");
  if (!leaveTypes.has(leaveType) || !startDate || !endDate || endDate < startDate || reason.length < 3) {
    go(t("performance.messages.invalidLeave"), "error", "absences");
  }

  // V4.6.6: a pending or approved request for the same employee must not
  // intersect the requested interval. This server-side check applies to every
  // UI that submits a leave request and cannot be bypassed from the browser.
  const {data: overlappingRequests, error: overlapError} = await admin
    .from("leave_requests")
    .select("id, leave_type, start_date, end_date, status")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .in("status", ["pending", "approved"])
    .lte("start_date", endDate)
    .gte("end_date", startDate)
    .order("start_date", {ascending: true})
    .limit(1);
  if (overlapError) {
    go(t("performance.messages.leaveCreateFailed", {message: overlapError.message}), "error", "absences");
  }
  const conflict = overlappingRequests?.[0] as {
    id: string;
    leave_type: string;
    start_date: string;
    end_date: string;
    status: string;
  } | undefined;
  if (conflict) {
    go(t("performance.messages.leaveOverlap", {
      type: t(`performance.leaveTypes.${conflict.leave_type}`),
      status: t(`performance.leaveStatuses.${conflict.status}`),
      startDate: conflict.start_date,
      endDate: conflict.end_date,
    }), "error", "absences");
  }

  if (leaveType === "annual") {
    await ensureAnnualLeaveBalance({
      admin,
      organizationId: membership.organization_id,
      userId: user.id,
      startDate,
      endDate,
      t,
      fail: (message) => go(message, "error", "absences"),
    });
  }

  const {data, error} = await admin.from("leave_requests").insert({
    organization_id: membership.organization_id,
    user_id: user.id,
    leave_type: leaveType,
    start_date: startDate,
    end_date: endDate,
    reason,
    document_url: documentUrl,
  }).select("id").single<{id: string}>();
  if (error || !data) go(t("performance.messages.leaveCreateFailed", {message: error?.message || "Leave request identifier missing."}), "error", "absences");

  let finalizedDocument = null;
  if (pendingDocument) {
    try {
      finalizedDocument = await finalizeTemporaryAttachment({
        admin,
        organizationId: membership.organization_id,
        userId: user.id,
        purpose: "leave",
        recordId: data.id,
        pending: pendingDocument,
      });
      const {error: attachmentError} = await admin.from("leave_requests").update({
        document_storage_path: finalizedDocument.storagePath,
        document_file_name: finalizedDocument.fileName,
        document_mime_type: finalizedDocument.mimeType,
        document_size_bytes: finalizedDocument.sizeBytes,
        document_uploaded_at: new Date().toISOString(),
      }).eq("id", data.id).eq("organization_id", membership.organization_id);
      if (attachmentError) throw attachmentError;
    } catch (attachmentError) {
      await removePrivateAttachment(admin, finalizedDocument?.storagePath ?? pendingDocument.storagePath);
      await admin.from("leave_requests").delete().eq("id", data.id).eq("organization_id", membership.organization_id);
      go(t("attachments.messages.finalizeFailed", {
        message: attachmentError instanceof Error ? attachmentError.message : t("common.unknownError"),
      }), "error", "absences");
    }
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: user.id,
    entityType: "leave_request",
    entityId: data.id,
    action: "submitted",
    details: {
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      document_file_name: finalizedDocument?.fileName ?? null,
    },
  });
  const requesterName = await leaveRequesterName(admin, user.id);
  await notifyHrAboutLeave({
    admin,
    organizationId: membership.organization_id,
    requesterId: user.id,
    actorId: user.id,
    requestId: data.id,
    eventType: "leave_submitted",
    titleFr: "Nouvelle demande de congé",
    titleEn: "New leave request",
    bodyFr: `${requesterName} demande un congé du ${startDate} au ${endDate}.`,
    bodyEn: `${requesterName} requested leave from ${startDate} to ${endDate}.`,
    priority: "warning",
    requiresAction: true,
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/hr/leave");
  revalidatePath("/dashboard/my-day");
  go(t("performance.messages.leaveSubmitted"), "success", "absences");
}

export async function reviewLeaveRequestAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const returnTo = String(formData.get("returnTo") ?? "").trim();
  const goLeave = (message: string, kind: "success" | "error" = "success"): never => {
    if (returnTo.startsWith("/dashboard/hr/leave")) goOperational(returnTo, message, kind);
    go(message, kind, "absences");
  };
  if (!hrRoles.has(membership.role)) goLeave(t("performance.messages.permissionDenied"), "error");
  const requestId = String(formData.get("requestId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const reviewNote = cleanText(formData.get("reviewNote"), 1200) || null;
  if (!requestId || !leaveReviewStatuses.has(status)) goLeave(t("performance.messages.invalidLeaveReview"), "error");
  const {data: request} = await admin.from("leave_requests").select("id, user_id, leave_type, start_date, end_date, status").eq("id", requestId).eq("organization_id", membership.organization_id).maybeSingle<{id: string; user_id: string; leave_type: string; start_date: string; end_date: string; status: string}>();
  if (!request) goLeave(t("performance.messages.leaveNotFound"), "error");
  if (request!.status !== "pending") goLeave(t("performance.messages.invalidLeaveReview"), "error");
  if (status === "approved" && request!.leave_type === "annual") {
    await ensureAnnualLeaveBalance({
      admin,
      organizationId: membership.organization_id,
      userId: request!.user_id,
      startDate: request!.start_date,
      endDate: request!.end_date,
      excludedRequestId: requestId,
      t,
      fail: (message) => goLeave(message, "error"),
    });
  }
  const {error} = await admin.from("leave_requests").update({
    status,
    review_note: reviewNote,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId).eq("organization_id", membership.organization_id).eq("status", "pending");
  if (error) goLeave(t("performance.messages.leaveReviewFailed", {message: error.message}), "error");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: request!.user_id,
    entityType: "leave_request",
    entityId: requestId,
    action: status,
    details: {review_note: reviewNote},
  });
  await createNotification({
    organizationId: membership.organization_id,
    userId: request!.user_id,
    actorId: user.id,
    category: "absences",
    eventType: status === "approved" ? "leave_approved" : "leave_rejected",
    titleFr: status === "approved" ? "Demande de congé approuvée" : "Demande de congé refusée",
    titleEn: status === "approved" ? "Leave request approved" : "Leave request rejected",
    bodyFr: `Votre demande du ${request!.start_date} au ${request!.end_date} a été ${status === "approved" ? "approuvée" : "refusée"}.${reviewNote ? ` Note RH : ${reviewNote}` : ""}`,
    bodyEn: `Your request from ${request!.start_date} to ${request!.end_date} was ${status === "approved" ? "approved" : "rejected"}.${reviewNote ? ` HR note: ${reviewNote}` : ""}`,
    actionUrl: "/dashboard/performance?view=absences",
    priority: status === "approved" ? "success" : "warning",
    dedupeKey: `leave:${requestId}:${status}:${request!.user_id}`,
    metadata: {request_id: requestId, status},
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/hr/leave");
  revalidatePath("/dashboard/my-day");
  goLeave(t("performance.messages.leaveReviewed"));
}

export async function updateLeaveRequestAction(formData: FormData) {
  const {user, membership, admin, locale, t} = await getContext();
  const fr = locale === "fr";
  const returnTo = String(formData.get("returnTo") ?? "").trim();
  const finish = (message: string, kind: "success" | "error" = "success"): never => {
    if (returnTo.startsWith("/dashboard/hr/leave")) goOperational(returnTo, message, kind);
    go(message, kind, "absences");
  };
  if (!hrRoles.has(membership.role)) finish(fr ? "Seuls le RH et les administrateurs peuvent corriger une demande de congé." : "Only HR and administrators can correct a leave request.", "error");

  const requestId = String(formData.get("requestId") ?? "").trim();
  const leaveType = String(formData.get("leaveType") ?? "").trim();
  const startDate = normalizeDate(formData.get("startDate"));
  const endDate = normalizeDate(formData.get("endDate"));
  const reason = cleanText(formData.get("reason"), 2000);
  const correctionReason = cleanText(formData.get("correctionReason"), 1000);
  if (!requestId || !leaveTypes.has(leaveType) || !startDate || !endDate || endDate < startDate || reason.length < 3 || correctionReason.length < 3) {
    finish(fr ? "Vérifiez le type, les dates, le motif du congé et le motif de correction." : "Check the type, dates, leave reason, and correction reason.", "error");
  }

  const {data: request, error: requestError} = await admin
    .from("leave_requests")
    .select("id,user_id,leave_type,start_date,end_date,reason,status")
    .eq("id", requestId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; user_id: string; leave_type: string; start_date: string; end_date: string; reason: string; status: string}>();
  if (requestError || !request) {
    finish(fr ? "Cette demande est introuvable." : "This request was not found.", "error");
  }
  const currentRequest = request!;
  if (!["pending", "approved"].includes(currentRequest.status)) {
    finish(fr ? "Cette demande ne peut plus être corrigée." : "This request can no longer be corrected.", "error");
  }

  const {data: overlap, error: overlapError} = await admin
    .from("leave_requests")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", currentRequest.user_id)
    .in("status", ["pending", "approved"])
    .neq("id", requestId)
    .lte("start_date", endDate)
    .gte("end_date", startDate)
    .limit(1);
  if (overlapError) finish(fr ? `Impossible de vérifier les dates : ${overlapError.message}` : `Unable to validate dates: ${overlapError.message}`, "error");
  if (overlap?.length) finish(fr ? "Ces dates chevauchent une autre demande active." : "These dates overlap another active request.", "error");

  if (leaveType === "annual") {
    await ensureAnnualLeaveBalance({
      admin,
      organizationId: membership.organization_id,
      userId: currentRequest.user_id,
      startDate,
      endDate,
      excludedRequestId: requestId,
      t,
      fail: (message) => finish(message, "error"),
    });
  }

  const {error} = await admin.from("leave_requests").update({
    leave_type: leaveType,
    start_date: startDate,
    end_date: endDate,
    reason,
  }).eq("id", requestId).eq("organization_id", membership.organization_id).in("status", ["pending", "approved"]);
  if (error) finish(fr ? `Correction impossible : ${error.message}` : `Unable to update request: ${error.message}`, "error");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: currentRequest.user_id,
    entityType: "leave_request",
    entityId: requestId,
    action: "corrected",
    details: {
      correction_reason: correctionReason,
      previous: {leave_type: currentRequest.leave_type, start_date: currentRequest.start_date, end_date: currentRequest.end_date, reason: currentRequest.reason},
      next: {leave_type: leaveType, start_date: startDate, end_date: endDate, reason},
    },
  });
  await createNotification({
    organizationId: membership.organization_id,
    userId: currentRequest.user_id,
    actorId: user.id,
    category: "absences",
    eventType: "leave_corrected",
    titleFr: "Demande de congé corrigée",
    titleEn: "Leave request corrected",
    bodyFr: `Votre demande couvre maintenant la période du ${startDate} au ${endDate}. Motif de correction : ${correctionReason}`,
    bodyEn: `Your request now covers ${startDate} to ${endDate}. Correction reason: ${correctionReason}`,
    actionUrl: "/dashboard/performance?view=absences",
    priority: "info",
    dedupeKey: `leave:${requestId}:corrected:${Date.now()}`,
    metadata: {request_id: requestId},
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/hr/leave");
  revalidatePath("/dashboard/my-day");
  finish(fr ? "Demande corrigée, solde recalculé et employé informé." : "Request corrected, balance recalculated, and employee notified.");
}

export async function cancelLeaveRequestAction(formData: FormData) {
  const {user, membership, admin, locale} = await getContext();
  const fr = locale === "fr";
  const returnTo = String(formData.get("returnTo") ?? "").trim();
  const finish = (message: string, kind: "success" | "error" = "success"): never => {
    if (returnTo.startsWith("/dashboard/hr/leave")) goOperational(returnTo, message, kind);
    go(message, kind, "absences");
  };
  const requestId = String(formData.get("requestId") ?? "").trim();
  const cancellationReason = cleanText(formData.get("cancellationReason"), 1000);
  if (!requestId || cancellationReason.length < 3) finish(fr ? "Indiquez le motif de l’annulation." : "Enter the cancellation reason.", "error");

  const {data: request, error: requestError} = await admin
    .from("leave_requests")
    .select("id,user_id,leave_type,start_date,end_date,status")
    .eq("id", requestId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; user_id: string; leave_type: string; start_date: string; end_date: string; status: string}>();
  if (requestError || !request) {
    finish(fr ? "Demande de congé introuvable." : "Leave request not found.", "error");
  }
  const currentRequest = request!;

  const isOwner = currentRequest.user_id === user.id;
  const canCancel = (isOwner && currentRequest.status === "pending") || (hrRoles.has(membership.role) && ["pending", "approved"].includes(currentRequest.status));
  if (!canCancel) finish(fr ? "Cette demande ne peut pas être annulée par votre compte." : "Your account cannot cancel this request.", "error");

  const {error} = await admin.from("leave_requests").update({
    status: "cancelled",
    review_note: cancellationReason,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId).eq("organization_id", membership.organization_id).eq("status", currentRequest.status);
  if (error) finish(fr ? `Annulation impossible : ${error.message}` : `Unable to cancel request: ${error.message}`, "error");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: currentRequest.user_id,
    entityType: "leave_request",
    entityId: requestId,
    action: "cancelled",
    details: {previous_status: currentRequest.status, cancellation_reason: cancellationReason},
  });

  if (isOwner) {
    const requesterName = await leaveRequesterName(admin, currentRequest.user_id);
    await notifyHrAboutLeave({
      admin,
      organizationId: membership.organization_id,
      requesterId: currentRequest.user_id,
      actorId: user.id,
      requestId,
      eventType: "leave_cancelled_by_employee",
      titleFr: "Demande de congé annulée",
      titleEn: "Leave request cancelled",
      bodyFr: `${requesterName} a annulé sa demande du ${currentRequest.start_date} au ${currentRequest.end_date}.`,
      bodyEn: `${requesterName} cancelled their request from ${currentRequest.start_date} to ${currentRequest.end_date}.`,
    });
  } else {
    await createNotification({
      organizationId: membership.organization_id,
      userId: currentRequest.user_id,
      actorId: user.id,
      category: "absences",
      eventType: "leave_cancelled_by_hr",
      titleFr: "Demande de congé annulée par le RH",
      titleEn: "Leave request cancelled by HR",
      bodyFr: `Votre demande du ${currentRequest.start_date} au ${currentRequest.end_date} a été annulée. Motif : ${cancellationReason}`,
      bodyEn: `Your request from ${currentRequest.start_date} to ${currentRequest.end_date} was cancelled. Reason: ${cancellationReason}`,
      actionUrl: "/dashboard/performance?view=absences",
      priority: "warning",
      dedupeKey: `leave:${requestId}:cancelled:${currentRequest.user_id}`,
      metadata: {request_id: requestId},
    });
  }
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/hr/leave");
  revalidatePath("/dashboard/my-day");
  finish(fr ? "Demande annulée et solde recalculé." : "Request cancelled and balance recalculated.");
}

export async function updateAnnualLeaveBalanceAction(formData: FormData) {
  const {user, membership, admin, locale} = await getContext();
  const fr = locale === "fr";
  const rawReturnTo = String(formData.get("returnTo") ?? "").trim();
  const returnTo = rawReturnTo.startsWith("/dashboard/hr/leave") ? rawReturnTo : "/dashboard/hr/leave";
  const finish = (message: string, kind: "success" | "error" = "success"): never =>
    goOperational(returnTo, message, kind);

  if (!hrRoles.has(membership.role)) {
    finish(fr ? "Seuls le propriétaire, l’administrateur et le RH peuvent ajuster les soldes de congé." : "Only owners, administrators and HR can adjust leave balances.", "error");
  }

  const employeeId = String(formData.get("userId") ?? "").trim();
  const leaveYear = parseInteger(formData.get("leaveYear"));
  const allowance = parseInteger(formData.get("annualAllowance"));
  const priorUsedDays = parseInteger(formData.get("priorUsedDays"));
  const reason = cleanText(formData.get("reason"), 1000);
  const currentYear = new Date().getUTCFullYear();
  if (
    !employeeId
    || !Number.isInteger(leaveYear)
    || leaveYear < currentYear - 5
    || leaveYear > currentYear + 2
    || !Number.isInteger(allowance)
    || allowance < 0
    || allowance > 365
    || !Number.isInteger(priorUsedDays)
    || priorUsedDays < 0
    || priorUsedDays > 365
    || reason.length < 3
  ) {
    finish(fr ? "Vérifiez l’année, les jours et le motif de l’ajustement." : "Check the year, day values and adjustment reason.", "error");
  }

  if (!(await ensureMember(membership.organization_id, employeeId, admin))) {
    finish(fr ? "Cet employé actif est introuvable dans l’organisation." : "This active employee was not found in the organisation.", "error");
  }

  const {error} = await admin.rpc("set_leave_annual_balance", {
    p_organization_id: membership.organization_id,
    p_user_id: employeeId,
    p_leave_year: leaveYear,
    p_annual_allowance: allowance,
    p_prior_used_days: priorUsedDays,
    p_reason: reason,
    p_actor_id: user.id,
  });
  if (error) {
    finish(fr ? `Impossible d’enregistrer le solde : ${error.message}` : `Unable to save the balance: ${error.message}`, "error");
  }

  revalidatePath("/dashboard/hr/leave");
  revalidatePath("/dashboard/performance");
  finish(fr ? "Solde annuel mis à jour et historisé." : "Annual balance updated and recorded in history.");
}

export async function submitDailyReportAction(formData: FormData) {
  const {user, membership, admin, t, locale} = await getContext();
  const dailyCopy = dailyExecutionCopy(locale);
  const reportDate = normalizeDate(formData.get("reportDate"));
  const accomplishments = cleanText(formData.get("accomplishments"), 3000);
  const results = cleanText(formData.get("results"), 3000);
  const blockers = cleanText(formData.get("blockers"), 3000) || t("performance.noBlockers");
  const nextPriorities = cleanText(formData.get("nextPriorities"), 3000);
  if (!reportDate || accomplishments.length < 3 || results.length < 3 || nextPriorities.length < 3) {
    go(t("performance.messages.invalidReport"), "error", "reports");
  }

  let settings!: PerformanceSettings;
  let schedule: ScheduleRow | null = null;
  try {
    ({settings, schedule} = await loadSettingsAndSchedule(membership.organization_id, user.id, admin));
  } catch {
    go(t("performance.messages.databaseSetupRequired"), "error", "reports");
  }

  const now = new Date();
  let detailedSchedule: DetailedScheduleRow | null = null;
  try {
    detailedSchedule = await loadPublishedDetailedSchedule(membership.organization_id, user.id, reportDate, admin);
  } catch (error) {
    go(t("performance.messages.reportSaveFailed", {message: error instanceof Error ? error.message : String(error)}), "error", "reports");
  }
  const window = reportWindowState(reportDate, now, settings, schedule, detailedSchedule);
  if (window.isFuture) go(t("performance.messages.futureReport"), "error", "reports");
  if (!window.reportRequired) go(t("performance.messages.reportNotRequired"), "error", "reports");

  const {data: dailySettings, error: dailySettingsError} = await admin
    .from("daily_execution_settings")
    .select("enabled, minimum_tasks, require_task_outcomes_for_report, required_from")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<DailyExecutionSettingsRow>();
  if (dailySettingsError) go(dailyCopy.messages.migration, "error", "reports");

  const dailyOutcomesRequired = Boolean(
    dailySettings?.enabled !== false &&
    dailySettings?.require_task_outcomes_for_report !== false &&
    reportDate >= String(dailySettings?.required_from || reportDate),
  );
  let dailyPlan: DailyWorkPlanRow | null = null;
  let dailyOutcomeInputs: DailyTaskOutcomeInput[] = [];

  if (dailyOutcomesRequired) {
    const {data: plan, error: planError} = await admin
      .from("daily_work_plans")
      .select("id, status, minimum_tasks_snapshot")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", user.id)
      .eq("work_date", reportDate)
      .maybeSingle<DailyWorkPlanRow>();
    if (planError) go(dailyCopy.messages.migration, "error", "reports");
    dailyPlan = plan ?? null;
    if (!dailyPlan) go(dailyCopy.messages.planRequired, "error", "reports");

    const {data: taskData, error: taskError} = await admin
      .from("daily_work_tasks")
      .select("id, plan_id, position, title, expected_outcome, priority, progress_status")
      .eq("plan_id", dailyPlan.id)
      .eq("organization_id", membership.organization_id)
      .eq("user_id", user.id)
      .order("position");
    if (taskError) go(dailyCopy.messages.migration, "error", "reports");
    const dailyTasks = (taskData ?? []) as DailyWorkTaskRow[];
    const minimumTasks = Math.max(1, Number(dailyPlan.minimum_tasks_snapshot || dailySettings?.minimum_tasks || 6));
    if (dailyTasks.length < minimumTasks) go(dailyCopy.messages.planRequired, "error", "reports");

    const submittedIds = new Set(formData.getAll("dailyTaskId").map((value) => String(value).trim()).filter(Boolean));
    const expectedIds = new Set(dailyTasks.map((task) => task.id));
    if (submittedIds.size !== expectedIds.size || [...expectedIds].some((id) => !submittedIds.has(id))) {
      go(dailyCopy.messages.invalidOutcome, "error", "reports");
    }

    dailyOutcomeInputs = dailyTasks.map((task) => {
      const finalStatus = String(formData.get(`dailyTaskStatus:${task.id}`) ?? "").trim();
      const actualOutcome = cleanText(formData.get(`dailyTaskOutcome:${task.id}`), 3000);
      const reason = cleanText(formData.get(`dailyTaskReason:${task.id}`), 2000) || null;
      const nextActionValue = String(formData.get(`dailyTaskNextAction:${task.id}`) ?? "").trim();
      const nextActionDateValue = normalizeDate(formData.get(`dailyTaskNextDate:${task.id}`)) || null;
      const nextAction = dailyTaskNextActions.has(nextActionValue) ? nextActionValue : null;

      if (!dailyTaskFinalStatuses.has(finalStatus) || actualOutcome.length < 3) {
        go(dailyCopy.messages.incompleteOutcome(task.title), "error", "reports");
      }
      if (finalStatus !== "completed" && (!reason || !nextAction || nextAction === "none")) {
        go(dailyCopy.messages.reasonRequired(task.title), "error", "reports");
      }
      if (finalStatus === "completed" && nextAction && nextAction !== "none") {
        go(dailyCopy.messages.invalidOutcome, "error", "reports");
      }

      return {
        ...task,
        finalStatus,
        actualOutcome,
        reason,
        nextAction: finalStatus === "completed" ? "none" : nextAction,
        nextActionDate: finalStatus === "completed" ? null : nextActionDateValue,
      };
    });

  }

  const {data: existingReport} = await admin
    .from("daily_reports")
    .select("id, user_id, report_date, accomplishments, results, blockers, next_priorities, status, submitted_at, submitted_by, submission_mode, submission_score_factor, supervisor_reason, review_note, reviewed_by, reviewed_at, revision_number")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("report_date", reportDate)
    .maybeSingle<DailyReportSnapshot>();

  await expireReopenings(membership.organization_id, user.id, reportDate, admin);
  let reopening: (ReopeningRow & {reopening_type?: string; opened_by?: string; reason?: string}) | null = null;
  if (existingReport || (settings.report_lock_enabled !== false && !window.isNormallyOpen)) {
    const {data} = await admin
      .from("daily_report_reopenings")
      .select("id, user_id, report_date, score_factor, status, expires_at, reopening_type, opened_by, reason")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", user.id)
      .eq("report_date", reportDate)
      .eq("status", "active")
      .gt("expires_at", now.toISOString())
      .order("opened_at", {ascending: false})
      .limit(1)
      .maybeSingle<ReopeningRow & {reopening_type?: string; opened_by?: string; reason?: string}>();
    reopening = data;
  }

  if (existingReport && !reopening) go(t("performance.messages.reportAlreadySubmitted"), "error", "reports");
  if (!existingReport && settings.report_lock_enabled !== false && !window.isNormallyOpen && !reopening) {
    go(t("performance.messages.reportLocked"), "error", "reports");
  }

  if (dailyOutcomesRequired && dailyPlan) {
    const finalizedAt = now.toISOString();
    for (const outcome of dailyOutcomeInputs) {
      const {error: outcomeError} = await admin.from("daily_work_tasks").update({
        progress_status: outcome.finalStatus,
        actual_outcome: outcome.actualOutcome,
        outcome_reason: outcome.reason,
        next_action: outcome.nextAction,
        next_action_date: outcome.nextActionDate,
        completed_at: outcome.finalStatus === "completed" ? finalizedAt : null,
        report_finalized_at: finalizedAt,
      }).eq("id", outcome.id).eq("plan_id", dailyPlan.id).eq("user_id", user.id);
      if (outcomeError) go(t("performance.messages.reportSaveFailed", {message: outcomeError.message}), "error", "reports");
    }
  }

  const submissionMode = reopening ? "reopened_employee" : "employee";
  const scoreFactor = reopening ? Math.min(1, Math.max(0, Number(reopening.score_factor))) : 1;
  const status = reopening ? "late" : "on_time";
  const reportRevisionNumber = existingReport ? Math.max(1, Number(existingReport.revision_number ?? 1)) + 1 : 1;
  let reportId: string;

  if (existingReport) {
    try {
      await archiveDailyReportVersion(admin, {
        organizationId: membership.organization_id,
        report: existingReport,
        actorId: user.id,
        reason: reopening?.reason || "Revision autorisee du rapport",
        reopeningId: reopening?.id ?? null,
      });
    } catch (error) {
      go(t("performance.messages.reportVersionArchiveFailed", {message: error instanceof Error ? error.message : String(error)}), "error", "reports");
    }
    const {data, error} = await admin.from("daily_reports").update({
      accomplishments,
      results,
      blockers,
      next_priorities: nextPriorities,
      status,
      submitted_at: now.toISOString(),
      submitted_by: user.id,
      submission_mode: submissionMode,
      submission_score_factor: Number.isFinite(scoreFactor) ? scoreFactor : 1,
      supervisor_reason: null,
      reopening_id: reopening?.id ?? null,
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      revision_number: reportRevisionNumber,
      locked_at: now.toISOString(),
      last_reopened_at: now.toISOString(),
      last_reopened_by: reopening?.opened_by ?? null,
      last_revision_reason: reopening?.reason ?? null,
    }).eq("id", existingReport.id).eq("organization_id", membership.organization_id).select("id").single<{id: string}>();
    if (error || !data) go(t("performance.messages.reportSaveFailed", {message: error?.message || "Report identifier missing."}), "error", "reports");
    reportId = data.id;
  } else {
    const {data, error} = await admin.from("daily_reports").insert({
      organization_id: membership.organization_id,
      user_id: user.id,
      report_date: reportDate,
      accomplishments,
      results,
      blockers,
      next_priorities: nextPriorities,
      status,
      submitted_at: now.toISOString(),
      submitted_by: user.id,
      submission_mode: submissionMode,
      submission_score_factor: Number.isFinite(scoreFactor) ? scoreFactor : 1,
      supervisor_reason: null,
      reopening_id: reopening?.id ?? null,
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      revision_number: 1,
      locked_at: now.toISOString(),
      last_reopened_at: reopening ? now.toISOString() : null,
      last_reopened_by: reopening?.opened_by ?? null,
      last_revision_reason: reopening?.reason ?? null,
    }).select("id").single<{id: string}>();
    if (error) {
      if (error.code === "23505") go(t("performance.messages.reportAlreadySubmitted"), "error", "reports");
      go(t("performance.messages.reportSaveFailed", {message: error.message}), "error", "reports");
    }
    if (!data) go(t("performance.messages.reportSaveFailed", {message: "Report identifier missing."}), "error", "reports");
    reportId = data.id;
  }

  if (dailyOutcomesRequired && dailyPlan) {
    const snapshots = dailyOutcomeInputs.map((outcome) => ({
      organization_id: membership.organization_id,
      plan_id: dailyPlan!.id,
      task_id: outcome.id,
      daily_report_id: reportId,
      report_revision_number: reportRevisionNumber,
      user_id: user.id,
      work_date: reportDate,
      position: outcome.position,
      title: outcome.title,
      expected_outcome: outcome.expected_outcome,
      priority: outcome.priority,
      final_status: outcome.finalStatus,
      actual_outcome: outcome.actualOutcome,
      outcome_reason: outcome.reason,
      next_action: outcome.nextAction,
      next_action_date: outcome.nextActionDate,
      captured_at: now.toISOString(),
    }));
    const {error: snapshotsError} = await admin
      .from("daily_work_task_outcome_versions")
      .upsert(snapshots, {onConflict: "task_id,report_revision_number"});
    if (snapshotsError) console.error("Daily task outcome snapshots failed", snapshotsError);

    const {error: planCompletionError} = await admin.from("daily_work_plans").update({
      daily_report_id: reportId,
      status: "completed",
      locked_at: now.toISOString(),
      completed_at: now.toISOString(),
      updated_by: user.id,
    }).eq("id", dailyPlan.id).eq("organization_id", membership.organization_id).eq("user_id", user.id);
    if (planCompletionError) console.error("Daily work plan completion failed", planCompletionError);
  }

  if (reopening) {
    await admin
      .from("daily_report_reopenings")
      .update({status: "used", used_at: now.toISOString()})
      .eq("id", reopening.id)
      .eq("status", "active");
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: user.id,
    entityType: "daily_report",
    entityId: reportId,
    action: existingReport ? "revised_after_reopening" : reopening ? "submitted_after_reopening" : "submitted",
    details: {
      report_date: reportDate,
      status,
      submission_mode: submissionMode,
      score_factor: scoreFactor,
      reopening_id: reopening?.id ?? null,
      revision_number: reportRevisionNumber,
      daily_plan_id: dailyPlan?.id ?? null,
      daily_task_count: dailyOutcomeInputs.length,
      daily_tasks_completed: dailyOutcomeInputs.filter((item) => item.finalStatus === "completed").length,
      daily_tasks_blocked: dailyOutcomeInputs.filter((item) => item.finalStatus === "blocked").length,
    },
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/my-day");
  go(existingReport ? t("performance.messages.reportRevisionSubmitted") : reopening ? t("performance.messages.reopenedReportSubmitted") : t("performance.messages.reportSubmitted"), "success", "reports");
}

export async function reopenDailyReportAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const returnTo = safeDailyReportGovernanceReturn(formData.get("returnTo"));
  const finish = (message: string, kind: "success" | "error" = "success"): never => goDailyReportGovernance(returnTo, message, kind);
  if (!leaderRoles.has(membership.role)) finish(t("performance.messages.permissionDenied"), "error");
  const employeeId = String(formData.get("userId") ?? "").trim();
  const reportDate = normalizeDate(formData.get("reportDate"));
  const reason = cleanText(formData.get("reason"), 2000);
  const requestedHours = parseInteger(formData.get("durationHours"));
  const justified = formData.get("justified") === "on";
  if (!employeeId || !reportDate || reason.length < 10 || !Number.isInteger(requestedHours) || requestedHours < 1) {
    finish(t("performance.messages.invalidReopening"), "error");
  }
  if (!(await ensureMember(membership.organization_id, employeeId, admin))) finish(t("performance.messages.memberNotFound"), "error");
  if (!(await canGovernEmployee(membership, user.id, employeeId, admin))) finish(t("performance.messages.notAssignedSupervisor"), "error");

  let settings!: PerformanceSettings;
  let schedule: ScheduleRow | null = null;
  try {
    ({settings, schedule} = await loadSettingsAndSchedule(membership.organization_id, employeeId, admin));
  } catch {
    finish(t("performance.messages.databaseSetupRequired"), "error");
  }
  const now = new Date();
  let detailedSchedule: DetailedScheduleRow | null = null;
  try {
    detailedSchedule = await loadPublishedDetailedSchedule(membership.organization_id, employeeId, reportDate, admin);
  } catch (error) {
    finish(t("performance.messages.reopeningFailed", {message: error instanceof Error ? error.message : String(error)}), "error");
  }
  const window = reportWindowState(reportDate, now, settings, schedule, detailedSchedule);
  if (window.isFuture) finish(t("performance.messages.futureReport"), "error");
  if (!window.reportRequired) finish(t("performance.messages.reportNotRequired"), "error");

  const {data: existingReport} = await admin
    .from("daily_reports")
    .select("id, status")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", employeeId)
    .eq("report_date", reportDate)
    .maybeSingle<{id: string; status: string}>();
  if (!existingReport && !window.isClosed) finish(t("performance.messages.reportDayStillOpen"), "error");

  await expireReopenings(membership.organization_id, employeeId, reportDate, admin);
  const {data: activeReopening} = await admin
    .from("daily_report_reopenings")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", employeeId)
    .eq("report_date", reportDate)
    .eq("status", "active")
    .gt("expires_at", now.toISOString())
    .maybeSingle<{id: string}>();
  if (activeReopening) finish(t("performance.messages.reopeningAlreadyActive"), "error");
  const {count} = await admin
    .from("daily_report_reopenings")
    .select("id", {head: true, count: "exact"})
    .eq("organization_id", membership.organization_id)
    .eq("user_id", employeeId)
    .eq("report_date", reportDate);
  const maximumReopenings = settings.maximum_reopenings_per_day ?? 1;
  if ((count ?? 0) >= maximumReopenings) finish(t("performance.messages.reopeningLimitReached"), "error");

  const maximumHours = settings.maximum_reopen_hours ?? 24;
  const durationHours = Math.min(requestedHours, maximumHours);
  const scorePercent = justified ? 100 : Number(settings.reopened_report_score_percent ?? 70);
  const scoreFactor = Math.min(1, Math.max(0, scorePercent / 100));
  const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
  const reopeningType = existingReport ? "revision" : "missing";
  const {data, error} = await admin.from("daily_report_reopenings").insert({
    organization_id: membership.organization_id,
    user_id: employeeId,
    report_date: reportDate,
    reason,
    justified,
    score_factor: scoreFactor,
    status: "active",
    opened_by: user.id,
    opened_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    reopening_type: reopeningType,
    existing_report_id: existingReport?.id ?? null,
    previous_status: existingReport?.status ?? null,
  }).select("id").single<{id: string}>();
  const reopeningRecordId = data?.id ?? null;
  if (error || !reopeningRecordId) finish(t("performance.messages.reopeningFailed", {message: error?.message || "Report reopening identifier missing."}), "error");

  await createNotification({
    organizationId: membership.organization_id,
    userId: employeeId,
    actorId: user.id,
    category: "reports",
    eventType: existingReport ? "daily_report_revision_opened" : "daily_report_reopened",
    titleFr: existingReport ? "Correction de rapport autorisée" : "Rapport journalier rouvert",
    titleEn: existingReport ? "Report revision authorised" : "Daily report reopened",
    bodyFr: `${existingReport ? "Vous pouvez corriger" : "Vous pouvez compléter"} le rapport du ${reportDate} jusqu'au ${expiresAt.toLocaleString("fr-FR")}. Motif : ${reason}`,
    bodyEn: `${existingReport ? "You may revise" : "You may complete"} the report for ${reportDate} until ${expiresAt.toLocaleString("en-GB")}. Reason: ${reason}`,
    actionUrl: "/dashboard/performance?view=reports",
    priority: "warning",
    requiresAction: true,
    dedupeKey: `daily-report-reopening:${reopeningRecordId}`,
  });

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: employeeId,
    entityType: "daily_report_reopening",
    entityId: reopeningRecordId,
    action: existingReport ? "revision_opened" : "opened",
    details: {report_date: reportDate, reason, justified, duration_hours: durationHours, expires_at: expiresAt.toISOString(), score_factor: scoreFactor, reopening_type: reopeningType, existing_report_id: existingReport?.id ?? null},
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/hr/daily-reports");
  finish(existingReport ? t("performance.messages.reportRevisionOpened") : t("performance.messages.reportReopened"), "success");
}

export async function revokeDailyReportReopeningAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "reports");
  const reopeningId = String(formData.get("reopeningId") ?? "").trim();
  if (!reopeningId) go(t("performance.messages.invalidReopening"), "error", "reports");
  const {data: reopening} = await admin
    .from("daily_report_reopenings")
    .select("id, user_id, report_date, status")
    .eq("id", reopeningId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; user_id: string; report_date: string; status: string}>();
  if (!reopening || reopening.status !== "active") go(t("performance.messages.reopeningNotFound"), "error", "reports");
  if (!(await canGovernEmployee(membership, user.id, reopening.user_id, admin))) go(t("performance.messages.notAssignedSupervisor"), "error", "reports");
  const now = new Date().toISOString();
  const {error} = await admin.from("daily_report_reopenings").update({status: "revoked", revoked_by: user.id, revoked_at: now}).eq("id", reopeningId).eq("status", "active");
  if (error) go(t("performance.messages.reopeningRevokeFailed", {message: error.message}), "error", "reports");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: reopening.user_id,
    entityType: "daily_report_reopening",
    entityId: reopeningId,
    action: "revoked",
    details: {report_date: reopening.report_date},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.reopeningRevoked"), "success", "reports");
}

export async function completeDailyReportForEmployeeAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const returnTo = safeDailyReportGovernanceReturn(formData.get("returnTo"));
  const finish = (message: string, kind: "success" | "error" = "success"): never => goDailyReportGovernance(returnTo, message, kind);
  if (!leaderRoles.has(membership.role)) finish(t("performance.messages.permissionDenied"), "error");
  const employeeId = String(formData.get("userId") ?? "").trim();
  const reportDate = normalizeDate(formData.get("reportDate"));
  const supervisorReason = cleanText(formData.get("supervisorReason"), 2000);
  const accomplishments = cleanText(formData.get("accomplishments"), 3000);
  const results = cleanText(formData.get("results"), 3000);
  const blockers = cleanText(formData.get("blockers"), 3000) || t("performance.noBlockers");
  const nextPriorities = cleanText(formData.get("nextPriorities"), 3000);
  if (!employeeId || !reportDate || supervisorReason.length < 10 || accomplishments.length < 3 || results.length < 3 || nextPriorities.length < 3) {
    finish(t("performance.messages.invalidSupervisorReport"), "error");
  }
  if (!(await ensureMember(membership.organization_id, employeeId, admin))) finish(t("performance.messages.memberNotFound"), "error");
  if (!(await canSuperviseEmployee(membership, user.id, employeeId, admin))) finish(t("performance.messages.notAssignedSupervisor"), "error");

  let settings!: PerformanceSettings;
  let schedule: ScheduleRow | null = null;
  try {
    ({settings, schedule} = await loadSettingsAndSchedule(membership.organization_id, employeeId, admin));
  } catch {
    finish(t("performance.messages.databaseSetupRequired"), "error");
  }
  const now = new Date();
  let detailedSchedule: DetailedScheduleRow | null = null;
  try {
    detailedSchedule = await loadPublishedDetailedSchedule(membership.organization_id, employeeId, reportDate, admin);
  } catch (error) {
    finish(t("performance.messages.reportSaveFailed", {message: error instanceof Error ? error.message : String(error)}), "error");
  }
  const window = reportWindowState(reportDate, now, settings, schedule, detailedSchedule);
  if (window.isFuture) finish(t("performance.messages.futureReport"), "error");
  if (!window.reportRequired) finish(t("performance.messages.reportNotRequired"), "error");
  if (!window.isClosed) finish(t("performance.messages.reportDayStillOpen"), "error");

  const {data: existingReport} = await admin
    .from("daily_reports")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", employeeId)
    .eq("report_date", reportDate)
    .maybeSingle<{id: string}>();
  if (existingReport) finish(t("performance.messages.reportAlreadySubmitted"), "error");

  const scoreFactor = Math.min(1, Math.max(0, Number(settings.supervisor_report_score_percent ?? 50) / 100));
  const {data, error} = await admin.from("daily_reports").insert({
    organization_id: membership.organization_id,
    user_id: employeeId,
    report_date: reportDate,
    accomplishments,
    results,
    blockers,
    next_priorities: nextPriorities,
    status: "supervisor_completed",
    submitted_at: now.toISOString(),
    submitted_by: user.id,
    submission_mode: "supervisor",
    submission_score_factor: scoreFactor,
    supervisor_reason: supervisorReason,
    reopening_id: null,
    review_note: null,
    reviewed_by: null,
    reviewed_at: null,
    revision_number: 1,
    locked_at: now.toISOString(),
  }).select("id").single<{id: string}>();
  const supervisorReportId = data?.id ?? null;
  if (error || !supervisorReportId) finish(t("performance.messages.reportSaveFailed", {message: error?.message || "Report identifier missing."}), "error");

  await admin
    .from("daily_report_reopenings")
    .update({status: "revoked", revoked_by: user.id, revoked_at: now.toISOString()})
    .eq("organization_id", membership.organization_id)
    .eq("user_id", employeeId)
    .eq("report_date", reportDate)
    .eq("status", "active");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: employeeId,
    entityType: "daily_report",
    entityId: supervisorReportId,
    action: "completed_by_supervisor",
    details: {report_date: reportDate, supervisor_reason: supervisorReason, score_factor: scoreFactor},
  });
  await createNotification({
    organizationId: membership.organization_id,
    userId: employeeId,
    actorId: user.id,
    category: "reports",
    eventType: "daily_report_completed_by_supervisor",
    titleFr: "Rapport complété par votre superviseur",
    titleEn: "Report completed by your supervisor",
    bodyFr: `Le rapport du ${reportDate} a été complété à votre place. Motif : ${supervisorReason}`,
    bodyEn: `The report for ${reportDate} was completed on your behalf. Reason: ${supervisorReason}`,
    actionUrl: "/dashboard/performance?view=reports",
    priority: "info",
    dedupeKey: `daily-report-supervisor:${supervisorReportId}`,
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/hr/daily-reports");
  finish(t("performance.messages.supervisorReportSaved"), "success");
}

export async function reviewDailyReportAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "reports");
  const reportId = String(formData.get("reportId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const reviewNote = cleanText(formData.get("reviewNote"), 1200) || null;
  if (!reportId || !reportReviewStatuses.has(status)) go(t("performance.messages.invalidReportReview"), "error", "reports");
  const {data: report} = await admin.from("daily_reports").select("id, user_id").eq("id", reportId).eq("organization_id", membership.organization_id).maybeSingle<{id: string; user_id: string}>();
  if (!report) go(t("performance.messages.reportNotFound"), "error", "reports");
  if (!(await canSuperviseEmployee(membership, user.id, report.user_id, admin))) go(t("performance.messages.notAssignedSupervisor"), "error", "reports");
  const {error} = await admin.from("daily_reports").update({
    status,
    review_note: reviewNote,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", reportId).eq("organization_id", membership.organization_id);
  if (error) go(t("performance.messages.reportReviewFailed", {message: error.message}), "error", "reports");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: report.user_id,
    entityType: "daily_report",
    entityId: reportId,
    action: status,
    details: {review_note: reviewNote},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.reportReviewed"), "success", "reports");
}

export async function updatePerformanceSettingsAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!hrRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "settings");
  const timezone = normalizeTimeZone(cleanText(formData.get("timezone"), 100));
  const defaultStart = normalizeTime(formData.get("defaultStart"));
  const defaultEnd = normalizeTime(formData.get("defaultEnd"));
  const reportDeadline = normalizeTime(formData.get("reportDeadline"));
  const graceMinutes = parseInteger(formData.get("graceMinutes"));
  const reportLockEnabled = formData.get("reportLockEnabled") === "on";
  const workdayReopenEnabled = formData.get("workdayReopenEnabled") === "on";
  const maximumWorkdayReopeningsPerDay = parseInteger(formData.get("maximumWorkdayReopeningsPerDay"));
  const longDayWarningMinutes = parseInteger(formData.get("longDayWarningMinutes"));
  const nightWorkStart = normalizeTime(formData.get("nightWorkStart"));
  const nightWorkEnd = normalizeTime(formData.get("nightWorkEnd"));
  const maximumReopenHours = parseInteger(formData.get("maximumReopenHours"));
  const maximumReopeningsPerDay = parseInteger(formData.get("maximumReopeningsPerDay"));
  const reopenedReportScorePercent = parseNumber(formData.get("reopenedReportScorePercent"));
  const supervisorReportScorePercent = parseNumber(formData.get("supervisorReportScorePercent"));
  const minimumWorkDays = parseInteger(formData.get("minimumWorkDays"));
  const minimumReportRate = parseNumber(formData.get("minimumReportRate"));
  const minimumScore = parseNumber(formData.get("minimumScore"));
  const maximumUnexcusedAbsences = parseInteger(formData.get("maximumUnexcusedAbsences"));
  const weights = {
    attendance_weight: parseNumber(formData.get("attendanceWeight")),
    punctuality_weight: parseNumber(formData.get("punctualityWeight")),
    meetings_weight: parseNumber(formData.get("meetingsWeight")),
    reports_weight: parseNumber(formData.get("reportsWeight")),
    collaboration_weight: parseNumber(formData.get("collaborationWeight")),
    training_weight: parseNumber(formData.get("trainingWeight")),
    role_kpi_weight: parseNumber(formData.get("roleKpiWeight")),
  };
  const weightSum = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (!defaultStart || !defaultEnd || !reportDeadline || defaultEnd <= defaultStart || !Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 180) {
    go(t("performance.messages.invalidSettings"), "error", "settings");
  }
  if (!Number.isInteger(minimumWorkDays) || minimumWorkDays < 1 || minimumWorkDays > 31 || minimumReportRate < 0 || minimumReportRate > 100 || minimumScore < 0 || minimumScore > 100 || !Number.isInteger(maximumUnexcusedAbsences) || maximumUnexcusedAbsences < 0 || maximumUnexcusedAbsences > 31) {
    go(t("performance.messages.invalidEligibility"), "error", "settings");
  }
  if (!Number.isInteger(maximumReopenHours) || maximumReopenHours < 1 || maximumReopenHours > 168 || !Number.isInteger(maximumReopeningsPerDay) || maximumReopeningsPerDay < 1 || maximumReopeningsPerDay > 10 || reopenedReportScorePercent < 0 || reopenedReportScorePercent > 100 || supervisorReportScorePercent < 0 || supervisorReportScorePercent > 100) {
    go(t("performance.messages.invalidReportGovernance"), "error", "settings");
  }
  if (!Number.isInteger(maximumWorkdayReopeningsPerDay) || maximumWorkdayReopeningsPerDay < 1 || maximumWorkdayReopeningsPerDay > 10 || !Number.isInteger(longDayWarningMinutes) || longDayWarningMinutes < 240 || longDayWarningMinutes > 1440 || !nightWorkStart || !nightWorkEnd) {
    go(t("performance.messages.invalidWorkTimeGovernance"), "error", "settings");
  }
  if (Object.values(weights).some((value) => !Number.isFinite(value) || value < 0 || value > 100) || Math.abs(weightSum - 100) > 0.01) {
    go(t("performance.messages.weightsMustEqual100"), "error", "settings");
  }
  const {error} = await admin.from("performance_settings").upsert({
    organization_id: membership.organization_id,
    timezone,
    default_start_time: defaultStart,
    default_end_time: defaultEnd,
    grace_minutes: graceMinutes,
    report_deadline_time: reportDeadline,
    report_lock_enabled: reportLockEnabled,
    workday_reopen_enabled: workdayReopenEnabled,
    maximum_workday_reopenings_per_day: maximumWorkdayReopeningsPerDay,
    long_day_warning_minutes: longDayWarningMinutes,
    night_work_start: nightWorkStart,
    night_work_end: nightWorkEnd,
    maximum_reopen_hours: maximumReopenHours,
    maximum_reopenings_per_day: maximumReopeningsPerDay,
    reopened_report_score_percent: reopenedReportScorePercent,
    supervisor_report_score_percent: supervisorReportScorePercent,
    minimum_work_days: minimumWorkDays,
    minimum_report_rate: minimumReportRate,
    minimum_score: minimumScore,
    maximum_unexcused_absences: maximumUnexcusedAbsences,
    ...weights,
  }, {onConflict: "organization_id"});
  if (error) go(t("performance.messages.settingsSaveFailed", {message: error.message}), "error", "settings");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "performance_settings",
    action: "updated",
    details: {timezone, weight_sum: weightSum, workday_reopen_enabled: workdayReopenEnabled, maximum_workday_reopenings_per_day: maximumWorkdayReopeningsPerDay, long_day_warning_minutes: longDayWarningMinutes, night_work_start: nightWorkStart, night_work_end: nightWorkEnd},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.settingsSaved"), "success", "settings");
}

export async function updateDailyReportReminderSettingsAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!hrRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "settings");
  const enabled = formData.get("reportRemindersEnabled") === "on";
  const firstReminderMinutes = parseInteger(formData.get("reportFirstReminderMinutes"));
  const urgentReminderMinutes = parseInteger(formData.get("reportUrgentReminderMinutes"));
  const supervisorEscalationEnabled = formData.get("reportSupervisorEscalationEnabled") === "on";
  if (!Number.isInteger(firstReminderMinutes) || firstReminderMinutes < 30 || firstReminderMinutes > 720 || !Number.isInteger(urgentReminderMinutes) || urgentReminderMinutes < 5 || urgentReminderMinutes > 120 || firstReminderMinutes <= urgentReminderMinutes) {
    go(t("performance.messages.invalidSettings"), "error", "settings");
  }
  const {error} = await admin.from("performance_settings").upsert({
    organization_id: membership.organization_id,
    report_reminders_enabled: enabled,
    report_first_reminder_minutes: firstReminderMinutes,
    report_urgent_reminder_minutes: urgentReminderMinutes,
    report_supervisor_escalation_enabled: supervisorEscalationEnabled,
  }, {onConflict: "organization_id"});
  if (error) go(t("performance.messages.settingsSaveFailed", {message: error.message}), "error", "settings");
  await audit(admin, {organizationId: membership.organization_id, actorId: user.id, entityType: "daily_report_reminder_settings", action: "updated", details: {enabled, first_reminder_minutes: firstReminderMinutes, urgent_reminder_minutes: urgentReminderMinutes, supervisor_escalation_enabled: supervisorEscalationEnabled}});
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.settingsSaved"), "success", "settings");
}

export async function upsertMemberScheduleAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "settings");
  const userId = String(formData.get("userId") ?? "").trim();
  const supervisorId = String(formData.get("supervisorId") ?? "").trim();
  const timezone = normalizeTimeZone(cleanText(formData.get("timezone"), 100));
  const startTime = normalizeTime(formData.get("startTime"));
  const endTime = normalizeTime(formData.get("endTime"));
  const reportDeadline = normalizeTime(formData.get("reportDeadline"));
  const graceMinutes = parseInteger(formData.get("graceMinutes"));
  const workPolicy = normalizeWorkPolicy(formData.get("workPolicy"));
  const startWindowFrom = normalizeTime(formData.get("startWindowFrom")) || startTime;
  const startWindowUntil = normalizeTime(formData.get("startWindowUntil")) || startTime;
  const dailyTargetMinutes = parseInteger(formData.get("dailyTargetMinutes"));
  const weeklyTargetMinutes = parseInteger(formData.get("weeklyTargetMinutes"));
  const coreHoursStart = normalizeTime(formData.get("coreHoursStart")) || null;
  const coreHoursEnd = normalizeTime(formData.get("coreHoursEnd")) || null;
  const latestEndTime = normalizeTime(formData.get("latestEndTime")) || null;
  const allowOvernight = formData.get("allowOvernight") === "on";
  const pauseTrackingEnabled = formData.get("pauseTrackingEnabled") === "on";
  const shortDayJustificationRequired = formData.get("shortDayJustificationRequired") === "on";
  const reportRequiredBeforeClockOut = formData.get("reportRequiredBeforeClockOut") === "on";
  const attendanceTrackingRequired = formData.get("attendanceTrackingRequired") === "on";
  const employeeAlertDelayMinutes = parseInteger(formData.get("employeeAlertDelayMinutes"), 0);
  const supervisorAlertDelayMinutes = parseInteger(formData.get("supervisorAlertDelayMinutes"), 30);
  const workDays = formData.getAll("workDays").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);

  const invalidFixedRange = !allowOvernight && endTime <= startTime;
  const invalidStartWindow = timeToMinutes(startWindowUntil) < timeToMinutes(startWindowFrom);
  const invalidCoreHours = Boolean(coreHoursStart) !== Boolean(coreHoursEnd) || Boolean(coreHoursStart && coreHoursEnd && !allowOvernight && coreHoursEnd <= coreHoursStart);
  if (
    !userId || !startTime || !endTime || !reportDeadline || workDays.length === 0 ||
    invalidFixedRange || invalidStartWindow || invalidCoreHours ||
    !Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 180 ||
    !Number.isInteger(dailyTargetMinutes) || dailyTargetMinutes < 0 || dailyTargetMinutes > 1440 ||
    !Number.isInteger(weeklyTargetMinutes) || weeklyTargetMinutes < 0 || weeklyTargetMinutes > 10080 ||
    !Number.isInteger(employeeAlertDelayMinutes) || employeeAlertDelayMinutes < 0 || employeeAlertDelayMinutes > 1440 ||
    !Number.isInteger(supervisorAlertDelayMinutes) || supervisorAlertDelayMinutes < 0 || supervisorAlertDelayMinutes > 1440
  ) {
    go(t("performance.messages.invalidSchedule"), "error", "settings");
  }
  if (!(await ensureMember(membership.organization_id, userId, admin))) go(t("performance.messages.memberNotFound"), "error", "settings");
  if (supervisorId && !(await isActiveLeader(membership.organization_id, supervisorId, admin))) go(t("performance.messages.invalidSupervisor"), "error", "settings");
  if (membership.role === "manager") {
    const {data: existingSchedule} = await admin
      .from("member_work_schedules")
      .select("supervisor_id")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle<{supervisor_id: string | null}>();
    if (!existingSchedule || existingSchedule.supervisor_id !== user.id || supervisorId !== user.id) {
      go(t("performance.messages.supervisorAssignmentRestricted"), "error", "settings");
    }
  }
  const {data, error} = await admin.from("member_work_schedules").upsert({
    organization_id: membership.organization_id,
    user_id: userId,
    timezone,
    work_days: [...new Set(workDays)].sort(),
    start_time: startTime,
    end_time: endTime,
    grace_minutes: graceMinutes,
    report_deadline_time: reportDeadline,
    supervisor_id: supervisorId || null,
    work_policy: workPolicy,
    start_window_from: startWindowFrom,
    start_window_until: startWindowUntil,
    daily_target_minutes: dailyTargetMinutes,
    weekly_target_minutes: weeklyTargetMinutes,
    core_hours_start: coreHoursStart,
    core_hours_end: coreHoursEnd,
    latest_end_time: latestEndTime,
    allow_overnight: allowOvernight,
    pause_tracking_enabled: pauseTrackingEnabled,
    short_day_justification_required: shortDayJustificationRequired,
    report_required_before_clock_out: reportRequiredBeforeClockOut,
    attendance_tracking_required: attendanceTrackingRequired,
    employee_alert_delay_minutes: employeeAlertDelayMinutes,
    supervisor_alert_delay_minutes: supervisorAlertDelayMinutes,
    is_active: true,
    updated_by: user.id,
  }, {onConflict: "organization_id,user_id"}).select("id").single<{id: string}>();
  if (error || !data) go(t("performance.messages.scheduleSaveFailed", {message: error?.message || "Schedule identifier missing."}), "error", "settings");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: userId,
    entityType: "member_schedule",
    entityId: data.id,
    action: "upserted",
    details: {
      work_days: workDays,
      start_time: startTime,
      end_time: endTime,
      supervisor_id: supervisorId || null,
      work_policy: workPolicy,
      start_window_from: startWindowFrom,
      start_window_until: startWindowUntil,
      daily_target_minutes: dailyTargetMinutes,
      weekly_target_minutes: weeklyTargetMinutes,
      core_hours_start: coreHoursStart,
      core_hours_end: coreHoursEnd,
      latest_end_time: latestEndTime,
      allow_overnight: allowOvernight,
      pause_tracking_enabled: pauseTrackingEnabled,
      short_day_justification_required: shortDayJustificationRequired,
      report_required_before_clock_out: reportRequiredBeforeClockOut,
      attendance_tracking_required: attendanceTrackingRequired,
      employee_alert_delay_minutes: employeeAlertDelayMinutes,
      supervisor_alert_delay_minutes: supervisorAlertDelayMinutes,
    },
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/my-day");
  go(t("performance.messages.scheduleSaved"), "success", "settings");
}

export async function createPerformanceMeetingAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "meetings");
  const title = cleanText(formData.get("title"), 200);
  const meetingType = String(formData.get("meetingType") ?? "team").trim();
  const startsAt = String(formData.get("startsAt") ?? "").trim();
  const endsAt = String(formData.get("endsAt") ?? "").trim() || null;
  const notes = cleanText(formData.get("notes"), 2000) || null;
  const mandatory = formData.get("mandatory") === "on";
  const zoomRequested = formData.get("createZoom") === "on";
  const suppliedMeetingUrl = cleanText(formData.get("meetingUrl"), 1000);
  const requestedZoomHostId = cleanText(formData.get("zoomHostAccountId"), 100);
  const meetingDepartment = cleanText(formData.get("meetingDepartment"), 160);
  const participantIds = [...new Set(formData.getAll("participantIds").map(String).filter(Boolean))];
  const {data: meetingSettings} = await admin
    .from("performance_settings")
    .select("timezone")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{timezone: string}>();
  const meetingTimezone = meetingSettings?.timezone || "UTC";
  const parsedStart = zonedLocalToUtc(startsAt, meetingTimezone);
  const parsedEnd = endsAt ? zonedLocalToUtc(endsAt, meetingTimezone) : null;
  if (title.length < 3 || !meetingTypes.has(meetingType) || !parsedStart || (endsAt && !parsedEnd) || (parsedEnd && parsedEnd <= parsedStart) || participantIds.length === 0) {
    go(t("performance.messages.invalidMeeting"), "error", "meetings");
  }
  let manualMeetingUrl: string | null = null;
  if (suppliedMeetingUrl) {
    try {
      const parsedMeetingUrl = new URL(suppliedMeetingUrl);
      if (parsedMeetingUrl.protocol !== "https:") throw new Error("invalid protocol");
      manualMeetingUrl = parsedMeetingUrl.toString();
    } catch {
      go("Le lien de réunion doit être une adresse HTTPS valide.", "error", "meetings");
    }
  }
  if (zoomRequested && manualMeetingUrl) {
    go("Choisis soit la création automatique Zoom, soit un lien Zoom existant.", "error", "meetings");
  }
  const validParticipants: string[] = [];
  for (const participantId of participantIds) {
    if (visibleUserIds.includes(participantId) && await ensureMember(membership.organization_id, participantId, admin)) {
      validParticipants.push(participantId);
    }
  }
  if (validParticipants.length === 0) go(t("performance.messages.noMeetingParticipants"), "error", "meetings");

  let zoomMeeting: Awaited<ReturnType<typeof createZoomMeeting>> | null = null;
  let selectedZoomHost: Awaited<ReturnType<typeof resolveZoomHost>> = null;
  if (zoomRequested) {
    await enforceOrganizationFeature(membership.organization_id, "api_integrations");
    const zoom = await zoomAvailableForOrganization(admin, membership.organization_id);
    if (!zoom.available) {
      go("Zoom n’est pas encore configuré pour cette organisation.", "error", "meetings");
    }
    try {
      let authorizedZoomHostId = requestedZoomHostId || null;
      let authorizedZoomDepartment = meetingDepartment || null;
      if (membership.role === "manager") {
        const {data: managedTeams, error: managedTeamsError} = await admin
          .from("teams")
          .select("department")
          .eq("organization_id", membership.organization_id)
          .eq("manager_id", user.id)
          .eq("is_active", true);
        if (managedTeamsError) throw new Error(managedTeamsError.message);
        const allowedDepartments = [...new Set((managedTeams || [])
          .map((team) => String(team.department || "").trim())
          .filter(Boolean))];
        if (!allowedDepartments.length) {
          throw new Error("Aucun département actif ne vous est attribué. Contactez l’administration.");
        }
        const requestedDepartmentKey = zoomDepartmentKey(meetingDepartment);
        authorizedZoomDepartment = allowedDepartments.find(
          (department) => zoomDepartmentKey(department) === requestedDepartmentKey,
        ) ?? allowedDepartments[0];
        authorizedZoomHostId = null;
      }
      selectedZoomHost = await resolveZoomHost(admin, {
        organizationId: membership.organization_id,
        hostAccountId: authorizedZoomHostId,
        department: authorizedZoomDepartment,
        fallbackEmail: zoom.settings.default_host_email,
      });
      if (!selectedZoomHost) throw new Error("Aucun compte Zoom hôte actif n’est disponible.");
      if (membership.role === "manager" && zoomDepartmentKey(selectedZoomHost.department) !== zoomDepartmentKey(authorizedZoomDepartment)) {
        throw new Error("Aucun compte Zoom actif n’est attribué à votre département. Contactez l’administration.");
      }
      const durationMinutes = parsedEnd
        ? Math.max(15, Math.round((parsedEnd.getTime() - parsedStart.getTime()) / 60000))
        : 60;
      const conflictEnd = parsedEnd ?? new Date(parsedStart.getTime() + durationMinutes * 60000);
      await assertZoomHostAvailability(admin, {
        organizationId: membership.organization_id,
        host: selectedZoomHost,
        startsAt: parsedStart.toISOString(),
        endsAt: conflictEnd.toISOString(),
      });
      zoomMeeting = await createZoomMeeting({
        hostEmail: selectedZoomHost.email,
        topic: title,
        startTime: parsedStart.toISOString(),
        durationMinutes,
        timezone: meetingTimezone,
        agenda: notes,
      });
    } catch (error) {
      go(`Création Zoom impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`, "error", "meetings");
    }
  }

  const {data: meeting, error: meetingError} = await admin.from("performance_meetings").insert({
    organization_id: membership.organization_id,
    title,
    meeting_type: meetingType,
    mandatory,
    starts_at: parsedStart.toISOString(),
    ends_at: parsedEnd?.toISOString() ?? null,
    notes,
    created_by: user.id,
    provider: zoomMeeting || manualMeetingUrl ? "zoom" : "manual",
    meeting_url: zoomMeeting?.join_url ?? manualMeetingUrl,
    zoom_meeting_id: zoomMeeting ? String(zoomMeeting.id) : null,
    zoom_meeting_uuid: zoomMeeting?.uuid ?? null,
    zoom_host_id: zoomMeeting?.host_id ?? selectedZoomHost?.zoom_user_id ?? null,
    zoom_host_email: zoomMeeting?.host_email ?? selectedZoomHost?.email ?? null,
    zoom_host_account_id: selectedZoomHost?.id || null,
    zoom_department: selectedZoomHost?.department || meetingDepartment || null,
    zoom_start_url: null,
    zoom_status: zoomMeeting ? "scheduled" : "not_linked",
    zoom_created_at: zoomMeeting ? new Date().toISOString() : null,
    source_type: "performance",
  }).select("id").single<{id: string}>();
  if (meetingError || !meeting) {
    if (zoomMeeting) await deleteZoomMeeting(String(zoomMeeting.id)).catch(() => undefined);
    go(t("performance.messages.meetingCreateFailed", {message: meetingError?.message || "Unknown error"}), "error", "meetings");
  }
  const {error: attendeeError} = await admin.from("performance_meeting_attendance").insert(
    validParticipants.map((participantId) => ({
      organization_id: membership.organization_id,
      meeting_id: meeting.id,
      user_id: participantId,
      status: "invited",
    })),
  );
  if (attendeeError) {
    await admin.from("performance_meetings").delete().eq("id", meeting.id);
    if (zoomMeeting) await deleteZoomMeeting(String(zoomMeeting.id)).catch(() => undefined);
    go(t("performance.messages.meetingParticipantsFailed", {message: attendeeError.message}), "error", "meetings");
  }
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "meeting",
    entityId: meeting.id,
    action: "created",
    details: {title, mandatory, participants: validParticipants.length, provider: zoomMeeting || manualMeetingUrl ? "zoom" : "manual", zoom_meeting_id: zoomMeeting ? String(zoomMeeting.id) : null, zoom_host_email: selectedZoomHost?.email || null, zoom_department: meetingDepartment || selectedZoomHost?.department || null, meeting_url_supplied: Boolean(manualMeetingUrl)},
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/my-day");
  go(zoomMeeting ? "Réunion Zoom créée et participants invités." : manualMeetingUrl ? "Réunion enregistrée, lien Zoom joint et participants invités." : t("performance.messages.meetingCreated"), "success", "meetings");
}


export async function updatePerformanceMeetingAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "meetings");

  const meetingId = cleanText(formData.get("meetingId"), 100);
  const title = cleanText(formData.get("title"), 200);
  const meetingType = String(formData.get("meetingType") ?? "team").trim();
  const startsAt = String(formData.get("startsAt") ?? "").trim();
  const endsAt = String(formData.get("endsAt") ?? "").trim() || null;
  const notes = cleanText(formData.get("notes"), 2000) || null;
  const mandatory = formData.get("mandatory") === "on";
  if (!meetingId) go("Réunion introuvable.", "error", "meetings");

  const {data: meeting, error: meetingError} = await admin
    .from("performance_meetings")
    .select("id,organization_id,title,meeting_type,mandatory,starts_at,ends_at,notes,created_by,provider,meeting_url,zoom_meeting_id,zoom_host_account_id,zoom_host_email,zoom_department,zoom_status,source_type,source_id")
    .eq("id", meetingId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      title: string;
      meeting_type: string;
      mandatory: boolean;
      starts_at: string;
      ends_at: string | null;
      notes: string | null;
      created_by: string;
      provider: string;
      meeting_url: string | null;
      zoom_meeting_id: string | null;
      zoom_host_account_id: string | null;
      zoom_host_email: string | null;
      zoom_department: string | null;
      zoom_status: string;
      source_type: string;
      source_id: string | null;
    }>();
  if (meetingError || !meeting) go("Réunion introuvable.", "error", "meetings");

  const canEdit = ["owner", "admin", "hr"].includes(membership.role) || meeting.created_by === user.id;
  if (!canEdit) go("Seul l’organisateur ou un administrateur peut modifier cette réunion.", "error", "meetings");

  const {data: meetingSettings} = await admin
    .from("performance_settings")
    .select("timezone")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{timezone: string}>();
  const meetingTimezone = meetingSettings?.timezone || "UTC";
  const parsedStart = zonedLocalToUtc(startsAt, meetingTimezone);
  const parsedEnd = endsAt ? zonedLocalToUtc(endsAt, meetingTimezone) : null;
  if (title.length < 3 || !meetingTypes.has(meetingType) || !parsedStart || (endsAt && !parsedEnd) || (parsedEnd && parsedEnd <= parsedStart)) {
    go("Vérifie le titre, le type et les dates de la réunion.", "error", "meetings");
  }

  const startIso = parsedStart.toISOString();
  const endIso = parsedEnd?.toISOString() ?? null;
  const scheduleChanged = meeting.starts_at !== startIso || (meeting.ends_at || null) !== endIso;
  const contentChanged = meeting.title !== title || meeting.meeting_type !== meetingType || meeting.mandatory !== mandatory || (meeting.notes || null) !== notes;
  if (!scheduleChanged && !contentChanged) go("Aucune modification à enregistrer.", "success", "meetings");

  const durationMinutes = parsedEnd
    ? Math.max(15, Math.round((parsedEnd.getTime() - parsedStart.getTime()) / 60000))
    : 60;

  let zoomSynced = false;
  if (meeting.provider === "zoom" && meeting.zoom_meeting_id) {
    await enforceOrganizationFeature(membership.organization_id, "api_integrations");
    try {
      const host = await resolveZoomHost(admin, {
        organizationId: membership.organization_id,
        hostAccountId: meeting.zoom_host_account_id,
        department: meeting.zoom_department,
        fallbackEmail: meeting.zoom_host_email,
      });
      if (host && !host.allow_concurrent_meetings) {
        const requestedEnd = parsedEnd ?? new Date(parsedStart.getTime() + durationMinutes * 60000);
        const {data: conflicts, error: conflictError} = await admin
          .from("performance_meetings")
          .select("id,title,starts_at,ends_at")
          .eq("organization_id", membership.organization_id)
          .eq("provider", "zoom")
          .ilike("zoom_host_email", host.email)
          .neq("zoom_status", "cancelled")
          .neq("id", meeting.id)
          .lt("starts_at", requestedEnd.toISOString())
          .order("starts_at", {ascending: true})
          .limit(100);
        if (conflictError) throw new Error(conflictError.message);
        const requestedStart = parsedStart.getTime();
        const conflict = (conflicts || []).find((row) => {
          const existingStart = new Date(String(row.starts_at)).getTime();
          const existingEnd = row.ends_at ? new Date(String(row.ends_at)).getTime() : existingStart + 60 * 60 * 1000;
          return existingEnd > requestedStart;
        });
        if (conflict) throw new Error(`Le compte Zoom ${host.email} est déjà utilisé par « ${conflict.title} » sur ce créneau.`);
      }
      await updateZoomMeeting(meeting.zoom_meeting_id, {
        topic: title,
        startTime: startIso,
        durationMinutes,
        timezone: meetingTimezone,
        agenda: notes,
      });
      zoomSynced = true;
    } catch (error) {
      go(`Mise à jour Zoom impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`, "error", "meetings");
    }
  }

  const {error: updateError} = await admin
    .from("performance_meetings")
    .update({
      title,
      meeting_type: meetingType,
      mandatory,
      starts_at: startIso,
      ends_at: endIso,
      notes,
      zoom_status: meeting.provider === "zoom" && meeting.zoom_meeting_id ? "scheduled" : meeting.zoom_status,
      zoom_sync_error: null,
    })
    .eq("id", meeting.id)
    .eq("organization_id", membership.organization_id);
  if (updateError) {
    if (zoomSynced && meeting.zoom_meeting_id) {
      const oldStart = new Date(meeting.starts_at);
      const oldEnd = meeting.ends_at ? new Date(meeting.ends_at) : null;
      await updateZoomMeeting(meeting.zoom_meeting_id, {
        topic: meeting.title,
        startTime: meeting.starts_at,
        durationMinutes: oldEnd ? Math.max(15, Math.round((oldEnd.getTime() - oldStart.getTime()) / 60000)) : 60,
        timezone: meetingTimezone,
        agenda: meeting.notes,
      }).catch(() => undefined);
    }
    go(`Enregistrement impossible : ${updateError.message}`, "error", "meetings");
  }

  if (meeting.source_type === "event") {
    const scheduleUpdate: Record<string, unknown> = {
      start_at: startIso,
      end_at: endIso,
      notes,
      meeting_url: meeting.meeting_url,
    };
    if (meeting.source_id) {
      const {data: sourceEvent} = await admin
        .from("events")
        .select("name")
        .eq("id", meeting.source_id)
        .eq("organization_id", membership.organization_id)
        .maybeSingle<{name: string}>();
      const prefix = sourceEvent?.name ? `${sourceEvent.name} — ` : "";
      scheduleUpdate.title = prefix && title.startsWith(prefix) ? title.slice(prefix.length) : title;
    }
    await admin
      .from("event_schedule_items")
      .update(scheduleUpdate)
      .eq("performance_meeting_id", meeting.id)
      .eq("organization_id", membership.organization_id);
  }

  if (scheduleChanged) {
    const {data: attendeeRows} = await admin
      .from("performance_meeting_attendance")
      .select("user_id")
      .eq("meeting_id", meeting.id)
      .eq("organization_id", membership.organization_id);
    const formatter = new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: normalizeTimeZone(meetingTimezone),
    });
    const newMoment = formatter.format(parsedStart);
    await Promise.all((attendeeRows || [])
      .map((row) => String(row.user_id || ""))
      .filter((recipientId) => recipientId && recipientId !== user.id)
      .map((recipientId) => createNotification({
        organizationId: membership.organization_id,
        userId: recipientId,
        actorId: user.id,
        category: "meetings",
        eventType: "meeting_rescheduled",
        titleFr: "Réunion mise à jour",
        titleEn: "Meeting updated",
        bodyFr: `La réunion « ${title} » est maintenant prévue le ${newMoment}.`,
        bodyEn: `The meeting “${title}” has been rescheduled. Please open Super Leader to see the new date and time.`,
        actionUrl: "/dashboard/performance?view=meetings",
        priority: "warning",
        requiresAction: false,
        emailRequested: false,
        metadata: {meeting_id: meeting.id, starts_at: startIso},
      })));
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "meeting",
    entityId: meeting.id,
    action: "updated",
    details: {
      previous: {title: meeting.title, meeting_type: meeting.meeting_type, mandatory: meeting.mandatory, starts_at: meeting.starts_at, ends_at: meeting.ends_at, notes: meeting.notes},
      next: {title, meeting_type: meetingType, mandatory, starts_at: startIso, ends_at: endIso, notes},
      zoom_synced: zoomSynced,
      source_type: meeting.source_type,
    },
  });
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/events");
  go(zoomSynced ? "Réunion et calendrier Zoom mis à jour." : "Réunion mise à jour.", "success", "meetings");
}

export async function markMeetingAttendanceAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "meetings");
  const attendanceId = String(formData.get("attendanceId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const lateMinutes = Math.max(0, parseInteger(formData.get("lateMinutes"), 0));
  const notes = cleanText(formData.get("notes"), 1000) || null;
  if (!attendanceId || !meetingAttendanceStatuses.has(status)) go(t("performance.messages.invalidMeetingAttendance"), "error", "meetings");
  const {data: attendee} = await admin.from("performance_meeting_attendance").select("id, user_id").eq("id", attendanceId).eq("organization_id", membership.organization_id).maybeSingle<{id: string; user_id: string}>();
  if (!attendee) go(t("performance.messages.meetingAttendanceNotFound"), "error", "meetings");
  if (!(await canSuperviseEmployee(membership, user.id, attendee.user_id, admin))) go(t("performance.messages.notAssignedSupervisor"), "error", "meetings");
  const {error} = await admin.from("performance_meeting_attendance").update({
    status,
    late_minutes: status === "late" ? lateMinutes : 0,
    notes,
    marked_by: user.id,
    marked_at: new Date().toISOString(),
  }).eq("id", attendanceId).eq("organization_id", membership.organization_id);
  if (error) go(t("performance.messages.meetingAttendanceFailed", {message: error.message}), "error", "meetings");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: attendee.user_id,
    entityType: "meeting_attendance",
    entityId: attendanceId,
    action: status,
    details: {late_minutes: lateMinutes, notes},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.meetingAttendanceSaved"), "success", "meetings");
}

export async function upsertMonthlyKpiScoreAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "ranking");
  const userId = String(formData.get("userId") ?? "").trim();
  const month = normalizeMonth(formData.get("month"));
  const score = parseNumber(formData.get("score"));
  const notes = cleanText(formData.get("notes"), 1500) || null;
  if (!userId || !month || !Number.isFinite(score) || score < 0 || score > 30) go(t("performance.messages.invalidKpi"), "error", "ranking");
  if (!(await ensureMember(membership.organization_id, userId, admin))) go(t("performance.messages.memberNotFound"), "error", "ranking");
  if (!(await canSuperviseEmployee(membership, user.id, userId, admin))) go(t("performance.messages.notAssignedSupervisor"), "error", "ranking");
  const {error} = await admin.from("monthly_kpi_scores").upsert({
    organization_id: membership.organization_id,
    user_id: userId,
    score_month: `${month}-01`,
    score,
    notes,
    assessed_by: user.id,
    assessed_at: new Date().toISOString(),
  }, {onConflict: "organization_id,user_id,score_month"});
  if (error) go(t("performance.messages.kpiSaveFailed", {message: error.message}), "error", "ranking");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: userId,
    entityType: "monthly_kpi",
    action: "upserted",
    details: {month, score, notes},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.kpiSaved"), "success", "ranking");
}

export async function calculateMonthlyPerformanceAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  if (!hrRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "ranking");
  const month = normalizeMonth(formData.get("month"));
  if (!month) go(t("performance.messages.invalidMonth"), "error", "ranking");
  const scoreMonth = `${month}-01`;
  const bounds = monthBounds(month);
  const {data: lockedScores} = await admin.from("employee_month_scores").select("id").eq("organization_id", membership.organization_id).eq("score_month", scoreMonth).not("locked_at", "is", null).limit(1);
  if (lockedScores?.length) go(t("performance.messages.monthLocked"), "error", "ranking");

  const [settingsResult, membersResult, schedulesResult, detailedSchedulesResult, attendanceResult, leavesResult, reportsResult, meetingsResult, meetingAttendanceResult, feedbackResult, recognitionsResult, academyCoursesResult, academyEnrollmentsResult, kpiResult, growthSettingsResult, growthPlansResult, growthContributionsResult, developmentActivitiesResult] = await Promise.all([
    admin.from("performance_settings").select("*").eq("organization_id", membership.organization_id).maybeSingle<PerformanceSettings>(),
    admin.from("organization_members").select("user_id").eq("organization_id", membership.organization_id).eq("is_active", true).in("user_id", visibleUserIds),
    admin.from("member_work_schedules").select("*").eq("organization_id", membership.organization_id).eq("is_active", true).in("user_id", visibleUserIds),
    admin.from("work_schedule_entries").select("user_id, work_date, status, work_mode, report_required").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds).gte("work_date", bounds.start).lte("work_date", bounds.end),
    admin.from("attendance_records").select("user_id, work_date, status, late_minutes").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds).gte("work_date", bounds.start).lte("work_date", bounds.end),
    admin.from("leave_requests").select("user_id, start_date, end_date, status").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds).eq("status", "approved").lte("start_date", bounds.end).gte("end_date", bounds.start),
    admin.from("daily_reports").select("user_id, report_date, status, submission_mode, submission_score_factor").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds).gte("report_date", bounds.start).lte("report_date", bounds.end),
    admin.from("performance_meetings").select("id, mandatory, starts_at").eq("organization_id", membership.organization_id).gte("starts_at", `${bounds.start}T00:00:00Z`).lte("starts_at", `${bounds.end}T23:59:59Z`),
    admin.from("performance_meeting_attendance").select("meeting_id, user_id, status").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds),
    admin.from("peer_feedback").select("recipient_id, score, created_at").eq("organization_id", membership.organization_id).eq("status", "published").gte("created_at", `${bounds.start}T00:00:00Z`).lte("created_at", `${bounds.end}T23:59:59Z`),
    admin.from("recognitions").select("recipient_id, created_at").eq("organization_id", membership.organization_id).gte("created_at", `${bounds.start}T00:00:00Z`).lte("created_at", `${bounds.end}T23:59:59Z`),
    admin.from("academy_courses").select("id, training_month, is_required").eq("organization_id", membership.organization_id).eq("training_month", scoreMonth),
    admin.from("academy_enrollments").select("course_id, user_id, status").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds),
    admin.from("monthly_kpi_scores").select("user_id, score").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds).eq("score_month", scoreMonth),
    admin.from("growth_settings").select("target_credits,bonus_weight,max_monthly_credits,max_development_credits").eq("organization_id", membership.organization_id).maybeSingle(),
    admin.from("growth_plans").select("user_id,target_credits").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds).eq("plan_month", scoreMonth),
    admin.from("impact_contributions").select("user_id,growth_credits").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds).gte("contribution_date", bounds.start).lte("contribution_date", bounds.end).in("status", ["approved", "partially_approved"]),
    admin.from("development_activities").select("user_id,growth_credits").eq("organization_id", membership.organization_id).in("user_id", visibleUserIds).gte("activity_date", bounds.start).lte("activity_date", bounds.end).in("status", ["approved", "partially_approved", "auto_validated"]),
  ]);

  const detailedScheduleError = detailedSchedulesResult.error && !["42P01", "PGRST205"].includes(detailedSchedulesResult.error.code) ? detailedSchedulesResult.error : null;
  const growthModuleError = growthSettingsResult.error && !["42P01", "42703", "PGRST204", "PGRST205"].includes(growthSettingsResult.error.code) ? growthSettingsResult.error : null;
  const growthPlansError = growthPlansResult.error && !["42P01", "PGRST205"].includes(growthPlansResult.error.code) ? growthPlansResult.error : null;
  const growthContributionsError = growthContributionsResult.error && !["42P01", "PGRST205"].includes(growthContributionsResult.error.code) ? growthContributionsResult.error : null;
  const developmentActivitiesError = developmentActivitiesResult.error && !["42P01", "42703", "PGRST204", "PGRST205"].includes(developmentActivitiesResult.error.code) ? developmentActivitiesResult.error : null;
  const anyError = [settingsResult.error, membersResult.error, schedulesResult.error, detailedScheduleError, attendanceResult.error, leavesResult.error, reportsResult.error, meetingsResult.error, meetingAttendanceResult.error, feedbackResult.error, recognitionsResult.error, academyCoursesResult.error, academyEnrollmentsResult.error, kpiResult.error, growthModuleError, growthPlansError, growthContributionsError, developmentActivitiesError].find(Boolean);
  if (anyError || !settingsResult.data) go(t("performance.messages.calculationFailed", {message: anyError?.message || t("performance.messages.settingsMissing")}), "error", "ranking");

  const settings = settingsResult.data;
  const members = (membersResult.data ?? []) as {user_id: string}[];
  const schedules = (schedulesResult.data ?? []) as MemberSchedule[];
  const detailedSchedules = (detailedSchedulesResult.data ?? []) as WorkScheduleEntry[];
  const attendance = (attendanceResult.data ?? []) as AttendanceRecord[];
  const leaves = (leavesResult.data ?? []) as LeaveRequest[];
  const reports = (reportsResult.data ?? []) as DailyReportRecord[];
  const meetings = (meetingsResult.data ?? []) as MeetingRecord[];
  const meetingAttendance = (meetingAttendanceResult.data ?? []) as MeetingAttendanceRecord[];
  const feedback = (feedbackResult.data ?? []) as FeedbackRecord[];
  const recognitions = (recognitionsResult.data ?? []) as {recipient_id: string; created_at: string}[];
  const academyCourseRows = (academyCoursesResult.data ?? []) as {id: string; training_month: string; is_required: boolean}[];
  const academyCourseById = new Map(academyCourseRows.map((row) => [row.id, row]));
  const trainings = ((academyEnrollmentsResult.data ?? []) as {course_id: string; user_id: string; status: string}[])
    .map((row) => {
      const course = academyCourseById.get(row.course_id);
      return course ? {user_id: row.user_id, course_id: row.course_id, status: row.status, training_month: course.training_month, is_required: course.is_required} : null;
    })
    .filter((row): row is TrainingRecord => Boolean(row));
  const kpiRows = (kpiResult.data ?? []) as KpiScoreRecord[];
  const growthSettings = (growthSettingsResult.data ?? {target_credits: 10, bonus_weight: 10, max_monthly_credits: 20, max_development_credits: 20}) as {target_credits: number | string; bonus_weight: number | string; max_monthly_credits: number | string; max_development_credits: number | string};
  const growthPlanRows = (growthPlansResult.data ?? []) as {user_id: string; target_credits: number | string}[];
  const impactCreditsByUser = new Map<string, number>();
  const developmentCreditsByUser = new Map<string, number>();
  for (const row of (growthContributionsResult.data ?? []) as {user_id: string; growth_credits: number | string}[]) {
    impactCreditsByUser.set(row.user_id, (impactCreditsByUser.get(row.user_id) ?? 0) + Number(row.growth_credits ?? 0));
  }
  for (const row of (developmentActivitiesResult.data ?? []) as {user_id: string; growth_credits: number | string}[]) {
    developmentCreditsByUser.set(row.user_id, (developmentCreditsByUser.get(row.user_id) ?? 0) + Number(row.growth_credits ?? 0));
  }
  const today = zonedParts(new Date(), settings.timezone).date;

  const calculated = members.map((member) => ({
    userId: member.user_id,
    result: calculatePerformanceScore({
      userId: member.user_id,
      month,
      today,
      settings,
      schedule: schedules.find((row) => row.user_id === member.user_id) ?? null,
      scheduleEntries: detailedSchedules,
      attendance,
      leaves,
      reports,
      meetings,
      meetingAttendance,
      feedback,
      recognitions,
      trainings,
      kpi: kpiRows.find((row) => row.user_id === member.user_id) ?? null,
      growth: {
        approvedCredits: (impactCreditsByUser.get(member.user_id) ?? 0) + Math.min(developmentCreditsByUser.get(member.user_id) ?? 0, Number(growthSettings.max_development_credits ?? 20)),
        targetCredits: Number(growthPlanRows.find((row) => row.user_id === member.user_id)?.target_credits ?? growthSettings.target_credits),
        bonusWeight: Number(growthSettings.bonus_weight),
        maxMonthlyCredits: Number(growthSettings.max_monthly_credits),
      },
    }),
  }));
  const eligibleRanking = calculated.filter((item) => item.result.eligible).sort((a, b) => b.result.totalScore - a.result.totalScore);
  const positionByUser = new Map(eligibleRanking.map((item, index) => [item.userId, index + 1]));

  const rows = calculated.map(({userId, result}) => ({
    organization_id: membership.organization_id,
    user_id: userId,
    score_month: scoreMonth,
    attendance_score: result.attendanceScore,
    punctuality_score: result.punctualityScore,
    meetings_score: result.meetingsScore,
    reports_score: result.reportsScore,
    collaboration_score: result.collaborationScore,
    training_score: result.trainingScore,
    role_kpi_score: result.roleKpiScore,
    growth_score: result.growthScore,
    growth_credits: result.growthCredits,
    total_score: result.totalScore,
    scheduled_days: result.scheduledDays,
    attended_days: result.attendedDays,
    late_days: result.lateDays,
    unexcused_absences: result.unexcusedAbsences,
    reports_expected: result.reportsExpected,
    reports_submitted: result.reportsSubmitted,
    mandatory_meetings: result.mandatoryMeetings,
    meetings_attended: result.meetingsAttended,
    trainings_required: result.trainingsRequired,
    trainings_completed: result.trainingsCompleted,
    eligible: result.eligible,
    eligibility_note: result.eligibilityNote || null,
    position: positionByUser.get(userId) ?? null,
    calculated_by: user.id,
    calculated_at: new Date().toISOString(),
    locked_at: null,
  }));
  const {error: upsertError} = await admin.from("employee_month_scores").upsert(rows, {onConflict: "organization_id,user_id,score_month"});
  if (upsertError) go(t("performance.messages.calculationFailed", {message: upsertError.message}), "error", "ranking");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "monthly_scores",
    action: "calculated",
    details: {month, members: rows.length, eligible: eligibleRanking.length},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.scoresCalculated", {count: rows.length}), "success", "ranking");
}

export async function publishEmployeeOfMonthAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!hrRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "ranking");
  const month = normalizeMonth(formData.get("month"));
  const announcementNote = cleanText(formData.get("announcementNote"), 1500) || null;
  if (!month) go(t("performance.messages.invalidMonth"), "error", "ranking");
  const scoreMonth = `${month}-01`;
  const {data: winner, error: winnerError} = await admin
    .from("employee_month_scores")
    .select("user_id, total_score, locked_at")
    .eq("organization_id", membership.organization_id)
    .eq("score_month", scoreMonth)
    .eq("eligible", true)
    .order("total_score", {ascending: false})
    .order("calculated_at", {ascending: true})
    .limit(1)
    .maybeSingle<{user_id: string; total_score: number | string; locked_at: string | null}>();
  if (winnerError || !winner) go(t("performance.messages.noEligibleWinner"), "error", "ranking");

  const now = new Date().toISOString();
  const {error: awardError} = await admin.from("employee_month_awards").upsert({
    organization_id: membership.organization_id,
    award_month: scoreMonth,
    winner_id: winner.user_id,
    final_score: Number(winner.total_score),
    announcement_note: announcementNote,
    published_by: user.id,
    published_at: now,
  }, {onConflict: "organization_id,award_month"});
  if (awardError) go(t("performance.messages.publishFailed", {message: awardError.message}), "error", "ranking");
  const {error: lockError} = await admin.from("employee_month_scores").update({locked_at: now}).eq("organization_id", membership.organization_id).eq("score_month", scoreMonth);
  if (lockError) go(t("performance.messages.lockFailed", {message: lockError.message}), "error", "ranking");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: winner.user_id,
    entityType: "employee_month_award",
    action: "published",
    details: {month, final_score: Number(winner.total_score), announcement_note: announcementNote},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.winnerPublished"), "success", "ranking");
}

export async function submitPerformanceAppealAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const month = normalizeMonth(formData.get("month"));
  const reason = cleanText(formData.get("reason"), 2000);
  if (!month || reason.length < 10) go(t("performance.messages.invalidAppeal"), "error", "ranking");
  const scoreMonth = `${month}-01`;
  const {data: score} = await admin
    .from("employee_month_scores")
    .select("id, locked_at")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("score_month", scoreMonth)
    .maybeSingle<{id: string; locked_at: string | null}>();
  if (!score) go(t("performance.messages.scoreNotFound"), "error", "ranking");
  if (score.locked_at) go(t("performance.messages.monthLocked"), "error", "ranking");
  const {data, error} = await admin.from("performance_score_appeals").upsert({
    organization_id: membership.organization_id,
    user_id: user.id,
    score_month: scoreMonth,
    reason,
    status: "pending",
    resolution_note: null,
    reviewed_by: null,
    reviewed_at: null,
  }, {onConflict: "organization_id,user_id,score_month"}).select("id").single<{id: string}>();
  if (error || !data) go(t("performance.messages.appealSaveFailed", {message: error?.message || "Appeal identifier missing."}), "error", "ranking");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: user.id,
    entityType: "performance_appeal",
    entityId: data.id,
    action: "submitted",
    details: {month, reason},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.appealSubmitted"), "success", "ranking");
}

export async function reviewPerformanceAppealAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!hrRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "ranking");
  const appealId = String(formData.get("appealId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const resolutionNote = cleanText(formData.get("resolutionNote"), 2000);
  if (!appealId || !["accepted", "rejected"].includes(status) || resolutionNote.length < 3) {
    go(t("performance.messages.invalidAppealReview"), "error", "ranking");
  }
  const {data: appeal} = await admin
    .from("performance_score_appeals")
    .select("id, user_id, score_month")
    .eq("id", appealId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; user_id: string; score_month: string}>();
  if (!appeal) go(t("performance.messages.appealNotFound"), "error", "ranking");
  const {data: score} = await admin
    .from("employee_month_scores")
    .select("locked_at")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", appeal.user_id)
    .eq("score_month", appeal.score_month)
    .maybeSingle<{locked_at: string | null}>();
  if (score?.locked_at) go(t("performance.messages.monthLocked"), "error", "ranking");
  const {error} = await admin.from("performance_score_appeals").update({
    status,
    resolution_note: resolutionNote,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", appealId).eq("organization_id", membership.organization_id);
  if (error) go(t("performance.messages.appealReviewFailed", {message: error.message}), "error", "ranking");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: appeal.user_id,
    entityType: "performance_appeal",
    entityId: appealId,
    action: status,
    details: {resolution_note: resolutionNote},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.appealReviewed"), "success", "ranking");
}

export async function openAbsenceContactAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  if (!leaderRoles.has(membership.role)) goOperational("/dashboard/my-day", t("performance.messages.permissionDenied"), "error");

  const subjectUserId = String(formData.get("subjectUserId") ?? "").trim();
  const workDate = normalizeDate(formData.get("workDate"));
  const returnTo = safeOperationalReturn(formData.get("returnTo"));
  if (!subjectUserId || !workDate || !visibleUserIds.includes(subjectUserId) || subjectUserId === user.id) {
    goOperational(returnTo, t("performance.messages.absenceContactOutOfScope"), "error");
  }

  const {data: attendance} = await admin
    .from("attendance_records")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", subjectUserId)
    .eq("work_date", workDate)
    .maybeSingle<{id: string}>();

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId,
    entityType: "attendance_contact",
    entityId: attendance?.id ?? null,
    action: "details_viewed",
    details: {work_date: workDate},
  });

  redirect(operationalUrl(returnTo, {contact: subjectUserId, contactDate: workDate, success: null, error: null}));
}

export async function sendAttendanceContactRequestAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = safeOperationalReturn(formData.get("returnTo"));
  if (!leaderRoles.has(membership.role)) goOperational(returnTo, t("performance.messages.permissionDenied"), "error");

  const subjectUserId = String(formData.get("subjectUserId") ?? "").trim();
  const workDate = normalizeDate(formData.get("workDate"));
  if (!subjectUserId || !workDate || !visibleUserIds.includes(subjectUserId) || subjectUserId === user.id) {
    goOperational(returnTo, t("performance.messages.absenceContactOutOfScope"), "error");
  }

  const [{data: subjectProfile}, {data: actorProfile}, {data: attendance}] = await Promise.all([
    admin.from("profiles").select("full_name,email").eq("id", subjectUserId).maybeSingle<{full_name: string | null; email: string | null}>(),
    admin.from("profiles").select("full_name,email").eq("id", user.id).maybeSingle<{full_name: string | null; email: string | null}>(),
    admin
      .from("attendance_records")
      .select("id,status,late_minutes")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", subjectUserId)
      .eq("work_date", workDate)
      .maybeSingle<{id: string; status: string; late_minutes: number}>(),
  ]);

  const subjectName = subjectProfile?.full_name?.trim() || subjectProfile?.email || "Collaborateur";
  const actorName = actorProfile?.full_name?.trim() || actorProfile?.email || "Votre manager";
  const isLate = attendance?.status === "late" || Number(attendance?.late_minutes ?? 0) > 0;
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));

  const notificationId = await createNotification({
    organizationId: membership.organization_id,
    userId: subjectUserId,
    actorId: user.id,
    category: "absences",
    eventType: isLate ? "late_contact_requested" : "absence_contact_requested",
    titleFr: isLate ? "Votre manager vous demande de le contacter" : "Présence à régulariser",
    titleEn: isLate ? "Your manager asked you to make contact" : "Attendance requires attention",
    bodyFr: isLate
      ? `${actorName} vous demande de pointer si nécessaire ou de le contacter immédiatement au sujet de votre retard du ${workDate}.`
      : `${actorName} vous demande de commencer votre journée si vous travaillez aujourd’hui, ou de le contacter immédiatement pour expliquer votre absence du ${workDate}.`,
    bodyEn: isLate
      ? `${actorName} asks you to clock in if needed or contact them immediately regarding your late arrival on ${workDate}.`
      : `${actorName} asks you to start your workday if you are working today, or contact them immediately regarding your absence on ${workDate}.`,
    actionUrl: "/dashboard/my-day",
    priority: "urgent",
    requiresAction: true,
    dedupeKey: `attendance-contact-request:${subjectUserId}:${workDate}:${bucket}`,
    metadata: {
      subject_user_id: subjectUserId,
      subject_name: subjectName,
      work_date: workDate,
      attendance_id: attendance?.id ?? null,
      attendance_status: attendance?.status ?? "absent",
      late_minutes: Number(attendance?.late_minutes ?? 0),
      manager_user_id: user.id,
    },
  });

  if (notificationId) {
    const {error: historyError} = await admin.from("absence_contact_followups").insert({
      organization_id: membership.organization_id,
      subject_user_id: subjectUserId,
      attendance_id: attendance?.id ?? null,
      work_date: workDate,
      contact_channel: "notification",
      outcome: "notification_sent",
      note: isLate
        ? "Notification urgente envoyée pour demander au collaborateur de contacter son manager au sujet de son retard."
        : "Notification urgente envoyée pour demander au collaborateur de commencer sa journée ou de contacter son manager.",
      next_follow_up_at: null,
      created_by: user.id,
    });
    if (historyError && !["42P01", "PGRST205", "42703"].includes(historyError.code)) {
      console.error("Attendance contact notification history failed", historyError);
    }
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId,
    entityType: "attendance_contact_notification",
    entityId: notificationId,
    action: "notification_sent",
    details: {
      work_date: workDate,
      attendance_status: attendance?.status ?? "absent",
      late_minutes: Number(attendance?.late_minutes ?? 0),
    },
  });

  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/notifications");
  goOperational(
    operationalUrl(returnTo, {contact: subjectUserId, contactDate: workDate}),
    t("performance.messages.attendanceContactNotificationSent"),
  );
}

export async function recordAbsenceContactAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = safeOperationalReturn(formData.get("returnTo"));
  if (!leaderRoles.has(membership.role)) goOperational(returnTo, t("performance.messages.permissionDenied"), "error");

  const subjectUserId = String(formData.get("subjectUserId") ?? "").trim();
  const workDate = normalizeDate(formData.get("workDate"));
  const contactChannel = String(formData.get("contactChannel") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  const note = cleanText(formData.get("note"), 3000);
  const nextFollowUpRaw = String(formData.get("nextFollowUpAt") ?? "").trim();
  const followUpTimezone = normalizeTimeZone(cleanText(formData.get("timezone"), 80));
  const nextFollowUpAt = nextFollowUpRaw ? zonedLocalToUtc(nextFollowUpRaw, followUpTimezone) : null;
  const channels = new Set(["phone", "whatsapp", "email", "notification", "other"]);
  const outcomes = new Set([
    "contacted_on_the_way",
    "contacted_sick",
    "contacted_technical_issue",
    "contacted_other",
    "no_answer",
    "justified",
    "escalated_hr",
  ]);

  if (
    !subjectUserId ||
    !workDate ||
    !channels.has(contactChannel) ||
    !outcomes.has(outcome) ||
    !visibleUserIds.includes(subjectUserId) ||
    subjectUserId === user.id ||
    (nextFollowUpAt && Number.isNaN(nextFollowUpAt.getTime()))
  ) {
    goOperational(
      operationalUrl(returnTo, {contact: subjectUserId || null, contactDate: workDate || null}),
      t("performance.messages.invalidAbsenceContact"),
      "error",
    );
  }

  const {data: attendance} = await admin
    .from("attendance_records")
    .select("id,status,justification")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", subjectUserId)
    .eq("work_date", workDate)
    .maybeSingle<{id: string; status: string; justification: string | null}>();

  const {data: followup, error} = await admin
    .from("absence_contact_followups")
    .insert({
      organization_id: membership.organization_id,
      subject_user_id: subjectUserId,
      attendance_id: attendance?.id ?? null,
      work_date: workDate,
      contact_channel: contactChannel,
      outcome,
      note,
      next_follow_up_at: nextFollowUpAt ? nextFollowUpAt.toISOString() : null,
      created_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !followup) {
    const setupMissing = Boolean(error && ["42P01", "PGRST205", "42703"].includes(error.code));
    goOperational(
      operationalUrl(returnTo, {contact: subjectUserId, contactDate: workDate}),
      setupMissing
        ? t("performance.messages.absenceContactMigrationRequired")
        : t("performance.messages.absenceContactSaveFailed", {message: error?.message || "unknown_error"}),
      "error",
    );
  }

  if (outcome === "justified") {
    const justification = note || attendance?.justification || "Absence ou retard justifié lors du suivi.";
    if (attendance?.id && ["absent", "late"].includes(attendance.status)) {
      await admin
        .from("attendance_records")
        .update({
          status: "excused",
          justification,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", attendance.id)
        .eq("organization_id", membership.organization_id);
    } else if (!attendance?.id) {
      await admin
        .from("attendance_records")
        .insert({
          organization_id: membership.organization_id,
          user_id: subjectUserId,
          work_date: workDate,
          status: "excused",
          late_minutes: 0,
          justification,
          source: "manual",
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        });
    }
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId,
    entityType: "absence_contact_followup",
    entityId: followup.id,
    action: outcome,
    details: {
      work_date: workDate,
      contact_channel: contactChannel,
      note,
      next_follow_up_at: nextFollowUpAt?.toISOString() ?? null,
    },
  });

  if (outcome === "escalated_hr") {
    const [{data: hrMembers}, {data: subjectProfile}] = await Promise.all([
      admin
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true)
        .in("role", ["owner", "admin", "hr"]),
      admin.from("profiles").select("full_name,email").eq("id", subjectUserId).maybeSingle<{full_name: string | null; email: string | null}>(),
    ]);
    const subjectName = subjectProfile?.full_name?.trim() || subjectProfile?.email || "Collaborateur";
    const hrRecipients = (hrMembers ?? []) as Array<{user_id: string}>;
    await Promise.all(hrRecipients.filter((member) => member.user_id !== user.id).map((member) => createNotification({
      organizationId: membership.organization_id,
      userId: member.user_id,
      actorId: user.id,
      category: "absences",
      eventType: "absence_escalated_hr",
      titleFr: "Absence ou retard escaladé aux RH",
      titleEn: "Attendance issue escalated to HR",
      bodyFr: `${subjectName} nécessite une intervention RH pour la journée du ${workDate}.`,
      bodyEn: `${subjectName} requires HR intervention for ${workDate}.`,
      actionUrl: operationalUrl("/dashboard/my-day", {contact: subjectUserId, contactDate: workDate}),
      priority: "urgent",
      requiresAction: true,
      dedupeKey: `absence-escalated:${followup.id}:${member.user_id}`,
      metadata: {subject_user_id: subjectUserId, work_date: workDate, followup_id: followup.id},
    })));
  }

  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/performance");
  goOperational(
    operationalUrl(returnTo, {contact: subjectUserId, contactDate: workDate}),
    t("performance.messages.absenceContactSaved"),
  );
}

export async function updateEmployeeWorkContactAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = safeOperationalReturn(formData.get("returnTo"));
  if (!hrRoles.has(membership.role)) goOperational(returnTo, t("performance.messages.permissionDenied"), "error");

  const subjectUserId = String(formData.get("subjectUserId") ?? "").trim();
  const workDate = normalizeDate(formData.get("workDate"));
  const workPhone = cleanText(formData.get("workPhone"), 80);
  const workWhatsapp = cleanText(formData.get("workWhatsapp"), 80);
  const positionTitle = cleanText(formData.get("positionTitle"), 160);
  if (!subjectUserId || !visibleUserIds.includes(subjectUserId)) {
    goOperational(returnTo, t("performance.messages.absenceContactOutOfScope"), "error");
  }

  const {error} = await admin
    .from("employee_work_contacts")
    .upsert({
      organization_id: membership.organization_id,
      user_id: subjectUserId,
      work_phone: workPhone || null,
      work_whatsapp: workWhatsapp || null,
      position_title: positionTitle || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, {onConflict: "organization_id,user_id"});

  if (error) {
    const setupMissing = ["42P01", "PGRST205", "42703"].includes(error.code);
    goOperational(
      operationalUrl(returnTo, {contact: subjectUserId, contactDate: workDate || null}),
      setupMissing
        ? t("performance.messages.absenceContactMigrationRequired")
        : t("performance.messages.workContactSaveFailed", {message: error.message}),
      "error",
    );
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId,
    entityType: "employee_work_contact",
    entityId: null,
    action: "professional_contact_updated",
    details: {
      work_phone_present: Boolean(workPhone),
      work_whatsapp_present: Boolean(workWhatsapp),
      position_title: positionTitle || null,
    },
  });

  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/performance");
  goOperational(
    operationalUrl(returnTo, {contact: subjectUserId, contactDate: workDate || null}),
    t("performance.messages.workContactSaved"),
  );
}
