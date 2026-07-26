"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";

const leaderRoles = new Set(["owner", "admin", "hr", "manager"]);
const hrRoles = new Set(["owner", "admin", "hr"]);
const workModes = new Set(["onsite", "remote", "hybrid", "off"]);
const statuses = new Set(["draft", "published"]);

type Membership = {
  organization_id: string;
  role: string;
};

type ScheduleTemplate = {
  id: string;
  name: string;
  timezone: string;
  start_time: string | null;
  end_time: string | null;
  grace_minutes: number;
  report_deadline_time: string | null;
  work_mode: string;
  location: string | null;
  report_required: boolean;
};

function first(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function clean(value: FormDataEntryValue | null, maxLength: number) {
  return first(value).slice(0, maxLength);
}

function normalizeDate(value: FormDataEntryValue | null) {
  const raw = first(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : raw;
}

function normalizeMonth(value: FormDataEntryValue | null) {
  const raw = first(value);
  return /^\d{4}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeTime(value: FormDataEntryValue | null) {
  const raw = first(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : "";
}

function toInteger(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const parsed = Number(first(value));
  return Number.isInteger(parsed) ? parsed : fallback;
}

function dateRange(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last && dates.length <= 93) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isoWeekday(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function go(message: string, kind: "success" | "error" = "success", month = ""): never {
  const suffix = month ? `&month=${encodeURIComponent(month)}` : "";
  redirect(`/dashboard/schedule?${kind}=${encodeURIComponent(message)}${suffix}`);
}

async function getContext() {
  const {t} = await getI18n();
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (error) throw new Error(error.message);
  if (!membership) redirect("/dashboard/company");
  return {user: authData.user, membership, admin, t};
}

async function ensureManageableMember(
  organizationId: string,
  actorId: string,
  actorRole: string,
  userId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  if (!leaderRoles.has(actorRole)) return false;

  const {data: member} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle<{user_id: string}>();
  if (!member) return false;

  if (hrRoles.has(actorRole)) return true;
  const {data: schedule} = await admin
    .from("member_work_schedules")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("supervisor_id", actorId)
    .eq("is_active", true)
    .maybeSingle<{user_id: string}>();
  return Boolean(schedule);
}

async function hasApprovedLeave(
  organizationId: string,
  userId: string,
  workDate: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  const {data} = await admin
    .from("leave_requests")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "approved")
    .lte("start_date", workDate)
    .gte("end_date", workDate)
    .limit(1)
    .maybeSingle<{id: string}>();
  return Boolean(data);
}

async function writeAudit(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    organizationId: string;
    entryId?: string | null;
    actorId: string;
    subjectUserId?: string | null;
    action: string;
    details?: Record<string, unknown>;
  },
) {
  const {error} = await admin.from("schedule_audit_log").insert({
    organization_id: input.organizationId,
    schedule_entry_id: input.entryId ?? null,
    actor_id: input.actorId,
    subject_user_id: input.subjectUserId ?? null,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Schedule audit failed", error);
}

function revalidateSchedule() {
  revalidatePath("/dashboard/schedule");
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/performance");
}

export async function saveScheduleEntryAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("schedule.messages.permissionDenied"), "error");

  const userId = first(formData.get("userId"));
  const workDate = normalizeDate(formData.get("workDate"));
  const workMode = first(formData.get("workMode"));
  const status = first(formData.get("status"));
  const timezone = normalizeTimeZone(clean(formData.get("timezone"), 80));
  const startTime = normalizeTime(formData.get("startTime"));
  const endTime = normalizeTime(formData.get("endTime"));
  const graceMinutes = Math.min(180, Math.max(0, toInteger(formData.get("graceMinutes"), 10)));
  const reportDeadline = normalizeTime(formData.get("reportDeadline"));
  const reportRequired = workMode !== "off" && formData.get("reportRequired") === "on";
  const location = clean(formData.get("location"), 240) || null;
  const notes = clean(formData.get("notes"), 1200) || null;
  const month = workDate.slice(0, 7);

  if (!userId || !workDate || !workModes.has(workMode) || !statuses.has(status)) {
    go(t("schedule.messages.invalidEntry"), "error", month);
  }
  if (workMode !== "off" && (!startTime || !endTime || endTime <= startTime)) {
    go(t("schedule.messages.invalidHours"), "error", month);
  }
  if (!(await ensureManageableMember(membership.organization_id, user.id, membership.role, userId, admin))) {
    go(t("schedule.messages.memberNotAllowed"), "error", month);
  }
  if (status === "published" && workMode !== "off" && await hasApprovedLeave(membership.organization_id, userId, workDate, admin)) {
    go(t("schedule.messages.leaveConflict"), "error", month);
  }

  const {data: baseSchedule} = await admin
    .from("member_work_schedules")
    .select("supervisor_id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle<{supervisor_id: string | null}>();

  const payload = {
    organization_id: membership.organization_id,
    user_id: userId,
    work_date: workDate,
    timezone,
    start_time: workMode === "off" ? null : startTime,
    end_time: workMode === "off" ? null : endTime,
    grace_minutes: graceMinutes,
    report_deadline_time: workMode === "off" ? null : (reportDeadline || endTime),
    work_mode: workMode,
    location,
    supervisor_id: baseSchedule?.supervisor_id ?? null,
    report_required: workMode === "off" ? false : reportRequired,
    status,
    source: "manual",
    notes,
    published_at: status === "published" ? new Date().toISOString() : null,
    published_by: status === "published" ? user.id : null,
    created_by: user.id,
  };

  const {data, error} = await admin
    .from("work_schedule_entries")
    .upsert(payload, {onConflict: "organization_id,user_id,work_date"})
    .select("id")
    .single<{id: string}>();
  if (error) go(t("schedule.messages.saveFailed", {message: error.message}), "error", month);

  await writeAudit(admin, {
    organizationId: membership.organization_id,
    entryId: data.id,
    actorId: user.id,
    subjectUserId: userId,
    action: status === "published" ? "saved_and_published" : "saved_as_draft",
    details: {work_date: workDate, work_mode: workMode, start_time: startTime || null, end_time: endTime || null},
  });
  revalidateSchedule();
  go(status === "published" ? t("schedule.messages.published") : t("schedule.messages.savedDraft"), "success", month);
}

export async function createScheduleTemplateAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("schedule.messages.permissionDenied"), "error");

  const name = clean(formData.get("name"), 120);
  const workMode = first(formData.get("workMode"));
  const timezone = normalizeTimeZone(clean(formData.get("timezone"), 80));
  const startTime = normalizeTime(formData.get("startTime"));
  const endTime = normalizeTime(formData.get("endTime"));
  const graceMinutes = Math.min(180, Math.max(0, toInteger(formData.get("graceMinutes"), 10)));
  const reportDeadline = normalizeTime(formData.get("reportDeadline"));
  const location = clean(formData.get("location"), 240) || null;
  const reportRequired = workMode !== "off" && formData.get("reportRequired") === "on";

  if (name.length < 2 || !workModes.has(workMode)) go(t("schedule.messages.invalidTemplate"), "error");
  if (workMode !== "off" && (!startTime || !endTime || endTime <= startTime)) go(t("schedule.messages.invalidHours"), "error");

  const {error} = await admin.from("schedule_templates").insert({
    organization_id: membership.organization_id,
    name,
    timezone,
    start_time: workMode === "off" ? null : startTime,
    end_time: workMode === "off" ? null : endTime,
    grace_minutes: graceMinutes,
    report_deadline_time: workMode === "off" ? null : (reportDeadline || endTime),
    work_mode: workMode,
    location,
    report_required: workMode === "off" ? false : reportRequired,
    created_by: user.id,
  });
  if (error) go(t("schedule.messages.templateSaveFailed", {message: error.message}), "error");
  revalidatePath("/dashboard/schedule");
  go(t("schedule.messages.templateSaved"));
}

export async function applyScheduleTemplateAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("schedule.messages.permissionDenied"), "error");

  const userId = first(formData.get("userId"));
  const templateId = first(formData.get("templateId"));
  const startDate = normalizeDate(formData.get("startDate"));
  const endDate = normalizeDate(formData.get("endDate"));
  const publishNow = formData.get("publishNow") === "on";
  const replaceExisting = formData.get("replaceExisting") === "on";
  const weekdays = new Set<number>();
  for (let day = 1; day <= 7; day += 1) {
    if (formData.get(`weekday-${day}`) === "on") weekdays.add(day);
  }
  const month = startDate.slice(0, 7);

  if (!userId || !templateId || !startDate || !endDate || endDate < startDate || weekdays.size === 0) {
    go(t("schedule.messages.invalidBulk"), "error", month);
  }
  const dates = dateRange(startDate, endDate).filter((date) => weekdays.has(isoWeekday(date)));
  if (!dates.length || dates.length > 93) go(t("schedule.messages.invalidBulk"), "error", month);
  if (!(await ensureManageableMember(membership.organization_id, user.id, membership.role, userId, admin))) {
    go(t("schedule.messages.memberNotAllowed"), "error", month);
  }

  const {data: template, error: templateError} = await admin
    .from("schedule_templates")
    .select("id, name, timezone, start_time, end_time, grace_minutes, report_deadline_time, work_mode, location, report_required")
    .eq("id", templateId)
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true)
    .maybeSingle<ScheduleTemplate>();
  if (templateError || !template) go(t("schedule.messages.templateNotFound"), "error", month);

  const [{data: baseSchedule}, {data: leaveRows}, {data: existingRows}] = await Promise.all([
    admin.from("member_work_schedules").select("supervisor_id").eq("organization_id", membership.organization_id).eq("user_id", userId).eq("is_active", true).maybeSingle<{supervisor_id: string | null}>(),
    admin.from("leave_requests").select("start_date, end_date").eq("organization_id", membership.organization_id).eq("user_id", userId).eq("status", "approved").lte("start_date", endDate).gte("end_date", startDate),
    admin.from("work_schedule_entries").select("work_date").eq("organization_id", membership.organization_id).eq("user_id", userId).gte("work_date", startDate).lte("work_date", endDate),
  ]);

  const leaveDates = new Set<string>();
  for (const leave of leaveRows ?? []) {
    for (const date of dateRange(String(leave.start_date), String(leave.end_date))) leaveDates.add(date);
  }
  const existingDates = new Set((existingRows ?? []).map((row) => String(row.work_date)));
  const selectedDates = dates.filter((date) => !leaveDates.has(date) && (replaceExisting || !existingDates.has(date)));
  if (!selectedDates.length) go(t("schedule.messages.noDatesCreated"), "error", month);

  const now = new Date().toISOString();
  const rows = selectedDates.map((workDate) => ({
    organization_id: membership.organization_id,
    user_id: userId,
    work_date: workDate,
    timezone: normalizeTimeZone(template.timezone),
    start_time: template.work_mode === "off" ? null : template.start_time,
    end_time: template.work_mode === "off" ? null : template.end_time,
    grace_minutes: template.grace_minutes,
    report_deadline_time: template.work_mode === "off" ? null : template.report_deadline_time,
    work_mode: template.work_mode,
    location: template.location,
    supervisor_id: baseSchedule?.supervisor_id ?? null,
    report_required: template.work_mode === "off" ? false : template.report_required,
    status: publishNow ? "published" : "draft",
    source: "template",
    template_id: template.id,
    notes: null,
    published_at: publishNow ? now : null,
    published_by: publishNow ? user.id : null,
    created_by: user.id,
  }));

  const {data, error} = await admin
    .from("work_schedule_entries")
    .upsert(rows, {onConflict: "organization_id,user_id,work_date"})
    .select("id, work_date");
  if (error) go(t("schedule.messages.bulkSaveFailed", {message: error.message}), "error", month);

  for (const entry of data ?? []) {
    await writeAudit(admin, {
      organizationId: membership.organization_id,
      entryId: entry.id,
      actorId: user.id,
      subjectUserId: userId,
      action: publishNow ? "bulk_created_and_published" : "bulk_created_as_draft",
      details: {work_date: entry.work_date, template_id: template.id, template_name: template.name},
    });
  }

  revalidateSchedule();
  go(t("schedule.messages.bulkCreated", {count: rows.length, skipped: dates.length - rows.length}), "success", month);
}

export async function publishScheduleEntryAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("schedule.messages.permissionDenied"), "error");
  const entryId = first(formData.get("entryId"));
  const month = normalizeMonth(formData.get("month"));

  const {data: entry} = await admin
    .from("work_schedule_entries")
    .select("id, user_id, work_date, work_mode")
    .eq("id", entryId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; user_id: string; work_date: string; work_mode: string}>();
  if (!entry) go(t("schedule.messages.entryNotFound"), "error", month);
  if (!(await ensureManageableMember(membership.organization_id, user.id, membership.role, entry.user_id, admin))) {
    go(t("schedule.messages.memberNotAllowed"), "error", month);
  }
  if (entry.work_mode !== "off" && await hasApprovedLeave(membership.organization_id, entry.user_id, entry.work_date, admin)) {
    go(t("schedule.messages.leaveConflict"), "error", month);
  }

  const {error} = await admin.from("work_schedule_entries").update({
    status: "published",
    published_at: new Date().toISOString(),
    published_by: user.id,
  }).eq("id", entryId).eq("organization_id", membership.organization_id);
  if (error) go(t("schedule.messages.publishFailed", {message: error.message}), "error", month);

  await writeAudit(admin, {organizationId: membership.organization_id, entryId, actorId: user.id, subjectUserId: entry.user_id, action: "published", details: {work_date: entry.work_date}});
  revalidateSchedule();
  go(t("schedule.messages.published"), "success", month);
}

export async function publishMonthScheduleAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("schedule.messages.permissionDenied"), "error");
  const month = normalizeMonth(formData.get("month"));
  if (!month) go(t("schedule.messages.invalidMonth"), "error");
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);

  let query = admin
    .from("work_schedule_entries")
    .select("id, user_id, work_date, work_mode")
    .eq("organization_id", membership.organization_id)
    .eq("status", "draft")
    .gte("work_date", start)
    .lte("work_date", end);

  if (membership.role === "manager") {
    const {data: supervised} = await admin.from("member_work_schedules").select("user_id").eq("organization_id", membership.organization_id).eq("supervisor_id", user.id).eq("is_active", true);
    const ids = (supervised ?? []).map((row) => String(row.user_id));
    if (!ids.length) go(t("schedule.messages.noDrafts"), "error", month);
    query = query.in("user_id", ids);
  }

  const {data: entries, error: loadError} = await query;
  if (loadError) go(t("schedule.messages.loadFailed", {message: loadError.message}), "error", month);
  if (!entries?.length) go(t("schedule.messages.noDrafts"), "error", month);

  const leaveConflicts: string[] = [];
  for (const entry of entries) {
    if (entry.work_mode !== "off" && await hasApprovedLeave(membership.organization_id, String(entry.user_id), String(entry.work_date), admin)) {
      leaveConflicts.push(String(entry.id));
    }
  }
  const publishable = entries.filter((entry) => !leaveConflicts.includes(String(entry.id)));
  if (!publishable.length) go(t("schedule.messages.allDraftsConflict"), "error", month);

  const {error} = await admin.from("work_schedule_entries").update({
    status: "published",
    published_at: new Date().toISOString(),
    published_by: user.id,
  }).in("id", publishable.map((entry) => String(entry.id)));
  if (error) go(t("schedule.messages.publishFailed", {message: error.message}), "error", month);

  revalidateSchedule();
  go(t("schedule.messages.monthPublished", {count: publishable.length, conflicts: leaveConflicts.length}), "success", month);
}

export async function cancelScheduleEntryAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("schedule.messages.permissionDenied"), "error");
  const entryId = first(formData.get("entryId"));
  const month = normalizeMonth(formData.get("month"));
  const reason = clean(formData.get("reason"), 500) || t("schedule.defaultCancellationReason");

  const {data: entry} = await admin
    .from("work_schedule_entries")
    .select("id, user_id, work_date, notes")
    .eq("id", entryId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; user_id: string; work_date: string; notes: string | null}>();
  if (!entry) go(t("schedule.messages.entryNotFound"), "error", month);
  if (!(await ensureManageableMember(membership.organization_id, user.id, membership.role, entry.user_id, admin))) {
    go(t("schedule.messages.memberNotAllowed"), "error", month);
  }

  const notes = [entry.notes, `${t("schedule.cancelledReasonLabel")}: ${reason}`].filter(Boolean).join("\n");
  const {error} = await admin.from("work_schedule_entries").update({status: "cancelled", notes}).eq("id", entryId);
  if (error) go(t("schedule.messages.cancelFailed", {message: error.message}), "error", month);
  await writeAudit(admin, {organizationId: membership.organization_id, entryId, actorId: user.id, subjectUserId: entry.user_id, action: "cancelled", details: {work_date: entry.work_date, reason}});
  revalidateSchedule();
  go(t("schedule.messages.cancelled"), "success", month);
}

export async function deleteDraftScheduleEntryAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!leaderRoles.has(membership.role)) go(t("schedule.messages.permissionDenied"), "error");
  const entryId = first(formData.get("entryId"));
  const month = normalizeMonth(formData.get("month"));

  const {data: entry} = await admin
    .from("work_schedule_entries")
    .select("id, user_id, work_date, status")
    .eq("id", entryId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; user_id: string; work_date: string; status: string}>();
  if (!entry || entry.status !== "draft") go(t("schedule.messages.onlyDraftDelete"), "error", month);
  if (!(await ensureManageableMember(membership.organization_id, user.id, membership.role, entry.user_id, admin))) {
    go(t("schedule.messages.memberNotAllowed"), "error", month);
  }

  await writeAudit(admin, {organizationId: membership.organization_id, entryId, actorId: user.id, subjectUserId: entry.user_id, action: "draft_deleted", details: {work_date: entry.work_date}});
  const {error} = await admin.from("work_schedule_entries").delete().eq("id", entryId).eq("status", "draft");
  if (error) go(t("schedule.messages.deleteFailed", {message: error.message}), "error", month);
  revalidateSchedule();
  go(t("schedule.messages.deleted"), "success", month);
}
