"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {
  academyGlobalRoles,
  getAcademyAssignments,
  hasAssignmentRole,
  schoolAssignments,
} from "@/lib/academy/access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {
  getZoomMeeting,
  listMeetingRegistrants,
  listPastMeetingInstances,
  listPastMeetingParticipants,
  ZoomApiError,
} from "@/lib/zoom/client";
import {
  aggregateZoomParticipants,
  choosePastMeetingInstance,
  classifyAcademyZoomAttendance,
  extractZoomMeetingId,
  formatTimeInZone,
  normalizeAttendanceEmail,
  normalizeZoomMeetingId,
} from "@/lib/zoom/academy-attendance";

const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused", "unmarked"] as const;
const SESSION_TYPES = ["class", "mastermind", "practice", "coaching_call", "review", "assessment", "other"] as const;
const SESSION_STATUSES = ["planned", "open", "closed", "cancelled", "archived"] as const;
const DELIVERY_MODES = ["online", "in_person", "hybrid"] as const;
const RETROACTIVE_SOURCES = ["paper_sheet", "manual_register", "other"] as const;

type SessionScope = {
  id: string;
  school_id: string;
  program_id: string | null;
  cohort_id: string | null;
  session_date: string;
  status: string;
  attendance_entry_mode: string | null;
};

type AttendanceEnrollmentScope = "school_wide" | "program_cohort";

function go(message: string, error = false, sessionId = ""): never {
  const params = new URLSearchParams({[error ? "error" : "success"]: message});
  if (sessionId) params.set("session", sessionId);
  redirect(`/dashboard/academy/attendance?${params.toString()}${sessionId ? `#attendance-${sessionId}` : ""}`);
}

const text = (value: FormDataEntryValue | null, max = 1000) => String(value ?? "").trim().slice(0, max);
const date = (value: FormDataEntryValue | null) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : "";
const nullableId = (value: FormDataEntryValue | null) => text(value, 80) || null;

async function ctx() {
  const supabase = await createClient();
  const {data} = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();

  if (!membership) throw new Error("Action non autorisée.");

  return {
    a: admin,
    user: data.user,
    m: membership,
    assignments: await getAcademyAssignments(admin, membership.organization_id, data.user.id),
  };
}

function assignmentMatchesScope(
  assignment: Awaited<ReturnType<typeof getAcademyAssignments>>[number],
  schoolId: string,
  programId: string | null,
  cohortId: string | null,
) {
  if (assignment.school_id !== schoolId) return false;
  if (assignment.program_id && assignment.program_id !== programId) return false;
  if (assignment.cohort_id && assignment.cohort_id !== cohortId) return false;
  return true;
}

function canManageSession(
  role: string,
  assignments: Awaited<ReturnType<typeof getAcademyAssignments>>,
  schoolId: string,
  programId: string | null,
  cohortId: string | null,
) {
  if (academyGlobalRoles.has(role)) return true;
  if (hasAssignmentRole(assignments, schoolId, ["director", "academic_coordinator"])) return true;
  return assignments.some((assignment) =>
    assignment.assignment_role === "instructor" &&
    assignmentMatchesScope(assignment, schoolId, programId, cohortId),
  );
}

function canTakeAttendance(
  role: string,
  assignments: Awaited<ReturnType<typeof getAcademyAssignments>>,
  schoolId: string,
  programId: string | null,
  cohortId: string | null,
) {
  if (academyGlobalRoles.has(role)) return true;
  if (hasAssignmentRole(assignments, schoolId, ["director", "academic_coordinator"])) return true;
  return assignments.some((assignment) =>
    ["instructor", "follow_up"].includes(assignment.assignment_role) &&
    assignmentMatchesScope(assignment, schoolId, programId, cohortId),
  );
}

function canManageAttendanceSeries(
  role: string,
  assignments: Awaited<ReturnType<typeof getAcademyAssignments>>,
  schoolId: string,
) {
  if (academyGlobalRoles.has(role)) return true;
  return hasAssignmentRole(assignments, schoolId, ["director", "academic_coordinator"]);
}

function weeklySeriesDates(startsOn: string, endsOn: string, weekdays: number[]) {
  const start = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(`${endsOn}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [] as string[];

  const accepted = new Set(weekdays);
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (accepted.has(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (dates.length > 200) break;
  }
  return dates;
}

function monthlySeriesDates(startsOn: string, endsOn: string, weekday: number, ordinal: number) {
  const start = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(`${endsOn}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [] as string[];
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return [] as string[];
  if (![-1, 1, 2, 3, 4].includes(ordinal)) return [] as string[];

  const dates: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const lastMonth = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);

  while (cursor.getTime() <= lastMonth) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    let candidate: Date;

    if (ordinal === -1) {
      candidate = new Date(Date.UTC(year, month + 1, 0));
      const back = (candidate.getUTCDay() - weekday + 7) % 7;
      candidate.setUTCDate(candidate.getUTCDate() - back);
    } else {
      candidate = new Date(Date.UTC(year, month, 1));
      const forward = (weekday - candidate.getUTCDay() + 7) % 7;
      candidate.setUTCDate(1 + forward + (ordinal - 1) * 7);
      if (candidate.getUTCMonth() !== month) {
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        continue;
      }
    }

    if (candidate >= start && candidate <= end) dates.push(candidate.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    if (dates.length > 60) break;
  }
  return dates;
}

function chunks<T>(items: T[], size = 800) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function getAttendanceEnrollmentScope(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  schoolId: string,
): Promise<AttendanceEnrollmentScope> {
  const {data, error} = await admin
    .from("academy_schools")
    .select("attendance_enrollment_scope")
    .eq("id", schoolId)
    .eq("organization_id", organizationId)
    .maybeSingle<{attendance_enrollment_scope: string | null}>();

  if (error) throw new Error(`Impossible de lire la politique d'inscription de l'école : ${error.message}`);
  return data?.attendance_enrollment_scope === "school_wide" ? "school_wide" : "program_cohort";
}

async function getUserLocalDate(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const {data} = await admin
    .from("profiles")
    .select("time_zone")
    .eq("id", userId)
    .maybeSingle<{time_zone: string | null}>();
  const timeZone = String(data?.time_zone || "UTC");
  try {
    return new Intl.DateTimeFormat("en-CA", {timeZone, year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function getEligibleAttendanceEnrollmentIds(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  schoolId: string,
  programId: string | null,
  cohortId: string | null,
) {
  const attendanceEnrollmentScope = await getAttendanceEnrollmentScope(admin, organizationId, schoolId);
  const schoolWideAttendance = attendanceEnrollmentScope === "school_wide";
  let query = admin
    .from("academy_school_enrollments")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("school_id", schoolId)
    .in("academic_status", ["admitted", "enrolled", "active"]);
  if (!schoolWideAttendance && programId) query = query.eq("program_id", programId);
  if (!schoolWideAttendance && cohortId) query = query.eq("cohort_id", cohortId);

  const {data, error} = await query;
  if (error) throw new Error(error.message);
  return {
    schoolWideAttendance,
    enrollmentIds: (data ?? []).map((item) => String(item.id)).filter(Boolean),
  };
}

async function getSessionScope(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  sessionId: string,
) {
  const {data} = await admin
    .from("academy_attendance_sessions")
    .select("id,school_id,program_id,cohort_id,session_date,status,attendance_entry_mode")
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .maybeSingle<SessionScope>();
  return data ?? null;
}

async function assertAttendanceEntryWindow(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  session: SessionScope,
) {
  const today = await getUserLocalDate(admin, userId);
  if (session.session_date < today && !["retroactive", "zoom_sync"].includes(String(session.attendance_entry_mode || "live"))) {
    go("Cette séance est passée. Utilisez « Saisir une présence passée » afin que la correction soit auditée.", true, session.id);
  }
}

function assertEditableAttendanceSession(session: SessionScope) {
  if (session.status === "closed") {
    go("Cet appel est terminé. Réouvre d’abord l’appel avant de modifier la feuille.", true, session.id);
  }
  if (["cancelled", "archived"].includes(session.status)) {
    go("Cette séance est annulée ou archivée et ne peut plus être pointée.", true, session.id);
  }
}

export async function createAttendanceSessionAction(fd: FormData) {
  const schoolId = text(fd.get("school_id"), 80);
  const programId = nullableId(fd.get("program_id"));
  const cohortId = nullableId(fd.get("cohort_id"));
  const title = text(fd.get("title"), 200);
  const sessionDate = date(fd.get("session_date"));
  const trainer = nullableId(fd.get("trainer_user_id"));
  const sessionType = text(fd.get("session_type"), 30) || "class";
  const deliveryMode = text(fd.get("delivery_mode"), 20) || "online";
  const {a, user, m, assignments} = await ctx();

  if (!canManageSession(m.role, assignments, schoolId, programId, cohortId)) {
    throw new Error("Création non autorisée.");
  }
  if (!title || !sessionDate) go("Titre et date obligatoires.", true);
  const today = await getUserLocalDate(a, user.id);
  if (sessionDate < today) go("Pour une date passée, utilisez la fonction « Saisir une présence passée » afin de conserver une trace d’audit.", true);
  if (!SESSION_TYPES.includes(sessionType as (typeof SESSION_TYPES)[number])) go("Type de séance invalide.", true);
  if (!DELIVERY_MODES.includes(deliveryMode as (typeof DELIVERY_MODES)[number])) go("Mode de séance invalide.", true);

  const ownInstructorAssignments = schoolAssignments(assignments, schoolId).filter((item) => item.assignment_role === "instructor");
  if (!academyGlobalRoles.has(m.role) && ownInstructorAssignments.length && !ownInstructorAssignments.some((item) =>
    (!item.program_id || item.program_id === programId) && (!item.cohort_id || item.cohort_id === cohortId),
  )) {
    throw new Error("Périmètre formateur invalide.");
  }

  const attendanceEnrollmentScope = await getAttendanceEnrollmentScope(a, m.organization_id, schoolId);
  const schoolWideAttendance = attendanceEnrollmentScope === "school_wide";
  let enrollmentQuery = a
    .from("academy_school_enrollments")
    .select("id")
    .eq("organization_id", m.organization_id)
    .eq("school_id", schoolId)
    .in("academic_status", ["admitted", "enrolled", "active"]);
  if (!schoolWideAttendance && programId) enrollmentQuery = enrollmentQuery.eq("program_id", programId);
  if (!schoolWideAttendance && cohortId) enrollmentQuery = enrollmentQuery.eq("cohort_id", cohortId);
  const {data: students, error: studentsError} = await enrollmentQuery;
  if (studentsError) go(studentsError.message, true);
  const rosterStudents = students ?? [];

  if (!schoolWideAttendance && !rosterStudents.length && (programId || cohortId)) {
    const {count: schoolStudentCount, error: schoolCountError} = await a
      .from("academy_school_enrollments")
      .select("id", {count: "exact", head: true})
      .eq("organization_id", m.organization_id)
      .eq("school_id", schoolId)
      .in("academic_status", ["admitted", "enrolled", "active"]);
    if (schoolCountError) go(schoolCountError.message, true);
    if ((schoolStudentCount ?? 0) > 0) {
      go(`Le programme ou la cohorte sélectionné(e) contient 0 étudiant, alors que l'école compte ${schoolStudentCount ?? 0} étudiant(s) actif(s). Choisissez le vrai programme/cohorte ou « Toute l'école ».`, true);
    }
  }

  const duration = Number(fd.get("duration_minutes") || 0);
  const {data: session, error} = await a.from("academy_attendance_sessions").insert({
    organization_id: m.organization_id,
    school_id: schoolId,
    program_id: programId,
    cohort_id: cohortId,
    trainer_user_id: trainer || user.id,
    title,
    session_date: sessionDate,
    starts_at: text(fd.get("starts_at"), 8) || null,
    duration_minutes: Number.isInteger(duration) && duration > 0 && duration <= 1440 ? duration : null,
    delivery_mode: deliveryMode,
    location_or_link: text(fd.get("location_or_link"), 1000) || null,
    session_type: sessionType,
    status: "open",
    created_by: user.id,
  }).select("id").single<{id: string}>();

  const createdSessionId = session?.id;
  if (error || !createdSessionId) go(error?.message || "Création impossible.", true);

  if (rosterStudents.length) {
    const {error: rosterError} = await a.from("academy_attendance_records").insert(rosterStudents.map((item) => ({
      organization_id: m.organization_id,
      session_id: createdSessionId,
      enrollment_id: String(item.id),
    })));
    if (rosterError) go(`Séance créée, mais la feuille d'appel n'a pas pu être générée : ${rosterError.message}`, true, createdSessionId);
  }

  revalidatePath("/dashboard/academy/attendance");
  go(`Séance créée avec ${rosterStudents.length} étudiant(s).`, false, createdSessionId);
}


export async function createRecurringAttendanceSeriesAction(fd: FormData) {
  const schoolId = text(fd.get("school_id"), 80);
  const title = text(fd.get("title"), 200);
  const trainer = nullableId(fd.get("trainer_user_id"));
  const sessionType = text(fd.get("session_type"), 30) || "mastermind";
  const startsOn = date(fd.get("starts_on"));
  const endsOn = date(fd.get("ends_on"));
  const startsAt = text(fd.get("starts_at"), 8) || null;
  const deliveryMode = text(fd.get("delivery_mode"), 20) || "online";
  const scheduleType = text(fd.get("schedule_type"), 20) || "weekly";
  const weeklyWeekdays = [...new Set(fd.getAll("weekdays")
    .map((value) => Number(String(value)))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))]
    .sort((a, b) => a - b);
  const monthlyWeekday = Number(String(fd.get("monthly_weekday") ?? ""));
  const monthlyOrdinal = Number(String(fd.get("monthly_ordinal") ?? ""));
  const weekdays = scheduleType === "monthly" ? [monthlyWeekday] : weeklyWeekdays;
  const {a, user, m, assignments} = await ctx();

  if (!schoolId || !title || !startsOn || !endsOn) go("École, titre, date de début et date de fin sont obligatoires.", true);
  if (!canManageAttendanceSeries(m.role, assignments, schoolId)) {
    throw new Error("Création de série récurrente non autorisée pour cette école.");
  }
  if (!SESSION_TYPES.includes(sessionType as (typeof SESSION_TYPES)[number])) go("Type de séance invalide.", true);
  if (!DELIVERY_MODES.includes(deliveryMode as (typeof DELIVERY_MODES)[number])) go("Mode de séance invalide.", true);
  if (!["weekly", "monthly"].includes(scheduleType)) go("Fréquence de récurrence invalide.", true);
  if (scheduleType === "weekly" && !weeklyWeekdays.length) go("Choisissez au moins un jour de la semaine.", true);
  if (scheduleType === "monthly" && (!Number.isInteger(monthlyWeekday) || monthlyWeekday < 0 || monthlyWeekday > 6)) {
    go("Choisissez le jour de la séance mensuelle.", true);
  }
  if (scheduleType === "monthly" && ![-1, 1, 2, 3, 4].includes(monthlyOrdinal)) {
    go("Choisissez la position de la séance dans le mois.", true);
  }

  const policy = await getAttendanceEnrollmentScope(a, m.organization_id, schoolId)
    .catch((error: unknown) => go(error instanceof Error ? error.message : "Impossible de lire la politique de l’école.", true));
  if (policy !== "school_wide") {
    go("Les séries d’activités au niveau de l’école sont réservées aux écoles configurées en accès école entière.", true);
  }

  const today = await getUserLocalDate(a, user.id);
  if (startsOn < today) go("Une nouvelle série récurrente doit commencer aujourd’hui ou dans le futur. Les présences passées restent gérées par la saisie rétroactive.", true);

  const startDate = new Date(`${startsOn}T00:00:00Z`);
  const endDate = new Date(`${endsOn}T00:00:00Z`);
  const spanDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000);
  if (!Number.isFinite(spanDays) || spanDays < 0 || spanDays > 550) {
    go("La période de la série doit être comprise entre 1 jour et 550 jours.", true);
  }

  const dates = scheduleType === "monthly"
    ? monthlySeriesDates(startsOn, endsOn, monthlyWeekday, monthlyOrdinal)
    : weeklySeriesDates(startsOn, endsOn, weeklyWeekdays);
  if (!dates.length) go("Aucune séance ne correspond à la règle de récurrence choisie dans cette période.", true);
  if (dates.length > 160) go("Cette série génère trop de séances. Réduisez la période.", true);

  const duration = Number(fd.get("duration_minutes") || 0);
  const durationMinutes = Number.isInteger(duration) && duration > 0 && duration <= 1440 ? duration : null;
  const locationOrLink = text(fd.get("location_or_link"), 1000) || null;

  let duplicateQuery = a
    .from("academy_attendance_series")
    .select("id")
    .eq("organization_id", m.organization_id)
    .eq("school_id", schoolId)
    .eq("title", title)
    .eq("starts_on", startsOn)
    .eq("ends_on", endsOn)
    .eq("is_active", true);
  duplicateQuery = startsAt ? duplicateQuery.eq("starts_at", startsAt) : duplicateQuery.is("starts_at", null);
  const {data: duplicateSeries, error: duplicateError} = await duplicateQuery.limit(1).maybeSingle<{id: string}>();
  if (duplicateError) go(duplicateError.message, true);
  if (duplicateSeries) go("Cette série récurrente existe déjà pour cette école et cette période.", true);

  const {data: existingSessionsData, error: existingSessionsError} = await a
    .from("academy_attendance_sessions")
    .select("id,session_date,series_id")
    .eq("organization_id", m.organization_id)
    .eq("school_id", schoolId)
    .eq("title", title)
    .in("session_date", dates);
  if (existingSessionsError) go(existingSessionsError.message, true);
  const existingSessions = (existingSessionsData ?? []) as {id: string; session_date: string; series_id: string | null}[];
  if (existingSessions.some((item) => Boolean(item.series_id))) {
    go("Une autre série récurrente contient déjà une séance portant ce titre sur cette période.", true);
  }

  const {data: seriesData, error: seriesError} = await a
    .from("academy_attendance_series")
    .insert({
      organization_id: m.organization_id,
      school_id: schoolId,
      trainer_user_id: trainer || user.id,
      title,
      session_type: sessionType,
      schedule_type: scheduleType,
      weekdays,
      monthly_ordinal: scheduleType === "monthly" ? monthlyOrdinal : null,
      starts_on: startsOn,
      ends_on: endsOn,
      starts_at: startsAt,
      duration_minutes: durationMinutes,
      delivery_mode: deliveryMode,
      location_or_link: locationOrLink,
      is_active: true,
      created_by: user.id,
    })
    .select("id")
    .single<{id: string}>();
  const seriesId = seriesData?.id;
  if (seriesError || !seriesId) go(seriesError?.message || "Création de la série impossible.", true);

  const existingDateSet = new Set(existingSessions.map((item) => item.session_date));
  const missingDates = dates.filter((item) => !existingDateSet.has(item));
  const generatedSessionsPayload = missingDates.map((sessionDate) => ({
    organization_id: m.organization_id,
    school_id: schoolId,
    program_id: null,
    cohort_id: null,
    trainer_user_id: trainer || user.id,
    title,
    session_date: sessionDate,
    starts_at: startsAt,
    duration_minutes: durationMinutes,
    delivery_mode: deliveryMode,
    location_or_link: locationOrLink,
    session_type: sessionType,
    status: "planned",
    attendance_entry_mode: "live",
    series_id: seriesId,
    created_by: user.id,
  }));

  let insertedSessions: {id: string; session_date: string}[] = [];
  if (generatedSessionsPayload.length) {
    const {data, error} = await a
      .from("academy_attendance_sessions")
      .insert(generatedSessionsPayload)
      .select("id,session_date");
    if (error) {
      await a.from("academy_attendance_series").delete().eq("id", seriesId).eq("organization_id", m.organization_id);
      go(`La série n’a pas pu générer ses séances : ${error.message}`, true);
    }
    insertedSessions = (data ?? []) as {id: string; session_date: string}[];
  }

  const existingSessionIds = existingSessions.map((item) => item.id);
  if (existingSessionIds.length) {
    const {error: linkError} = await a
      .from("academy_attendance_sessions")
      .update({series_id: seriesId, updated_at: new Date().toISOString()})
      .eq("organization_id", m.organization_id)
      .in("id", existingSessionIds)
      .is("series_id", null);
    if (linkError) go(`La série est créée, mais certaines séances existantes n’ont pas pu être rattachées : ${linkError.message}`, true);
  }

  const sessionIds = [...existingSessionIds, ...insertedSessions.map((item) => item.id)];
  const eligible = await getEligibleAttendanceEnrollmentIds(a, m.organization_id, schoolId, null, null)
    .catch((error: unknown) => go(error instanceof Error ? error.message : "Impossible de charger les étudiants de l’école.", true));
  const enrollmentIds = eligible.enrollmentIds;

  if (sessionIds.length && enrollmentIds.length) {
    const rosterPayload = sessionIds.flatMap((sessionId) => enrollmentIds.map((enrollmentId) => ({
      organization_id: m.organization_id,
      session_id: sessionId,
      enrollment_id: enrollmentId,
    })));
    for (const batch of chunks(rosterPayload)) {
      const {error} = await a
        .from("academy_attendance_records")
        .upsert(batch, {onConflict: "session_id,enrollment_id", ignoreDuplicates: true});
      if (error) go(`Les séances sont créées, mais certaines feuilles d’appel n’ont pas pu être préparées : ${error.message}`, true);
    }
  }

  revalidatePath("/dashboard/academy/attendance");
  go(`Série récurrente créée : ${dates.length} séance(s) planifiée(s), avec ${enrollmentIds.length} étudiant(s) éligible(s) par séance.`, false);
}



export async function promoteAttendanceSessionToRecurringSeriesAction(fd: FormData) {
  const sessionId = text(fd.get("session_id"), 80);
  const requestedEndsOn = date(fd.get("ends_on"));
  const {a, user, m, assignments} = await ctx();

  if (!sessionId || !requestedEndsOn) go("Séance de référence et date de fin sont obligatoires.", true);

  type SeedSession = {
    id: string;
    series_id: string | null;
    school_id: string;
    trainer_user_id: string | null;
    title: string;
    session_date: string;
    starts_at: string | null;
    duration_minutes: number | null;
    delivery_mode: string;
    location_or_link: string | null;
    session_type: string;
    status: string;
  };

  const {data: seedData, error: seedError} = await a
    .from("academy_attendance_sessions")
    .select("id,series_id,school_id,trainer_user_id,title,session_date,starts_at,duration_minutes,delivery_mode,location_or_link,session_type,status")
    .eq("id", sessionId)
    .eq("organization_id", m.organization_id)
    .maybeSingle<SeedSession>();

  if (seedError) go(seedError.message, true);
  if (!seedData) go("Séance de référence introuvable.", true);

  // Supabase `maybeSingle()` reste typé nullable. Après le garde d'exécution
  // ci-dessus, on fige une référence non nullable pour toute l'action afin
  // d'éviter que TypeScript réintroduise `null` au fil des awaits/callbacks.
  const seed: SeedSession = seedData as SeedSession;
  if (!canManageAttendanceSeries(m.role, assignments, seed.school_id)) {
    throw new Error("Création de série récurrente non autorisée pour cette école.");
  }
  if (seed.series_id) go("Cette séance appartient déjà à une série récurrente.", true, seed.id);
  if (["cancelled", "archived"].includes(seed.status)) go("Une séance annulée ou archivée ne peut pas devenir une série récurrente.", true, seed.id);

  const policy = await getAttendanceEnrollmentScope(a, m.organization_id, seed.school_id)
    .catch((error: unknown) => go(error instanceof Error ? error.message : "Impossible de lire la politique de l’école.", true, seed.id));
  if (policy !== "school_wide") {
    go("Cette conversion est réservée aux écoles configurées en accès école entière.", true, seed.id);
  }

  const today = await getUserLocalDate(a, user.id);

  const parsedSeedDate = new Date(`${seed.session_date}T00:00:00Z`);
  if (Number.isNaN(parsedSeedDate.getTime())) go("La date de la séance de référence est invalide.", true, seed.id);
  const weekday = parsedSeedDate.getUTCDay();

  const {data: activeSeriesData, error: activeSeriesError} = await a
    .from("academy_attendance_series")
    .select("id")
    .eq("organization_id", m.organization_id)
    .eq("school_id", seed.school_id)
    .eq("title", seed.title)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{id: string}>();
  if (activeSeriesError) go(activeSeriesError.message, true, seed.id);
  if (activeSeriesData) go("Une série active portant ce titre existe déjà pour cette école.", true, seed.id);

  const {data: matchingData, error: matchingError} = await a
    .from("academy_attendance_sessions")
    .select("id,session_date,series_id,status")
    .eq("organization_id", m.organization_id)
    .eq("school_id", seed.school_id)
    .eq("title", seed.title)
    .order("session_date", {ascending: true});
  if (matchingError) go(matchingError.message, true, seed.id);

  const matchingSameWeekday = ((matchingData ?? []) as {id: string; session_date: string; series_id: string | null; status: string}[])
    .filter((session) => !["cancelled", "archived"].includes(session.status))
    .filter((session) => {
      const parsed = new Date(`${session.session_date}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.getUTCDay() === weekday;
    });

  if (matchingSameWeekday.some((session) => Boolean(session.series_id))) {
    go("Une séance correspondante appartient déjà à une autre série. Vérifiez la structure avant de continuer.", true, seed.id);
  }

  const latestExistingDate = matchingSameWeekday[matchingSameWeekday.length - 1]?.session_date ?? seed.session_date;
  if (requestedEndsOn < latestExistingDate) {
    go(`La date de fin doit être au moins le ${latestExistingDate}, car une séance correspondante existe déjà à cette date.`, true, seed.id);
  }

  const firstExistingDate = matchingSameWeekday[0]?.session_date ?? seed.session_date;
  const futureAnchor = seed.session_date > today ? seed.session_date : today;
  const futureAnchorDate = new Date(`${futureAnchor}T00:00:00Z`);
  const endDate = new Date(`${requestedEndsOn}T00:00:00Z`);
  const futureSpanDays = Math.floor((endDate.getTime() - futureAnchorDate.getTime()) / 86400000);
  if (!Number.isFinite(futureSpanDays) || futureSpanDays < 0 || futureSpanDays > 550) {
    go("La période future de la série doit rester dans une fenêtre maximale de 550 jours.", true, seed.id);
  }

  const desiredDates = weeklySeriesDates(firstExistingDate, requestedEndsOn, [weekday]);
  if (!desiredDates.length || desiredDates.length > 220) {
    go("La période choisie ne produit pas un nombre de séances valide.", true, seed.id);
  }

  const relevantExisting = matchingSameWeekday.filter((session) => desiredDates.includes(session.session_date));
  const dateCounts = new Map<string, number>();
  for (const session of relevantExisting) dateCounts.set(session.session_date, (dateCounts.get(session.session_date) ?? 0) + 1);
  const duplicateDate = [...dateCounts.entries()].find(([, count]) => count > 1)?.[0];
  if (duplicateDate) {
    go(`Deux séances ou plus portent ce titre le ${duplicateDate}. Corrigez le doublon avant de créer la série.`, true, seed.id);
  }

  const sessionType = SESSION_TYPES.includes(seed.session_type as (typeof SESSION_TYPES)[number]) ? seed.session_type : "class";
  const deliveryMode = DELIVERY_MODES.includes(seed.delivery_mode as (typeof DELIVERY_MODES)[number]) ? seed.delivery_mode : "online";

  const {data: seriesData, error: seriesError} = await a
    .from("academy_attendance_series")
    .insert({
      organization_id: m.organization_id,
      school_id: seed.school_id,
      trainer_user_id: seed.trainer_user_id || user.id,
      title: seed.title,
      session_type: sessionType,
      schedule_type: "weekly",
      weekdays: [weekday],
      starts_on: firstExistingDate,
      ends_on: requestedEndsOn,
      starts_at: seed.starts_at,
      duration_minutes: seed.duration_minutes,
      delivery_mode: deliveryMode,
      location_or_link: seed.location_or_link,
      is_active: true,
      created_by: user.id,
    })
    .select("id")
    .single<{id: string}>();
  const seriesId = seriesData?.id;
  if (seriesError || !seriesId) go(seriesError?.message || "Création de la série impossible.", true, seed.id);

  const existingSessionIds = relevantExisting.map((session) => session.id);
  if (existingSessionIds.length) {
    const {error: linkError} = await a
      .from("academy_attendance_sessions")
      .update({series_id: seriesId, updated_at: new Date().toISOString()})
      .eq("organization_id", m.organization_id)
      .in("id", existingSessionIds)
      .is("series_id", null);
    if (linkError) {
      await a.from("academy_attendance_series").delete().eq("id", seriesId).eq("organization_id", m.organization_id);
      go(`La série n’a pas pu rattacher les séances existantes : ${linkError.message}`, true, seed.id);
    }
  }

  const existingDateSet = new Set(relevantExisting.map((session) => session.session_date));
  const missingFutureDates = desiredDates.filter((sessionDate) => sessionDate >= today && !existingDateSet.has(sessionDate));
  const generatedPayload = missingFutureDates.map((sessionDate) => ({
    organization_id: m.organization_id,
    school_id: seed.school_id,
    program_id: null,
    cohort_id: null,
    trainer_user_id: seed.trainer_user_id || user.id,
    title: seed.title,
    session_date: sessionDate,
    starts_at: seed.starts_at,
    duration_minutes: seed.duration_minutes,
    delivery_mode: deliveryMode,
    location_or_link: seed.location_or_link,
    session_type: sessionType,
    status: "planned",
    attendance_entry_mode: "live",
    series_id: seriesId,
    created_by: user.id,
  }));

  let insertedSessions: {id: string; session_date: string}[] = [];
  if (generatedPayload.length) {
    const {data, error} = await a
      .from("academy_attendance_sessions")
      .insert(generatedPayload)
      .select("id,session_date");
    if (error) {
      await a.from("academy_attendance_sessions").update({series_id: null, updated_at: new Date().toISOString()}).eq("organization_id", m.organization_id).eq("series_id", seriesId);
      await a.from("academy_attendance_series").delete().eq("id", seriesId).eq("organization_id", m.organization_id);
      go(`La série a été annulée car les séances futures n’ont pas pu être générées : ${error.message}`, true, seed.id);
    }
    insertedSessions = (data ?? []) as {id: string; session_date: string}[];
  }

  const affectedSessionIds = [...existingSessionIds, ...insertedSessions.map((session) => session.id)];
  const eligible = await getEligibleAttendanceEnrollmentIds(a, m.organization_id, seed.school_id, null, null)
    .catch((error: unknown) => go(error instanceof Error ? error.message : "Impossible de charger les étudiants de l’école.", true, seed.id));
  const enrollmentIds = eligible.enrollmentIds;

  if (affectedSessionIds.length && enrollmentIds.length) {
    const rosterPayload = affectedSessionIds.flatMap((affectedSessionId) => enrollmentIds.map((enrollmentId) => ({
      organization_id: m.organization_id,
      session_id: affectedSessionId,
      enrollment_id: enrollmentId,
    })));
    for (const batch of chunks(rosterPayload)) {
      const {error} = await a
        .from("academy_attendance_records")
        .upsert(batch, {onConflict: "session_id,enrollment_id", ignoreDuplicates: true});
      if (error) go(`La série est créée, mais certaines feuilles d’appel n’ont pas pu être synchronisées : ${error.message}`, true, seed.id);
    }
  }

  revalidatePath("/dashboard/academy/attendance");
  go(`Série hebdomadaire créée depuis la séance du ${seed.session_date} : ${existingSessionIds.length} séance(s) existante(s) rattachée(s), ${insertedSessions.length} séance(s) future(s) ajoutée(s), ${enrollmentIds.length} étudiant(s) synchronisé(s) par feuille.`, false, seed.id);
}

export async function normalizeLegacyRecurringAttendanceAction(fd: FormData) {
  const schoolId = text(fd.get("school_id"), 80);
  const legacyTitle = text(fd.get("legacy_title"), 200);
  const weekday = Number(String(fd.get("weekday") ?? ""));
  const requestedEndsOn = date(fd.get("ends_on"));
  const requestedSessionType = text(fd.get("session_type"), 30) || "class";
  const {a, user, m, assignments} = await ctx();

  if (!schoolId || !legacyTitle || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    go("La récurrence historique à normaliser est incomplète.", true);
  }
  if (!canManageAttendanceSeries(m.role, assignments, schoolId)) {
    throw new Error("Normalisation de série récurrente non autorisée pour cette école.");
  }
  if (!SESSION_TYPES.includes(requestedSessionType as (typeof SESSION_TYPES)[number])) {
    go("Type de séance invalide.", true);
  }

  const policy = await getAttendanceEnrollmentScope(a, m.organization_id, schoolId)
    .catch((error: unknown) => go(error instanceof Error ? error.message : "Impossible de lire la politique de l’école.", true));
  if (policy !== "school_wide") {
    go("La normalisation automatique est réservée aux écoles configurées en accès école entière.", true);
  }

  const {data: activeSeriesData, error: activeSeriesError} = await a
    .from("academy_attendance_series")
    .select("id")
    .eq("organization_id", m.organization_id)
    .eq("school_id", schoolId)
    .eq("title", legacyTitle)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{id: string}>();
  if (activeSeriesError) go(activeSeriesError.message, true);
  if (activeSeriesData) {
    go("Cette activité possède déjà une série récurrente active. Aucune conversion n’est nécessaire.", true);
  }

  const {data: legacySessionsData, error: legacySessionsError} = await a
    .from("academy_attendance_sessions")
    .select("id,series_id,session_date,trainer_user_id,starts_at,duration_minutes,delivery_mode,location_or_link,session_type,status")
    .eq("organization_id", m.organization_id)
    .eq("school_id", schoolId)
    .eq("title", legacyTitle)
    .is("series_id", null)
    .order("session_date", {ascending: true});
  if (legacySessionsError) go(legacySessionsError.message, true);

  type LegacySession = {
    id: string;
    series_id: string | null;
    session_date: string;
    trainer_user_id: string | null;
    starts_at: string | null;
    duration_minutes: number | null;
    delivery_mode: string;
    location_or_link: string | null;
    session_type: string;
    status: string;
  };

  const legacySessions = ((legacySessionsData ?? []) as LegacySession[])
    .filter((session) => !["cancelled", "archived"].includes(session.status))
    .filter((session) => {
      const parsed = new Date(`${session.session_date}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.getUTCDay() === weekday;
    });

  if (legacySessions.length < 2) {
    go("Il faut au moins deux séances historiques du même jour pour confirmer une récurrence avant conversion.", true);
  }

  const dateCounts = new Map<string, number>();
  for (const session of legacySessions) dateCounts.set(session.session_date, (dateCounts.get(session.session_date) ?? 0) + 1);
  const duplicateDate = [...dateCounts.entries()].find(([, count]) => count > 1)?.[0];
  if (duplicateDate) {
    go(`Deux séances ou plus portent le même titre le ${duplicateDate}. Corrigez ce doublon avant de normaliser la récurrence.`, true);
  }

  const today = await getUserLocalDate(a, user.id);
  const firstExistingDate = legacySessions[0]?.session_date ?? "";
  const lastExistingDate = legacySessions[legacySessions.length - 1]?.session_date ?? "";
  const endsOn = requestedEndsOn || lastExistingDate;
  if (!firstExistingDate || !lastExistingDate || !endsOn) go("Impossible de déterminer la période de cette récurrence.", true);
  if (endsOn < lastExistingDate) {
    go(`La date de fin doit être au moins le ${lastExistingDate}, car une séance historique existe déjà à cette date.`, true);
  }

  const futureAnchor = firstExistingDate > today ? firstExistingDate : today;
  const futureAnchorDate = new Date(`${futureAnchor}T00:00:00Z`);
  const endDate = new Date(`${endsOn}T00:00:00Z`);
  const futureSpanDays = Math.floor((endDate.getTime() - futureAnchorDate.getTime()) / 86400000);
  if (!Number.isFinite(futureSpanDays) || futureSpanDays < 0 || futureSpanDays > 550) {
    go("La période future de la série doit rester dans une fenêtre maximale de 550 jours.", true);
  }

  const desiredDates = weeklySeriesDates(firstExistingDate, endsOn, [weekday]);
  if (!desiredDates.length || desiredDates.length > 220) {
    go("La période détectée ne produit pas un nombre de séances valide.", true);
  }

  const {data: sameTitleSessionsData, error: sameTitleSessionsError} = await a
    .from("academy_attendance_sessions")
    .select("id,session_date,series_id,status")
    .eq("organization_id", m.organization_id)
    .eq("school_id", schoolId)
    .eq("title", legacyTitle)
    .in("session_date", desiredDates);
  if (sameTitleSessionsError) go(sameTitleSessionsError.message, true);

  const sameTitleSessions = ((sameTitleSessionsData ?? []) as {id: string; session_date: string; series_id: string | null; status: string}[])
    .filter((session) => !["cancelled", "archived"].includes(session.status));
  if (sameTitleSessions.some((session) => Boolean(session.series_id))) {
    go("Une autre série récurrente couvre déjà une séance portant ce titre dans la période choisie.", true);
  }

  const byDate = new Map<string, {id: string; session_date: string; series_id: string | null; status: string}>();
  for (const session of sameTitleSessions) {
    if (byDate.has(session.session_date)) {
      go(`Plusieurs séances portent ce titre le ${session.session_date}. Corrigez le doublon avant la normalisation.`, true);
    }
    byDate.set(session.session_date, session);
  }

  const sourceSession = legacySessions.find((session) => session.session_date >= today) ?? legacySessions[legacySessions.length - 1];
  if (!sourceSession) go("Aucune séance de référence n’a pu être déterminée.", true);
  const sessionType = SESSION_TYPES.includes(requestedSessionType as (typeof SESSION_TYPES)[number])
    ? requestedSessionType
    : (SESSION_TYPES.includes(sourceSession.session_type as (typeof SESSION_TYPES)[number]) ? sourceSession.session_type : "class");
  const deliveryMode = DELIVERY_MODES.includes(sourceSession.delivery_mode as (typeof DELIVERY_MODES)[number])
    ? sourceSession.delivery_mode
    : "online";

  const {data: seriesData, error: seriesError} = await a
    .from("academy_attendance_series")
    .insert({
      organization_id: m.organization_id,
      school_id: schoolId,
      trainer_user_id: sourceSession.trainer_user_id || user.id,
      title: legacyTitle,
      session_type: sessionType,
      schedule_type: "weekly",
      weekdays: [weekday],
      starts_on: firstExistingDate,
      ends_on: endsOn,
      starts_at: sourceSession.starts_at,
      duration_minutes: sourceSession.duration_minutes,
      delivery_mode: deliveryMode,
      location_or_link: sourceSession.location_or_link,
      is_active: true,
      created_by: user.id,
    })
    .select("id")
    .single<{id: string}>();
  const seriesId = seriesData?.id;
  if (seriesError || !seriesId) go(seriesError?.message || "Création de la série normalisée impossible.", true);

  const existingSessionsToLink = sameTitleSessions.filter((session) => desiredDates.includes(session.session_date));
  const existingSessionIds = existingSessionsToLink.map((session) => session.id);
  if (existingSessionIds.length) {
    const {error: linkError} = await a
      .from("academy_attendance_sessions")
      .update({series_id: seriesId, updated_at: new Date().toISOString()})
      .eq("organization_id", m.organization_id)
      .in("id", existingSessionIds)
      .is("series_id", null);
    if (linkError) {
      await a.from("academy_attendance_series").delete().eq("id", seriesId).eq("organization_id", m.organization_id);
      go(`Les séances existantes n’ont pas pu être rattachées : ${linkError.message}`, true);
    }
  }

  const existingDateSet = new Set(existingSessionsToLink.map((session) => session.session_date));
  const missingFutureDates = desiredDates.filter((sessionDate) => sessionDate >= today && !existingDateSet.has(sessionDate));
  const generatedPayload = missingFutureDates.map((sessionDate) => ({
    organization_id: m.organization_id,
    school_id: schoolId,
    program_id: null,
    cohort_id: null,
    trainer_user_id: sourceSession.trainer_user_id || user.id,
    title: legacyTitle,
    session_date: sessionDate,
    starts_at: sourceSession.starts_at,
    duration_minutes: sourceSession.duration_minutes,
    delivery_mode: deliveryMode,
    location_or_link: sourceSession.location_or_link,
    session_type: sessionType,
    status: "planned",
    attendance_entry_mode: "live",
    series_id: seriesId,
    created_by: user.id,
  }));

  let insertedSessions: {id: string; session_date: string}[] = [];
  if (generatedPayload.length) {
    const {data, error} = await a
      .from("academy_attendance_sessions")
      .insert(generatedPayload)
      .select("id,session_date");
    if (error) {
      await a.from("academy_attendance_sessions").update({series_id: null, updated_at: new Date().toISOString()}).eq("organization_id", m.organization_id).eq("series_id", seriesId);
      await a.from("academy_attendance_series").delete().eq("id", seriesId).eq("organization_id", m.organization_id);
      go(`La série a été annulée car les séances manquantes n’ont pas pu être générées : ${error.message}`, true);
    }
    insertedSessions = (data ?? []) as {id: string; session_date: string}[];
  }

  const sessionIds = [...existingSessionIds, ...insertedSessions.map((session) => session.id)];
  const eligible = await getEligibleAttendanceEnrollmentIds(a, m.organization_id, schoolId, null, null)
    .catch((error: unknown) => go(error instanceof Error ? error.message : "Impossible de charger les étudiants de l’école.", true));
  const enrollmentIds = eligible.enrollmentIds;

  if (sessionIds.length && enrollmentIds.length) {
    const rosterPayload = sessionIds.flatMap((sessionId) => enrollmentIds.map((enrollmentId) => ({
      organization_id: m.organization_id,
      session_id: sessionId,
      enrollment_id: enrollmentId,
    })));
    for (const batch of chunks(rosterPayload)) {
      const {error} = await a
        .from("academy_attendance_records")
        .upsert(batch, {onConflict: "session_id,enrollment_id", ignoreDuplicates: true});
      if (error) go(`La récurrence est normalisée, mais certaines feuilles d’appel n’ont pas pu être synchronisées : ${error.message}`, true);
    }
  }

  revalidatePath("/dashboard/academy/attendance");
  go(`Récurrence normalisée : ${existingSessionIds.length} séance(s) existante(s) rattachée(s), ${insertedSessions.length} séance(s) future(s) ajoutée(s), ${enrollmentIds.length} étudiant(s) synchronisé(s) par feuille.`, false);
}

export async function archiveRecurringAttendanceSeriesAction(fd: FormData) {
  const seriesId = text(fd.get("series_id"), 80);
  const {a, user, m, assignments} = await ctx();
  const {data: series, error: seriesError} = await a
    .from("academy_attendance_series")
    .select("id,school_id,is_active")
    .eq("id", seriesId)
    .eq("organization_id", m.organization_id)
    .maybeSingle<{id: string; school_id: string; is_active: boolean}>();
  if (seriesError) go(seriesError.message, true);
  if (!series || !canManageAttendanceSeries(m.role, assignments, series.school_id)) {
    throw new Error("Désactivation de série non autorisée.");
  }

  const today = await getUserLocalDate(a, user.id);
  const now = new Date().toISOString();
  const {error: updateError} = await a
    .from("academy_attendance_series")
    .update({is_active: false, updated_at: now})
    .eq("id", seriesId)
    .eq("organization_id", m.organization_id);
  if (updateError) go(updateError.message, true);

  const {error: sessionsError} = await a
    .from("academy_attendance_sessions")
    .update({status: "cancelled", updated_at: now})
    .eq("organization_id", m.organization_id)
    .eq("series_id", seriesId)
    .gte("session_date", today)
    .eq("status", "planned");
  if (sessionsError) go(`La série est désactivée, mais certaines séances futures n’ont pas pu être annulées : ${sessionsError.message}`, true);

  revalidatePath("/dashboard/academy/attendance");
  go("Série récurrente désactivée. Les séances futures encore planifiées ont été annulées; l’historique est conservé.", false);
}

export async function createPastAttendanceSessionAction(fd: FormData) {
  const schoolId = text(fd.get("school_id"), 80);
  const programId = nullableId(fd.get("program_id"));
  const cohortId = nullableId(fd.get("cohort_id"));
  const title = text(fd.get("title"), 200);
  const sessionDate = date(fd.get("session_date"));
  const trainer = nullableId(fd.get("trainer_user_id"));
  const sessionType = text(fd.get("session_type"), 30) || "class";
  const deliveryMode = text(fd.get("delivery_mode"), 20) || "online";
  const source = text(fd.get("retroactive_source"), 30) || "paper_sheet";
  const reason = text(fd.get("retroactive_reason"), 1000);
  const {a, user, m, assignments} = await ctx();

  if (!schoolId || !title || !sessionDate) go("École, titre et date sont obligatoires.", true);
  if (!canTakeAttendance(m.role, assignments, schoolId, programId, cohortId)) {
    throw new Error("Saisie de présence passée non autorisée pour ce périmètre.");
  }
  if (!RETROACTIVE_SOURCES.includes(source as (typeof RETROACTIVE_SOURCES)[number])) go("Source de présence invalide.", true);
  if (reason.length < 3) go("Indiquez pourquoi la présence est saisie après la séance.", true);
  if (!SESSION_TYPES.includes(sessionType as (typeof SESSION_TYPES)[number])) go("Type de séance invalide.", true);
  if (!DELIVERY_MODES.includes(deliveryMode as (typeof DELIVERY_MODES)[number])) go("Mode de séance invalide.", true);

  const today = await getUserLocalDate(a, user.id);
  if (sessionDate >= today) go("La fonction « Saisir une présence passée » est réservée aux dates antérieures à aujourd’hui.", true);

  if (programId) {
    const {data: program} = await a.from("academy_programs").select("id").eq("id", programId).eq("school_id", schoolId).eq("organization_id", m.organization_id).maybeSingle();
    if (!program) go("Programme invalide pour cette école.", true);
  }
  if (cohortId) {
    const {data: cohort} = await a.from("academy_cohorts").select("id").eq("id", cohortId).eq("school_id", schoolId).eq("organization_id", m.organization_id).maybeSingle();
    if (!cohort) go("Cohorte invalide pour cette école.", true);
  }

  const eligible = await getEligibleAttendanceEnrollmentIds(a, m.organization_id, schoolId, programId, cohortId)
    .catch((error: unknown) => go(error instanceof Error ? error.message : "Impossible de charger les étudiants.", true));
  const enrollmentIds = eligible.enrollmentIds;
  if (!enrollmentIds.length) go("Aucun étudiant actif ne correspond à cette école/séance.", true);

  const duration = Number(fd.get("duration_minutes") || 0);
  const now = new Date().toISOString();
  const {data: sessionData, error: sessionError} = await a.from("academy_attendance_sessions").insert({
    organization_id: m.organization_id,
    school_id: schoolId,
    program_id: programId,
    cohort_id: cohortId,
    trainer_user_id: trainer || user.id,
    title,
    session_date: sessionDate,
    starts_at: text(fd.get("starts_at"), 8) || null,
    duration_minutes: Number.isInteger(duration) && duration > 0 && duration <= 1440 ? duration : null,
    delivery_mode: deliveryMode,
    location_or_link: text(fd.get("location_or_link"), 1000) || null,
    session_type: sessionType,
    status: "open",
    attendance_entry_mode: "retroactive",
    retroactive_source: source,
    retroactive_reason: reason,
    retroactive_entered_by: user.id,
    retroactive_entered_at: now,
    created_by: user.id,
  }).select("id").single<{id: string}>();

  const createdSessionId = sessionData?.id;
  if (sessionError || !createdSessionId) go(sessionError?.message || "Création de la séance passée impossible.", true);

  const rosterPayload = enrollmentIds.map((enrollmentId) => ({
    organization_id: m.organization_id,
    session_id: createdSessionId,
    enrollment_id: enrollmentId,
  }));
  const {error: rosterError} = await a.from("academy_attendance_records").insert(rosterPayload);
  if (rosterError) go(`Séance créée, mais la feuille d’appel n’a pas pu être générée : ${rosterError.message}`, true, createdSessionId);

  revalidatePath("/dashboard/academy/attendance");
  go(`Saisie passée créée et ${enrollmentIds.length} étudiant(s) chargé(s). La date de séance reste ${sessionDate}, et la saisie est auditée aujourd’hui.`, false, createdSessionId);
}

export async function openPastAttendanceSessionAction(fd: FormData) {
  const sessionId = text(fd.get("session_id"), 80);
  const source = text(fd.get("retroactive_source"), 30) || "paper_sheet";
  const reason = text(fd.get("retroactive_reason"), 1000);
  const {a, user, m, assignments} = await ctx();
  const session = await getSessionScope(a, m.organization_id, sessionId);

  if (!session || !canTakeAttendance(m.role, assignments, session.school_id, session.program_id, session.cohort_id)) {
    throw new Error("Saisie de présence passée non autorisée.");
  }
  if (["cancelled", "archived"].includes(session.status)) go("Une séance annulée ou archivée ne peut pas être rouverte pour saisie.", true, sessionId);
  if (!RETROACTIVE_SOURCES.includes(source as (typeof RETROACTIVE_SOURCES)[number])) go("Source de présence invalide.", true, sessionId);
  if (reason.length < 3) go("Indiquez pourquoi la présence est saisie après la séance.", true, sessionId);

  const today = await getUserLocalDate(a, user.id);
  if (session.session_date >= today) go("Cette séance n’est pas passée. Utilisez l’appel normal.", true, sessionId);

  const eligible = await getEligibleAttendanceEnrollmentIds(a, m.organization_id, session.school_id, session.program_id, session.cohort_id)
    .catch((error: unknown) => go(error instanceof Error ? error.message : "Impossible de charger les étudiants.", true, sessionId));
  const enrollmentIds = eligible.enrollmentIds;

  const {data: existingData, error: existingError} = await a
    .from("academy_attendance_records")
    .select("enrollment_id")
    .eq("organization_id", m.organization_id)
    .eq("session_id", sessionId);
  if (existingError) go(existingError.message, true, sessionId);
  const existingIds = new Set((existingData ?? []).map((item) => String(item.enrollment_id)));
  const missingIds = enrollmentIds.filter((enrollmentId) => !existingIds.has(enrollmentId));

  if (missingIds.length) {
    const {error: rosterError} = await a.from("academy_attendance_records").insert(missingIds.map((enrollmentId) => ({
      organization_id: m.organization_id,
      session_id: sessionId,
      enrollment_id: enrollmentId,
    })));
    if (rosterError) go(rosterError.message, true, sessionId);
  }

  const now = new Date().toISOString();
  const {error: updateError} = await a.from("academy_attendance_sessions").update({
    status: "open",
    attendance_entry_mode: "retroactive",
    retroactive_source: source,
    retroactive_reason: reason,
    retroactive_entered_by: user.id,
    retroactive_entered_at: now,
    updated_at: now,
  }).eq("id", sessionId).eq("organization_id", m.organization_id);
  if (updateError) go(updateError.message, true, sessionId);

  revalidatePath("/dashboard/academy/attendance");
  go(`Saisie passée ouverte. ${missingIds.length} étudiant(s) manquant(s) ont été ajouté(s) à la feuille.`, false, sessionId);
}

export async function repairAttendanceSessionScopeAction(fd: FormData) {
  const sessionId = text(fd.get("session_id"), 80);
  const targetScope = text(fd.get("target_scope"), 180);
  const {a, m, assignments} = await ctx();
  const session = await getSessionScope(a, m.organization_id, sessionId);

  if (!session || !canManageSession(m.role, assignments, session.school_id, session.program_id, session.cohort_id)) {
    throw new Error("Correction du périmètre non autorisée.");
  }
  assertEditableAttendanceSession(session);

  const {count: existingCount, error: countError} = await a
    .from("academy_attendance_records")
    .select("id", {count: "exact", head: true})
    .eq("organization_id", m.organization_id)
    .eq("session_id", sessionId);
  if (countError) go(countError.message, true, sessionId);
  if ((existingCount ?? 0) > 0) {
    go("Le périmètre ne peut être réparé automatiquement qu'avant le premier pointage.", true, sessionId);
  }

  let targetProgramId: string | null = null;
  let targetCohortId: string | null = null;

  if (targetScope.startsWith("program:")) {
    targetProgramId = targetScope.slice("program:".length) || null;
    const {data: program} = await a
      .from("academy_programs")
      .select("id")
      .eq("id", targetProgramId)
      .eq("organization_id", m.organization_id)
      .eq("school_id", session.school_id)
      .neq("status", "archived")
      .maybeSingle<{id: string}>();
    if (!program) go("Programme cible invalide pour cette école.", true, sessionId);
  } else if (targetScope.startsWith("cohort:")) {
    targetCohortId = targetScope.slice("cohort:".length) || null;
    const {data: cohort} = await a
      .from("academy_cohorts")
      .select("id,program_id")
      .eq("id", targetCohortId)
      .eq("organization_id", m.organization_id)
      .eq("school_id", session.school_id)
      .neq("status", "archived")
      .maybeSingle<{id: string; program_id: string | null}>();
    const targetCohort = cohort ?? go("Cohorte cible invalide pour cette école.", true, sessionId);
    targetProgramId = targetCohort.program_id ? String(targetCohort.program_id) : null;
  } else if (targetScope !== "school") {
    go("Choisissez un périmètre valide pour la séance.", true, sessionId);
  }

  if (!canManageSession(m.role, assignments, session.school_id, targetProgramId, targetCohortId)) {
    throw new Error("Le nouveau périmètre dépasse vos responsabilités Academy.");
  }

  let enrollmentQuery = a
    .from("academy_school_enrollments")
    .select("id")
    .eq("organization_id", m.organization_id)
    .eq("school_id", session.school_id)
    .in("academic_status", ["admitted", "enrolled", "active"]);
  if (targetProgramId) enrollmentQuery = enrollmentQuery.eq("program_id", targetProgramId);
  if (targetCohortId) enrollmentQuery = enrollmentQuery.eq("cohort_id", targetCohortId);

  const {data: students, error: studentsError} = await enrollmentQuery;
  if (studentsError) go(studentsError.message, true, sessionId);

  // Supabase retourne `data` comme nullable par contrat. On normalise une seule fois
  // puis on n'utilise plus la valeur nullable brute dans la suite de l'action.
  const scopedStudents = students ?? [];
  if (!scopedStudents.length) {
    go("Le périmètre choisi ne contient aucun étudiant actif. Choisissez toute l'école, un programme ou une cohorte contenant des étudiants.", true, sessionId);
  }

  const {error: updateError} = await a
    .from("academy_attendance_sessions")
    .update({
      program_id: targetProgramId,
      cohort_id: targetCohortId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("organization_id", m.organization_id);
  if (updateError) go(updateError.message, true, sessionId);

  const {error: rosterError} = await a.from("academy_attendance_records").insert(scopedStudents.map((item) => ({
    organization_id: m.organization_id,
    session_id: sessionId,
    enrollment_id: String(item.id),
  })));

  if (rosterError) {
    await a
      .from("academy_attendance_sessions")
      .update({
        program_id: session.program_id,
        cohort_id: session.cohort_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("organization_id", m.organization_id);
    go(`Le périmètre a été restauré car la feuille d'appel n'a pas pu être générée : ${rosterError.message}`, true, sessionId);
  }

  revalidatePath("/dashboard/academy/attendance");
  go(`Périmètre corrigé et ${scopedStudents.length} étudiant(s) chargé(s) dans la feuille d'appel.`, false, sessionId);
}

export async function syncAttendanceRosterAction(fd: FormData) {
  const sessionId = text(fd.get("session_id"), 80);
  const {a, user, m, assignments} = await ctx();
  const session = await getSessionScope(a, m.organization_id, sessionId);
  if (!session || !canTakeAttendance(m.role, assignments, session.school_id, session.program_id, session.cohort_id)) {
    throw new Error("Synchronisation non autorisée.");
  }
  assertEditableAttendanceSession(session);
  await assertAttendanceEntryWindow(a, user.id, session);

  const attendanceEnrollmentScope = await getAttendanceEnrollmentScope(a, m.organization_id, session.school_id);
  const schoolWideAttendance = attendanceEnrollmentScope === "school_wide";
  let enrollmentQuery = a
    .from("academy_school_enrollments")
    .select("id")
    .eq("organization_id", m.organization_id)
    .eq("school_id", session.school_id)
    .in("academic_status", ["admitted", "enrolled", "active"]);
  if (!schoolWideAttendance && session.program_id) enrollmentQuery = enrollmentQuery.eq("program_id", session.program_id);
  if (!schoolWideAttendance && session.cohort_id) enrollmentQuery = enrollmentQuery.eq("cohort_id", session.cohort_id);

  const [{data: students, error: studentError}, {data: existing, error: existingError}] = await Promise.all([
    enrollmentQuery,
    a.from("academy_attendance_records").select("enrollment_id").eq("organization_id", m.organization_id).eq("session_id", sessionId),
  ]);

  if (studentError) go(studentError.message, true, sessionId);
  if (existingError) go(existingError.message, true, sessionId);

  const rosterStudents = students ?? [];

  if (!schoolWideAttendance && !rosterStudents.length) {
    const {count: schoolStudentCount} = await a
      .from("academy_school_enrollments")
      .select("id", {count: "exact", head: true})
      .eq("organization_id", m.organization_id)
      .eq("school_id", session.school_id)
      .in("academic_status", ["admitted", "enrolled", "active"]);
    if ((schoolStudentCount ?? 0) > 0) {
      go(`Cette séance pointe vers un programme ou une cohorte sans étudiants, alors que l'école compte ${schoolStudentCount ?? 0} étudiant(s) actif(s). Utilisez « Corriger le périmètre » sur cette séance.`, true, sessionId);
    }
  }

  const existingIds = new Set((existing ?? []).map((item) => String(item.enrollment_id)));
  const missing = rosterStudents.filter((item) => !existingIds.has(String(item.id)));
  if (missing.length) {
    const {error} = await a.from("academy_attendance_records").insert(missing.map((item) => ({
      organization_id: m.organization_id,
      session_id: sessionId,
      enrollment_id: String(item.id),
    })));
    if (error) go(error.message, true, sessionId);
  }

  revalidatePath("/dashboard/academy/attendance");
  go(missing.length ? `${missing.length} étudiant(s) ajouté(s) à la feuille d'appel.` : "La feuille d'appel est déjà à jour.", false, sessionId);
}


type AcademyZoomSettingsRow = {
  school_id: string;
  organization_id: string;
  enabled: boolean;
  zoom_meeting_id: string;
  timezone: string;
  late_grace_minutes: number;
  present_threshold_percent: number;
  partial_threshold_percent: number;
};

type AcademyZoomSessionRow = SessionScope & {
  starts_at: string | null;
  duration_minutes: number | null;
  location_or_link: string | null;
  zoom_meeting_id: string | null;
  zoom_meeting_uuid: string | null;
  zoom_timezone: string | null;
};

type AcademyZoomAttendanceRecordRow = {
  id: string;
  enrollment_id: string;
  attendance_status: string;
  attendance_source: string | null;
  zoom_needs_review: boolean | null;
};

type AcademyZoomEnrollmentRow = {
  id: string;
  user_id: string | null;
  crm_client_id: string | null;
};

type AcademyZoomContactRow = {
  id: string;
  email: string | null;
};

type AcademyZoomIdentityRow = {
  id: string;
  enrollment_id: string;
  zoom_registrant_id: string | null;
  zoom_email: string | null;
};

async function loadAcademyZoomSettings(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  schoolId: string,
) {
  const {data, error} = await admin
    .from("academy_zoom_attendance_settings")
    .select("school_id,organization_id,enabled,zoom_meeting_id,timezone,late_grace_minutes,present_threshold_percent,partial_threshold_percent")
    .eq("organization_id", organizationId)
    .eq("school_id", schoolId)
    .maybeSingle<AcademyZoomSettingsRow>();
  if (error) throw new Error(`Configuration Smart Attendance inaccessible : ${error.message}`);
  return data ?? null;
}

async function refreshAcademyZoomReviewSummary(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  sessionId: string,
) {
  const [{count: reviewCount, error: reviewError}, {count: unmatchedCount, error: unmatchedError}] = await Promise.all([
    admin.from("academy_attendance_records")
      .select("id", {count: "exact", head: true})
      .eq("organization_id", organizationId)
      .eq("session_id", sessionId)
      .eq("zoom_needs_review", true),
    admin.from("academy_zoom_attendance_participants")
      .select("id", {count: "exact", head: true})
      .eq("organization_id", organizationId)
      .eq("session_id", sessionId)
      .eq("is_latest", true)
      .eq("is_ignored", false)
      .is("matched_enrollment_id", null),
  ]);
  if (reviewError) throw new Error(reviewError.message);
  if (unmatchedError) throw new Error(unmatchedError.message);

  const remainingReview = reviewCount ?? 0;
  const remainingUnmatched = unmatchedCount ?? 0;
  const {error: sessionError} = await admin.from("academy_attendance_sessions").update({
    zoom_review_count: remainingReview,
    zoom_unmatched_participant_count: remainingUnmatched,
    zoom_sync_status: remainingReview > 0 || remainingUnmatched > 0 ? "review" : "synced",
    updated_at: new Date().toISOString(),
  }).eq("id", sessionId).eq("organization_id", organizationId);
  if (sessionError) throw new Error(sessionError.message);

  return {reviewCount: remainingReview, unmatchedCount: remainingUnmatched};
}

function friendlyZoomSyncError(error: unknown) {
  if (error instanceof ZoomApiError) {
    const details = error.details as {code?: number | string; message?: string} | null;
    const code = String(details?.code ?? "");
    if (code === "3001" || error.status === 404) {
      return "Zoom ne trouve pas encore cette occurrence terminée. Vérifie l’ID de réunion ou attends quelques minutes après la fin du cours, puis réessaie.";
    }
    if (error.status === 401 || error.status === 403 || code === "200") {
      return "Zoom refuse la lecture de cette réunion. Vérifie que l’application Zoom intégrée possède les droits de lecture des réunions, inscrits et participants passés.";
    }
    if (error.status === 429) return "Zoom limite temporairement les requêtes. Attends une minute puis relance la synchronisation.";
    return `Synchronisation Zoom impossible : ${error.message}`;
  }
  return error instanceof Error ? error.message : "Synchronisation Zoom impossible.";
}

export async function saveAcademyZoomAttendanceSettingsAction(fd: FormData) {
  const schoolId = text(fd.get("school_id"), 80);
  const zoomMeetingId = normalizeZoomMeetingId(text(fd.get("zoom_meeting_id"), 80));
  const timeZone = text(fd.get("timezone"), 100) || "Europe/Dublin";
  const lateGraceMinutes = Number(fd.get("late_grace_minutes") || 15);
  const presentThresholdPercent = Number(fd.get("present_threshold_percent") || 75);
  const partialThresholdPercent = Number(fd.get("partial_threshold_percent") || 25);
  const sessionId = text(fd.get("session_id"), 80);

  if (!schoolId || zoomMeetingId.length < 9) go("Indique un Meeting ID Zoom valide.", true, sessionId);
  if (!Number.isInteger(lateGraceMinutes) || lateGraceMinutes < 0 || lateGraceMinutes > 120) go("Le délai de retard doit être compris entre 0 et 120 minutes.", true, sessionId);
  if (!Number.isInteger(presentThresholdPercent) || presentThresholdPercent < 1 || presentThresholdPercent > 100) go("Le seuil de présence doit être compris entre 1 et 100 %.", true, sessionId);
  if (!Number.isInteger(partialThresholdPercent) || partialThresholdPercent < 1 || partialThresholdPercent >= presentThresholdPercent) go("Le seuil partiel doit être inférieur au seuil de présence.", true, sessionId);

  try {
    new Intl.DateTimeFormat("en-CA", {timeZone}).format(new Date());
  } catch {
    go("Le fuseau horaire indiqué n’est pas valide.", true, sessionId);
  }

  const {a, user, m, assignments} = await ctx();
  const {data: school, error: schoolError} = await a.from("academy_schools")
    .select("id")
    .eq("id", schoolId)
    .eq("organization_id", m.organization_id)
    .maybeSingle<{id: string}>();
  if (schoolError) go(schoolError.message, true, sessionId);
  if (!school || !canManageSession(m.role, assignments, schoolId, null, null)) {
    throw new Error("Configuration Zoom Academy non autorisée pour cette école.");
  }

  const existingSettings = await loadAcademyZoomSettings(a, m.organization_id, schoolId);
  const settingsPayload = {
    enabled: true,
    zoom_meeting_id: zoomMeetingId,
    timezone: timeZone,
    late_grace_minutes: lateGraceMinutes,
    present_threshold_percent: presentThresholdPercent,
    partial_threshold_percent: partialThresholdPercent,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const {error} = existingSettings
    ? await a.from("academy_zoom_attendance_settings").update(settingsPayload).eq("school_id", schoolId).eq("organization_id", m.organization_id)
    : await a.from("academy_zoom_attendance_settings").insert({
      school_id: schoolId,
      organization_id: m.organization_id,
      ...settingsPayload,
      created_by: user.id,
    });
  if (error) go(error.message, true, sessionId);

  revalidatePath("/dashboard/academy/attendance");
  go(`Zoom Smart Attendance activé pour cette école · Meeting ID ${zoomMeetingId}.`, false, sessionId);
}

export async function syncAcademyAttendanceWithZoomAction(fd: FormData) {
  const sessionId = text(fd.get("session_id"), 80);
  const {a, user, m, assignments} = await ctx();
  const {data: session, error: sessionError} = await a
    .from("academy_attendance_sessions")
    .select("id,school_id,program_id,cohort_id,session_date,status,attendance_entry_mode,starts_at,duration_minutes,location_or_link,zoom_meeting_id,zoom_meeting_uuid,zoom_timezone")
    .eq("id", sessionId)
    .eq("organization_id", m.organization_id)
    .maybeSingle<AcademyZoomSessionRow>();
  if (sessionError) go(sessionError.message, true, sessionId);
  if (!session || !canTakeAttendance(m.role, assignments, session.school_id, session.program_id, session.cohort_id)) {
    throw new Error("Synchronisation Zoom non autorisée.");
  }
  if (["cancelled", "archived"].includes(session.status)) go("Cette séance est annulée ou archivée et ne peut pas être synchronisée.", true, sessionId);
  if (session.status === "closed") go("L’appel est déjà terminé. Réouvre d’abord la séance avant de relancer Zoom.", true, sessionId);

  const settings = await loadAcademyZoomSettings(a, m.organization_id, session.school_id);
  const inferredMeetingId = extractZoomMeetingId(session.location_or_link);
  const zoomMeetingId = normalizeZoomMeetingId(session.zoom_meeting_id || settings?.zoom_meeting_id || inferredMeetingId);
  if (!zoomMeetingId) go("Aucun Meeting ID Zoom n’est associé à cette école. Utilise d’abord « Configurer Zoom Smart Attendance ».", true, sessionId);

  const timeZone = String(session.zoom_timezone || settings?.timezone || "Europe/Dublin");
  const lateGraceMinutes = Number(settings?.late_grace_minutes ?? 15);
  const presentThresholdPercent = Number(settings?.present_threshold_percent ?? 75);
  const partialThresholdPercent = Number(settings?.partial_threshold_percent ?? 25);

  const {data: syncRow, error: syncCreateError} = await a.from("academy_zoom_attendance_syncs").insert({
    organization_id: m.organization_id,
    session_id: session.id,
    school_id: session.school_id,
    requested_by: user.id,
    zoom_meeting_id: zoomMeetingId,
    status: "running",
  }).select("id").single<{id: string}>();
  if (syncCreateError || !syncRow) go(syncCreateError?.message || "Impossible de démarrer le journal de synchronisation Zoom.", true, sessionId);

  const syncId = syncRow.id;
  try {
    const [meeting, instances] = await Promise.all([
      getZoomMeeting(zoomMeetingId).catch(() => null),
      listPastMeetingInstances(zoomMeetingId),
    ]);
    const effectiveTimeZone = String(meeting?.timezone || timeZone || "Europe/Dublin");
    const instance = session.zoom_meeting_uuid
      ? instances.find((item) => item.uuid === session.zoom_meeting_uuid) ?? null
      : choosePastMeetingInstance({
        instances,
        sessionDate: session.session_date,
        startsAt: session.starts_at,
        timeZone: effectiveTimeZone,
      });
    if (!instance) {
      throw new Error(`Aucune occurrence Zoom terminée ne correspond à la séance du ${session.session_date}. Attends la fin de la réunion ou vérifie la date et le Meeting ID.`);
    }

    let registrationAvailable = true;
    let registrants: Awaited<ReturnType<typeof listMeetingRegistrants>> = [];
    try {
      registrants = await listMeetingRegistrants(zoomMeetingId);
    } catch {
      registrationAvailable = false;
    }

    const participants = await listPastMeetingParticipants(instance.uuid);
    if (!participants.length) {
      throw new Error("Zoom n’a retourné aucun participant pour cette occurrence. Le rapport peut encore être en préparation : attends quelques minutes puis réessaie.");
    }

    const aggregated = aggregateZoomParticipants(participants, registrants);
    const scheduledMinutes = Math.max(1, Number(session.duration_minutes || meeting?.duration || 60));
    const now = new Date().toISOString();

    const {data: attendanceRows, error: attendanceError} = await a
      .from("academy_attendance_records")
      .select("id,enrollment_id,attendance_status,attendance_source,zoom_needs_review")
      .eq("organization_id", m.organization_id)
      .eq("session_id", session.id);
    if (attendanceError) throw new Error(attendanceError.message);
    const attendanceRecords = (attendanceRows ?? []) as AcademyZoomAttendanceRecordRow[];
    if (!attendanceRecords.length) throw new Error("La feuille d’appel est vide. Synchronise d’abord les étudiants de l’école.");

    const enrollmentIds = attendanceRecords.map((row) => String(row.enrollment_id));
    const {data: enrollmentRows, error: enrollmentError} = await a
      .from("academy_school_enrollments")
      .select("id,user_id,crm_client_id")
      .in("id", enrollmentIds);
    if (enrollmentError) throw new Error(enrollmentError.message);
    const academyEnrollments = (enrollmentRows ?? []) as AcademyZoomEnrollmentRow[];

    const userIds = [...new Set(academyEnrollments.map((row) => row.user_id).filter(Boolean).map(String))];
    const crmIds = [...new Set(academyEnrollments.map((row) => row.crm_client_id).filter(Boolean).map(String))];
    const [{data: profiles, error: profileError}, {data: clients, error: clientError}, {data: identityRows, error: identityError}] = await Promise.all([
      userIds.length ? a.from("profiles").select("id,email").in("id", userIds) : Promise.resolve({data: [], error: null}),
      crmIds.length ? a.from("crm_clients").select("id,email").in("id", crmIds) : Promise.resolve({data: [], error: null}),
      a.from("academy_zoom_student_identities")
        .select("id,enrollment_id,zoom_registrant_id,zoom_email")
        .eq("organization_id", m.organization_id)
        .eq("school_id", session.school_id)
        .eq("zoom_meeting_id", zoomMeetingId),
    ]);
    if (profileError) throw new Error(profileError.message);
    if (clientError) throw new Error(clientError.message);
    if (identityError) throw new Error(identityError.message);

    const profileContacts = (profiles ?? []) as AcademyZoomContactRow[];
    const clientContacts = (clients ?? []) as AcademyZoomContactRow[];
    const rememberedIdentities = (identityRows ?? []) as AcademyZoomIdentityRow[];
    const emailByUser = new Map<string, string>(profileContacts.map((row) => [String(row.id), normalizeAttendanceEmail(row.email)]));
    const emailByClient = new Map<string, string>(clientContacts.map((row) => [String(row.id), normalizeAttendanceEmail(row.email)]));
    const emailByEnrollment = new Map<string, string>();
    for (const enrollment of academyEnrollments) {
      const email = enrollment.crm_client_id
        ? emailByClient.get(String(enrollment.crm_client_id)) || ""
        : emailByUser.get(String(enrollment.user_id)) || "";
      if (email) emailByEnrollment.set(String(enrollment.id), email);
    }

    const enrollmentsByEmail = new Map<string, string[]>();
    for (const [enrollmentId, email] of emailByEnrollment) {
      const ids = enrollmentsByEmail.get(email) ?? [];
      ids.push(enrollmentId);
      enrollmentsByEmail.set(email, ids);
    }

    const rosterIds = new Set(enrollmentIds);
    const identityByRegistrant = new Map<string, string>();
    const identityByEmail = new Map<string, string>();
    for (const identity of rememberedIdentities) {
      const enrollmentId = String(identity.enrollment_id);
      if (!rosterIds.has(enrollmentId)) continue;
      const registrantId = String(identity.zoom_registrant_id || "").trim();
      const identityEmail = normalizeAttendanceEmail(identity.zoom_email);
      if (registrantId) identityByRegistrant.set(registrantId, enrollmentId);
      if (identityEmail) identityByEmail.set(identityEmail, enrollmentId);
    }

    const registrantEmailById = new Map<string, string>();
    for (const registrant of registrants) {
      const registrantId = String(registrant.id || registrant.registrant_id || "").trim();
      const registrantEmail = normalizeAttendanceEmail(registrant.email);
      if (registrantId && registrantEmail) registrantEmailById.set(registrantId, registrantEmail);
    }

    const registeredEnrollmentIds = new Set<string>();
    if (registrationAvailable) {
      for (const registrant of registrants) {
        const registrantId = String(registrant.id || registrant.registrant_id || "").trim();
        const registrantEmail = normalizeAttendanceEmail(registrant.email);
        const remembered = registrantId ? identityByRegistrant.get(registrantId) : undefined;
        if (remembered) {
          registeredEnrollmentIds.add(remembered);
          continue;
        }
        const rememberedEmail = registrantEmail ? identityByEmail.get(registrantEmail) : undefined;
        if (rememberedEmail) {
          registeredEnrollmentIds.add(rememberedEmail);
          continue;
        }
        const candidates = registrantEmail ? enrollmentsByEmail.get(registrantEmail) ?? [] : [];
        if (candidates.length === 1) registeredEnrollmentIds.add(candidates[0]);
      }
    }

    const matchedGroups = new Map<string, typeof aggregated>();
    const participantMatch = new Map<string, {enrollmentId: string; method: string}>();
    const unmatchedReasons = new Map<string, string>();

    for (const participant of aggregated) {
      let enrollmentId = participant.registrantId ? identityByRegistrant.get(participant.registrantId) || "" : "";
      let method = enrollmentId ? "registrant_identity" : "";
      if (!enrollmentId && participant.email) {
        enrollmentId = identityByEmail.get(participant.email) || "";
        if (enrollmentId) method = "email_identity";
      }
      if (!enrollmentId && participant.email) {
        const candidates = enrollmentsByEmail.get(participant.email) ?? [];
        if (candidates.length === 1) {
          enrollmentId = candidates[0];
          method = participant.registrantId ? "registrant_email" : "email";
        } else if (candidates.length > 1) {
          unmatchedReasons.set(participant.key, "Plusieurs étudiants Academy utilisent cet email.");
        }
      }
      if (!enrollmentId && participant.registrantId) {
        const registryEmail = registrantEmailById.get(participant.registrantId) || "";
        const candidates = registryEmail ? enrollmentsByEmail.get(registryEmail) ?? [] : [];
        if (candidates.length === 1) {
          enrollmentId = candidates[0];
          method = "registrant_id";
        }
      }

      if (enrollmentId && rosterIds.has(enrollmentId)) {
        participantMatch.set(participant.key, {enrollmentId, method});
        const rows = matchedGroups.get(enrollmentId) ?? [];
        rows.push(participant);
        matchedGroups.set(enrollmentId, rows);
      } else if (!unmatchedReasons.has(participant.key)) {
        unmatchedReasons.set(participant.key, participant.email
          ? "Aucun étudiant Academy ne correspond à cet email Zoom."
          : "Zoom n’a fourni aucun email permettant un rapprochement fiable.");
      }
    }

    const attendanceByEnrollment = new Map<string, AcademyZoomAttendanceRecordRow>(attendanceRecords.map((row) => [String(row.enrollment_id), row]));
    let autoPresentCount = 0;
    let autoLateCount = 0;
    let autoAbsentCount = 0;
    let reviewCount = 0;

    for (const enrollmentId of enrollmentIds) {
      const record = attendanceByEnrollment.get(enrollmentId);
      if (!record) continue;
      const groups = matchedGroups.get(enrollmentId) ?? [];
      const manualProtected = ["manual", "zoom_review"].includes(String(record.attendance_source || "manual"))
        && String(record.attendance_status) !== "unmarked";

      if (groups.length) {
        const allSegments = groups.flatMap((group) => group.rawSegments);
        const firstJoinAt = groups.map((group) => group.firstJoinAt).filter(Boolean).map(String).sort()[0] || null;
        const lastLeaveAt = groups.map((group) => group.lastLeaveAt).filter(Boolean).map(String).sort().at(-1) || null;
        const durationMinutes = groups.reduce((sum, group) => sum + group.durationMinutes, 0);
        const result = classifyAcademyZoomAttendance({
          durationMinutes,
          scheduledMinutes,
          firstJoinAt,
          meetingStartedAt: instance.start_time,
          lateGraceMinutes,
          presentThresholdPercent,
          partialThresholdPercent,
        });
        const primary = groups[0];
        const needsReview = result.classification === "partial" && !manualProtected;
        const officialStatus = manualProtected
          ? String(record.attendance_status)
          : result.classification === "partial"
            ? "unmarked"
            : result.classification;
        if (!manualProtected) {
          if (officialStatus === "present") autoPresentCount += 1;
          if (officialStatus === "late") autoLateCount += 1;
          if (officialStatus === "absent") autoAbsentCount += 1;
        }
        if (needsReview) reviewCount += 1;

        const {error: updateError} = await a.from("academy_attendance_records").update({
          attendance_status: officialStatus,
          arrived_at: formatTimeInZone(firstJoinAt, effectiveTimeZone),
          attendance_source: manualProtected ? record.attendance_source : "zoom_report",
          zoom_registrant_id: primary.registrantId,
          zoom_email: primary.email,
          zoom_display_name: primary.name,
          zoom_first_join_at: firstJoinAt,
          zoom_last_leave_at: lastLeaveAt,
          zoom_duration_minutes: Math.max(0, Math.round(durationMinutes)),
          zoom_attendance_percent: result.attendancePercent,
          zoom_late_minutes: result.lateMinutes,
          zoom_classification: result.classification,
          zoom_needs_review: needsReview,
          zoom_match_method: participantMatch.get(primary.key)?.method || "zoom",
          zoom_last_synced_at: now,
          marked_by: officialStatus !== "unmarked" ? user.id : null,
          marked_at: officialStatus !== "unmarked" ? now : null,
          updated_at: now,
        }).eq("id", record.id).eq("organization_id", m.organization_id);
        if (updateError) throw new Error(updateError.message);
        void allSegments;
      } else {
        const isRegistered = registrationAvailable && registeredEnrollmentIds.has(enrollmentId);
        const classification = isRegistered ? "absent" : "registration_missing";
        const needsReview = !isRegistered && !manualProtected;
        const officialStatus = manualProtected ? String(record.attendance_status) : isRegistered ? "absent" : "unmarked";
        if (!manualProtected && isRegistered) autoAbsentCount += 1;
        if (needsReview) reviewCount += 1;
        const {error: updateError} = await a.from("academy_attendance_records").update({
          attendance_status: officialStatus,
          attendance_source: manualProtected ? record.attendance_source : "zoom_report",
          zoom_first_join_at: null,
          zoom_last_leave_at: null,
          zoom_duration_minutes: 0,
          zoom_attendance_percent: isRegistered ? 0 : null,
          zoom_late_minutes: 0,
          zoom_classification: classification,
          zoom_needs_review: needsReview,
          zoom_match_method: isRegistered ? "registered_no_join" : "registration_missing",
          zoom_last_synced_at: now,
          marked_by: officialStatus !== "unmarked" ? user.id : null,
          marked_at: officialStatus !== "unmarked" ? now : null,
          updated_at: now,
        }).eq("id", record.id).eq("organization_id", m.organization_id);
        if (updateError) throw new Error(updateError.message);
      }
    }

    const {error: latestError} = await a.from("academy_zoom_attendance_participants")
      .update({is_latest: false})
      .eq("organization_id", m.organization_id)
      .eq("session_id", session.id)
      .eq("is_latest", true);
    if (latestError) throw new Error(latestError.message);

    const participantPayload = aggregated.map((participant) => {
      const match = participantMatch.get(participant.key);
      const result = classifyAcademyZoomAttendance({
        durationMinutes: participant.durationMinutes,
        scheduledMinutes,
        firstJoinAt: participant.firstJoinAt,
        meetingStartedAt: instance.start_time,
        lateGraceMinutes,
        presentThresholdPercent,
        partialThresholdPercent,
      });
      return {
        organization_id: m.organization_id,
        session_id: session.id,
        sync_id: syncId,
        zoom_meeting_id: zoomMeetingId,
        zoom_meeting_uuid: instance.uuid,
        zoom_registrant_id: participant.registrantId,
        zoom_user_id: participant.zoomUserId,
        participant_email: participant.email,
        participant_name: participant.name,
        first_join_at: participant.firstJoinAt,
        last_leave_at: participant.lastLeaveAt,
        duration_minutes: participant.durationMinutes,
        attendance_percent: result.attendancePercent,
        late_minutes: result.lateMinutes,
        classification: result.classification,
        matched_enrollment_id: match?.enrollmentId || null,
        match_method: match?.method || null,
        match_reason: match ? null : unmatchedReasons.get(participant.key) || "À rapprocher manuellement.",
        is_ignored: false,
        is_latest: true,
        raw_segments: participant.rawSegments,
      };
    });
    if (participantPayload.length) {
      const {error: participantInsertError} = await a.from("academy_zoom_attendance_participants").insert(participantPayload);
      if (participantInsertError) throw new Error(participantInsertError.message);
    }

    const unmatchedZoomCount = aggregated.filter((participant) => !participantMatch.has(participant.key)).length;
    const matchedStudentCount = matchedGroups.size;
    const attendanceEntryMode = "zoom_sync";
    const syncStatus = reviewCount > 0 || unmatchedZoomCount > 0 ? "review" : "synced";

    const {error: sessionUpdateError} = await a.from("academy_attendance_sessions").update({
      status: session.status === "planned" ? "open" : session.status,
      attendance_entry_mode: attendanceEntryMode,
      zoom_meeting_id: zoomMeetingId,
      zoom_meeting_uuid: instance.uuid,
      zoom_host_email: meeting?.host_email || null,
      zoom_instance_started_at: instance.start_time,
      zoom_timezone: effectiveTimeZone,
      zoom_last_synced_at: now,
      zoom_sync_status: syncStatus,
      zoom_sync_error: null,
      zoom_matched_count: matchedStudentCount,
      zoom_review_count: reviewCount,
      zoom_unmatched_participant_count: unmatchedZoomCount,
      zoom_registered_count: registrants.length,
      updated_at: now,
    }).eq("id", session.id).eq("organization_id", m.organization_id);
    if (sessionUpdateError) throw new Error(sessionUpdateError.message);

    const {error: syncUpdateError} = await a.from("academy_zoom_attendance_syncs").update({
      zoom_meeting_uuid: instance.uuid,
      zoom_instance_started_at: instance.start_time,
      registered_count: registrants.length,
      zoom_participant_count: aggregated.length,
      matched_student_count: matchedStudentCount,
      auto_present_count: autoPresentCount,
      auto_late_count: autoLateCount,
      auto_absent_count: autoAbsentCount,
      review_count: reviewCount,
      unmatched_zoom_count: unmatchedZoomCount,
      status: reviewCount > 0 || unmatchedZoomCount > 0 ? "completed_with_review" : "completed",
      completed_at: now,
      error_message: registrationAvailable ? null : "La liste des inscrits Zoom n’était pas accessible; les absences non connectées restent à vérifier.",
    }).eq("id", syncId);
    if (syncUpdateError) throw new Error(syncUpdateError.message);

    revalidatePath("/dashboard/academy/attendance");
    const registrationNote = registrationAvailable ? "" : " La liste des inscrits n’était pas accessible : les non-connectés restent à vérifier.";
    go(`Zoom synchronisé : ${matchedStudentCount} étudiant(s) rapproché(s), ${autoPresentCount} présent(s), ${autoLateCount} retard(s), ${autoAbsentCount} absent(s), ${reviewCount} à vérifier, ${unmatchedZoomCount} participant(s) Zoom non rapproché(s).${registrationNote}`, false, session.id);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    const message = friendlyZoomSyncError(error);
    const now = new Date().toISOString();
    await a.from("academy_zoom_attendance_syncs").update({status: "failed", error_message: message, completed_at: now}).eq("id", syncId);
    await a.from("academy_attendance_sessions").update({zoom_sync_status: "error", zoom_sync_error: message, updated_at: now}).eq("id", session.id).eq("organization_id", m.organization_id);
    revalidatePath("/dashboard/academy/attendance");
    go(message, true, session.id);
  }
}

export async function ignoreAcademyZoomParticipantAction(fd: FormData) {
  const participantId = text(fd.get("participant_id"), 80);
  const sessionId = text(fd.get("session_id"), 80);
  if (!participantId || !sessionId) go("Participant Zoom introuvable.", true, sessionId);

  const {a, user, m, assignments} = await ctx();
  const session = await getSessionScope(a, m.organization_id, sessionId);
  if (!session || !canTakeAttendance(m.role, assignments, session.school_id, session.program_id, session.cohort_id)) {
    throw new Error("Action Zoom non autorisée.");
  }

  const {data: participant, error: participantError} = await a.from("academy_zoom_attendance_participants")
    .select("id,participant_name")
    .eq("id", participantId)
    .eq("organization_id", m.organization_id)
    .eq("session_id", sessionId)
    .eq("is_latest", true)
    .is("matched_enrollment_id", null)
    .maybeSingle<{id: string; participant_name: string}>();
  if (participantError) go(participantError.message, true, sessionId);
  if (!participant) go("Ce participant Zoom n’est plus dans la liste à vérifier.", true, sessionId);

  const now = new Date().toISOString();
  const {error: ignoreError} = await a.from("academy_zoom_attendance_participants").update({
    is_ignored: true,
    ignore_reason: text(fd.get("ignore_reason"), 300) || "Staff, invité ou participant non étudiant",
    ignored_by: user.id,
    ignored_at: now,
  }).eq("id", participant.id).eq("organization_id", m.organization_id);
  if (ignoreError) go(ignoreError.message, true, sessionId);

  await refreshAcademyZoomReviewSummary(a, m.organization_id, sessionId);
  revalidatePath("/dashboard/academy/attendance");
  go(`« ${participant.participant_name} » a été ignoré pour cette séance Zoom.`, false, sessionId);
}

export async function mapAcademyZoomParticipantAction(fd: FormData) {
  const participantId = text(fd.get("participant_id"), 80);
  const enrollmentId = text(fd.get("enrollment_id"), 80);
  const sessionId = text(fd.get("session_id"), 80);
  if (!participantId || !enrollmentId || !sessionId) go("Choisis l’étudiant à associer au participant Zoom.", true, sessionId);

  const {a, user, m, assignments} = await ctx();
  const {data: session} = await a
    .from("academy_attendance_sessions")
    .select("id,school_id,program_id,cohort_id,session_date,status,attendance_entry_mode,zoom_meeting_id,zoom_timezone")
    .eq("id", sessionId)
    .eq("organization_id", m.organization_id)
    .maybeSingle<SessionScope & {zoom_meeting_id: string | null; zoom_timezone: string | null}>();
  if (!session || !canTakeAttendance(m.role, assignments, session.school_id, session.program_id, session.cohort_id)) throw new Error("Association Zoom non autorisée.");

  const [{data: participant, error: participantError}, {data: record, error: recordError}] = await Promise.all([
    a.from("academy_zoom_attendance_participants")
      .select("id,zoom_meeting_id,zoom_registrant_id,participant_email,participant_name,first_join_at,last_leave_at,duration_minutes,attendance_percent,late_minutes,classification,matched_enrollment_id")
      .eq("id", participantId)
      .eq("organization_id", m.organization_id)
      .eq("session_id", sessionId)
      .eq("is_latest", true)
      .maybeSingle<{
        id: string; zoom_meeting_id: string; zoom_registrant_id: string | null; participant_email: string | null;
        participant_name: string; first_join_at: string | null; last_leave_at: string | null; duration_minutes: number;
        attendance_percent: number | null; late_minutes: number; classification: string | null; matched_enrollment_id: string | null;
      }>(),
    a.from("academy_attendance_records")
      .select("id,enrollment_id")
      .eq("organization_id", m.organization_id)
      .eq("session_id", sessionId)
      .eq("enrollment_id", enrollmentId)
      .maybeSingle<{id: string; enrollment_id: string}>(),
  ]);
  if (participantError) go(participantError.message, true, sessionId);
  if (recordError) go(recordError.message, true, sessionId);
  if (!participant || participant.matched_enrollment_id) go("Ce participant Zoom est déjà associé.", true, sessionId);
  if (!record) go("L’étudiant choisi n’appartient pas à cette feuille d’appel.", true, sessionId);

  const zoomEmail = normalizeAttendanceEmail(participant.participant_email) || null;
  if (!participant.zoom_registrant_id && !zoomEmail) {
    go("Ce participant Zoom n’a ni registrant ID ni email stable; l’association ne peut pas être mémorisée de façon sûre.", true, sessionId);
  }

  let existingIdentity: {id: string; enrollment_id: string} | null = null;
  if (participant.zoom_registrant_id) {
    const {data, error} = await a.from("academy_zoom_student_identities")
      .select("id,enrollment_id")
      .eq("organization_id", m.organization_id)
      .eq("school_id", session.school_id)
      .eq("zoom_meeting_id", participant.zoom_meeting_id)
      .eq("zoom_registrant_id", participant.zoom_registrant_id)
      .limit(1)
      .maybeSingle<{id: string; enrollment_id: string}>();
    if (error) go(error.message, true, sessionId);
    existingIdentity = data ?? null;
  }
  if (!existingIdentity && zoomEmail) {
    const {data, error} = await a.from("academy_zoom_student_identities")
      .select("id,enrollment_id")
      .eq("organization_id", m.organization_id)
      .eq("school_id", session.school_id)
      .eq("zoom_meeting_id", participant.zoom_meeting_id)
      .ilike("zoom_email", zoomEmail)
      .limit(1)
      .maybeSingle<{id: string; enrollment_id: string}>();
    if (error) go(error.message, true, sessionId);
    existingIdentity = data ?? null;
  }

  if (existingIdentity) {
    const {error} = await a.from("academy_zoom_student_identities").update({
      enrollment_id: enrollmentId,
      zoom_registrant_id: participant.zoom_registrant_id,
      zoom_email: zoomEmail,
      source: "manual",
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }).eq("id", existingIdentity.id);
    if (error) go(error.message, true, sessionId);
  } else {
    const {error} = await a.from("academy_zoom_student_identities").insert({
      organization_id: m.organization_id,
      school_id: session.school_id,
      zoom_meeting_id: participant.zoom_meeting_id,
      enrollment_id: enrollmentId,
      zoom_registrant_id: participant.zoom_registrant_id,
      zoom_email: zoomEmail,
      source: "manual",
      created_by: user.id,
      updated_by: user.id,
    });
    if (error) go(error.message, true, sessionId);
  }

  const classification = String(participant.classification || "partial");
  const officialStatus = ["present", "late", "absent"].includes(classification) ? classification : "unmarked";
  const needsReview = classification === "partial";
  const now = new Date().toISOString();
  const {error: recordUpdateError} = await a.from("academy_attendance_records").update({
    attendance_status: officialStatus,
    attendance_source: needsReview ? "zoom_report" : "zoom_review",
    arrived_at: formatTimeInZone(participant.first_join_at, session.zoom_timezone || "Europe/Dublin"),
    zoom_registrant_id: participant.zoom_registrant_id,
    zoom_email: zoomEmail,
    zoom_display_name: participant.participant_name,
    zoom_first_join_at: participant.first_join_at,
    zoom_last_leave_at: participant.last_leave_at,
    zoom_duration_minutes: Math.max(0, Number(participant.duration_minutes || 0)),
    zoom_attendance_percent: participant.attendance_percent,
    zoom_late_minutes: Math.max(0, Number(participant.late_minutes || 0)),
    zoom_classification: classification,
    zoom_needs_review: needsReview,
    zoom_match_method: "manual_identity",
    zoom_last_synced_at: now,
    marked_by: officialStatus !== "unmarked" ? user.id : null,
    marked_at: officialStatus !== "unmarked" ? now : null,
    updated_at: now,
  }).eq("id", record.id).eq("organization_id", m.organization_id);
  if (recordUpdateError) go(recordUpdateError.message, true, sessionId);

  const {error: participantUpdateError} = await a.from("academy_zoom_attendance_participants").update({
    matched_enrollment_id: enrollmentId,
    match_method: "manual_identity",
    match_reason: null,
  }).eq("id", participant.id).eq("organization_id", m.organization_id);
  if (participantUpdateError) go(participantUpdateError.message, true, sessionId);

  await refreshAcademyZoomReviewSummary(a, m.organization_id, sessionId);

  revalidatePath("/dashboard/academy/attendance");
  go(`Association mémorisée pour « ${participant.participant_name} ». Les prochaines séances pourront réutiliser cette identité Zoom.`, false, sessionId);
}


export async function markUnmarkedPresentAction(fd: FormData) {
  const sessionId = text(fd.get("session_id"), 80);
  const {a, user, m, assignments} = await ctx();
  const session = await getSessionScope(a, m.organization_id, sessionId);
  if (!session || !canTakeAttendance(m.role, assignments, session.school_id, session.program_id, session.cohort_id)) {
    throw new Error("Pointage non autorisé.");
  }
  assertEditableAttendanceSession(session);
  await assertAttendanceEntryWindow(a, user.id, session);

  const now = new Date().toISOString();
  const {error} = await a.from("academy_attendance_records").update({
    attendance_status: "present",
    attendance_source: "manual",
    zoom_needs_review: false,
    marked_by: user.id,
    marked_at: now,
    updated_at: now,
  }).eq("organization_id", m.organization_id).eq("session_id", sessionId).eq("attendance_status", "unmarked");

  if (error) go(error.message, true, sessionId);
  if (session.attendance_entry_mode === "zoom_sync") {
    await refreshAcademyZoomReviewSummary(a, m.organization_id, sessionId);
  }
  revalidatePath("/dashboard/academy/attendance");
  go("Tous les étudiants non pointés ont été marqués présents. Corrige seulement les absents, retards ou excusés.", false, sessionId);
}

export async function saveAttendanceSheetAction(fd: FormData) {
  const sessionId = text(fd.get("session_id"), 80);
  const recordIds = [...new Set(fd.getAll("record_id").map((value) => text(value, 80)).filter(Boolean))].slice(0, 600);
  const {a, user, m, assignments} = await ctx();
  const session = await getSessionScope(a, m.organization_id, sessionId);

  if (!session || !canTakeAttendance(m.role, assignments, session.school_id, session.program_id, session.cohort_id)) {
    throw new Error("Pointage non autorisé.");
  }
  assertEditableAttendanceSession(session);
  await assertAttendanceEntryWindow(a, user.id, session);
  if (!recordIds.length) go("Aucun étudiant à enregistrer.", true, sessionId);

  const {data: rows, error: rowsError} = await a
    .from("academy_attendance_records")
    .select("id,organization_id,session_id,enrollment_id,attendance_status,arrived_at,comment,attendance_source,zoom_needs_review")
    .eq("organization_id", m.organization_id)
    .eq("session_id", sessionId)
    .in("id", recordIds);
  if (rowsError) go(rowsError.message, true, sessionId);
  if ((rows ?? []).length !== recordIds.length) go("La feuille d'appel contient un enregistrement hors périmètre.", true, sessionId);

  const now = new Date().toISOString();
  const payload = (rows ?? []).map((row) => {
    const id = String(row.id);
    const status = text(fd.get(`status_${id}`), 20) || "unmarked";
    if (!ATTENDANCE_STATUSES.includes(status as (typeof ATTENDANCE_STATUSES)[number])) {
      throw new Error(`Statut invalide pour ${id}.`);
    }
    const marked = status !== "unmarked";
    const arrivedAt = text(fd.get(`arrived_${id}`), 8) || null;
    const comment = text(fd.get(`comment_${id}`), 1000) || null;
    const currentArrivedAt = String(row.arrived_at ?? "").slice(0, 5) || null;
    const currentComment = text(row.comment, 1000) || null;
    const changed = status !== String(row.attendance_status || "unmarked")
      || arrivedAt !== currentArrivedAt
      || comment !== currentComment;
    const existingSource = String(row.attendance_source || "manual");
    const attendanceSource = row.zoom_needs_review && marked
      ? "zoom_review"
      : changed && ["zoom_report", "zoom_review"].includes(existingSource)
        ? "zoom_review"
        : existingSource;
    return {
      id,
      organization_id: String(row.organization_id),
      session_id: String(row.session_id),
      enrollment_id: String(row.enrollment_id),
      attendance_status: status,
      arrived_at: arrivedAt,
      comment,
      attendance_source: attendanceSource,
      zoom_needs_review: row.zoom_needs_review ? !marked : false,
      marked_by: marked ? user.id : null,
      marked_at: marked ? now : null,
      updated_at: now,
    };
  });

  const {error} = await a.from("academy_attendance_records").upsert(payload, {onConflict: "id"});
  if (error) go(error.message, true, sessionId);
  if (session.attendance_entry_mode === "zoom_sync") {
    await refreshAcademyZoomReviewSummary(a, m.organization_id, sessionId);
  }

  revalidatePath("/dashboard/academy/attendance");
  go(`Feuille d'appel enregistrée pour ${payload.length} étudiant(s).`, false, sessionId);
}

export async function markAttendanceAction(fd: FormData) {
  const recordId = text(fd.get("record_id"), 80);
  const status = text(fd.get("attendance_status"), 20);
  if (!ATTENDANCE_STATUSES.includes(status as (typeof ATTENDANCE_STATUSES)[number])) go("Statut invalide.", true);

  const {a, user, m, assignments} = await ctx();
  const {data: record} = await a
    .from("academy_attendance_records")
    .select("id,session_id")
    .eq("id", recordId)
    .eq("organization_id", m.organization_id)
    .maybeSingle<{id: string; session_id: string}>();
  if (!record) throw new Error("Pointage non autorisé.");

  const session = await getSessionScope(a, m.organization_id, record.session_id);
  if (!session || !canTakeAttendance(m.role, assignments, session.school_id, session.program_id, session.cohort_id)) {
    throw new Error("Pointage non autorisé.");
  }
  assertEditableAttendanceSession(session);
  await assertAttendanceEntryWindow(a, user.id, session);

  const now = new Date().toISOString();
  const marked = status !== "unmarked";
  const {error} = await a.from("academy_attendance_records").update({
    attendance_status: status,
    arrived_at: text(fd.get("arrived_at"), 8) || null,
    comment: text(fd.get("comment"), 1000) || null,
    attendance_source: "manual",
    zoom_needs_review: false,
    marked_by: marked ? user.id : null,
    marked_at: marked ? now : null,
    updated_at: now,
  }).eq("id", recordId).eq("organization_id", m.organization_id);

  if (error) go(error.message, true, session.id);
  if (session.attendance_entry_mode === "zoom_sync") {
    await refreshAcademyZoomReviewSummary(a, m.organization_id, session.id);
  }
  revalidatePath("/dashboard/academy/attendance");
  go("Présence enregistrée.", false, session.id);
}

export async function closeAttendanceSessionAction(fd: FormData) {
  fd.set("status", "closed");
  return updateAttendanceSessionStatusAction(fd);
}

export async function updateAttendanceSessionAction(fd: FormData) {
  const sessionId = text(fd.get("session_id"), 80);
  const schoolId = text(fd.get("school_id"), 80);
  const programId = nullableId(fd.get("program_id"));
  const cohortId = nullableId(fd.get("cohort_id"));
  const title = text(fd.get("title"), 200);
  const sessionDate = date(fd.get("session_date"));
  const trainer = nullableId(fd.get("trainer_user_id"));
  const deliveryMode = text(fd.get("delivery_mode"), 20);
  const sessionType = text(fd.get("session_type"), 30) || "class";

  if (title.length < 2 || !sessionDate) go("Titre et date obligatoires.", true, sessionId);
  if (!DELIVERY_MODES.includes(deliveryMode as (typeof DELIVERY_MODES)[number])) go("Mode de séance invalide.", true, sessionId);
  if (!SESSION_TYPES.includes(sessionType as (typeof SESSION_TYPES)[number])) go("Type de séance invalide.", true, sessionId);

  const {a, user, m, assignments} = await ctx();
  const current = await getSessionScope(a, m.organization_id, sessionId);
  if (!current ||
      !canManageSession(m.role, assignments, current.school_id, current.program_id, current.cohort_id) ||
      !canManageSession(m.role, assignments, schoolId, programId, cohortId)) {
    throw new Error("Modification non autorisée.");
  }

  const today = await getUserLocalDate(a, user.id);
  if (current.session_date >= today && sessionDate < today) {
    go("Une séance actuelle ne peut pas être déplacée vers le passé par l’édition normale. Utilisez « Saisir une présence passée ».", true, sessionId);
  }

  const {count} = await a.from("academy_attendance_records").select("id", {count: "exact", head: true}).eq("session_id", sessionId);
  const scopeChanged = current.school_id !== schoolId || (current.program_id ?? null) !== programId || (current.cohort_id ?? null) !== cohortId;
  if (scopeChanged && (count ?? 0) > 0) {
    go("Cette séance possède déjà une feuille d'appel. Son école, son programme et sa cohorte ne peuvent plus être changés.", true, sessionId);
  }

  if (programId) {
    const {data: program} = await a.from("academy_programs").select("id").eq("id", programId).eq("school_id", schoolId).eq("organization_id", m.organization_id).maybeSingle();
    if (!program) go("Programme invalide pour cette école.", true, sessionId);
  }
  if (cohortId) {
    const {data: cohort} = await a.from("academy_cohorts").select("id").eq("id", cohortId).eq("school_id", schoolId).eq("organization_id", m.organization_id).maybeSingle();
    if (!cohort) go("Cohorte invalide pour cette école.", true, sessionId);
  }

  const duration = Number(fd.get("duration_minutes") || 0);
  const {error} = await a.from("academy_attendance_sessions").update({
    school_id: schoolId,
    program_id: programId,
    cohort_id: cohortId,
    trainer_user_id: trainer,
    title,
    session_date: sessionDate,
    starts_at: text(fd.get("starts_at"), 8) || null,
    duration_minutes: Number.isInteger(duration) && duration > 0 && duration <= 1440 ? duration : null,
    delivery_mode: deliveryMode,
    location_or_link: text(fd.get("location_or_link"), 1000) || null,
    session_type: sessionType,
    updated_at: new Date().toISOString(),
  }).eq("id", sessionId).eq("organization_id", m.organization_id);

  if (error) go(error.message, true, sessionId);
  revalidatePath("/dashboard/academy/attendance");
  go("Séance mise à jour.", false, sessionId);
}

export async function updateAttendanceSessionStatusAction(fd: FormData) {
  const sessionId = text(fd.get("session_id"), 80);
  const status = text(fd.get("status"), 20);
  if (!SESSION_STATUSES.includes(status as (typeof SESSION_STATUSES)[number])) go("Statut de séance invalide.", true, sessionId);

  const {a, user, m, assignments} = await ctx();
  const session = await getSessionScope(a, m.organization_id, sessionId);
  if (!session) throw new Error("Séance introuvable.");

  if (status === "open") {
    const today = await getUserLocalDate(a, user.id);
    if (session.session_date < today && session.attendance_entry_mode !== "zoom_sync") {
      go("Pour réouvrir une séance passée, utilisez « Saisir une présence passée » afin que la modification soit auditée.", true, sessionId);
    }
  }

  const canOperate = canTakeAttendance(m.role, assignments, session.school_id, session.program_id, session.cohort_id);
  const canAdminister = canManageSession(m.role, assignments, session.school_id, session.program_id, session.cohort_id);
  if (["open", "closed"].includes(status) ? !canOperate : !canAdminister) {
    throw new Error("Changement de statut non autorisé.");
  }

  if (status === "closed") {
    const today = await getUserLocalDate(a, user.id);
    if (session.session_date < today && !["retroactive", "zoom_sync"].includes(String(session.attendance_entry_mode || "live"))) {
      go("Cette séance passée doit d’abord être ouverte avec « Saisir une présence passée » ou Smart Attendance Zoom avant toute clôture ou correction.", true, sessionId);
    }

    const {count, error: countError} = await a
      .from("academy_attendance_records")
      .select("id", {count: "exact", head: true})
      .eq("organization_id", m.organization_id)
      .eq("session_id", sessionId)
      .eq("attendance_status", "unmarked");
    if (countError) go(countError.message, true, sessionId);
    if ((count ?? 0) > 0) go(`Impossible de terminer l'appel : ${count} étudiant(s) ne sont pas encore pointé(s).`, true, sessionId);
  }

  const {error} = await a.from("academy_attendance_sessions").update({
    status,
    updated_at: new Date().toISOString(),
  }).eq("id", sessionId).eq("organization_id", m.organization_id);

  if (error) go(error.message, true, sessionId);
  revalidatePath("/dashboard/academy/attendance");
  const message = status === "archived" ? "Séance archivée. Son historique est conservé."
    : status === "closed" ? "Appel terminé et séance clôturée."
    : status === "open" ? "Appel ouvert."
    : "Statut de la séance mis à jour.";
  go(message, false, sessionId);
}
