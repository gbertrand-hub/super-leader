import Link from "next/link";
import {redirect} from "next/navigation";
import {
  archiveRecurringAttendanceSeriesAction,
  createAttendanceSessionAction,
  createPastAttendanceSessionAction,
  createRecurringAttendanceSeriesAction,
  markUnmarkedPresentAction,
  normalizeLegacyRecurringAttendanceAction,
  promoteAttendanceSessionToRecurringSeriesAction,
  openPastAttendanceSessionAction,
  repairAttendanceSessionScopeAction,
  saveAcademyZoomAttendanceSettingsAction,
  saveAttendanceSheetAction,
  syncAcademyAttendanceWithZoomAction,
  syncAttendanceRosterAction,
  mapAcademyZoomParticipantAction,
  ignoreAcademyZoomParticipantAction,
  updateAttendanceSessionAction,
  updateAttendanceSessionStatusAction,
} from "@/app/actions/academy-attendance";
import {academyGlobalRoles, getAcademyAssignments, hasAssignmentRole} from "@/lib/academy/access";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {extractZoomMeetingId} from "@/lib/zoom/academy-attendance";


type Props = {searchParams?: Promise<Record<string, string | string[] | undefined>>};
type SessionRow = {
  id: string;
  series_id: string | null;
  school_id: string;
  program_id: string | null;
  cohort_id: string | null;
  trainer_user_id: string | null;
  title: string;
  session_date: string;
  starts_at: string | null;
  duration_minutes: number | null;
  delivery_mode: string;
  location_or_link: string | null;
  session_type: string;
  status: string;
  attendance_entry_mode: string | null;
  retroactive_source: string | null;
  retroactive_reason: string | null;
  retroactive_entered_by: string | null;
  retroactive_entered_at: string | null;
  zoom_meeting_id: string | null;
  zoom_meeting_uuid: string | null;
  zoom_host_email: string | null;
  zoom_instance_started_at: string | null;
  zoom_timezone: string | null;
  zoom_last_synced_at: string | null;
  zoom_sync_status: string | null;
  zoom_sync_error: string | null;
  zoom_matched_count: number;
  zoom_review_count: number;
  zoom_unmatched_participant_count: number;
  zoom_registered_count: number;
};
type AttendanceSeriesRow = {
  id: string;
  school_id: string;
  trainer_user_id: string | null;
  title: string;
  session_type: string;
  schedule_type: string;
  weekdays: number[];
  monthly_ordinal: number | null;
  starts_on: string;
  ends_on: string;
  starts_at: string | null;
  duration_minutes: number | null;
  delivery_mode: string;
  location_or_link: string | null;
  is_active: boolean;
};
type AttendanceRecord = {
  id: string;
  session_id: string;
  enrollment_id: string;
  attendance_status: string;
  arrived_at: string | null;
  comment: string | null;
  attendance_source: string;
  zoom_registrant_id: string | null;
  zoom_email: string | null;
  zoom_display_name: string | null;
  zoom_first_join_at: string | null;
  zoom_last_leave_at: string | null;
  zoom_duration_minutes: number;
  zoom_attendance_percent: number | null;
  zoom_late_minutes: number;
  zoom_classification: string | null;
  zoom_needs_review: boolean;
  zoom_match_method: string | null;
  zoom_last_synced_at: string | null;
};

type AcademyZoomSettingsRow = {
  school_id: string;
  enabled: boolean;
  zoom_meeting_id: string;
  timezone: string;
  late_grace_minutes: number;
  present_threshold_percent: number;
  partial_threshold_percent: number;
};

type AcademyZoomParticipantRow = {
  id: string;
  session_id: string;
  zoom_registrant_id: string | null;
  participant_email: string | null;
  participant_name: string;
  first_join_at: string | null;
  last_leave_at: string | null;
  duration_minutes: number;
  attendance_percent: number | null;
  late_minutes: number;
  classification: string | null;
  match_reason: string | null;
};
type ScopeEnrollment = {
  id: string;
  school_id: string;
  program_id: string | null;
  cohort_id: string | null;
};
type AttendanceEnrollmentRow = {
  id: string;
  user_id: string | null;
  crm_client_id: string | null;
};
type SchoolRow = {
  id: string;
  name: string;
  attendance_enrollment_scope: string | null;
};

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const positiveInt = (value: string, fallback = 1) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; };
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const attendanceLabel = (status: string) => ({unmarked: "Non pointé", present: "Présent", absent: "Absent", late: "Retard", excused: "Excusé"})[status] ?? status;
const sessionLabel = (status: string) => ({planned: "Planifiée", open: "Appel ouvert", closed: "Terminée", cancelled: "Annulée", archived: "Archivée"})[status] ?? status;
const sessionTypeLabel = (status: string) => ({class: "Cours", mastermind: "Mastermind", practice: "Pratique", coaching_call: "Coaching call", review: "Révision", assessment: "Évaluation", other: "Autre"})[status] ?? status;
const zoomClassificationLabel = (status: string | null) => ({present: "Présence Zoom confirmée", late: "Retard détecté", partial: "Présence partielle", absent: "Absent selon Zoom", registration_missing: "Inscription Zoom à vérifier"})[String(status ?? "")] ?? "Non synchronisé";
const retroactiveSourceLabel = (source: string | null) => ({paper_sheet: "Feuille papier", manual_register: "Registre manuel", other: "Autre source"})[String(source ?? "")] ?? "Source non précisée";

function previousDate(value: string) {
  const current = new Date(`${value}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() - 1);
  return current.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const current = new Date(`${value}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

const weekdayOptions = [
  {value: 0, label: "Dimanche"},
  {value: 1, label: "Lundi"},
  {value: 2, label: "Mardi"},
  {value: 3, label: "Mercredi"},
  {value: 4, label: "Jeudi"},
  {value: 5, label: "Vendredi"},
  {value: 6, label: "Samedi"},
] as const;

function weekdaySummary(values: number[]) {
  const labels = weekdayOptions.filter((item) => values.includes(item.value)).map((item) => item.label);
  return labels.join(", ") || "Jour non défini";
}

const monthlyOrdinalLabels = new Map<number, string>([
  [1, "Premier"],
  [2, "Deuxième"],
  [3, "Troisième"],
  [4, "Quatrième"],
  [-1, "Dernier"],
]);

function seriesScheduleSummary(series: AttendanceSeriesRow) {
  if (series.schedule_type === "monthly") {
    const ordinal = monthlyOrdinalLabels.get(Number(series.monthly_ordinal)) ?? "Mensuel";
    const day = weekdaySummary(series.weekdays ?? []);
    return `${ordinal} ${day.toLocaleLowerCase("fr")} du mois`;
  }
  return `Chaque ${weekdaySummary(series.weekdays ?? []).toLocaleLowerCase("fr")}`;
}

function assignmentMatchesScope(
  assignment: Awaited<ReturnType<typeof getAcademyAssignments>>[number],
  session: SessionRow,
) {
  if (assignment.school_id !== session.school_id) return false;
  if (assignment.program_id && assignment.program_id !== session.program_id) return false;
  if (assignment.cohort_id && assignment.cohort_id !== session.cohort_id) return false;
  return true;
}

function canViewSession(
  role: string,
  assignments: Awaited<ReturnType<typeof getAcademyAssignments>>,
  session: SessionRow,
) {
  if (academyGlobalRoles.has(role)) return true;
  if (hasAssignmentRole(assignments, session.school_id, ["director", "academic_coordinator"])) return true;
  return assignments.some((assignment) =>
    ["instructor", "follow_up"].includes(assignment.assignment_role) && assignmentMatchesScope(assignment, session),
  );
}

function canManageSession(
  role: string,
  assignments: Awaited<ReturnType<typeof getAcademyAssignments>>,
  session: SessionRow,
) {
  if (academyGlobalRoles.has(role)) return true;
  if (hasAssignmentRole(assignments, session.school_id, ["director", "academic_coordinator"])) return true;
  return assignments.some((assignment) => assignment.assignment_role === "instructor" && assignmentMatchesScope(assignment, session));
}

function canTakeAttendance(
  role: string,
  assignments: Awaited<ReturnType<typeof getAcademyAssignments>>,
  session: SessionRow,
) {
  return canViewSession(role, assignments, session);
}

function canTakeAttendanceForSchool(
  role: string,
  assignments: Awaited<ReturnType<typeof getAcademyAssignments>>,
  schoolId: string,
) {
  if (academyGlobalRoles.has(role)) return true;
  if (hasAssignmentRole(assignments, schoolId, ["director", "academic_coordinator"])) return true;
  return assignments.some((assignment) =>
    assignment.school_id === schoolId && ["instructor", "follow_up"].includes(assignment.assignment_role),
  );
}

function todayInTimeZone(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {timeZone, year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function countStatuses(rows: AttendanceRecord[]) {
  return {
    present: rows.filter((row) => row.attendance_status === "present").length,
    absent: rows.filter((row) => row.attendance_status === "absent").length,
    late: rows.filter((row) => row.attendance_status === "late").length,
    excused: rows.filter((row) => row.attendance_status === "excused").length,
    unmarked: rows.filter((row) => row.attendance_status === "unmarked").length,
  };
}

async function loadAttendanceRecords(
  admin: ReturnType<typeof createAdminClient>,
  sessionIds: string[],
) {
  if (!sessionIds.length) return [] as AttendanceRecord[];

  const sessionBatchSize = 40;
  const pageSize = 900;
  const records: AttendanceRecord[] = [];

  for (let batchStart = 0; batchStart < sessionIds.length; batchStart += sessionBatchSize) {
    const batchIds = sessionIds.slice(batchStart, batchStart + sessionBatchSize);

    for (let from = 0; ; from += pageSize) {
      const {data, error} = await admin
        .from("academy_attendance_records")
        .select("id,session_id,enrollment_id,attendance_status,arrived_at,comment,attendance_source,zoom_registrant_id,zoom_email,zoom_display_name,zoom_first_join_at,zoom_last_leave_at,zoom_duration_minutes,zoom_attendance_percent,zoom_late_minutes,zoom_classification,zoom_needs_review,zoom_match_method,zoom_last_synced_at")
        .in("session_id", batchIds)
        .order("id", {ascending: true})
        .range(from, from + pageSize - 1);

      if (error) throw new Error(`Impossible de charger les feuilles d’appel : ${error.message}`);

      const page = (data ?? []) as AttendanceRecord[];
      records.push(...page);
      if (page.length < pageSize) break;
    }
  }

  return records;
}

export default async function AttendancePage({searchParams}: Props) {
  const query = (await searchParams) ?? {};
  const selectedSessionId = first(query.session);
  const selectedSchoolId = first(query.school);
  const requestedSessionView = first(query.view);
  const requestedSessionPage = positiveInt(first(query.page));
  const requestedAttendanceView = first(query.attendance_view);
  const supabase = await createClient();
  const {data: auth} = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");

  const assignments = await getAcademyAssignments(admin, membership.organization_id, auth.user.id);
  const global = academyGlobalRoles.has(membership.role);
  const hasAttendanceRole = global || assignments.some((assignment) => ["director", "academic_coordinator", "instructor", "follow_up"].includes(assignment.assignment_role));
  if (!hasAttendanceRole) redirect("/dashboard/academy");

  const [{data: allSchools}, {data: programs}, {data: cohorts}, {data: sessions}, {data: members}, {data: recurringSeries}, {data: me}, {data: zoomSettingsRows}] = await Promise.all([
    admin.from("academy_schools").select("id,name,attendance_enrollment_scope").eq("organization_id", membership.organization_id).eq("is_active", true).order("name"),
    admin.from("academy_programs").select("id,school_id,name").eq("organization_id", membership.organization_id).neq("status", "archived"),
    admin.from("academy_cohorts").select("id,school_id,name").eq("organization_id", membership.organization_id).neq("status", "archived"),
    admin.from("academy_attendance_sessions").select("id,series_id,school_id,program_id,cohort_id,trainer_user_id,title,session_date,starts_at,duration_minutes,delivery_mode,location_or_link,session_type,status,attendance_entry_mode,retroactive_source,retroactive_reason,retroactive_entered_by,retroactive_entered_at,zoom_meeting_id,zoom_meeting_uuid,zoom_host_email,zoom_instance_started_at,zoom_timezone,zoom_last_synced_at,zoom_sync_status,zoom_sync_error,zoom_matched_count,zoom_review_count,zoom_unmatched_participant_count,zoom_registered_count").eq("organization_id", membership.organization_id).order("session_date", {ascending: false}).limit(400),
    admin.from("organization_members").select("user_id").eq("organization_id", membership.organization_id).eq("is_active", true),
    admin.from("academy_attendance_series").select("id,school_id,trainer_user_id,title,session_type,schedule_type,weekdays,monthly_ordinal,starts_on,ends_on,starts_at,duration_minutes,delivery_mode,location_or_link,is_active").eq("organization_id", membership.organization_id).eq("is_active", true).order("starts_on", {ascending: true}),
    admin.from("profiles").select("time_zone").eq("id", auth.user.id).maybeSingle<{time_zone: string | null}>(),
    admin.from("academy_zoom_attendance_settings").select("school_id,enabled,zoom_meeting_id,timezone,late_grace_minutes,present_threshold_percent,partial_threshold_percent").eq("organization_id", membership.organization_id),
  ]);

  const visibleSessions = ((sessions ?? []) as SessionRow[]).filter((session) => canViewSession(membership.role, assignments, session));
  const visibleSchoolIds = new Set(visibleSessions.map((session) => session.school_id));
  for (const assignment of assignments) visibleSchoolIds.add(assignment.school_id);
  const schools = ((allSchools ?? []) as SchoolRow[]).filter((school) => global || visibleSchoolIds.has(String(school.id)));
  const schoolBy = new Map(schools.map((school) => [String(school.id), String(school.name)]));
  const zoomSettingsBySchool = new Map(((zoomSettingsRows ?? []) as AcademyZoomSettingsRow[]).map((row) => [String(row.school_id), row]));
  const schoolWideAttendanceIds = new Set(
    schools.filter((school) => school.attendance_enrollment_scope === "school_wide").map((school) => String(school.id)),
  );
  const programBy = new Map((programs ?? []).map((program) => [String(program.id), String(program.name)]));
  const cohortBy = new Map((cohorts ?? []).map((cohort) => [String(cohort.id), String(cohort.name)]));
  const manageableSeriesSchoolIds = new Set(schools
    .filter((school) => global || hasAssignmentRole(assignments, String(school.id), ["director", "academic_coordinator"]))
    .map((school) => String(school.id)));
  const activeSeries = ((recurringSeries ?? []) as AttendanceSeriesRow[])
    .filter((series) => manageableSeriesSchoolIds.has(series.school_id))
    .filter((series) => !selectedSchoolId || series.school_id === selectedSchoolId);
  const canManageRecurringSeries = manageableSeriesSchoolIds.size > 0;

  const visibleSchoolIdList = schools.map((school) => String(school.id));
  const {data: scopeEnrollmentData} = visibleSchoolIdList.length
    ? await admin
      .from("academy_school_enrollments")
      .select("id,school_id,program_id,cohort_id")
      .eq("organization_id", membership.organization_id)
      .in("school_id", visibleSchoolIdList)
      .in("academic_status", ["admitted", "enrolled", "active"])
    : {data: []};
  const scopeEnrollments = (scopeEnrollmentData ?? []) as ScopeEnrollment[];

  const filteredSessions = visibleSessions.filter((session) => !selectedSchoolId || session.school_id === selectedSchoolId);
  const sessionIds = filteredSessions.map((session) => session.id);
  const records = await loadAttendanceRecords(admin, sessionIds);
  const {data: unmatchedZoomData} = sessionIds.length
    ? await admin.from("academy_zoom_attendance_participants")
      .select("id,session_id,zoom_registrant_id,participant_email,participant_name,first_join_at,last_leave_at,duration_minutes,attendance_percent,late_minutes,classification,match_reason")
      .in("session_id", sessionIds)
      .eq("organization_id", membership.organization_id)
      .eq("is_latest", true)
      .eq("is_ignored", false)
      .is("matched_enrollment_id", null)
      .order("participant_name", {ascending: true})
    : {data: []};
  const unmatchedZoomParticipants = (unmatchedZoomData ?? []) as AcademyZoomParticipantRow[];
  const enrollmentIds = [...new Set(records.map((record) => record.enrollment_id))];
  const {data: enrollments} = enrollmentIds.length
    ? await admin.from("academy_school_enrollments").select("id,user_id,crm_client_id").in("id", enrollmentIds)
    : {data: []};
  const attendanceEnrollments = (enrollments ?? []) as AttendanceEnrollmentRow[];

  const userIds = [...new Set([
    ...attendanceEnrollments.map((item) => item.user_id).filter(Boolean).map(String),
    ...(members ?? []).map((item) => String(item.user_id)),
    ...visibleSessions.map((session) => session.retroactive_entered_by).filter(Boolean).map(String),
  ])];
  const crmIds = [...new Set(attendanceEnrollments.map((item) => item.crm_client_id).filter(Boolean).map(String))];
  const [{data: profiles}, {data: clients}] = await Promise.all([
    userIds.length ? admin.from("profiles").select("id,full_name,email").in("id", userIds) : Promise.resolve({data: []}),
    crmIds.length ? admin.from("crm_clients").select("id,full_name,email").in("id", crmIds) : Promise.resolve({data: []}),
  ]);

  const personBy = new Map<string, string>();
  const personEmailBy = new Map<string, string>();
  (profiles ?? []).forEach((profile) => {
    personBy.set(`u:${profile.id}`, String(profile.full_name || profile.email || "Membre"));
    personEmailBy.set(`u:${profile.id}`, String(profile.email || ""));
  });
  (clients ?? []).forEach((client) => {
    personBy.set(`c:${client.id}`, String(client.full_name || client.email || "Étudiant"));
    personEmailBy.set(`c:${client.id}`, String(client.email || ""));
  });
  const profileBy = new Map((profiles ?? []).map((profile) => [String(profile.id), String(profile.full_name || profile.email || "Membre")]));
  const enrollmentBy = new Map<string, AttendanceEnrollmentRow>(attendanceEnrollments.map((enrollment) => [String(enrollment.id), enrollment]));

  const today = todayInTimeZone(String(me?.time_zone || "UTC"));
  const yesterday = previousDate(today);
  const defaultSeriesEnd = addDays(today, 365);
  const activeSeriesKeys = new Set(((recurringSeries ?? []) as AttendanceSeriesRow[])
    .filter((series) => series.is_active)
    .map((series) => `${series.school_id}::${series.title.trim().toLocaleLowerCase("fr")}`));
  const legacyRecurringGroups = new Map<string, SessionRow[]>();
  for (const session of filteredSessions) {
    if (session.series_id || ["cancelled", "archived"].includes(session.status)) continue;
    if (!schoolWideAttendanceIds.has(session.school_id) || !manageableSeriesSchoolIds.has(session.school_id)) continue;
    if (activeSeriesKeys.has(`${session.school_id}::${session.title.trim().toLocaleLowerCase("fr")}`)) continue;
    const parsed = new Date(`${session.session_date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) continue;
    const weekday = parsed.getUTCDay();
    const key = `${session.school_id}::${session.title.trim().toLocaleLowerCase("fr")}::${weekday}`;
    const group = legacyRecurringGroups.get(key) ?? [];
    group.push(session);
    legacyRecurringGroups.set(key, group);
  }
  const legacyRecurringCandidates = [...legacyRecurringGroups.values()]
    .map((group) => [...group].sort((a, b) => a.session_date.localeCompare(b.session_date)))
    .filter((group) => group.length >= 2)
    .map((group) => {
      const firstSession = group[0];
      const lastSession = group[group.length - 1];
      const referenceSession = group.find((session) => session.session_date >= today) ?? lastSession;
      const parsed = new Date(`${firstSession.session_date}T00:00:00Z`);
      return {
        schoolId: firstSession.school_id,
        title: firstSession.title,
        weekday: parsed.getUTCDay(),
        firstDate: firstSession.session_date,
        lastDate: lastSession.session_date,
        count: group.length,
        sessionType: referenceSession.session_type,
        startsAt: referenceSession.starts_at,
      };
    })
    .filter((candidate) => candidate.lastDate >= today)
    .sort((a, b) => {
      const schoolCompare = String(schoolBy.get(a.schoolId) ?? "").localeCompare(String(schoolBy.get(b.schoolId) ?? ""), "fr");
      if (schoolCompare !== 0) return schoolCompare;
      return a.title.localeCompare(b.title, "fr");
    });
  const todaySessions = filteredSessions.filter((session) => session.session_date === today && !["cancelled", "archived"].includes(session.status));
  const todaySessionIds = new Set(todaySessions.map((session) => session.id));
  const todayStats = countStatuses(records.filter((record) => todaySessionIds.has(record.session_id)));
  const orderedSessions = [...filteredSessions].sort((a, b) => {
    if (a.id === selectedSessionId) return -1;
    if (b.id === selectedSessionId) return 1;

    const rank = (sessionDate: string) => {
      if (sessionDate === today) return 0;
      if (sessionDate > today) return 1;
      return 2;
    };

    const aRank = rank(a.session_date);
    const bRank = rank(b.session_date);
    if (aRank !== bRank) return aRank - bRank;

    const aKey = `${a.session_date}${a.starts_at ?? ""}`;
    const bKey = `${b.session_date}${b.starts_at ?? ""}`;

    // Today and future sessions: nearest first. Past sessions: most recent first.
    return aRank <= 1 ? aKey.localeCompare(bKey) : bKey.localeCompare(aKey);
  });
  const selectedSession = selectedSessionId ? filteredSessions.find((session) => session.id === selectedSessionId) : undefined;
  const sessionView = requestedSessionView === "history" || requestedSessionView === "upcoming"
    ? requestedSessionView
    : selectedSession && selectedSession.session_date < today ? "history" : "upcoming";
  const upcomingSessionCount = orderedSessions.filter((session) => session.session_date >= today).length;
  const historySessionCount = orderedSessions.filter((session) => session.session_date < today).length;
  const sessionsForView = orderedSessions.filter((session) => sessionView === "history" ? session.session_date < today : session.session_date >= today);
  const sessionPageSize = 8;
  const sessionPageCount = Math.max(1, Math.ceil(sessionsForView.length / sessionPageSize));
  const sessionPage = Math.min(requestedSessionPage, sessionPageCount);
  const pageStart = (sessionPage - 1) * sessionPageSize;
  let displayedSessions = sessionsForView.slice(pageStart, pageStart + sessionPageSize);
  if (selectedSession && (sessionView === "history" ? selectedSession.session_date < today : selectedSession.session_date >= today) && !displayedSessions.some((session) => session.id === selectedSession.id)) {
    displayedSessions = [selectedSession, ...displayedSessions.filter((session) => session.id !== selectedSession.id)].slice(0, sessionPageSize);
  }
  const sessionListHref = (view: "upcoming" | "history", page = 1) => {
    const params = new URLSearchParams();
    if (selectedSchoolId) params.set("school", selectedSchoolId);
    params.set("view", view);
    if (page > 1) params.set("page", String(page));
    return `/dashboard/academy/attendance?${params.toString()}#sessions-list`;
  };

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/dashboard/academy" className="font-bold text-violet-700">← Super Leader Academy</Link>
        <nav className="mt-5 flex gap-2">
          <span className="rounded-xl bg-violet-700 px-5 py-3 font-black text-white">Présences</span>
          <Link href="/dashboard/academy/assessments" className="rounded-xl border bg-white px-5 py-3 font-black text-violet-700">Évaluations</Link>
        </nav>

        <header className="mt-4 rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white">
          <p className="text-sm font-black uppercase tracking-[.2em] text-amber-400">Appel simplifié</p>
          <h1 className="mt-2 text-4xl font-black">Présences & appel</h1>
          <p className="mt-3 max-w-3xl text-slate-300">Choisis la séance du jour pour l’appel normal. Si une feuille papier a été utilisée, la saisie passée permet de la reporter avec une trace d’audit.</p>
        </header>

        {first(query.success) ? <p className="mt-5 rounded-xl bg-emerald-100 p-4 font-bold text-emerald-900">{first(query.success)}</p> : null}
        {first(query.error) ? <p className="mt-5 rounded-xl bg-red-100 p-4 font-bold text-red-900">{first(query.error)}</p> : null}

        <section className="mt-6 rounded-3xl border border-violet-200 bg-violet-50 p-6">
          <p className="text-xs font-black uppercase tracking-[.18em] text-violet-700">Comment faire l’appel</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <GuideStep n="1" title="Choisir la séance" text="Ouvre la séance Academy correspondant au cours Zoom." />
            <GuideStep n="2" title="Synchroniser Zoom" text="Après le cours, Super Leader récupère les inscrits, connexions et durées automatiquement." />
            <GuideStep n="3" title="Vérifier les exceptions" text="Traite seulement les cas à vérifier, puis termine l’appel quand la feuille est complète." />
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-5">
          <Stat n={todaySessions.length} label="Séances aujourd’hui" />
          <Stat n={todayStats.present} label="Présents aujourd’hui" />
          <Stat n={todayStats.absent} label="Absents aujourd’hui" />
          <Stat n={todayStats.late} label="Retards aujourd’hui" />
          <Stat n={todayStats.unmarked} label="Non pointés aujourd’hui" />
        </section>

        <section className="mt-7 rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[.18em] text-violet-700">Aujourd’hui · {today}</p>
              <h2 className="mt-1 text-2xl font-black">Séances à appeler</h2>
            </div>
            {schools.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                <Link href="/dashboard/academy/attendance" className={`rounded-xl px-3 py-2 text-sm font-black ${!selectedSchoolId ? "bg-slate-950 text-white" : "border bg-white"}`}>Toutes les écoles</Link>
                {schools.map((school) => (
                  <Link key={String(school.id)} href={`/dashboard/academy/attendance?school=${encodeURIComponent(String(school.id))}`} className={`rounded-xl px-3 py-2 text-sm font-black ${selectedSchoolId === String(school.id) ? "bg-violet-700 text-white" : "border bg-white"}`}>{String(school.name)}</Link>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {todaySessions.map((session) => {
              const rows = records.filter((record) => record.session_id === session.id);
              const stats = countStatuses(rows);
              return (
                <div key={session.id} className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
                  <p className="text-xs font-black uppercase text-violet-700">{schoolBy.get(session.school_id)}</p>
                  <h3 className="mt-1 text-xl font-black">{session.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{sessionTypeLabel(session.session_type)} · {String(session.starts_at ?? "").slice(0, 5) || "Heure non définie"} · {cohortBy.get(String(session.cohort_id)) ?? programBy.get(String(session.program_id)) ?? "Toute l’école"}</p>
                  <p className="mt-3 text-sm font-bold text-slate-700">{rows.length} étudiant(s) · {stats.unmarked} non pointé(s)</p>
                  <Link href={`/dashboard/academy/attendance?session=${encodeURIComponent(session.id)}${selectedSchoolId ? `&school=${encodeURIComponent(selectedSchoolId)}` : ""}#attendance-${session.id}`} className="mt-4 inline-flex rounded-xl bg-violet-700 px-5 py-3 font-black text-white">Faire l’appel →</Link>
                </div>
              );
            })}
            {!todaySessions.length ? (
              <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-6 lg:col-span-2">
                <p className="font-black text-amber-950">Aucune séance d’appel n’est préparée pour aujourd’hui dans ton périmètre.</p>
                <p className="mt-2 text-sm text-amber-900">Si la séance existe déjà dans la liste ci-dessous, ouvre-la. Sinon, utilise « Créer exceptionnellement une séance » pour générer immédiatement la feuille d’appel.</p>
              </div>
            ) : null}
          </div>
        </section>

        {canManageRecurringSeries ? (
          <details open={!todaySessions.length} className="mt-6 rounded-3xl border border-emerald-300 bg-emerald-50 p-6">
            <summary className="cursor-pointer text-xl font-black text-emerald-950">Programmer une activité récurrente</summary>
            <p className="mt-2 max-w-4xl text-sm text-emerald-900">Utilise cette fonction pour les Masterminds, Coaching Calls, pratiques ou autres activités hebdomadaires ou mensuelles. Une activité récurrente appartient directement à l’école : elle ne crée ni nouveau programme ni nouvelle cohorte.</p>

            <form action={createRecurringAttendanceSeriesAction} className="mt-5 grid gap-4 md:grid-cols-3">
              <Label t="Nom de l’activité"><input name="title" required placeholder="Ex. Mastermind École des Affaires" className={input} /></Label>
              <SessionType value="mastermind" />
              <Label t="École">
                <select name="school_id" required defaultValue={selectedSchoolId && manageableSeriesSchoolIds.has(selectedSchoolId) && schoolWideAttendanceIds.has(selectedSchoolId) ? selectedSchoolId : ""} className={input}>
                  <option value="">Sélectionner…</option>
                  {schools.filter((school) => manageableSeriesSchoolIds.has(String(school.id)) && schoolWideAttendanceIds.has(String(school.id))).map((school) => <option key={`series-${String(school.id)}`} value={String(school.id)}>{String(school.name)}</option>)}
                </select>
              </Label>
              <Trainer members={members ?? []} profiles={profileBy} value={auth.user.id} />
              <Label t="Début"><input type="date" name="starts_on" required min={today} defaultValue={today} className={input} /></Label>
              <Label t="Fin"><input type="date" name="ends_on" required min={today} defaultValue={defaultSeriesEnd} className={input} /></Label>
              <Label t="Fréquence">
                <select name="schedule_type" defaultValue="weekly" className={input}>
                  <option value="weekly">Hebdomadaire</option>
                  <option value="monthly">Mensuelle</option>
                </select>
              </Label>
              <div className="md:col-span-3 rounded-2xl border border-emerald-200 bg-white/70 p-4">
                <p className="text-sm font-black text-slate-800">Si la fréquence est hebdomadaire</p>
                <p className="mt-1 text-xs text-slate-500">Choisis un ou plusieurs jours. Ces jours sont ignorés lorsque la fréquence « Mensuelle » est sélectionnée.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {weekdayOptions.map((day) => (
                    <label key={day.value} className="flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                      <input type="checkbox" name="weekdays" value={day.value} defaultChecked={day.value === 0} />
                      {day.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="md:col-span-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
                <p className="text-sm font-black text-violet-950">Si la fréquence est mensuelle</p>
                <p className="mt-1 text-xs text-violet-700">Exemple : « Dernier mercredi du mois ». Ces deux champs sont ignorés pour une série hebdomadaire.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Label t="Position dans le mois">
                    <select name="monthly_ordinal" defaultValue="-1" className={input}>
                      <option value="1">Premier</option>
                      <option value="2">Deuxième</option>
                      <option value="3">Troisième</option>
                      <option value="4">Quatrième</option>
                      <option value="-1">Dernier</option>
                    </select>
                  </Label>
                  <Label t="Jour">
                    <select name="monthly_weekday" defaultValue="3" className={input}>
                      {weekdayOptions.map((day) => <option key={`monthly-${day.value}`} value={day.value}>{day.label}</option>)}
                    </select>
                  </Label>
                </div>
              </div>
              <Label t="Heure"><input type="time" name="starts_at" className={input} /></Label>
              <Label t="Durée (minutes)"><input type="number" min="1" max="1440" name="duration_minutes" defaultValue="90" className={input} /></Label>
              <Mode />
              <label className="text-sm font-bold text-slate-700 md:col-span-2">Lieu ou lien<input name="location_or_link" placeholder="Ex. Zoom / salle" className={input} /></label>
              <button className="self-end rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">Créer toute la série</button>
            </form>

            <div className="mt-6 border-t border-emerald-200 pt-5">
              <p className="font-black text-emerald-950">Séries actives</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {activeSeries.map((series) => {
                  const generatedCount = visibleSessions.filter((session) => session.series_id === series.id && !["cancelled", "archived"].includes(session.status)).length;
                  return (
                    <div key={series.id} className="rounded-2xl border border-emerald-200 bg-white p-4">
                      <p className="text-xs font-black uppercase text-emerald-700">{schoolBy.get(series.school_id) ?? "École"} · {sessionTypeLabel(series.session_type)}</p>
                      <h3 className="mt-1 font-black text-slate-950">{series.title}</h3>
                      <p className="mt-1 text-sm text-slate-600">{seriesScheduleSummary(series)} · {String(series.starts_at ?? "").slice(0, 5) || "Heure non définie"} · du {series.starts_on} au {series.ends_on}</p>
                      <p className="mt-2 text-sm font-bold text-slate-700">{generatedCount} séance(s) active(s) générée(s)</p>
                      <form action={archiveRecurringAttendanceSeriesAction} className="mt-3">
                        <input type="hidden" name="series_id" value={series.id} />
                        <button className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-700">Désactiver la série</button>
                      </form>
                    </div>
                  );
                })}
                {!activeSeries.length ? <p className="rounded-2xl border border-dashed border-emerald-300 bg-white p-4 text-sm text-slate-600 lg:col-span-2">Aucune série récurrente active dans ce périmètre.</p> : null}
              </div>
            </div>

            {legacyRecurringCandidates.length ? (
              <div className="mt-6 border-t border-amber-200 pt-5">
                <p className="text-xs font-black uppercase tracking-[.15em] text-amber-700">Récurrences historiques détectées</p>
                <h3 className="mt-1 text-lg font-black text-slate-950">Normaliser les anciennes séances sans créer de doublons</h3>
                <p className="mt-2 max-w-4xl text-sm text-slate-600">Super Leader a repéré des séances répétées qui utilisent encore l’ancien moteur. La normalisation rattache les séances déjà existantes à une vraie série récurrente, conserve leurs présences et complète seulement les dates futures manquantes.</p>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {legacyRecurringCandidates.map((candidate) => (
                    <form key={`${candidate.schoolId}-${candidate.title}-${candidate.weekday}`} action={normalizeLegacyRecurringAttendanceAction} className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                      <input type="hidden" name="school_id" value={candidate.schoolId} />
                      <input type="hidden" name="legacy_title" value={candidate.title} />
                      <input type="hidden" name="weekday" value={candidate.weekday} />
                      <p className="text-xs font-black uppercase text-amber-700">{schoolBy.get(candidate.schoolId) ?? "École"} · {weekdaySummary([candidate.weekday])}</p>
                      <h4 className="mt-1 font-black text-slate-950">{candidate.title}</h4>
                      <p className="mt-1 text-sm text-slate-600">{candidate.count} séance(s) existante(s) · du {candidate.firstDate} au {candidate.lastDate}{candidate.startsAt ? ` · ${String(candidate.startsAt).slice(0, 5)}` : ""}</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <Label t="Type de séance">
                          <select name="session_type" defaultValue={candidate.sessionType} className={input}>
                            <option value="class">Cours</option>
                            <option value="mastermind">Mastermind</option>
                            <option value="practice">Pratique</option>
                            <option value="coaching_call">Coaching call</option>
                            <option value="review">Révision</option>
                            <option value="assessment">Évaluation</option>
                            <option value="other">Autre</option>
                          </select>
                        </Label>
                        <Label t="Conserver / générer jusqu’au">
                          <input type="date" name="ends_on" required min={candidate.lastDate} defaultValue={candidate.lastDate} className={input} />
                        </Label>
                      </div>
                      <p className="mt-3 text-xs font-bold text-amber-900">Aucune séance passée ni présence existante ne sera supprimée.</p>
                      <button className="mt-3 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950">Normaliser cette récurrence</button>
                    </form>
                  ))}
                </div>
              </div>
            ) : null}
          </details>
        ) : null}

        {hasAttendanceRole ? (
          <details className="mt-6 rounded-3xl border border-amber-300 bg-amber-50 p-6">
            <summary className="cursor-pointer text-xl font-black text-amber-950">Saisir une présence passée</summary>
            <p className="mt-2 max-w-4xl text-sm text-amber-900">Utilise cette fonction quand l’appel a été fait sur papier ou hors ligne. La date de la séance reste la date réelle, tandis que Super Leader enregistre qui a saisi les données, quand, la source et le motif.</p>
            <div className="mt-4 rounded-2xl bg-white/80 p-4 text-sm text-slate-700">
              <p className="font-black">Si la séance existe déjà dans l’historique</p>
              <p className="mt-1">Ouvre sa carte plus bas et clique sur « Saisir une présence passée ». Ne recrée pas la séance.</p>
            </div>
            <form action={createPastAttendanceSessionAction} className="mt-5 grid gap-4 md:grid-cols-3">
              <Label t="Titre de la séance"><input name="title" required placeholder="Ex. Rentrée École des Coachs" className={input} /></Label>
              <SessionType />
              <Label t="École">
                <select name="school_id" required className={input}>
                  <option value="">Sélectionner…</option>
                  {schools.filter((school) => canTakeAttendanceForSchool(membership.role, assignments, String(school.id))).map((school) => <option key={`past-${String(school.id)}`} value={String(school.id)}>{String(school.name)}</option>)}
                </select>
              </Label>
              <Trainer members={members ?? []} profiles={profileBy} value={auth.user.id} />
              <Program programs={programs ?? []} schools={schoolBy} />
              <Cohort cohorts={cohorts ?? []} schools={schoolBy} />
              <Label t="Date réelle de la séance"><input type="date" name="session_date" required max={yesterday} defaultValue={yesterday} className={input} /></Label>
              <Label t="Heure"><input type="time" name="starts_at" className={input} /></Label>
              <Label t="Durée (minutes)"><input type="number" min="1" max="1440" name="duration_minutes" className={input} /></Label>
              <Mode />
              <Label t="Source de la présence">
                <select name="retroactive_source" defaultValue="paper_sheet" className={input}>
                  <option value="paper_sheet">Feuille papier</option>
                  <option value="manual_register">Registre manuel</option>
                  <option value="other">Autre source</option>
                </select>
              </Label>
              <Label t="Lieu ou lien"><input name="location_or_link" className={input} /></Label>
              <label className="text-sm font-bold text-slate-700 md:col-span-3">Motif de la saisie après la séance<textarea name="retroactive_reason" required rows={3} placeholder="Ex. L’appel a été noté sur papier car l’équipe n’a pas pu utiliser la plateforme pendant la séance." className={input} /></label>
              <button className="self-end rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 md:col-span-2">Créer la séance passée et charger les étudiants</button>
            </form>
          </details>
        ) : null}

        {global || assignments.some((assignment) => ["director", "academic_coordinator", "instructor"].includes(assignment.assignment_role)) ? (
          <details className="mt-6 rounded-3xl border bg-white p-6">
            <summary className="cursor-pointer text-xl font-black">Créer exceptionnellement une séance</summary>
            <p className="mt-2 text-sm text-slate-500">À utiliser seulement si la séance n’a pas encore été préparée. La feuille d’appel sera générée automatiquement.</p>
            <form action={createAttendanceSessionAction} className="mt-5 grid gap-4 md:grid-cols-3">
              <Label t="Titre"><input name="title" required className={input} /></Label>
              <SessionType />
              <Label t="École">
                <select name="school_id" required className={input}>
                  <option value="">Sélectionner…</option>
                  {schools.filter((school) => global || hasAssignmentRole(assignments, String(school.id), ["director", "academic_coordinator", "instructor"])).map((school) => <option key={String(school.id)} value={String(school.id)}>{String(school.name)}</option>)}
                </select>
              </Label>
              <Trainer members={members ?? []} profiles={profileBy} value={auth.user.id} />
              <Program programs={programs ?? []} schools={schoolBy} />
              <Cohort cohorts={cohorts ?? []} schools={schoolBy} />
              <Label t="Date"><input type="date" name="session_date" required defaultValue={today} className={input} /></Label>
              <Label t="Heure"><input type="time" name="starts_at" className={input} /></Label>
              <Label t="Durée (minutes)"><input type="number" min="1" max="1440" name="duration_minutes" className={input} /></Label>
              <Mode />
              <Label t="Lieu ou lien"><input name="location_or_link" className={input} /></Label>
              <button className="self-end rounded-xl bg-violet-700 px-5 py-3 font-black text-white md:col-span-2">Créer et ouvrir la feuille d’appel</button>
            </form>
          </details>
        ) : null}

        <section id="sessions-list" className="mt-7 scroll-mt-28 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[.18em] text-slate-500">Navigation des séances</p>
              <h2 className="mt-1 text-2xl font-black">{sessionView === "history" ? "Historique des séances" : "Aujourd’hui et prochaines séances"}</h2>
              <p className="mt-1 text-sm text-slate-500">8 séances maximum par page pour garder l’écran court et lisible.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={sessionListHref("upcoming")} className={`rounded-xl px-4 py-2 text-sm font-black ${sessionView === "upcoming" ? "bg-violet-700 text-white" : "border bg-white text-slate-700"}`}>À venir ({upcomingSessionCount})</Link>
              <Link href={sessionListHref("history")} className={`rounded-xl px-4 py-2 text-sm font-black ${sessionView === "history" ? "bg-slate-950 text-white" : "border bg-white text-slate-700"}`}>Historique ({historySessionCount})</Link>
            </div>
          </div>

          {displayedSessions.map((session) => {
            const rows = records.filter((record) => record.session_id === session.id);
            const stats = countStatuses(rows);
            const locked = rows.length > 0;
            const canManage = canManageSession(membership.role, assignments, session);
            const canTake = canTakeAttendance(membership.role, assignments, session);
            const historical = ["cancelled", "archived"].includes(session.status);
            const pastSession = session.session_date < today;
            const retroactiveOpen = pastSession && session.attendance_entry_mode === "retroactive" && session.status === "open";
            const attendanceLocked = ["closed", "cancelled", "archived"].includes(session.status);
            const zoomSyncOpen = pastSession && session.attendance_entry_mode === "zoom_sync" && session.status === "open";
            const canEditAttendance = canTake && !attendanceLocked && (!pastSession || retroactiveOpen || zoomSyncOpen);
            const open = selectedSessionId === session.id;
            const schoolScopeEnrollments = scopeEnrollments.filter((item) => item.school_id === session.school_id);
            const schoolWideAttendance = schoolWideAttendanceIds.has(session.school_id);
            const currentScopeEnrollments = schoolWideAttendance
              ? schoolScopeEnrollments
              : schoolScopeEnrollments.filter((item) =>
                (!session.program_id || item.program_id === session.program_id) &&
                (!session.cohort_id || item.cohort_id === session.cohort_id),
              );
            const schoolStudentCount = schoolScopeEnrollments.length;
            const currentScopeStudentCount = currentScopeEnrollments.length;
            const scopeMismatch = !schoolWideAttendance && rows.length === 0 && currentScopeStudentCount === 0 && schoolStudentCount > 0;
            const schoolPrograms = (programs ?? []).filter((program) => String(program.school_id) === session.school_id);
            const schoolCohorts = (cohorts ?? []).filter((cohort) => String(cohort.school_id) === session.school_id);
            const zoomSettings = zoomSettingsBySchool.get(session.school_id);
            const effectiveZoomMeetingId = session.zoom_meeting_id || zoomSettings?.zoom_meeting_id || extractZoomMeetingId(session.location_or_link);
            const zoomConfigured = Boolean(effectiveZoomMeetingId && (zoomSettings?.enabled ?? true));
            const zoomReviewRows = rows.filter((record) => record.zoom_needs_review);
            const sessionUnmatchedZoom = unmatchedZoomParticipants.filter((participant) => participant.session_id === session.id);
            const defaultAttendanceView = (zoomReviewRows.length > 0 || sessionUnmatchedZoom.length > 0) ? "review" : "summary";
            const attendanceView = ["summary", "review", "all"].includes(requestedAttendanceView) ? requestedAttendanceView : defaultAttendanceView;
            const displayedAttendanceRows = attendanceView === "review" ? zoomReviewRows : attendanceView === "all" ? rows : [];
            const studentOptions = rows.map((record) => {
              const enrollment = enrollmentBy.get(record.enrollment_id);
              const personKey = enrollment ? (enrollment.crm_client_id ? `c:${enrollment.crm_client_id}` : `u:${enrollment.user_id}`) : "";
              return {
                enrollmentId: record.enrollment_id,
                name: personKey ? personBy.get(personKey) || "Étudiant" : "Étudiant",
                email: personKey ? personEmailBy.get(personKey) || "" : "",
              };
            }).sort((a, b) => a.name.localeCompare(b.name, "fr"));
            const attendanceTabHref = (tab: "summary" | "review" | "all") => {
              const params = new URLSearchParams();
              params.set("session", session.id);
              params.set("view", sessionView);
              params.set("attendance_view", tab);
              if (selectedSchoolId) params.set("school", selectedSchoolId);
              return `/dashboard/academy/attendance?${params.toString()}#attendance-${session.id}`;
            };

            return (
              <details id={`attendance-${session.id}`} key={session.id} open={open} className="scroll-mt-28 rounded-3xl border bg-white shadow-sm">
                <summary className="cursor-pointer list-none p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase text-violet-700">{schoolBy.get(session.school_id)}</p>
                      <h3 className="text-xl font-black">{session.title}</h3>
                      <p className="mt-1 text-sm text-slate-500">{sessionTypeLabel(session.session_type)} · {session.session_date} · {String(session.starts_at ?? "").slice(0, 5)} · {profileBy.get(String(session.trainer_user_id)) ?? "Formateur"}</p>
                      <p className="mt-1 text-xs text-slate-500">{programBy.get(String(session.program_id)) ?? "Toute l’école"}{session.cohort_id ? ` · ${cohortBy.get(String(session.cohort_id)) ?? "Cohorte"}` : ""}</p>
                      {schoolWideAttendance ? <p className="mt-2 inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-black text-violet-700">Accès école entière · {schoolStudentCount} étudiant(s) éligible(s)</p> : null}
                      {session.attendance_entry_mode === "retroactive" ? <p className="ml-2 mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-800">Saisie passée · {retroactiveSourceLabel(session.retroactive_source)}</p> : null}
                      {session.attendance_entry_mode === "zoom_sync" ? <p className="ml-2 mt-2 inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-black text-blue-800">Smart Attendance Zoom</p> : null}
                      {session.series_id ? <p className="ml-2 mt-2 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-800">Série récurrente</p> : null}
                    </div>
                    <div className="text-right">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{rows.length - stats.unmarked}/{rows.length} pointés · {sessionLabel(session.status)}</span>
                      <p className="mt-2 text-xs font-bold text-slate-500">{stats.present} présents · {stats.absent} absents · {stats.late} retards · {stats.unmarked} non pointés</p>
                    </div>
                  </div>
                </summary>

                <div className="border-t bg-slate-50 p-5">
                  {scopeMismatch ? (
                    <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                      <p className="text-xs font-black uppercase tracking-[.15em] text-amber-700">Périmètre de séance à corriger</p>
                      <h4 className="mt-1 text-lg font-black">Cette séance est rattachée à un programme ou une cohorte qui contient 0 étudiant.</h4>
                      <p className="mt-2 text-sm">L’école compte pourtant <b>{schoolStudentCount} étudiant(s) actif(s)</b>. C’est la raison pour laquelle la feuille d’appel reste vide.</p>
                      {canManage ? (
                        <form action={repairAttendanceSessionScopeAction} className="mt-4 flex flex-wrap items-end gap-3">
                          <input type="hidden" name="session_id" value={session.id} />
                          <label className="min-w-[280px] flex-1 text-sm font-bold">
                            Périmètre réel de cette séance
                            <select name="target_scope" required defaultValue="" className={input}>
                              <option value="" disabled>Choisir le groupe qui participe…</option>
                              <option value="school">Toute l’école — {schoolStudentCount} étudiant(s)</option>
                              {schoolPrograms.map((program) => {
                                const count = schoolScopeEnrollments.filter((item) => item.program_id === String(program.id)).length;
                                return count > 0 ? <option key={`repair-program-${String(program.id)}`} value={`program:${String(program.id)}`}>Programme · {String(program.name)} — {count} étudiant(s)</option> : null;
                              })}
                              {schoolCohorts.map((cohort) => {
                                const count = schoolScopeEnrollments.filter((item) => item.cohort_id === String(cohort.id)).length;
                                return count > 0 ? <option key={`repair-cohort-${String(cohort.id)}`} value={`cohort:${String(cohort.id)}`}>Cohorte · {String(cohort.name)} — {count} étudiant(s)</option> : null;
                              })}
                            </select>
                          </label>
                          <button className="rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950">Corriger et charger les étudiants</button>
                        </form>
                      ) : (
                        <p className="mt-3 text-sm font-bold">La Direction d’école ou la Coordination académique doit corriger le périmètre de cette séance avant l’appel.</p>
                      )}
                    </div>
                  ) : null}

                  {canTake && !historical ? (
                    <section className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[.15em] text-blue-700">Smart Attendance Zoom</p>
                          <h4 className="mt-1 text-lg font-black text-slate-950">Appel automatique à partir des connexions Zoom</h4>
                          <p className="mt-1 max-w-3xl text-sm text-slate-700">Super Leader rapproche les inscrits Zoom avec les étudiants Academy, additionne les reconnexions et ne te laisse que les exceptions à vérifier.</p>
                        </div>
                        {zoomConfigured ? <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-800">Meeting ID · {effectiveZoomMeetingId}</span> : <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">Zoom à associer</span>}
                      </div>

                      {zoomConfigured ? (
                        <div className="mt-4">
                          <div className="flex flex-wrap items-center gap-3">
                            {session.status !== "closed" ? (
                              <form action={syncAcademyAttendanceWithZoomAction}>
                                <input type="hidden" name="session_id" value={session.id} />
                                <button className="rounded-xl bg-blue-700 px-5 py-3 font-black text-white">Synchroniser les présences Zoom</button>
                              </form>
                            ) : pastSession && session.attendance_entry_mode === "zoom_sync" ? (
                              <Status id={session.id} status="open" label="Réouvrir l’appel Zoom" color="border border-blue-300 bg-white text-blue-800" />
                            ) : <span className="rounded-xl bg-slate-200 px-4 py-2.5 font-black text-slate-700">Appel terminé</span>}
                            <span className="text-sm font-bold text-slate-600">Après la fin du cours · Présent ≥ {zoomSettings?.present_threshold_percent ?? 75}% · Partiel ≥ {zoomSettings?.partial_threshold_percent ?? 25}% · Retard &gt; {zoomSettings?.late_grace_minutes ?? 15} min</span>
                          </div>

                          {session.zoom_last_synced_at ? (
                            <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-4">
                              <div className="grid gap-3 sm:grid-cols-4">
                                <ZoomStat n={session.zoom_matched_count} label="Étudiants rapprochés" />
                                <ZoomStat n={session.zoom_review_count} label="À vérifier" />
                                <ZoomStat n={session.zoom_unmatched_participant_count} label="Zoom non rapprochés" />
                                <ZoomStat n={session.zoom_registered_count} label="Inscrits Zoom lus" />
                              </div>
                              <p className="mt-3 text-xs font-bold text-slate-500">Dernière synchronisation : {new Date(session.zoom_last_synced_at).toLocaleString("fr-FR")}{session.zoom_host_email ? ` · Hôte ${session.zoom_host_email}` : ""}</p>
                              {session.zoom_sync_error ? <p className="mt-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{session.zoom_sync_error}</p> : null}
                            </div>
                          ) : null}
                        </div>
                      ) : canManage ? (
                        <form action={saveAcademyZoomAttendanceSettingsAction} className="mt-4 grid gap-3 md:grid-cols-5 md:items-end">
                          <input type="hidden" name="school_id" value={session.school_id} />
                          <input type="hidden" name="session_id" value={session.id} />
                          <Label t="Meeting ID Zoom"><input name="zoom_meeting_id" required inputMode="numeric" placeholder="83144605093" defaultValue={effectiveZoomMeetingId} className={input} /></Label>
                          <Label t="Fuseau horaire"><input name="timezone" required defaultValue={zoomSettings?.timezone || session.zoom_timezone || "Europe/Dublin"} className={input} /></Label>
                          <Label t="Retard après (min)"><input type="number" name="late_grace_minutes" min="0" max="120" defaultValue={zoomSettings?.late_grace_minutes ?? 15} className={input} /></Label>
                          <Label t="Présent à partir de %"><input type="number" name="present_threshold_percent" min="1" max="100" defaultValue={zoomSettings?.present_threshold_percent ?? 75} className={input} /></Label>
                          <Label t="Partiel à partir de %"><input type="number" name="partial_threshold_percent" min="1" max="99" defaultValue={zoomSettings?.partial_threshold_percent ?? 25} className={input} /></Label>
                          <button className="rounded-xl bg-blue-700 px-5 py-3 font-black text-white md:col-span-5">Configurer Zoom Smart Attendance pour cette école</button>
                        </form>
                      ) : (
                        <p className="mt-4 rounded-xl bg-white p-3 text-sm font-bold text-slate-700">La Direction de l’école doit associer une fois le Meeting ID Zoom à cette école.</p>
                      )}

                      {zoomConfigured && canManage ? (
                        <details className="mt-4 rounded-xl border border-blue-100 bg-white p-3">
                          <summary className="cursor-pointer text-sm font-black text-blue-800">Modifier les paramètres Zoom de cette école</summary>
                          <form action={saveAcademyZoomAttendanceSettingsAction} className="mt-3 grid gap-3 md:grid-cols-5 md:items-end">
                            <input type="hidden" name="school_id" value={session.school_id} />
                            <input type="hidden" name="session_id" value={session.id} />
                            <Label t="Meeting ID Zoom"><input name="zoom_meeting_id" required inputMode="numeric" defaultValue={effectiveZoomMeetingId} className={input} /></Label>
                            <Label t="Fuseau horaire"><input name="timezone" required defaultValue={zoomSettings?.timezone || session.zoom_timezone || "Europe/Dublin"} className={input} /></Label>
                            <Label t="Retard après (min)"><input type="number" name="late_grace_minutes" min="0" max="120" defaultValue={zoomSettings?.late_grace_minutes ?? 15} className={input} /></Label>
                            <Label t="Présent à partir de %"><input type="number" name="present_threshold_percent" min="1" max="100" defaultValue={zoomSettings?.present_threshold_percent ?? 75} className={input} /></Label>
                            <Label t="Partiel à partir de %"><input type="number" name="partial_threshold_percent" min="1" max="99" defaultValue={zoomSettings?.partial_threshold_percent ?? 25} className={input} /></Label>
                            <button className="rounded-xl border border-blue-300 bg-blue-50 px-5 py-3 font-black text-blue-900 md:col-span-5">Enregistrer les paramètres</button>
                          </form>
                        </details>
                      ) : null}
                    </section>
                  ) : null}

                  {zoomSyncOpen ? (
                    <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
                      <p className="text-xs font-black uppercase tracking-[.15em] text-blue-700">Saisie Zoom auditée</p>
                      <p className="mt-1 font-black">Cette séance passée a été ouverte automatiquement par Smart Attendance.</p>
                      <p className="mt-1 text-sm">Traite uniquement les éléments « À vérifier », puis termine l’appel normalement.</p>
                    </div>
                  ) : null}

                  {pastSession && !historical && canTake && session.attendance_entry_mode !== "zoom_sync" ? (
                    retroactiveOpen ? (
                      <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                        <p className="text-xs font-black uppercase tracking-[.15em] text-amber-700">Saisie rétroactive ouverte</p>
                        <p className="mt-1 font-black text-amber-950">{retroactiveSourceLabel(session.retroactive_source)} · séance du {session.session_date}</p>
                        <p className="mt-2 text-sm text-amber-900">Motif : {session.retroactive_reason || "Motif non renseigné"}</p>
                        <p className="mt-1 text-xs font-bold text-amber-800">Ouverte par {profileBy.get(String(session.retroactive_entered_by)) ?? "Membre autorisé"}{session.retroactive_entered_at ? ` · ${new Date(session.retroactive_entered_at).toLocaleString("fr-FR")}` : ""}</p>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <form action={markUnmarkedPresentAction}><input type="hidden" name="session_id" value={session.id} /><button className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 font-black text-amber-900">Marquer les non pointés présents</button></form>
                          <form action={syncAttendanceRosterAction}><input type="hidden" name="session_id" value={session.id} /><button className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-black text-slate-700">{schoolWideAttendance ? "Synchroniser les étudiants de l’école" : "Synchroniser les étudiants"}</button></form>
                        </div>
                      </div>
                    ) : (
                      <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                        <p className="text-xs font-black uppercase tracking-[.15em] text-amber-700">Séance passée</p>
                        <h4 className="mt-1 text-lg font-black text-amber-950">Reporter une feuille papier ou une présence notée hors ligne</h4>
                        <p className="mt-2 text-sm text-amber-900">Cette action ouvre temporairement la feuille d’appel et conserve une trace d’audit. Les présences déjà enregistrées ne sont pas effacées.</p>
                        <form action={openPastAttendanceSessionAction} className="mt-4 grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
                          <input type="hidden" name="session_id" value={session.id} />
                          <Label t="Source"><select name="retroactive_source" defaultValue="paper_sheet" className={input}><option value="paper_sheet">Feuille papier</option><option value="manual_register">Registre manuel</option><option value="other">Autre source</option></select></Label>
                          <Label t="Motif"><input name="retroactive_reason" required placeholder="Ex. Appel réalisé sur papier pendant la séance" className={input} /></Label>
                          <button className="rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950">Saisir une présence passée</button>
                        </form>
                      </div>
                    )
                  ) : null}

                  {!historical && !pastSession && canTake ? (
                    <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        {session.status !== "open" ? <Status id={session.id} status="open" label={session.status === "closed" ? "Réouvrir l’appel" : "Ouvrir l’appel"} color="bg-emerald-700 text-white" /> : <span className="rounded-xl bg-emerald-700 px-4 py-2.5 font-black text-white">Appel ouvert</span>}
                        {session.status !== "closed" ? <form action={syncAttendanceRosterAction}><input type="hidden" name="session_id" value={session.id} /><button className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-black text-slate-700">{schoolWideAttendance ? "Synchroniser les étudiants de l’école" : "Synchroniser les étudiants"}</button></form> : null}
                      </div>
                      <p className="mt-3 text-sm text-emerald-900">{session.status === "closed" ? "L’appel est clôturé. Réouvre-le avant toute correction." : schoolWideAttendance ? "Cette école fonctionne en accès école entière : tous ses étudiants actifs sont éligibles à cette séance, quel que soit le programme affiché." : "La feuille manuelle reste disponible comme solution de secours."}</p>
                      {session.status !== "closed" ? (
                        <details className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
                          <summary className="cursor-pointer text-sm font-black text-emerald-800">Mode manuel / secours</summary>
                          <p className="mt-2 text-xs text-slate-600">À utiliser seulement si Zoom n’est pas disponible. Cette action marque tous les étudiants encore non pointés présents.</p>
                          <form action={markUnmarkedPresentAction} className="mt-3"><input type="hidden" name="session_id" value={session.id} /><button className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 font-black text-amber-900">Mode manuel : marquer les non pointés présents</button></form>
                        </details>
                      ) : null}
                    </div>
                  ) : null}

                  {schoolWideAttendance && manageableSeriesSchoolIds.has(session.school_id) && !session.series_id && !historical ? (
                    <details className="mb-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
                      <summary className="cursor-pointer font-black text-emerald-800">Rendre cette séance récurrente</summary>
                      <p className="mt-3 text-sm text-emerald-950">Utilise cette option lorsqu’une séance existe déjà dans l’ancien planning mais n’apparaît pas dans « Récurrences historiques détectées ». Super Leader conservera les séances existantes portant le même titre et le même jour, puis ajoutera uniquement les dates futures manquantes.</p>
                      <form action={promoteAttendanceSessionToRecurringSeriesAction} className="mt-4 grid gap-4 md:grid-cols-3">
                        <input type="hidden" name="session_id" value={session.id} />
                        <Label t="Répétition"><input value={`Chaque ${weekdayOptions[new Date(`${session.session_date}T00:00:00Z`).getUTCDay()]?.label ?? "semaine"}`} readOnly className={`${input} bg-slate-100`} /></Label>
                        <Label t="Première séance"><input value={session.session_date} readOnly className={`${input} bg-slate-100`} /></Label>
                        <Label t="Fin de la série"><input type="date" name="ends_on" required min={session.session_date} defaultValue={addDays(session.session_date, 365)} className={input} /></Label>
                        <button className="self-end rounded-xl bg-emerald-700 px-5 py-3 font-black text-white md:col-span-3">Créer la série hebdomadaire sans doublons</button>
                      </form>
                    </details>
                  ) : null}

                  {canManage ? (
                    <details className="mb-5 rounded-2xl border bg-white p-4">
                      <summary className="cursor-pointer font-black text-violet-700">Modifier la séance</summary>
                      <form action={updateAttendanceSessionAction} className="mt-4 grid gap-4 md:grid-cols-3">
                        <input type="hidden" name="session_id" value={session.id} />
                        <Label t="Titre"><input name="title" required defaultValue={session.title} className={input} /></Label>
                        <SessionType value={session.session_type} />
                        <Label t="École">
                          <select name="school_id" defaultValue={session.school_id} disabled={locked} className={input}>{schools.map((school) => <option key={String(school.id)} value={String(school.id)}>{String(school.name)}</option>)}</select>
                          {locked ? <input type="hidden" name="school_id" value={session.school_id} /> : null}
                        </Label>
                        <Trainer members={members ?? []} profiles={profileBy} value={String(session.trainer_user_id ?? auth.user.id)} />
                        <Label t="Programme">
                          <select name="program_id" defaultValue={String(session.program_id ?? "")} disabled={locked} className={input}><option value="">Toute l’école</option>{(programs ?? []).filter((program) => String(program.school_id) === session.school_id).map((program) => <option key={String(program.id)} value={String(program.id)}>{String(program.name)}</option>)}</select>
                          {locked ? <input type="hidden" name="program_id" value={String(session.program_id ?? "")} /> : null}
                        </Label>
                        <Label t="Cohorte">
                          <select name="cohort_id" defaultValue={String(session.cohort_id ?? "")} disabled={locked} className={input}><option value="">Toutes</option>{(cohorts ?? []).filter((cohort) => String(cohort.school_id) === session.school_id).map((cohort) => <option key={String(cohort.id)} value={String(cohort.id)}>{String(cohort.name)}</option>)}</select>
                          {locked ? <input type="hidden" name="cohort_id" value={String(session.cohort_id ?? "")} /> : null}
                        </Label>
                        <Label t="Date"><input type="date" name="session_date" required defaultValue={session.session_date} className={input} /></Label>
                        <Label t="Heure"><input type="time" name="starts_at" defaultValue={String(session.starts_at ?? "").slice(0, 5)} className={input} /></Label>
                        <Label t="Durée (minutes)"><input type="number" min="1" max="1440" name="duration_minutes" defaultValue={session.duration_minutes ? String(session.duration_minutes) : ""} className={input} /></Label>
                        <Mode value={session.delivery_mode} />
                        <Label t="Lieu ou lien"><input name="location_or_link" defaultValue={String(session.location_or_link ?? "")} className={input} /></Label>
                        {locked ? <p className="self-end text-xs text-slate-500 md:col-span-2">La feuille d’appel existe déjà : l’école, le programme et la cohorte sont protégés.</p> : null}
                        <button className="self-end rounded-xl bg-violet-700 px-5 py-3 font-black text-white">Enregistrer les modifications</button>
                      </form>
                      {!historical ? <div className="mt-4 flex flex-wrap gap-3"><Status id={session.id} status="cancelled" label="Annuler la séance" color="border border-red-300 bg-white text-red-700" /><Status id={session.id} status="archived" label="Archiver" color="border border-slate-300 bg-white text-slate-700" /></div> : null}
                    </details>
                  ) : null}

                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black">Feuille d’appel</h3>
                      <p className="text-sm text-slate-500">{rows.length} étudiant(s) · {stats.unmarked} non pointé(s)</p>
                    </div>
                    {canEditAttendance && rows.length ? <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">Validation par exceptions</span> : null}
                  </div>

                  {session.zoom_last_synced_at ? (
                    <nav className="mb-4 flex flex-wrap gap-2 rounded-2xl border bg-white p-2" aria-label="Vues de la feuille d'appel">
                      <Link href={attendanceTabHref("summary")} className={`rounded-xl px-4 py-2 text-sm font-black ${attendanceView === "summary" ? "bg-slate-950 text-white" : "text-slate-700"}`}>Résumé</Link>
                      <Link href={attendanceTabHref("review")} className={`rounded-xl px-4 py-2 text-sm font-black ${attendanceView === "review" ? "bg-amber-400 text-slate-950" : "text-slate-700"}`}>À vérifier ({zoomReviewRows.length + sessionUnmatchedZoom.length})</Link>
                      <Link href={attendanceTabHref("all")} className={`rounded-xl px-4 py-2 text-sm font-black ${attendanceView === "all" ? "bg-violet-700 text-white" : "text-slate-700"}`}>Tous les étudiants ({rows.length})</Link>
                    </nav>
                  ) : null}

                  {rows.length ? (
                    <>
                      {attendanceView === "summary" && session.zoom_last_synced_at ? (
                        <div className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-4">
                          <ZoomStat n={stats.present} label="Présents" />
                          <ZoomStat n={stats.late} label="Retards" />
                          <ZoomStat n={stats.absent} label="Absents" />
                          <ZoomStat n={stats.unmarked} label="À traiter" />
                          <p className="text-sm text-slate-600 sm:col-span-4">Le travail principal est terminé par Zoom. Ouvre « À vérifier » uniquement pour les présences partielles, inscriptions non rapprochées ou identités Zoom inconnues.</p>
                        </div>
                      ) : null}

                      {attendanceView === "review" && sessionUnmatchedZoom.length ? (
                        <section className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                          <p className="text-xs font-black uppercase tracking-[.15em] text-amber-700">Participants Zoom non rapprochés</p>
                          <h4 className="mt-1 font-black text-amber-950">Associe seulement les personnes que tu reconnais.</h4>
                          <p className="mt-1 text-sm text-amber-900">L’association est mémorisée pour ce Meeting ID. Super Leader pourra la réutiliser lors des prochaines séances.</p>
                          <div className="mt-4 space-y-3">
                            {sessionUnmatchedZoom.map((participant) => (
                              <div key={participant.id} className="grid gap-3 rounded-xl border border-amber-200 bg-white p-3 lg:grid-cols-[1.2fr_1.6fr_auto] lg:items-end">
                                <div>
                                  <p className="font-black">{participant.participant_name}</p>
                                  <p className="text-xs text-slate-500">{participant.participant_email || "Email Zoom non disponible"} · {participant.duration_minutes} min{participant.attendance_percent !== null ? ` · ${participant.attendance_percent}%` : ""}</p>
                                  <p className="mt-1 text-xs font-bold text-amber-800">{participant.match_reason || "À rapprocher"}</p>
                                </div>
                                <form action={mapAcademyZoomParticipantAction} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                                  <input type="hidden" name="participant_id" value={participant.id} />
                                  <input type="hidden" name="session_id" value={session.id} />
                                  <label className="text-sm font-bold text-slate-700">Associer à l’étudiant
                                    <select name="enrollment_id" required defaultValue="" className={input}>
                                      <option value="" disabled>Choisir un étudiant…</option>
                                      {studentOptions.map((student) => <option key={`${participant.id}-${student.enrollmentId}`} value={student.enrollmentId}>{student.name}{student.email ? ` · ${student.email}` : ""}</option>)}
                                    </select>
                                  </label>
                                  <button className="rounded-xl bg-amber-400 px-4 py-2.5 font-black text-slate-950">Mémoriser</button>
                                </form>
                                <form action={ignoreAcademyZoomParticipantAction}>
                                  <input type="hidden" name="participant_id" value={participant.id} />
                                  <input type="hidden" name="session_id" value={session.id} />
                                  <input type="hidden" name="ignore_reason" value="Staff, invité ou participant non étudiant" />
                                  <button className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-black text-slate-700">Ignorer pour cette séance</button>
                                </form>
                              </div>
                            ))}
                          </div>
                        </section>
                      ) : null}

                      {attendanceView === "review" && !displayedAttendanceRows.length && !sessionUnmatchedZoom.length ? (
                        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center font-bold text-emerald-800">Aucune exception à vérifier. La feuille peut être finalisée.</p>
                      ) : null}

                      {attendanceView !== "summary" && displayedAttendanceRows.length ? (
                        <form action={saveAttendanceSheetAction}>
                          <input type="hidden" name="session_id" value={session.id} />
                          <div className="overflow-hidden rounded-2xl border bg-white">
                            <div className="hidden grid-cols-[1.5fr_180px_140px_1.4fr] gap-3 bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-wide text-white md:grid"><span>Étudiant</span><span>Statut</span><span>Arrivée</span><span>Commentaire</span></div>
                            <div className="divide-y">
                              {displayedAttendanceRows.map((record) => {
                                const enrollment = enrollmentBy.get(record.enrollment_id);
                                const name = enrollment ? personBy.get(enrollment.crm_client_id ? `c:${enrollment.crm_client_id}` : `u:${enrollment.user_id}`) : "Étudiant";
                                return (
                                  <div key={record.id} className="grid gap-3 p-4 md:grid-cols-[1.5fr_180px_140px_1.4fr] md:items-center">
                                    <input type="hidden" name="record_id" value={record.id} />
                                    <div>
                                      <p className="font-black">{name}</p>
                                      <p className="text-xs text-slate-500">{attendanceLabel(record.attendance_status)}</p>
                                      {record.zoom_classification ? <p className={`mt-1 text-xs font-bold ${record.zoom_needs_review ? "text-amber-700" : "text-blue-700"}`}>{zoomClassificationLabel(record.zoom_classification)}{record.zoom_attendance_percent !== null ? ` · ${record.zoom_attendance_percent}%` : ""}{record.zoom_duration_minutes ? ` · ${record.zoom_duration_minutes} min` : ""}</p> : null}
                                    </div>
                                    <label className="text-xs font-black md:text-sm"><span className="md:hidden">Statut</span><select name={`status_${record.id}`} defaultValue={record.attendance_status} disabled={!canEditAttendance} className={input}><option value="unmarked">Non pointé</option><option value="present">Présent</option><option value="absent">Absent</option><option value="late">Retard</option><option value="excused">Excusé</option></select></label>
                                    <label className="text-xs font-black md:text-sm"><span className="md:hidden">Arrivée</span><input type="time" name={`arrived_${record.id}`} defaultValue={String(record.arrived_at ?? "").slice(0, 5)} disabled={!canEditAttendance} className={input} /></label>
                                    <label className="text-xs font-black md:text-sm"><span className="md:hidden">Commentaire</span><input name={`comment_${record.id}`} defaultValue={String(record.comment ?? "")} disabled={!canEditAttendance} className={input} /></label>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {canEditAttendance ? (
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4">
                              <p className="text-sm font-bold text-slate-600">{attendanceView === "review" ? "Corrige uniquement ces exceptions. Chaque correction humaine est conservée comme revue Zoom." : "Tu peux toujours corriger manuellement un statut si nécessaire."}</p>
                              <button className="rounded-xl bg-amber-400 px-6 py-3 font-black text-slate-950">{attendanceView === "review" ? "Enregistrer les corrections" : "Enregistrer toute la feuille"}</button>
                            </div>
                          ) : null}
                        </form>
                      ) : null}
                    </>
                  ) : <p className="rounded-2xl border border-dashed bg-white p-6 text-center text-slate-500">Aucun étudiant ne correspond au périmètre de cette séance. Utilise « Synchroniser les étudiants » si des inscriptions ont été ajoutées après la création de la séance.</p>}

                  {canEditAttendance ? (
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      {session.status !== "closed" ? <Status id={session.id} status="closed" label="Terminer l’appel" color="bg-slate-950 text-white" /> : <span className="rounded-xl bg-slate-200 px-4 py-2.5 font-black text-slate-700">Appel terminé</span>}
                      {stats.unmarked > 0 ? <span className="text-sm font-bold text-amber-700">Encore {stats.unmarked} étudiant(s) non pointé(s).</span> : <span className="text-sm font-bold text-emerald-700">Feuille complète : l’appel peut être terminé.</span>}
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}

          {!displayedSessions.length ? <p className="rounded-3xl border border-dashed bg-white p-10 text-center text-slate-500">{sessionView === "history" ? "Aucune séance passée dans ton périmètre." : "Aucune séance à venir dans ton périmètre."}</p> : null}

          {sessionsForView.length > sessionPageSize ? (
            <nav aria-label="Pagination des séances" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4">
              <p className="text-sm font-bold text-slate-600">Page {sessionPage} sur {sessionPageCount} · {sessionsForView.length} séance(s)</p>
              <div className="flex gap-2">
                {sessionPage > 1 ? <Link href={sessionListHref(sessionView, sessionPage - 1)} className="rounded-xl border bg-white px-4 py-2 text-sm font-black text-slate-700">← Précédentes</Link> : null}
                {sessionPage < sessionPageCount ? <Link href={sessionListHref(sessionView, sessionPage + 1)} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-black text-white">Suivantes →</Link> : null}
              </div>
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function GuideStep({n, title, text}: {n: string; title: string; text: string}) {
  return <div className="rounded-2xl bg-white p-4"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-700 font-black text-white">{n}</span><div><p className="font-black">{title}</p><p className="mt-1 text-sm text-slate-600">{text}</p></div></div></div>;
}
function Stat({n, label}: {n: number; label: string}) {return <div className="rounded-2xl border bg-white p-5"><p className="text-3xl font-black">{n}</p><p className="text-sm font-bold text-slate-500">{label}</p></div>;}
function ZoomStat({n, label}: {n: number; label: string}) {return <div className="rounded-xl bg-slate-50 p-3"><p className="text-2xl font-black text-slate-950">{n}</p><p className="text-xs font-bold text-slate-500">{label}</p></div>;}
function Label({t, children}: {t: string; children: React.ReactNode}) {return <label className="text-sm font-bold text-slate-700">{t}{children}</label>;}
function Trainer({members, profiles, value}: {members: {user_id: unknown}[]; profiles: Map<string, string>; value: string}) {return <Label t="Formateur"><select name="trainer_user_id" defaultValue={value} className={input}>{members.map((item) => <option key={String(item.user_id)} value={String(item.user_id)}>{profiles.get(String(item.user_id)) ?? String(item.user_id)}</option>)}</select></Label>;}
function Program({programs, schools}: {programs: {id: unknown; school_id: unknown; name: unknown}[]; schools: Map<string, string>}) {return <Label t="Programme (facultatif)"><select name="program_id" className={input}><option value="">Toute l’école</option>{programs.map((item) => <option key={String(item.id)} value={String(item.id)}>{schools.get(String(item.school_id))} · {String(item.name)}</option>)}</select></Label>;}
function Cohort({cohorts, schools}: {cohorts: {id: unknown; school_id: unknown; name: unknown}[]; schools: Map<string, string>}) {return <Label t="Cohorte (facultatif)"><select name="cohort_id" className={input}><option value="">Toutes</option>{cohorts.map((item) => <option key={String(item.id)} value={String(item.id)}>{schools.get(String(item.school_id))} · {String(item.name)}</option>)}</select></Label>;}
function Mode({value = "online"}: {value?: string}) {return <Label t="Mode"><select name="delivery_mode" defaultValue={value} className={input}><option value="online">En ligne</option><option value="in_person">Présentiel</option><option value="hybrid">Hybride</option></select></Label>;}
function Status({id, status, label, color}: {id: string; status: string; label: string; color: string}) {return <form action={updateAttendanceSessionStatusAction}><input type="hidden" name="session_id" value={id} /><input type="hidden" name="status" value={status} /><button className={`rounded-xl px-4 py-2.5 font-black ${color}`}>{label}</button></form>;}
function SessionType({value = "class"}: {value?: string}) {return <Label t="Type de séance"><select name="session_type" defaultValue={value} className={input}><option value="class">Cours</option><option value="mastermind">Mastermind</option><option value="practice">Pratique</option><option value="coaching_call">Coaching call</option><option value="review">Révision</option><option value="assessment">Évaluation</option><option value="other">Autre</option></select></Label>;}
