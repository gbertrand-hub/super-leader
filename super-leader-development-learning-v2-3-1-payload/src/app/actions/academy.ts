"use server";

import {randomUUID} from "crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {createNotification} from "@/lib/notifications/service";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";

const academyAdminRoles = new Set(["owner", "admin", "hr"]);
const academyAssignmentRoles = new Set(["owner", "admin", "hr", "manager"]);
const academyGrowthPrograms = new Set([
  "school_coaches",
  "school_business",
  "school_experts",
  "school_breeders",
  "vision_monday",
  "other_training",
]);

type Membership = {
  organization_id: string;
  role: string;
  is_active: boolean;
};

type CourseRow = {
  id: string;
  organization_id: string;
  title: string;
  status: string;
  training_month: string;
  deadline: string;
  is_required: boolean;
  passing_score: number | string;
  max_attempts: number;
  certificate_enabled: boolean;
  attendance_required_percent: number | string;
};

type EnrollmentRow = {
  id: string;
  organization_id: string;
  course_id: string;
  user_id: string;
  status: string;
  attempts_count: number;
  best_score: number | string | null;
  attendance_percent: number | string;
  sessions_expected: number;
  sessions_attended: number;
  quiz_passed_at: string | null;
};

type QuestionRow = {
  id: string;
  question_text: string;
  options: unknown;
  correct_option: number;
  points: number | string;
};

function go(message: string, kind: "success" | "error" = "success", courseId?: string): never {
  const params = new URLSearchParams({[kind]: message});
  if (courseId) params.set("course", courseId);
  redirect(`/dashboard/academy?${params.toString()}`);
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
  return /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : "";
}

function parseInteger(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseNumber(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTime(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : "";
}

function isoWeekday(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function dateRange(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last && dates.length < 500) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function generateSessionDates(input: {
  scheduleType: string;
  startsOn: string;
  endsOn: string;
  weekdays: number[];
  monthlyStartDay: number;
  consecutiveDays: number;
}) {
  if (input.scheduleType === "single") return [input.startsOn];
  if (input.scheduleType === "weekly") {
    const allowed = new Set(input.weekdays);
    return dateRange(input.startsOn, input.endsOn).filter((date) => allowed.has(isoWeekday(date)));
  }
  if (input.scheduleType === "monthly_intensive") {
    return dateRange(input.startsOn, input.endsOn).filter((date) => {
      const day = Number(date.slice(8, 10));
      return day >= input.monthlyStartDay && day < input.monthlyStartDay + input.consecutiveDays;
    });
  }
  return [];
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let index = 0; index < 3; index += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += target - represented;
  }
  return new Date(guess);
}

async function getAttendanceSnapshot(input: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  courseId: string;
  enrollmentId: string;
}) {
  const sessionsResult = await input.admin
    .from("academy_sessions")
    .select("id, status, starts_at, ends_at")
    .eq("organization_id", input.organizationId)
    .eq("course_id", input.courseId)
    .neq("status", "cancelled");
  if (sessionsResult.error) throw new Error(sessionsResult.error.message);

  const nowMs = Date.now();
  const sessions = sessionsResult.data ?? [];
  const finishedSessions = sessions.filter((session) =>
    String(session.status) === "completed" || new Date(String(session.ends_at)).getTime() <= nowMs,
  );
  const pendingSessions = sessions.filter((session) =>
    String(session.status) !== "completed" && new Date(String(session.ends_at)).getTime() > nowMs,
  );
  const finishedSessionIds = finishedSessions.map((session) => String(session.id));
  const nextSessionEndsAt = pendingSessions
    .map((session) => String(session.ends_at))
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;

  if (!sessions.length) {
    return {totalSessions: 0, finishedSessions: 0, allSessionsFinished: false, expected: 0, attended: 0, percent: 0, nextSessionEndsAt};
  }

  const attendanceResult = finishedSessionIds.length
    ? await input.admin
        .from("academy_session_attendance")
        .select("status, session_id")
        .eq("organization_id", input.organizationId)
        .eq("enrollment_id", input.enrollmentId)
        .in("session_id", finishedSessionIds)
    : {data: [], error: null};
  if (attendanceResult.error) throw new Error(attendanceResult.error.message);

  const rows = attendanceResult.data ?? [];
  const excused = rows.filter((row) => String(row.status) === "excused").length;
  const expected = Math.max(0, finishedSessionIds.length - excused);
  const attended = rows.filter((row) => ["present", "late"].includes(String(row.status))).length;
  const percent = expected
    ? Math.round((attended / expected) * 10000) / 100
    : finishedSessionIds.length ? 100 : 0;

  return {
    totalSessions: sessions.length,
    finishedSessions: finishedSessionIds.length,
    allSessionsFinished: sessions.length > 0 && pendingSessions.length === 0,
    expected,
    attended,
    percent,
    nextSessionEndsAt,
  };
}

async function context() {
  const {t} = await getI18n();
  const supabase = await createClient();
  const {data, error} = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (membershipError || !membership) redirect("/dashboard/company");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: data.user.id,
    role: membership.role,
  });

  return {user: data.user, membership, admin, t, visibleUserIds};
}

async function audit(input: {
  organizationId: string;
  actorId: string;
  subjectUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  details?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const {error} = await admin.from("performance_audit_log").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    subject_user_id: input.subjectUserId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Academy audit failed", error);
}

async function loadCourse(courseId: string, organizationId: string) {
  const admin = createAdminClient();
  const {data, error} = await admin
    .from("academy_courses")
    .select("id, organization_id, title, status, training_month, deadline, is_required, passing_score, max_attempts, certificate_enabled, attendance_required_percent")
    .eq("id", courseId)
    .eq("organization_id", organizationId)
    .maybeSingle<CourseRow>();
  if (error) throw new Error(error.message);
  return data;
}

async function loadSchedule(scheduleId: string, courseId: string, organizationId: string) {
  const admin = createAdminClient();
  const {data, error} = await admin
    .from("academy_course_schedules")
    .select("id, course_id, is_active")
    .eq("id", scheduleId)
    .eq("course_id", courseId)
    .eq("organization_id", organizationId)
    .maybeSingle<{id: string; course_id: string; is_active: boolean}>();
  if (error) throw new Error(error.message);
  return data;
}


type AcademyWizardSchedule = {
  label: string;
  schedule_type: "weekly" | "monthly_intensive" | "single";
  starts_on: string;
  ends_on: string;
  local_start_time: string;
  duration_minutes: number;
  timezone: string;
  weekdays: number[];
  monthly_start_day: number | null;
  consecutive_days: number | null;
  zoom_join_url: string | null;
  sessions: Array<{
    title: string;
    session_date: string;
    local_start_time: string;
    timezone: string;
    starts_at: string;
    ends_at: string;
    delivery_mode: string;
    zoom_join_url: string | null;
  }>;
};

function academyWizardQuestions(formData: FormData) {
  const texts = formData.getAll("wizardQuestionText");
  const optionColumns = [1, 2, 3, 4].map((index) => formData.getAll(`wizardOption${index}`));
  const correctOptions = formData.getAll("wizardCorrectOption");
  const points = formData.getAll("wizardPoints");
  const questions: Array<{question_text: string; options: string[]; correct_option: number; points: number; position: number}> = [];

  texts.forEach((value, index) => {
    const questionText = cleanText(value, 1000);
    if (!questionText) return;
    const options = optionColumns.map((column) => cleanText(column[index] ?? null, 500)).filter(Boolean);
    const correctOption = parseInteger(correctOptions[index] ?? null, 0);
    const questionPoints = parseNumber(points[index] ?? null, 1);
    if (questionText.length < 3 || options.length < 2 || correctOption < 0 || correctOption >= options.length || !Number.isFinite(questionPoints) || questionPoints <= 0) {
      throw new Error("ACADEMY_WIZARD_INVALID_QUESTION");
    }
    questions.push({question_text: questionText, options, correct_option: correctOption, points: questionPoints, position: questions.length + 1});
  });

  return questions;
}

function academyWizardSchedulePayload(formData: FormData, courseTitle: string) {
  const requestedType = cleanText(formData.get("wizardScheduleType"), 40);
  const label = cleanText(formData.get("wizardScheduleLabel"), 180) || courseTitle;
  const startTime = normalizeTime(formData.get("wizardStartTime"));
  const durationMinutes = parseInteger(formData.get("wizardSessionDurationMinutes"));
  const timezone = normalizeTimeZone(cleanText(formData.get("wizardTimezone"), 100));
  const zoomJoinUrl = cleanText(formData.get("wizardZoomJoinUrl"), 1000) || null;
  const weekdays = formData.getAll("wizardWeekdays").map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);
  const monthlyStartDay = parseInteger(formData.get("wizardMonthlyStartDay"), 1);
  const consecutiveDays = parseInteger(formData.get("wizardConsecutiveDays"), 3);

  if (!["single", "weekly", "monthly_intensive", "custom"].includes(requestedType) || label.length < 3 || !startTime || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    throw new Error("ACADEMY_WIZARD_INVALID_SCHEDULE");
  }

  const build = (input: {
    scheduleType: "weekly" | "monthly_intensive" | "single";
    startsOn: string;
    endsOn: string;
    scheduleLabel: string;
    scheduleWeekdays?: number[];
    scheduleMonthlyStartDay?: number;
    scheduleConsecutiveDays?: number;
  }): AcademyWizardSchedule => {
    const dates = generateSessionDates({
      scheduleType: input.scheduleType,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      weekdays: input.scheduleWeekdays ?? [],
      monthlyStartDay: input.scheduleMonthlyStartDay ?? 1,
      consecutiveDays: input.scheduleConsecutiveDays ?? 3,
    });
    if (!dates.length) throw new Error("ACADEMY_WIZARD_NO_SESSIONS");
    const sessions = dates.map((date) => {
      const startsAt = zonedDateTimeToUtc(date, startTime, timezone);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
      const intensiveDay = input.scheduleType === "monthly_intensive"
        ? ((Number(date.slice(8, 10)) - (input.scheduleMonthlyStartDay ?? 1)) % (input.scheduleConsecutiveDays ?? 3)) + 1
        : null;
      return {
        title: intensiveDay ? `${input.scheduleLabel} - Jour ${intensiveDay}` : input.scheduleLabel,
        session_date: date,
        local_start_time: startTime,
        timezone,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        delivery_mode: zoomJoinUrl ? "zoom" : "other",
        zoom_join_url: zoomJoinUrl,
      };
    });
    return {
      label: input.scheduleLabel,
      schedule_type: input.scheduleType,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      local_start_time: startTime,
      duration_minutes: durationMinutes,
      timezone,
      weekdays: input.scheduleType === "weekly" ? input.scheduleWeekdays ?? [] : [],
      monthly_start_day: input.scheduleType === "monthly_intensive" ? input.scheduleMonthlyStartDay ?? 1 : null,
      consecutive_days: input.scheduleType === "monthly_intensive" ? input.scheduleConsecutiveDays ?? 3 : null,
      zoom_join_url: zoomJoinUrl,
      sessions,
    };
  };

  if (requestedType === "custom") {
    const customDates = [...new Set(formData.getAll("wizardCustomDates").map(normalizeDate).filter(Boolean))].sort();
    if (!customDates.length || customDates.length > 100) throw new Error("ACADEMY_WIZARD_INVALID_SCHEDULE");
    return customDates.map((date, index) => build({scheduleType: "single", startsOn: date, endsOn: date, scheduleLabel: `${label} - ${index + 1}`}));
  }

  const startsOn = normalizeDate(formData.get("wizardStartsOn"));
  const endsOn = requestedType === "single" ? startsOn : normalizeDate(formData.get("wizardEndsOn"));
  if (!startsOn || !endsOn || endsOn < startsOn) throw new Error("ACADEMY_WIZARD_INVALID_SCHEDULE");
  if (requestedType === "weekly" && !weekdays.length) throw new Error("ACADEMY_WIZARD_INVALID_SCHEDULE");
  if (requestedType === "monthly_intensive" && (monthlyStartDay < 1 || monthlyStartDay > 28 || consecutiveDays < 1 || consecutiveDays > 14)) throw new Error("ACADEMY_WIZARD_INVALID_SCHEDULE");

  return [build({
    scheduleType: requestedType as "weekly" | "monthly_intensive" | "single",
    startsOn,
    endsOn,
    scheduleLabel: label,
    scheduleWeekdays: weekdays,
    scheduleMonthlyStartDay: monthlyStartDay,
    scheduleConsecutiveDays: consecutiveDays,
  })];
}

export async function createAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");

  const title = cleanText(formData.get("title"), 180);
  const description = cleanText(formData.get("description"), 5000);
  const category = cleanText(formData.get("category"), 80) || "professional_development";
  const growthProgramCodeRaw = cleanText(formData.get("growthProgramCode"), 60) || "other_training";
  const growthProgramCode = academyGrowthPrograms.has(growthProgramCodeRaw) ? growthProgramCodeRaw : "other_training";
  const trainingMonth = normalizeMonth(formData.get("trainingMonth"));
  const deadline = normalizeDate(formData.get("deadline"));
  const durationMinutes = parseInteger(formData.get("durationMinutes"));
  const passingScore = parseNumber(formData.get("passingScore"));
  const maxAttempts = parseInteger(formData.get("maxAttempts"));
  const attendanceRequiredPercent = parseNumber(formData.get("attendanceRequiredPercent"), 80);
  const resourceUrl = cleanText(formData.get("resourceUrl"), 1000) || null;
  const isRequired = formData.get("isRequired") === "on";
  const certificateEnabled = formData.get("certificateEnabled") === "on";

  if (
    title.length < 3 ||
    !trainingMonth ||
    !deadline ||
    deadline < trainingMonth ||
    !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080 ||
    !Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100 ||
    !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 ||
    !Number.isFinite(attendanceRequiredPercent) || attendanceRequiredPercent < 0 || attendanceRequiredPercent > 100
  ) {
    go(t("academy.messages.invalidCourse"), "error");
  }

  const {data: course, error} = await admin.from("academy_courses").insert({
    organization_id: membership.organization_id,
    title,
    description,
    category,
    growth_program_code: growthProgramCode,
    training_month: trainingMonth,
    deadline,
    duration_minutes: durationMinutes,
    is_required: isRequired,
    passing_score: passingScore,
    max_attempts: maxAttempts,
    attendance_required_percent: attendanceRequiredPercent,
    certificate_enabled: certificateEnabled,
    resource_url: resourceUrl,
    status: "draft",
    created_by: user.id,
  }).select("id").single<{id: string}>();

  if (error || !course) go(t("academy.messages.courseCreateFailed", {message: error?.message ?? ""}), "error");

  await audit({
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "academy_course",
    entityId: course.id,
    action: "created",
    details: {title, training_month: trainingMonth, required: isRequired},
  });

  revalidatePath("/dashboard/academy");
  go(t("academy.messages.courseCreated"), "success", course.id);
}


export async function createAcademyCourseWizardAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");

  const title = cleanText(formData.get("title"), 180);
  const description = cleanText(formData.get("description"), 5000);
  const category = cleanText(formData.get("category"), 80) || "professional_development";
  const growthProgramCodeRaw = cleanText(formData.get("growthProgramCode"), 60) || "other_training";
  const growthProgramCode = academyGrowthPrograms.has(growthProgramCodeRaw) ? growthProgramCodeRaw : "other_training";
  const trainingMonth = normalizeMonth(formData.get("trainingMonth"));
  const deadline = normalizeDate(formData.get("deadline"));
  const durationMinutes = parseInteger(formData.get("durationMinutes"));
  const passingScore = parseNumber(formData.get("passingScore"));
  const maxAttempts = parseInteger(formData.get("maxAttempts"));
  const attendanceRequiredPercent = parseNumber(formData.get("attendanceRequiredPercent"), 80);
  const resourceUrl = cleanText(formData.get("resourceUrl"), 1000) || null;
  const isRequired = formData.get("isRequired") === "on";
  const certificateEnabled = formData.get("certificateEnabled") === "on";
  const publish = cleanText(formData.get("wizardPublishMode"), 20) === "publish";

  if (
    title.length < 3 ||
    !trainingMonth ||
    !deadline ||
    deadline < trainingMonth ||
    !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080 ||
    !Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100 ||
    !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 ||
    !Number.isFinite(attendanceRequiredPercent) || attendanceRequiredPercent < 0 || attendanceRequiredPercent > 100
  ) {
    go(t("academy.messages.invalidCourse"), "error");
  }

  let questions: ReturnType<typeof academyWizardQuestions>;
  let schedules: AcademyWizardSchedule[];
  try {
    questions = academyWizardQuestions(formData);
    schedules = academyWizardSchedulePayload(formData, title);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ACADEMY_WIZARD_INVALID_QUESTION") go(t("academy.messages.wizardInvalidQuestion"), "error");
    if (code === "ACADEMY_WIZARD_NO_SESSIONS") go(t("academy.messages.wizardNoSessions"), "error");
    go(t("academy.messages.invalidSchedule"), "error");
  }

  if (publish && certificateEnabled && !questions.length) go(t("academy.messages.quizRequiredBeforePublish"), "error");
  const totalSessions = schedules.reduce((sum, schedule) => sum + schedule.sessions.length, 0);
  if (!totalSessions || totalSessions > 500) go(t("academy.messages.wizardNoSessions"), "error");

  const assignmentScope = cleanText(formData.get("wizardAssignmentScope"), 30);
  const requestedUserIds = formData.getAll("wizardUserIds").map(String);
  const requestedTeamIds = formData.getAll("wizardTeamIds").map(String);
  let assignedUserIds: string[] = [];

  if (assignmentScope === "organization") {
    const {data, error} = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true);
    if (error) go(t("academy.messages.wizardAssignmentFailed", {message: error.message}), "error");
    assignedUserIds = (data ?? []).map((row) => String(row.user_id));
  } else if (assignmentScope === "selected") {
    assignedUserIds = requestedUserIds.filter((userId) => visibleUserIds.includes(userId));
  } else if (assignmentScope === "teams" && requestedTeamIds.length) {
    const {data: teamRows, error: teamError} = await admin
      .from("teams")
      .select("id, manager_id")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .in("id", requestedTeamIds);
    if (teamError) go(t("academy.messages.wizardAssignmentFailed", {message: teamError.message}), "error");
    const validTeamIds = (teamRows ?? []).map((row) => String(row.id));
    const managerIds = (teamRows ?? []).map((row) => row.manager_id ? String(row.manager_id) : "").filter(Boolean);
    if (validTeamIds.length) {
      const {data: memberRows, error: memberError} = await admin.from("team_members").select("user_id").in("team_id", validTeamIds);
      if (memberError) go(t("academy.messages.wizardAssignmentFailed", {message: memberError.message}), "error");
      assignedUserIds = [...managerIds, ...(memberRows ?? []).map((row) => String(row.user_id))];
    }
  }

  assignedUserIds = [...new Set(assignedUserIds)].filter((userId) => visibleUserIds.includes(userId));

  const {data, error} = await admin.rpc("academy_create_course_bundle_v2_2_4", {
    p_organization_id: membership.organization_id,
    p_actor_id: user.id,
    p_course: {
      title,
      description,
      category,
      growth_program_code: growthProgramCode,
      training_month: trainingMonth,
      deadline,
      duration_minutes: durationMinutes,
      is_required: isRequired,
      passing_score: passingScore,
      max_attempts: maxAttempts,
      attendance_required_percent: attendanceRequiredPercent,
      certificate_enabled: certificateEnabled,
      resource_url: resourceUrl ?? "",
    },
    p_schedules: schedules,
    p_questions: questions,
    p_user_ids: assignedUserIds,
    p_publish: publish,
  });

  if (error) {
    const message = error.message.includes("ACADEMY_WIZARD_QUIZ_REQUIRED")
      ? t("academy.messages.quizRequiredBeforePublish")
      : error.message.includes("ACADEMY_WIZARD_PERMISSION_DENIED")
        ? t("academy.messages.permissionDenied")
        : error.message.includes("academy_create_course_bundle_v2_2_4") || error.code === "PGRST202"
          ? t("academy.messages.wizardMigrationRequired")
          : t("academy.messages.wizardCreateFailed", {message: error.message});
    go(message, "error");
  }

  const result = (data ?? {}) as {
    course_id?: string;
    questions_created?: number;
    schedules_created?: number;
    sessions_created?: number;
    enrollments_created?: number;
    published?: boolean;
  };
  const courseId = String(result.course_id ?? "");
  if (!courseId) go(t("academy.messages.wizardCreateFailed", {message: "Missing course id"}), "error");

  if (publish) {
    await Promise.allSettled(assignedUserIds.map((userId) => createNotification({
      organizationId: membership.organization_id,
      userId,
      actorId: user.id,
      category: "performance",
      eventType: "academy_course_assigned",
      titleFr: "Nouvelle formation assignée",
      titleEn: "New training assigned",
      bodyFr: `${title} doit être terminée avant le ${deadline}.`,
      bodyEn: `${title} must be completed by ${deadline}.`,
      actionUrl: `/dashboard/academy?course=${courseId}`,
      priority: isRequired ? "warning" : "info",
      requiresAction: isRequired,
      dedupeKey: `academy-assigned-${courseId}-${userId}`,
    })));
  }

  await audit({
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "academy_course",
    entityId: courseId,
    action: "wizard_created",
    details: {
      title,
      published: publish,
      questions: result.questions_created ?? questions.length,
      schedules: result.schedules_created ?? schedules.length,
      sessions: result.sessions_created ?? totalSessions,
      enrollments: result.enrollments_created ?? assignedUserIds.length,
      assignment_scope: assignmentScope,
    },
  });

  revalidatePath("/dashboard/academy");
  revalidatePath("/dashboard/my-day");
  go(
    publish
      ? t("academy.messages.wizardPublished", {sessions: result.sessions_created ?? totalSessions, participants: result.enrollments_created ?? assignedUserIds.length})
      : t("academy.messages.wizardDraftCreated", {sessions: result.sessions_created ?? totalSessions}),
    "success",
    courseId,
  );
}

export async function updateAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");

  const courseId = cleanText(formData.get("courseId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course) go(t("academy.messages.courseNotFound"), "error");

  const title = cleanText(formData.get("title"), 180);
  const description = cleanText(formData.get("description"), 5000);
  const category = cleanText(formData.get("category"), 80) || "professional_development";
  const growthProgramCodeRaw = cleanText(formData.get("growthProgramCode"), 60) || "other_training";
  const growthProgramCode = academyGrowthPrograms.has(growthProgramCodeRaw) ? growthProgramCodeRaw : "other_training";
  const trainingMonth = normalizeMonth(formData.get("trainingMonth"));
  const deadline = normalizeDate(formData.get("deadline"));
  const durationMinutes = parseInteger(formData.get("durationMinutes"));
  const passingScore = parseNumber(formData.get("passingScore"));
  const maxAttempts = parseInteger(formData.get("maxAttempts"));
  const attendanceRequiredPercent = parseNumber(formData.get("attendanceRequiredPercent"), 80);
  const resourceUrl = cleanText(formData.get("resourceUrl"), 1000) || null;
  const isRequired = formData.get("isRequired") === "on";
  const certificateEnabled = formData.get("certificateEnabled") === "on";

  if (
    title.length < 3 ||
    !trainingMonth ||
    !deadline ||
    deadline < trainingMonth ||
    !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080 ||
    !Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100 ||
    !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 ||
    !Number.isFinite(attendanceRequiredPercent) || attendanceRequiredPercent < 0 || attendanceRequiredPercent > 100
  ) {
    go(t("academy.messages.invalidCourse"), "error", courseId);
  }

  const {error} = await admin.from("academy_courses").update({
    title,
    description,
    category,
    growth_program_code: growthProgramCode,
    training_month: trainingMonth,
    deadline,
    duration_minutes: durationMinutes,
    is_required: isRequired,
    passing_score: passingScore,
    max_attempts: maxAttempts,
    attendance_required_percent: attendanceRequiredPercent,
    certificate_enabled: certificateEnabled,
    resource_url: resourceUrl,
  }).eq("id", courseId).eq("organization_id", membership.organization_id);

  if (error) go(t("academy.messages.courseUpdateFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_course", entityId: courseId, action: "updated"});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.courseUpdated"), "success", courseId);
}

export async function addAcademyQuestionAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course) go(t("academy.messages.courseNotFound"), "error");

  const questionText = cleanText(formData.get("questionText"), 1000);
  const options = [1, 2, 3, 4]
    .map((index) => cleanText(formData.get(`option${index}`), 500))
    .filter(Boolean);
  const correctOption = parseInteger(formData.get("correctOption"));
  const points = parseNumber(formData.get("points"), 1);

  if (questionText.length < 3 || options.length < 2 || correctOption < 0 || correctOption >= options.length || points <= 0) {
    go(t("academy.messages.invalidQuestion"), "error", courseId);
  }

  const {data: lastQuestion} = await admin
    .from("academy_quiz_questions")
    .select("position")
    .eq("course_id", courseId)
    .order("position", {ascending: false})
    .limit(1)
    .maybeSingle<{position: number}>();

  const {error} = await admin.from("academy_quiz_questions").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    question_text: questionText,
    options,
    correct_option: correctOption,
    points,
    position: (lastQuestion?.position ?? 0) + 1,
  });
  if (error) go(t("academy.messages.questionCreateFailed", {message: error.message}), "error", courseId);

  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_question", action: "created", details: {course_id: courseId}});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.questionCreated"), "success", courseId);
}

export async function deleteAcademyQuestionAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const questionId = cleanText(formData.get("questionId"), 80);
  const {error} = await admin.from("academy_quiz_questions").delete().eq("id", questionId).eq("course_id", courseId).eq("organization_id", membership.organization_id);
  if (error) go(t("academy.messages.questionDeleteFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_question", entityId: questionId, action: "deleted"});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.questionDeleted"), "success", courseId);
}

export async function publishAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course) go(t("academy.messages.courseNotFound"), "error");

  const {count, error: countError} = await admin
    .from("academy_quiz_questions")
    .select("id", {count: "exact", head: true})
    .eq("course_id", courseId);
  if (countError) go(t("academy.messages.coursePublishFailed", {message: countError.message}), "error", courseId);
  if (course.certificate_enabled && !count) go(t("academy.messages.quizRequiredBeforePublish"), "error", courseId);

  const now = new Date().toISOString();
  const {error} = await admin.from("academy_courses").update({status: "published", published_by: user.id, published_at: now}).eq("id", courseId).eq("organization_id", membership.organization_id);
  if (error) go(t("academy.messages.coursePublishFailed", {message: error.message}), "error", courseId);
  const {data: assignedRows} = await admin.from("academy_enrollments").select("user_id").eq("organization_id", membership.organization_id).eq("course_id", courseId);
  await Promise.allSettled((assignedRows ?? []).map((row) => createNotification({
    organizationId: membership.organization_id,
    userId: String(row.user_id),
    actorId: user.id,
    category: "performance",
    eventType: "academy_course_assigned",
    titleFr: "Nouvelle formation assignée",
    titleEn: "New training assigned",
    bodyFr: `${course.title} doit être terminée avant le ${course.deadline}.`,
    bodyEn: `${course.title} must be completed by ${course.deadline}.`,
    actionUrl: `/dashboard/academy?course=${courseId}`,
    priority: course.is_required ? "warning" : "info",
    requiresAction: course.is_required,
    dedupeKey: `academy-assigned-${courseId}-${String(row.user_id)}`,
  })));
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_course", entityId: courseId, action: "published"});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.coursePublished"), "success", courseId);
}

export async function archiveAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const {error} = await admin.from("academy_courses").update({status: "archived"}).eq("id", courseId).eq("organization_id", membership.organization_id);
  if (error) go(t("academy.messages.courseArchiveFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_course", entityId: courseId, action: "archived"});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.courseArchived"), "success", courseId);
}

export async function assignAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await context();
  if (!academyAssignmentRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const userId = cleanText(formData.get("userId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course || course.status !== "published") go(t("academy.messages.courseNotPublished"), "error", courseId);
  if (!visibleUserIds.includes(userId)) go(t("academy.messages.outOfScope"), "error", courseId);

  const {data: activeMember} = await admin.from("organization_members").select("user_id").eq("organization_id", membership.organization_id).eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (!activeMember) go(t("academy.messages.memberNotFound"), "error", courseId);

  const {data: existingEnrollment, error: existingEnrollmentError} = await admin
    .from("academy_enrollments")
    .select("id, status")
    .eq("organization_id", membership.organization_id)
    .eq("course_id", courseId)
    .eq("user_id", userId)
    .maybeSingle<{id: string; status: string}>();
  if (existingEnrollmentError) go(t("academy.messages.assignmentFailed", {message: existingEnrollmentError.message}), "error", courseId);
  if (existingEnrollment) go(t("academy.messages.courseAlreadyAssigned"), "success", courseId);

  const {error} = await admin.from("academy_enrollments").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    user_id: userId,
    status: "assigned",
    progress_percent: 0,
    assigned_by: user.id,
    assigned_at: new Date().toISOString(),
  });
  if (error) go(t("academy.messages.assignmentFailed", {message: error.message}), "error", courseId);

  await createNotification({
    organizationId: membership.organization_id,
    userId,
    actorId: user.id,
    category: "performance",
    eventType: "academy_course_assigned",
    titleFr: "Nouvelle formation assignée",
    titleEn: "New training assigned",
    bodyFr: `${course.title} doit être terminée avant le ${course.deadline}.`,
    bodyEn: `${course.title} must be completed by ${course.deadline}.`,
    actionUrl: `/dashboard/academy?course=${courseId}`,
    priority: course.is_required ? "warning" : "info",
    requiresAction: course.is_required,
    dedupeKey: `academy-assigned-${courseId}-${userId}`,
  });

  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: userId, entityType: "academy_enrollment", action: "assigned", details: {course_id: courseId}});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.courseAssigned"), "success", courseId);
}

export async function selfEnrollAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  const courseId = cleanText(formData.get("courseId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course || course.status !== "published") go(t("academy.messages.courseNotPublished"), "error", courseId);

  const {data: existingEnrollment, error: existingEnrollmentError} = await admin
    .from("academy_enrollments")
    .select("id, status")
    .eq("organization_id", membership.organization_id)
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<{id: string; status: string}>();
  if (existingEnrollmentError) go(t("academy.messages.assignmentFailed", {message: existingEnrollmentError.message}), "error", courseId);
  if (existingEnrollment) go(t("academy.messages.selfAlreadyEnrolled"), "success", courseId);

  const {error} = await admin.from("academy_enrollments").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    user_id: user.id,
    status: "assigned",
    progress_percent: 0,
    assigned_by: user.id,
    assigned_at: new Date().toISOString(),
  });
  if (error) go(t("academy.messages.assignmentFailed", {message: error.message}), "error", courseId);
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.selfEnrolled"), "success", courseId);
}

export async function startAcademyCourseAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  const enrollmentId = cleanText(formData.get("enrollmentId"), 80);
  const courseId = cleanText(formData.get("courseId"), 80);
  const {data: startedEnrollment, error} = await admin.from("academy_enrollments").update({
    status: "in_progress",
    progress_percent: 25,
    started_at: new Date().toISOString(),
  }).eq("id", enrollmentId).eq("course_id", courseId).eq("user_id", user.id).eq("organization_id", membership.organization_id).in("status", ["assigned", "failed"]).select("id").maybeSingle<{id: string}>();
  if (error) go(t("academy.messages.startFailed", {message: error.message}), "error", courseId);
  if (!startedEnrollment) {
    const {data: existingEnrollment} = await admin.from("academy_enrollments").select("status").eq("id", enrollmentId).eq("course_id", courseId).eq("user_id", user.id).eq("organization_id", membership.organization_id).maybeSingle<{status: string}>();
    if (existingEnrollment && ["in_progress", "completed"].includes(existingEnrollment.status)) go(t("academy.messages.courseAlreadyStarted"), "success", courseId);
    go(t("academy.messages.enrollmentNotFound"), "error", courseId);
  }
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.courseStarted"), "success", courseId);
}

async function createCertificate({
  enrollment,
  course,
  userId,
  score,
}: {
  enrollment: EnrollmentRow;
  course: CourseRow;
  userId: string;
  score: number | null;
}) {
  const admin = createAdminClient();
  if (score == null || Number(score) < Number(course.passing_score)) {
    throw new Error("Quiz pass mark has not been reached.");
  }
  const attendanceRequired = Number(course.attendance_required_percent);
  if (attendanceRequired > 0) {
    const attendance = await getAttendanceSnapshot({
      admin,
      organizationId: enrollment.organization_id,
      courseId: course.id,
      enrollmentId: enrollment.id,
    });
    if (!attendance.totalSessions || !attendance.allSessionsFinished || attendance.percent < attendanceRequired) {
      throw new Error("Attendance and session completion requirements have not been met.");
    }
  }
  const {data: existing} = await admin.from("academy_certificates").select("id").eq("enrollment_id", enrollment.id).maybeSingle<{id: string}>();
  if (existing) return existing.id;

  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const certificateNumber = `SLA-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const {data, error} = await admin.from("academy_certificates").insert({
    organization_id: enrollment.organization_id,
    course_id: course.id,
    enrollment_id: enrollment.id,
    user_id: userId,
    certificate_number: certificateNumber,
    final_score: score,
    issued_by: userId,
    status: "active",
  }).select("id").single<{id: string}>();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function submitAcademyQuizAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  const courseId = cleanText(formData.get("courseId"), 80);
  const enrollmentId = cleanText(formData.get("enrollmentId"), 80);

  const [course, enrollmentResult, questionsResult] = await Promise.all([
    loadCourse(courseId, membership.organization_id),
    admin.from("academy_enrollments").select("id, organization_id, course_id, user_id, status, attempts_count, best_score, attendance_percent, sessions_expected, sessions_attended, quiz_passed_at").eq("id", enrollmentId).eq("course_id", courseId).eq("user_id", user.id).eq("organization_id", membership.organization_id).maybeSingle<EnrollmentRow>(),
    admin.from("academy_quiz_questions").select("id, question_text, options, correct_option, points").eq("course_id", courseId).eq("organization_id", membership.organization_id).order("position"),
  ]);

  const enrollment = enrollmentResult.data;
  const questions = (questionsResult.data ?? []) as QuestionRow[];
  if (!course || course.status !== "published" || !enrollment) go(t("academy.messages.enrollmentNotFound"), "error", courseId);
  if (enrollment.status === "completed") go(t("academy.messages.alreadyCompleted"), "error", courseId);
  if (Number(enrollment.best_score ?? 0) >= Number(course.passing_score)) go(t("academy.messages.quizAlreadyPassed"), "error", courseId);
  if (!questions.length) go(t("academy.messages.quizMissing"), "error", courseId);
  if (enrollment.attempts_count >= course.max_attempts) go(t("academy.messages.noAttemptsLeft"), "error", courseId);

  let attendance = {totalSessions: 0, finishedSessions: 0, allSessionsFinished: false, expected: 0, attended: 0, percent: 0, nextSessionEndsAt: null as string | null};
  try {
    attendance = await getAttendanceSnapshot({admin, organizationId: membership.organization_id, courseId, enrollmentId});
  } catch (snapshotError) {
    go(t("academy.messages.quizSaveFailed", {message: snapshotError instanceof Error ? snapshotError.message : ""}), "error", courseId);
  }
  const attendanceRequired = Number(course.attendance_required_percent);
  if (attendanceRequired > 0 && attendance.totalSessions === 0) go(t("academy.messages.quizLockedNoSessions"), "error", courseId);
  if (attendanceRequired > 0 && !attendance.allSessionsFinished) {
    go(t("academy.messages.quizLockedSessionsPending", {date: attendance.nextSessionEndsAt ? new Intl.DateTimeFormat("fr-FR", {dateStyle: "medium"}).format(new Date(attendance.nextSessionEndsAt)) : "—"}), "error", courseId);
  }
  if (attendanceRequired > 0 && attendance.percent < attendanceRequired) {
    go(t("academy.messages.quizLockedAttendance", {attendance: attendance.percent, required: attendanceRequired}), "error", courseId);
  }

  let earned = 0;
  let total = 0;
  const answers: Record<string, number | null> = {};
  for (const question of questions) {
    const answerRaw = String(formData.get(`question_${question.id}`) ?? "");
    const answer = /^\d+$/.test(answerRaw) ? Number(answerRaw) : null;
    answers[question.id] = answer;
    const points = Number(question.points) || 1;
    total += points;
    if (answer === question.correct_option) earned += points;
  }

  const score = total > 0 ? Math.round((earned / total) * 10000) / 100 : 0;
  const passed = score >= Number(course.passing_score);
  const attemptsCount = enrollment.attempts_count + 1;
  const bestScore = Math.max(Number(enrollment.best_score ?? 0), score);
  const now = new Date().toISOString();

  const {error: attemptError} = await admin.from("academy_quiz_attempts").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    enrollment_id: enrollmentId,
    user_id: user.id,
    answers,
    score,
    passed,
    attempted_at: now,
  });
  if (attemptError) go(t("academy.messages.quizSaveFailed", {message: attemptError.message}), "error", courseId);

  const attendanceEligible = Number(course.attendance_required_percent) <= 0 || (attendance.allSessionsFinished && attendance.percent >= Number(course.attendance_required_percent));
  const completed = passed && attendanceEligible;
  const nextStatus = completed ? "completed" : passed ? "in_progress" : attemptsCount >= course.max_attempts ? "failed" : "in_progress";
  const progressPercent = completed ? 100 : Math.min(99, Math.round((passed ? 40 : 0) + attendance.percent * 0.6));
  const {error: enrollmentError} = await admin.from("academy_enrollments").update({
    status: nextStatus,
    progress_percent: progressPercent,
    attempts_count: attemptsCount,
    best_score: bestScore,
    quiz_passed_at: passed ? now : enrollment.quiz_passed_at,
    attendance_percent: attendance.percent,
    sessions_expected: attendance.expected,
    sessions_attended: attendance.attended,
    completed_at: completed ? now : null,
    started_at: now,
  }).eq("id", enrollmentId).eq("user_id", user.id);
  if (enrollmentError) go(t("academy.messages.quizSaveFailed", {message: enrollmentError.message}), "error", courseId);

  let certificateId: string | null = null;
  if (completed && course.certificate_enabled) {
    try {
      certificateId = await createCertificate({enrollment: {...enrollment, attempts_count: attemptsCount, best_score: bestScore, status: nextStatus, attendance_percent: attendance.percent, sessions_expected: attendance.expected, sessions_attended: attendance.attended, quiz_passed_at: now}, course, userId: user.id, score});
    } catch (error) {
      console.error("Certificate creation failed", error);
    }
  }

  await createNotification({
    organizationId: membership.organization_id,
    userId: user.id,
    actorId: user.id,
    category: "performance",
    eventType: completed ? "academy_course_completed" : passed ? "academy_quiz_passed_attendance_pending" : "academy_quiz_failed",
    titleFr: completed ? "Formation terminée" : passed ? "Quiz réussi - présence à compléter" : "Quiz à reprendre",
    titleEn: completed ? "Training completed" : passed ? "Quiz passed - attendance pending" : "Quiz needs another attempt",
    bodyFr: completed ? `${course.title} est terminée avec ${score} %.` : passed ? `Quiz réussi avec ${score} %. La présence est de ${attendance.percent} % sur ${course.attendance_required_percent} % requis.` : `Résultat : ${score} %. Le seuil est ${course.passing_score} %.`,
    bodyEn: completed ? `${course.title} was completed with ${score}%.` : passed ? `Quiz passed with ${score}%. Attendance is ${attendance.percent}% of the required ${course.attendance_required_percent}%.` : `Result: ${score}%. The pass mark is ${course.passing_score}%.`,
    actionUrl: certificateId ? `/dashboard/academy/certificate/${certificateId}` : `/dashboard/academy?course=${courseId}`,
    priority: completed ? "success" : "warning",
    requiresAction: !completed,
    dedupeKey: completed ? `academy-completed-${enrollmentId}` : null,
  });

  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: user.id, entityType: "academy_quiz_attempt", action: completed ? "completed" : passed ? "quiz_passed_attendance_pending" : "failed", details: {course_id: courseId, score, attempt: attemptsCount}});
  revalidatePath("/dashboard/academy");
  revalidatePath("/dashboard/performance");
  go(completed ? t("academy.messages.quizPassed", {score}) : passed ? t("academy.messages.quizPassedAttendancePending", {score, attendance: attendance.percent, required: course.attendance_required_percent}) : t("academy.messages.quizFailed", {score, passingScore: course.passing_score}), passed ? "success" : "error", courseId);
}


export async function createAcademyScheduleAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course) go(t("academy.messages.courseNotFound"), "error");

  const label = cleanText(formData.get("label"), 180);
  const scheduleType = cleanText(formData.get("scheduleType"), 40);
  const startsOn = normalizeDate(formData.get("startsOn"));
  const endsOn = normalizeDate(formData.get("endsOn"));
  const startTime = normalizeTime(formData.get("startTime"));
  const durationMinutes = parseInteger(formData.get("sessionDurationMinutes"));
  const timezone = normalizeTimeZone(cleanText(formData.get("timezone"), 100));
  const weekdays = formData.getAll("weekdays").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);
  const monthlyStartDay = parseInteger(formData.get("monthlyStartDay"), 1);
  const consecutiveDays = parseInteger(formData.get("consecutiveDays"), 3);
  const zoomJoinUrl = cleanText(formData.get("zoomJoinUrl"), 1000) || null;

  if (
    label.length < 3 || !["weekly", "monthly_intensive", "single"].includes(scheduleType) ||
    !startsOn || !endsOn || endsOn < startsOn || !startTime ||
    !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440 ||
    (scheduleType === "weekly" && !weekdays.length) ||
    (scheduleType === "monthly_intensive" && (monthlyStartDay < 1 || monthlyStartDay > 28 || consecutiveDays < 1 || consecutiveDays > 14))
  ) go(t("academy.messages.invalidSchedule"), "error", courseId);

  const dates = generateSessionDates({scheduleType, startsOn, endsOn, weekdays, monthlyStartDay, consecutiveDays});
  if (!dates.length || dates.length > 500) go(t("academy.messages.invalidSchedule"), "error", courseId);

  const generatedStarts = dates.map((date) => zonedDateTimeToUtc(date, startTime, timezone).toISOString());
  const [duplicateScheduleResult, conflictingSessionsResult] = await Promise.all([
    admin
      .from("academy_course_schedules")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .eq("course_id", courseId)
      .eq("label", label)
      .eq("schedule_type", scheduleType)
      .eq("starts_on", startsOn)
      .eq("ends_on", endsOn)
      .eq("local_start_time", startTime)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<{id: string}>(),
    admin
      .from("academy_sessions")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .eq("course_id", courseId)
      .in("starts_at", generatedStarts)
      .limit(1),
  ]);
  if (duplicateScheduleResult.error) go(t("academy.messages.scheduleCreateFailed", {message: duplicateScheduleResult.error.message}), "error", courseId);
  if (conflictingSessionsResult.error) go(t("academy.messages.scheduleCreateFailed", {message: conflictingSessionsResult.error.message}), "error", courseId);
  if (duplicateScheduleResult.data) go(t("academy.messages.scheduleDuplicate"), "error", courseId);
  if ((conflictingSessionsResult.data ?? []).length) go(t("academy.messages.scheduleConflict"), "error", courseId);

  const {data: schedule, error: scheduleError} = await admin.from("academy_course_schedules").insert({
    organization_id: membership.organization_id,
    course_id: courseId,
    label,
    schedule_type: scheduleType,
    starts_on: startsOn,
    ends_on: endsOn,
    local_start_time: startTime,
    duration_minutes: durationMinutes,
    timezone,
    weekdays,
    monthly_start_day: scheduleType === "monthly_intensive" ? monthlyStartDay : null,
    consecutive_days: scheduleType === "monthly_intensive" ? consecutiveDays : null,
    zoom_join_url: zoomJoinUrl,
    created_by: user.id,
  }).select("id").single<{id: string}>();
  if (scheduleError || !schedule) go(t("academy.messages.scheduleCreateFailed", {message: scheduleError?.message ?? ""}), "error", courseId);

  const sessions = dates.map((date, index) => {
    const startsAt = zonedDateTimeToUtc(date, startTime, timezone);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    return {
      organization_id: membership.organization_id,
      course_id: courseId,
      schedule_id: schedule.id,
      title: scheduleType === "monthly_intensive" ? `${label} - Jour ${((Number(date.slice(8, 10)) - monthlyStartDay) % consecutiveDays) + 1}` : label,
      session_date: date,
      local_start_time: startTime,
      timezone,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      delivery_mode: zoomJoinUrl ? "zoom" : "other",
      zoom_join_url: zoomJoinUrl,
      status: "scheduled",
      created_by: user.id,
      _position: index,
    };
  }).map(({_position, ...row}) => row);

  const {error: sessionsError} = await admin.from("academy_sessions").upsert(sessions, {onConflict: "course_id,starts_at", ignoreDuplicates: true});
  if (sessionsError) {
    await admin.from("academy_course_schedules").delete().eq("id", schedule.id);
    go(t("academy.messages.scheduleCreateFailed", {message: sessionsError.message}), "error", courseId);
  }

  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_schedule", entityId: schedule.id, action: "created", details: {course_id: courseId, schedule_type: scheduleType, sessions: dates.length}});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.scheduleCreated", {count: dates.length}), "success", courseId);
}


function academyScheduleInput(formData: FormData) {
  const label = cleanText(formData.get("label"), 180);
  const scheduleType = cleanText(formData.get("scheduleType"), 40);
  const startsOn = normalizeDate(formData.get("startsOn"));
  const endsOn = normalizeDate(formData.get("endsOn"));
  const startTime = normalizeTime(formData.get("startTime"));
  const durationMinutes = parseInteger(formData.get("sessionDurationMinutes"));
  const timezone = normalizeTimeZone(cleanText(formData.get("timezone"), 100));
  const weekdays = formData.getAll("weekdays").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);
  const monthlyStartDay = parseInteger(formData.get("monthlyStartDay"), 1);
  const consecutiveDays = parseInteger(formData.get("consecutiveDays"), 3);
  const zoomJoinUrl = cleanText(formData.get("zoomJoinUrl"), 1000) || null;
  const reason = cleanText(formData.get("reason"), 500) || null;
  const valid = Boolean(
    label.length >= 3 && ["weekly", "monthly_intensive", "single"].includes(scheduleType) &&
    startsOn && endsOn && endsOn >= startsOn && startTime &&
    Number.isInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 1440 &&
    (scheduleType !== "weekly" || weekdays.length > 0) &&
    (scheduleType !== "monthly_intensive" || (monthlyStartDay >= 1 && monthlyStartDay <= 28 && consecutiveDays >= 1 && consecutiveDays <= 14))
  );
  return {label, scheduleType, startsOn, endsOn, startTime, durationMinutes, timezone, weekdays, monthlyStartDay, consecutiveDays, zoomJoinUrl, reason, valid};
}

function academySessionPayload(input: ReturnType<typeof academyScheduleInput>) {
  const dates = generateSessionDates({
    scheduleType: input.scheduleType,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    weekdays: input.weekdays,
    monthlyStartDay: input.monthlyStartDay,
    consecutiveDays: input.consecutiveDays,
  });
  const sessions = dates.map((date) => {
    const startsAt = zonedDateTimeToUtc(date, input.startTime, input.timezone);
    const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
    const dayNumber = ((Number(date.slice(8, 10)) - input.monthlyStartDay) % input.consecutiveDays) + 1;
    return {
      title: input.scheduleType === "monthly_intensive" ? `${input.label} - Jour ${dayNumber}` : input.label,
      session_date: date,
      local_start_time: input.startTime,
      timezone: input.timezone,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      delivery_mode: input.zoomJoinUrl ? "zoom" : "other",
      zoom_join_url: input.zoomJoinUrl,
    };
  });
  return {dates, sessions};
}

export async function updateAcademyScheduleAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const scheduleId = cleanText(formData.get("scheduleId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  const schedule = scheduleId ? await loadSchedule(scheduleId, courseId, membership.organization_id) : null;
  if (!course || !schedule) go(t("academy.messages.courseNotFound"), "error");

  const input = academyScheduleInput(formData);
  if (!input.valid) go(t("academy.messages.invalidSchedule"), "error", courseId);
  const {dates, sessions} = academySessionPayload(input);
  if (!dates.length || dates.length > 500) go(t("academy.messages.invalidSchedule"), "error", courseId);

  const {data, error} = await admin.rpc("academy_replace_schedule_v2_2_2", {
    p_organization_id: membership.organization_id,
    p_schedule_id: scheduleId,
    p_actor_id: user.id,
    p_schedule: {
      label: input.label,
      schedule_type: input.scheduleType,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      local_start_time: input.startTime,
      duration_minutes: input.durationMinutes,
      timezone: input.timezone,
      weekdays: input.scheduleType === "weekly" ? input.weekdays : [],
      monthly_start_day: input.scheduleType === "monthly_intensive" ? input.monthlyStartDay : "",
      consecutive_days: input.scheduleType === "monthly_intensive" ? input.consecutiveDays : "",
      zoom_join_url: input.zoomJoinUrl ?? "",
    },
    p_sessions: sessions,
    p_reason: input.reason,
  });
  if (error) {
    const translated = error.message.includes("ACADEMY_SCHEDULE_SESSION_CONFLICT")
      ? t("academy.messages.scheduleConflict")
      : error.message.includes("ACADEMY_SCHEDULE_ARCHIVED")
        ? t("academy.messages.scheduleArchivedEditDenied")
        : t("academy.messages.scheduleUpdateFailed", {message: error.message});
    go(translated, "error", courseId);
  }

  const result = (data ?? {}) as {sessions_created?: number; sessions_removed?: number};
  await audit({
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "academy_schedule",
    entityId: scheduleId,
    action: "updated",
    details: {course_id: courseId, sessions_created: result.sessions_created ?? 0, sessions_removed: result.sessions_removed ?? 0, reason: input.reason},
  });
  revalidatePath("/dashboard/academy");
  revalidatePath("/dashboard/my-day");
  go(t("academy.messages.scheduleUpdated", {created: result.sessions_created ?? 0, removed: result.sessions_removed ?? 0}), "success", courseId);
}

export async function archiveAcademyScheduleAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const scheduleId = cleanText(formData.get("scheduleId"), 80);
  const reason = cleanText(formData.get("reason"), 500);
  if (!courseId || !scheduleId || reason.length < 3) go(t("academy.messages.scheduleReasonRequired"), "error", courseId);
  const schedule = await loadSchedule(scheduleId, courseId, membership.organization_id);
  if (!schedule) go(t("academy.messages.courseNotFound"), "error", courseId);
  const {data, error} = await admin.rpc("academy_set_schedule_active_v2_2_2", {
    p_organization_id: membership.organization_id,
    p_schedule_id: scheduleId,
    p_actor_id: user.id,
    p_active: false,
    p_reason: reason,
  });
  if (error) go(t("academy.messages.scheduleArchiveFailed", {message: error.message}), "error", courseId);
  const result = (data ?? {}) as {sessions_cancelled?: number};
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_schedule", entityId: scheduleId, action: "archived", details: {course_id: courseId, reason, sessions_cancelled: result.sessions_cancelled ?? 0}});
  revalidatePath("/dashboard/academy");
  revalidatePath("/dashboard/my-day");
  go(t("academy.messages.scheduleArchived", {count: result.sessions_cancelled ?? 0}), "success", courseId);
}

export async function restoreAcademyScheduleAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const scheduleId = cleanText(formData.get("scheduleId"), 80);
  if (!courseId || !scheduleId) go(t("academy.messages.invalidSchedule"), "error", courseId);
  const schedule = await loadSchedule(scheduleId, courseId, membership.organization_id);
  if (!schedule) go(t("academy.messages.courseNotFound"), "error", courseId);
  const {error} = await admin.rpc("academy_set_schedule_active_v2_2_2", {
    p_organization_id: membership.organization_id,
    p_schedule_id: scheduleId,
    p_actor_id: user.id,
    p_active: true,
    p_reason: cleanText(formData.get("reason"), 500) || null,
  });
  if (error) go(t("academy.messages.scheduleRestoreFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_schedule", entityId: scheduleId, action: "restored", details: {course_id: courseId}});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.scheduleRestored"), "success", courseId);
}

export async function repairAcademyCourseSessionsAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const course = await loadCourse(courseId, membership.organization_id);
  if (!course) go(t("academy.messages.courseNotFound"), "error", courseId);

  const {data, error} = await admin.rpc("academy_repair_course_sessions_v2_2_3", {
    p_organization_id: membership.organization_id,
    p_course_id: courseId,
    p_actor_id: user.id,
  });
  if (error) go(t("academy.messages.sessionRepairFailed", {message: error.message}), "error", courseId);
  const result = (data ?? {}) as {sessions_created?: number; attendance_rows_created?: number};
  await audit({
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "academy_course",
    entityId: courseId,
    action: "sessions_repaired",
    details: {sessions_created: result.sessions_created ?? 0, attendance_rows_created: result.attendance_rows_created ?? 0},
  });
  revalidatePath("/dashboard/academy");
  revalidatePath("/dashboard/my-day");
  go(t("academy.messages.sessionsRepaired", {count: result.sessions_created ?? 0}), "success", courseId);
}

export async function cancelAcademySessionAction(formData: FormData) {
  const {user, membership, admin, t} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const sessionId = cleanText(formData.get("sessionId"), 80);
  const {error} = await admin.from("academy_sessions").update({status: "cancelled"}).eq("id", sessionId).eq("course_id", courseId).eq("organization_id", membership.organization_id);
  if (error) go(t("academy.messages.sessionUpdateFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "academy_session", entityId: sessionId, action: "cancelled", details: {course_id: courseId}});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.sessionCancelled"), "success", courseId);
}

export async function markAcademySessionAttendanceAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await context();
  if (!academyAssignmentRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const sessionId = cleanText(formData.get("sessionId"), 80);
  const enrollmentId = cleanText(formData.get("enrollmentId"), 80);
  const status = cleanText(formData.get("status"), 20);
  const notes = cleanText(formData.get("notes"), 1000) || null;
  if (!["invited", "present", "late", "absent", "excused"].includes(status)) go(t("academy.messages.invalidAttendance"), "error", courseId);

  const [sessionResult, enrollmentResult] = await Promise.all([
    admin.from("academy_sessions").select("id, course_id").eq("id", sessionId).eq("course_id", courseId).eq("organization_id", membership.organization_id).maybeSingle<{id: string; course_id: string}>(),
    admin.from("academy_enrollments").select("id, organization_id, course_id, user_id, status, attempts_count, best_score, attendance_percent, sessions_expected, sessions_attended, quiz_passed_at").eq("id", enrollmentId).eq("course_id", courseId).eq("organization_id", membership.organization_id).maybeSingle<EnrollmentRow>(),
  ]);
  const enrollment = enrollmentResult.data;
  if (!sessionResult.data || !enrollment || !visibleUserIds.includes(enrollment.user_id)) go(t("academy.messages.outOfScope"), "error", courseId);

  const now = new Date().toISOString();
  const {error: attendanceError} = await admin.from("academy_session_attendance").upsert({
    organization_id: membership.organization_id,
    session_id: sessionId,
    enrollment_id: enrollmentId,
    user_id: enrollment.user_id,
    status,
    notes,
    marked_by: user.id,
    marked_at: now,
  }, {onConflict: "session_id,user_id"});
  if (attendanceError) go(t("academy.messages.attendanceSaveFailed", {message: attendanceError.message}), "error", courseId);

  const course = await loadCourse(courseId, membership.organization_id);
  if (!course) go(t("academy.messages.courseNotFound"), "error", courseId);
  const attendance = await getAttendanceSnapshot({admin, organizationId: membership.organization_id, courseId, enrollmentId});
  const quizPassed = Number(enrollment.best_score ?? 0) >= Number(course.passing_score);
  const attendanceEligible = Number(course.attendance_required_percent) <= 0 || (attendance.allSessionsFinished && attendance.percent >= Number(course.attendance_required_percent));
  const completed = quizPassed && attendanceEligible;
  const progressPercent = completed ? 100 : Math.min(99, Math.round((quizPassed ? 40 : 0) + attendance.percent * 0.6));
  const {error: enrollmentError} = await admin.from("academy_enrollments").update({
    status: completed ? "completed" : enrollment.status === "completed" ? "completed" : enrollment.status === "assigned" ? "in_progress" : enrollment.status,
    progress_percent: progressPercent,
    attendance_percent: attendance.percent,
    sessions_expected: attendance.expected,
    sessions_attended: attendance.attended,
    completed_at: completed ? now : null,
  }).eq("id", enrollmentId);
  if (enrollmentError) go(t("academy.messages.attendanceSaveFailed", {message: enrollmentError.message}), "error", courseId);

  if (completed && course.certificate_enabled) {
    try {
      await createCertificate({enrollment: {...enrollment, attendance_percent: attendance.percent, sessions_expected: attendance.expected, sessions_attended: attendance.attended, status: "completed"}, course, userId: enrollment.user_id, score: Number(enrollment.best_score)});
      await createNotification({
        organizationId: membership.organization_id,
        userId: enrollment.user_id,
        actorId: user.id,
        category: "performance",
        eventType: "academy_course_completed",
        titleFr: "Formation terminée",
        titleEn: "Training completed",
        bodyFr: `${course.title} est validée : quiz et présence complétés.`,
        bodyEn: `${course.title} is complete: quiz and attendance requirements met.`,
        actionUrl: `/dashboard/academy?course=${courseId}`,
        priority: "success",
        requiresAction: false,
        dedupeKey: `academy-completed-${enrollmentId}`,
      });
    } catch (certificateError) {
      console.error("Certificate creation failed after attendance", certificateError);
    }
  }

  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: enrollment.user_id, entityType: "academy_session_attendance", entityId: sessionId, action: status, details: {course_id: courseId, attendance_percent: attendance.percent}});
  revalidatePath("/dashboard/academy");
  revalidatePath("/dashboard/performance");
  go(t("academy.messages.attendanceSaved"), "success", courseId);
}

export async function exemptAcademyEnrollmentAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await context();
  if (!academyAdminRoles.has(membership.role)) go(t("academy.messages.permissionDenied"), "error");
  const courseId = cleanText(formData.get("courseId"), 80);
  const enrollmentId = cleanText(formData.get("enrollmentId"), 80);
  const reason = cleanText(formData.get("reason"), 1000);
  const {data: enrollment} = await admin.from("academy_enrollments").select("user_id").eq("id", enrollmentId).eq("course_id", courseId).eq("organization_id", membership.organization_id).maybeSingle<{user_id: string}>();
  if (!enrollment || !visibleUserIds.includes(enrollment.user_id) || reason.length < 3) go(t("academy.messages.invalidExemption"), "error", courseId);
  const {error} = await admin.from("academy_enrollments").update({status: "exempted", exempted_reason: reason, progress_percent: 100}).eq("id", enrollmentId);
  if (error) go(t("academy.messages.exemptionFailed", {message: error.message}), "error", courseId);
  await audit({organizationId: membership.organization_id, actorId: user.id, subjectUserId: enrollment.user_id, entityType: "academy_enrollment", entityId: enrollmentId, action: "exempted", details: {reason}});
  revalidatePath("/dashboard/academy");
  go(t("academy.messages.enrollmentExempted"), "success", courseId);
}
