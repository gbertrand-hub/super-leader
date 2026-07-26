"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
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
} from "@/lib/performance/scoring";
import {
  finalizeTemporaryAttachment,
  readPendingAttachment,
  removePrivateAttachment,
} from "@/lib/storage/private-attachments";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const leaderRoles = new Set(["owner", "admin", "hr", "manager"]);
const hrRoles = new Set(["owner", "admin", "hr"]);
const attendanceStatuses = new Set(["present", "late", "absent", "excused", "remote"]);
const leaveTypes = new Set(["annual", "sick", "family", "training", "unpaid", "other"]);
const leaveReviewStatuses = new Set(["approved", "rejected"]);
const reportReviewStatuses = new Set(["validated", "needs_revision", "incomplete"]);
const meetingTypes = new Set(["team", "training", "client", "company", "other"]);
const meetingAttendanceStatuses = new Set(["present", "late", "absent", "excused"]);

type Membership = {
  organization_id: string;
  role: string;
  is_active: boolean;
};

type ScheduleRow = MemberSchedule & {id: string};

type ReopeningRow = {
  id: string;
  user_id: string;
  report_date: string;
  score_factor: number | string;
  status: string;
  expires_at: string;
};

function go(message: string, kind: "success" | "error" = "success", view = "overview"): never {
  redirect(`/dashboard/performance?view=${encodeURIComponent(view)}&${kind}=${encodeURIComponent(message)}`);
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

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
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

async function getContext() {
  const {t} = await getI18n();
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

  return {user: authData.user, membership, admin, t};
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

async function canSuperviseEmployee(
  membership: Membership,
  actorId: string,
  employeeId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  if (actorId === employeeId) return false;
  if (hrRoles.has(membership.role)) return true;
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
) {
  const timezone = schedule?.timezone || settings.timezone;
  const local = zonedParts(now, timezone);
  const deadline = (schedule?.report_deadline_time || settings.report_deadline_time).slice(0, 5);
  const isFuture = reportDate > local.date;
  const isNormallyOpen = reportDate === local.date && timeToMinutes(local.time) <= timeToMinutes(deadline);
  return {local, deadline, isFuture, isNormallyOpen, isClosed: !isFuture && !isNormallyOpen};
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

export async function clockInAction() {
  const {user, membership, admin, t} = await getContext();
  let settings: PerformanceSettings;
  let schedule: ScheduleRow | null;
  try {
    ({settings, schedule} = await loadSettingsAndSchedule(membership.organization_id, user.id, admin));
  } catch {
    go(t("performance.messages.databaseSetupRequired"), "error");
  }

  const timezone = schedule?.timezone || settings.timezone;
  const now = new Date();
  const local = zonedParts(now, timezone);
  const scheduledStart = (schedule?.start_time || settings.default_start_time).slice(0, 5);
  const scheduledEnd = (schedule?.end_time || settings.default_end_time).slice(0, 5);
  const graceMinutes = schedule?.grace_minutes ?? settings.grace_minutes;
  const lateMinutes = Math.max(0, timeToMinutes(local.time) - timeToMinutes(scheduledStart) - graceMinutes);

  const {data: existing} = await admin
    .from("attendance_records")
    .select("id, clock_in_at")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("work_date", local.date)
    .maybeSingle<{id: string; clock_in_at: string | null}>();
  if (existing?.clock_in_at) go(t("performance.messages.alreadyClockedIn"), "error", "attendance");

  const payload = {
    organization_id: membership.organization_id,
    user_id: user.id,
    work_date: local.date,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    clock_in_at: now.toISOString(),
    status: lateMinutes > 0 ? "late" : "present",
    late_minutes: lateMinutes,
    source: "web",
  };

  const result = existing
    ? await admin.from("attendance_records").update(payload).eq("id", existing.id).select("id").single<{id: string}>()
    : await admin.from("attendance_records").insert(payload).select("id").single<{id: string}>();
  if (result.error) go(t("performance.messages.clockInFailed", {message: result.error.message}), "error", "attendance");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: user.id,
    entityType: "attendance",
    entityId: result.data.id,
    action: "clock_in",
    details: {work_date: local.date, late_minutes: lateMinutes},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.clockedIn"), "success", "attendance");
}

export async function clockOutAction() {
  const {user, membership, admin, t} = await getContext();
  let settings: PerformanceSettings;
  let schedule: ScheduleRow | null;
  try {
    ({settings, schedule} = await loadSettingsAndSchedule(membership.organization_id, user.id, admin));
  } catch {
    go(t("performance.messages.databaseSetupRequired"), "error");
  }
  const now = new Date();
  const local = zonedParts(now, schedule?.timezone || settings.timezone);
  const {data: record, error: recordError} = await admin
    .from("attendance_records")
    .select("id, clock_in_at, clock_out_at")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("work_date", local.date)
    .maybeSingle<{id: string; clock_in_at: string | null; clock_out_at: string | null}>();
  if (recordError || !record?.clock_in_at) go(t("performance.messages.clockInFirst"), "error", "attendance");
  if (record.clock_out_at) go(t("performance.messages.alreadyClockedOut"), "error", "attendance");

  const {error} = await admin.from("attendance_records").update({clock_out_at: now.toISOString()}).eq("id", record.id);
  if (error) go(t("performance.messages.clockOutFailed", {message: error.message}), "error", "attendance");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: user.id,
    entityType: "attendance",
    entityId: record.id,
    action: "clock_out",
    details: {work_date: local.date},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.clockedOut"), "success", "attendance");
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
  if (error) go(t("performance.messages.attendanceSaveFailed", {message: error.message}), "error", "attendance");
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
  const {data, error} = await admin.from("leave_requests").insert({
    organization_id: membership.organization_id,
    user_id: user.id,
    leave_type: leaveType,
    start_date: startDate,
    end_date: endDate,
    reason,
    document_url: documentUrl,
  }).select("id").single<{id: string}>();
  if (error) go(t("performance.messages.leaveCreateFailed", {message: error.message}), "error", "absences");

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
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.leaveSubmitted"), "success", "absences");
}

export async function reviewLeaveRequestAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "absences");
  const requestId = String(formData.get("requestId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const reviewNote = cleanText(formData.get("reviewNote"), 1200) || null;
  if (!requestId || !leaveReviewStatuses.has(status)) go(t("performance.messages.invalidLeaveReview"), "error", "absences");
  const {data: request} = await admin.from("leave_requests").select("id, user_id").eq("id", requestId).eq("organization_id", membership.organization_id).maybeSingle<{id: string; user_id: string}>();
  if (!request) go(t("performance.messages.leaveNotFound"), "error", "absences");
  const {error} = await admin.from("leave_requests").update({
    status,
    review_note: reviewNote,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", requestId).eq("organization_id", membership.organization_id);
  if (error) go(t("performance.messages.leaveReviewFailed", {message: error.message}), "error", "absences");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: request.user_id,
    entityType: "leave_request",
    entityId: requestId,
    action: status,
    details: {review_note: reviewNote},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.leaveReviewed"), "success", "absences");
}

export async function submitDailyReportAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const reportDate = normalizeDate(formData.get("reportDate"));
  const accomplishments = cleanText(formData.get("accomplishments"), 3000);
  const results = cleanText(formData.get("results"), 3000);
  const blockers = cleanText(formData.get("blockers"), 3000) || t("performance.noBlockers");
  const nextPriorities = cleanText(formData.get("nextPriorities"), 3000);
  if (!reportDate || accomplishments.length < 3 || results.length < 3 || nextPriorities.length < 3) {
    go(t("performance.messages.invalidReport"), "error", "reports");
  }

  let settings: PerformanceSettings;
  let schedule: ScheduleRow | null;
  try {
    ({settings, schedule} = await loadSettingsAndSchedule(membership.organization_id, user.id, admin));
  } catch {
    go(t("performance.messages.databaseSetupRequired"), "error", "reports");
  }

  const now = new Date();
  const window = reportWindowState(reportDate, now, settings, schedule);
  if (window.isFuture) go(t("performance.messages.futureReport"), "error", "reports");

  let reopening: ReopeningRow | null = null;
  if (settings.report_lock_enabled !== false && !window.isNormallyOpen) {
    await expireReopenings(membership.organization_id, user.id, reportDate, admin);
    const {data} = await admin
      .from("daily_report_reopenings")
      .select("id, user_id, report_date, score_factor, status, expires_at")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", user.id)
      .eq("report_date", reportDate)
      .eq("status", "active")
      .gt("expires_at", now.toISOString())
      .order("opened_at", {ascending: false})
      .limit(1)
      .maybeSingle<ReopeningRow>();
    reopening = data;
    if (!reopening) go(t("performance.messages.reportLocked"), "error", "reports");
  }

  const {data: existingReport} = await admin
    .from("daily_reports")
    .select("id, status, submission_mode")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("report_date", reportDate)
    .maybeSingle<{id: string; status: string; submission_mode: string}>();
  if (existingReport?.status === "validated" || existingReport?.submission_mode === "supervisor") {
    go(t("performance.messages.reportImmutable"), "error", "reports");
  }

  const submissionMode = reopening ? "reopened_employee" : "employee";
  const scoreFactor = reopening ? Math.min(1, Math.max(0, Number(reopening.score_factor))) : 1;
  const status = reopening ? "late" : "on_time";
  const {data, error} = await admin.from("daily_reports").upsert({
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
  }, {onConflict: "organization_id,user_id,report_date"}).select("id").single<{id: string}>();
  if (error) go(t("performance.messages.reportSaveFailed", {message: error.message}), "error", "reports");

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
    entityId: data.id,
    action: reopening ? "submitted_after_reopening" : "submitted",
    details: {
      report_date: reportDate,
      status,
      submission_mode: submissionMode,
      score_factor: scoreFactor,
      reopening_id: reopening?.id ?? null,
    },
  });
  revalidatePath("/dashboard/performance");
  go(reopening ? t("performance.messages.reopenedReportSubmitted") : t("performance.messages.reportSubmitted"), "success", "reports");
}

export async function reopenDailyReportAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "reports");
  const employeeId = String(formData.get("userId") ?? "").trim();
  const reportDate = normalizeDate(formData.get("reportDate"));
  const reason = cleanText(formData.get("reason"), 2000);
  const requestedHours = parseInteger(formData.get("durationHours"));
  const justified = formData.get("justified") === "on";
  if (!employeeId || !reportDate || reason.length < 10 || !Number.isInteger(requestedHours) || requestedHours < 1) {
    go(t("performance.messages.invalidReopening"), "error", "reports");
  }
  if (!(await ensureMember(membership.organization_id, employeeId, admin))) go(t("performance.messages.memberNotFound"), "error", "reports");
  if (!(await canSuperviseEmployee(membership, user.id, employeeId, admin))) go(t("performance.messages.notAssignedSupervisor"), "error", "reports");

  let settings: PerformanceSettings;
  let schedule: ScheduleRow | null;
  try {
    ({settings, schedule} = await loadSettingsAndSchedule(membership.organization_id, employeeId, admin));
  } catch {
    go(t("performance.messages.databaseSetupRequired"), "error", "reports");
  }
  const now = new Date();
  const window = reportWindowState(reportDate, now, settings, schedule);
  if (window.isFuture) go(t("performance.messages.futureReport"), "error", "reports");
  if (!window.isClosed) go(t("performance.messages.reportDayStillOpen"), "error", "reports");

  const {data: existingReport} = await admin
    .from("daily_reports")
    .select("id, status")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", employeeId)
    .eq("report_date", reportDate)
    .maybeSingle<{id: string; status: string}>();
  if (existingReport?.status === "validated") go(t("performance.messages.validatedReportCannotReopen"), "error", "reports");

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
  if (activeReopening) go(t("performance.messages.reopeningAlreadyActive"), "error", "reports");
  const {count} = await admin
    .from("daily_report_reopenings")
    .select("id", {head: true, count: "exact"})
    .eq("organization_id", membership.organization_id)
    .eq("user_id", employeeId)
    .eq("report_date", reportDate);
  const maximumReopenings = settings.maximum_reopenings_per_day ?? 1;
  if ((count ?? 0) >= maximumReopenings) go(t("performance.messages.reopeningLimitReached"), "error", "reports");

  const maximumHours = settings.maximum_reopen_hours ?? 24;
  const durationHours = Math.min(requestedHours, maximumHours);
  const scorePercent = justified ? 100 : Number(settings.reopened_report_score_percent ?? 70);
  const scoreFactor = Math.min(1, Math.max(0, scorePercent / 100));
  const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
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
  }).select("id").single<{id: string}>();
  if (error) go(t("performance.messages.reopeningFailed", {message: error.message}), "error", "reports");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: employeeId,
    entityType: "daily_report_reopening",
    entityId: data.id,
    action: "opened",
    details: {report_date: reportDate, reason, justified, duration_hours: durationHours, expires_at: expiresAt.toISOString(), score_factor: scoreFactor},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.reportReopened"), "success", "reports");
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
  if (!(await canSuperviseEmployee(membership, user.id, reopening.user_id, admin))) go(t("performance.messages.notAssignedSupervisor"), "error", "reports");
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
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "reports");
  const employeeId = String(formData.get("userId") ?? "").trim();
  const reportDate = normalizeDate(formData.get("reportDate"));
  const supervisorReason = cleanText(formData.get("supervisorReason"), 2000);
  const accomplishments = cleanText(formData.get("accomplishments"), 3000);
  const results = cleanText(formData.get("results"), 3000);
  const blockers = cleanText(formData.get("blockers"), 3000) || t("performance.noBlockers");
  const nextPriorities = cleanText(formData.get("nextPriorities"), 3000);
  if (!employeeId || !reportDate || supervisorReason.length < 10 || accomplishments.length < 3 || results.length < 3 || nextPriorities.length < 3) {
    go(t("performance.messages.invalidSupervisorReport"), "error", "reports");
  }
  if (!(await ensureMember(membership.organization_id, employeeId, admin))) go(t("performance.messages.memberNotFound"), "error", "reports");
  if (!(await canSuperviseEmployee(membership, user.id, employeeId, admin))) go(t("performance.messages.notAssignedSupervisor"), "error", "reports");

  let settings: PerformanceSettings;
  let schedule: ScheduleRow | null;
  try {
    ({settings, schedule} = await loadSettingsAndSchedule(membership.organization_id, employeeId, admin));
  } catch {
    go(t("performance.messages.databaseSetupRequired"), "error", "reports");
  }
  const now = new Date();
  const window = reportWindowState(reportDate, now, settings, schedule);
  if (window.isFuture) go(t("performance.messages.futureReport"), "error", "reports");
  if (!window.isClosed) go(t("performance.messages.reportDayStillOpen"), "error", "reports");

  const {data: existingReport} = await admin
    .from("daily_reports")
    .select("id, status")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", employeeId)
    .eq("report_date", reportDate)
    .maybeSingle<{id: string; status: string}>();
  if (existingReport?.status === "validated") go(t("performance.messages.validatedReportCannotReplace"), "error", "reports");

  const scoreFactor = Math.min(1, Math.max(0, Number(settings.supervisor_report_score_percent ?? 50) / 100));
  const {data, error} = await admin.from("daily_reports").upsert({
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
  }, {onConflict: "organization_id,user_id,report_date"}).select("id").single<{id: string}>();
  if (error) go(t("performance.messages.reportSaveFailed", {message: error.message}), "error", "reports");

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
    entityId: data.id,
    action: "completed_by_supervisor",
    details: {report_date: reportDate, supervisor_reason: supervisorReason, score_factor: scoreFactor},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.supervisorReportSaved"), "success", "reports");
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
  const timezone = cleanText(formData.get("timezone"), 100) || "Europe/Dublin";
  const defaultStart = normalizeTime(formData.get("defaultStart"));
  const defaultEnd = normalizeTime(formData.get("defaultEnd"));
  const reportDeadline = normalizeTime(formData.get("reportDeadline"));
  const graceMinutes = parseInteger(formData.get("graceMinutes"));
  const reportLockEnabled = formData.get("reportLockEnabled") === "on";
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
    details: {timezone, weight_sum: weightSum},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.settingsSaved"), "success", "settings");
}

export async function upsertMemberScheduleAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "settings");
  const userId = String(formData.get("userId") ?? "").trim();
  const supervisorId = String(formData.get("supervisorId") ?? "").trim();
  const timezone = cleanText(formData.get("timezone"), 100) || "Europe/Dublin";
  const startTime = normalizeTime(formData.get("startTime"));
  const endTime = normalizeTime(formData.get("endTime"));
  const reportDeadline = normalizeTime(formData.get("reportDeadline"));
  const graceMinutes = parseInteger(formData.get("graceMinutes"));
  const workDays = formData.getAll("workDays").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);
  if (!userId || !startTime || !endTime || !reportDeadline || endTime <= startTime || workDays.length === 0 || !Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 180) {
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
    is_active: true,
    updated_by: user.id,
  }, {onConflict: "organization_id,user_id"}).select("id").single<{id: string}>();
  if (error) go(t("performance.messages.scheduleSaveFailed", {message: error.message}), "error", "settings");
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: userId,
    entityType: "member_schedule",
    entityId: data.id,
    action: "upserted",
    details: {work_days: workDays, start_time: startTime, end_time: endTime, supervisor_id: supervisorId || null},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.scheduleSaved"), "success", "settings");
}

export async function createPerformanceMeetingAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "meetings");
  const title = cleanText(formData.get("title"), 200);
  const meetingType = String(formData.get("meetingType") ?? "team").trim();
  const startsAt = String(formData.get("startsAt") ?? "").trim();
  const endsAt = String(formData.get("endsAt") ?? "").trim() || null;
  const notes = cleanText(formData.get("notes"), 2000) || null;
  const mandatory = formData.get("mandatory") === "on";
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
  const validParticipants: string[] = [];
  for (const participantId of participantIds) {
    if (await ensureMember(membership.organization_id, participantId, admin)) validParticipants.push(participantId);
  }
  if (validParticipants.length === 0) go(t("performance.messages.noMeetingParticipants"), "error", "meetings");
  const {data: meeting, error: meetingError} = await admin.from("performance_meetings").insert({
    organization_id: membership.organization_id,
    title,
    meeting_type: meetingType,
    mandatory,
    starts_at: parsedStart.toISOString(),
    ends_at: parsedEnd?.toISOString() ?? null,
    notes,
    created_by: user.id,
  }).select("id").single<{id: string}>();
  if (meetingError) go(t("performance.messages.meetingCreateFailed", {message: meetingError.message}), "error", "meetings");
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
    go(t("performance.messages.meetingParticipantsFailed", {message: attendeeError.message}), "error", "meetings");
  }
  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "meeting",
    entityId: meeting.id,
    action: "created",
    details: {title, mandatory, participants: validParticipants.length},
  });
  revalidatePath("/dashboard/performance");
  go(t("performance.messages.meetingCreated"), "success", "meetings");
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
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("performance.messages.permissionDenied"), "error", "ranking");
  const month = normalizeMonth(formData.get("month"));
  if (!month) go(t("performance.messages.invalidMonth"), "error", "ranking");
  const scoreMonth = `${month}-01`;
  const bounds = monthBounds(month);
  const {data: lockedScores} = await admin.from("employee_month_scores").select("id").eq("organization_id", membership.organization_id).eq("score_month", scoreMonth).not("locked_at", "is", null).limit(1);
  if (lockedScores?.length) go(t("performance.messages.monthLocked"), "error", "ranking");

  const [settingsResult, membersResult, schedulesResult, attendanceResult, leavesResult, reportsResult, meetingsResult, meetingAttendanceResult, feedbackResult, recognitionsResult, kpiResult] = await Promise.all([
    admin.from("performance_settings").select("*").eq("organization_id", membership.organization_id).maybeSingle<PerformanceSettings>(),
    admin.from("organization_members").select("user_id").eq("organization_id", membership.organization_id).eq("is_active", true),
    admin.from("member_work_schedules").select("*").eq("organization_id", membership.organization_id).eq("is_active", true),
    admin.from("attendance_records").select("user_id, work_date, status, late_minutes").eq("organization_id", membership.organization_id).gte("work_date", bounds.start).lte("work_date", bounds.end),
    admin.from("leave_requests").select("user_id, start_date, end_date, status").eq("organization_id", membership.organization_id).eq("status", "approved").lte("start_date", bounds.end).gte("end_date", bounds.start),
    admin.from("daily_reports").select("user_id, report_date, status, submission_mode, submission_score_factor").eq("organization_id", membership.organization_id).gte("report_date", bounds.start).lte("report_date", bounds.end),
    admin.from("performance_meetings").select("id, mandatory, starts_at").eq("organization_id", membership.organization_id).gte("starts_at", `${bounds.start}T00:00:00Z`).lte("starts_at", `${bounds.end}T23:59:59Z`),
    admin.from("performance_meeting_attendance").select("meeting_id, user_id, status").eq("organization_id", membership.organization_id),
    admin.from("peer_feedback").select("recipient_id, score, created_at").eq("organization_id", membership.organization_id).eq("status", "published").gte("created_at", `${bounds.start}T00:00:00Z`).lte("created_at", `${bounds.end}T23:59:59Z`),
    admin.from("recognitions").select("recipient_id, created_at").eq("organization_id", membership.organization_id).gte("created_at", `${bounds.start}T00:00:00Z`).lte("created_at", `${bounds.end}T23:59:59Z`),
    admin.from("monthly_kpi_scores").select("user_id, score").eq("organization_id", membership.organization_id).eq("score_month", scoreMonth),
  ]);

  const anyError = [settingsResult.error, membersResult.error, schedulesResult.error, attendanceResult.error, leavesResult.error, reportsResult.error, meetingsResult.error, meetingAttendanceResult.error, feedbackResult.error, recognitionsResult.error, kpiResult.error].find(Boolean);
  if (anyError || !settingsResult.data) go(t("performance.messages.calculationFailed", {message: anyError?.message || t("performance.messages.settingsMissing")}), "error", "ranking");

  const settings = settingsResult.data;
  const members = (membersResult.data ?? []) as {user_id: string}[];
  const schedules = (schedulesResult.data ?? []) as MemberSchedule[];
  const attendance = (attendanceResult.data ?? []) as AttendanceRecord[];
  const leaves = (leavesResult.data ?? []) as LeaveRequest[];
  const reports = (reportsResult.data ?? []) as DailyReportRecord[];
  const meetings = (meetingsResult.data ?? []) as MeetingRecord[];
  const meetingAttendance = (meetingAttendanceResult.data ?? []) as MeetingAttendanceRecord[];
  const feedback = (feedbackResult.data ?? []) as FeedbackRecord[];
  const recognitions = (recognitionsResult.data ?? []) as {recipient_id: string; created_at: string}[];
  const kpiRows = (kpiResult.data ?? []) as KpiScoreRecord[];
  const today = zonedParts(new Date(), settings.timezone).date;

  const calculated = members.map((member) => ({
    userId: member.user_id,
    result: calculatePerformanceScore({
      userId: member.user_id,
      month,
      today,
      settings,
      schedule: schedules.find((row) => row.user_id === member.user_id) ?? null,
      attendance,
      leaves,
      reports,
      meetings,
      meetingAttendance,
      feedback,
      recognitions,
      kpi: kpiRows.find((row) => row.user_id === member.user_id) ?? null,
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
    role_kpi_score: result.roleKpiScore,
    total_score: result.totalScore,
    scheduled_days: result.scheduledDays,
    attended_days: result.attendedDays,
    late_days: result.lateDays,
    unexcused_absences: result.unexcusedAbsences,
    reports_expected: result.reportsExpected,
    reports_submitted: result.reportsSubmitted,
    mandatory_meetings: result.mandatoryMeetings,
    meetings_attended: result.meetingsAttended,
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
  if (error) go(t("performance.messages.appealSaveFailed", {message: error.message}), "error", "ranking");
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
