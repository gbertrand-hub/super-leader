import {normalizeTimeZone} from "@/lib/timezone";
import {createAdminClient} from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type PerformanceSettingsRow = {
  timezone: string;
  default_start_time: string;
  default_end_time: string;
  report_deadline_time: string;
};
type ScheduleEntryRow = {
  id: string;
  user_id: string;
  work_date: string;
  timezone: string;
  start_time: string | null;
  end_time: string | null;
  report_deadline_time: string | null;
  work_mode: string;
  location: string | null;
  supervisor_id: string | null;
  report_required: boolean;
  status: string;
};
type LegacyScheduleRow = {
  user_id: string;
  timezone: string;
  work_days: number[];
  start_time: string;
  end_time: string;
  report_deadline_time: string;
  effective_from: string;
  effective_to: string | null;
  supervisor_id: string | null;
  is_active: boolean;
};
type AttendanceRow = {
  id: string;
  user_id: string;
  status: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  late_minutes: number;
  total_work_minutes: number | null;
  scheduled_work_minutes: number | null;
  pause_minutes: number | null;
};
type ReportRow = {
  id: string;
  user_id: string;
  report_date: string;
  accomplishments: string;
  results: string;
  blockers: string;
  next_priorities: string;
  status: string;
  submitted_at: string;
  review_note: string | null;
  reviewed_at: string | null;
  revision_number: number | null;
  submission_mode: string | null;
};
type PlanRow = {
  id: string;
  user_id: string;
  status: string;
  minimum_tasks_snapshot: number;
};
type TaskRow = {
  id: string;
  plan_id: string;
  user_id: string;
  position: number;
  title: string;
  expected_outcome: string;
  priority: string;
  progress_status: string;
};
type OutcomeRow = {
  id: string;
  daily_report_id: string;
  report_revision_number: number;
  position: number;
  title: string;
  expected_outcome: string;
  final_status: string;
  actual_outcome: string;
  outcome_reason: string | null;
  next_action: string | null;
  next_action_date: string | null;
};
type TeamRow = {
  id: string;
  name: string;
  department: string | null;
  manager_id: string | null;
  is_active: boolean;
};
type TeamMemberRow = {team_id: string; user_id: string};
type LeaveRow = {user_id: string; leave_type: string};

export type HrDailyReportState =
  | "validated"
  | "needs_revision"
  | "incomplete"
  | "late"
  | "submitted"
  | "pending"
  | "missing"
  | "not_required";

export type HrDailyReportFilters = {
  date?: string | null;
  status?: string | null;
  team?: string | null;
  department?: string | null;
  manager?: string | null;
  search?: string | null;
  quick?: string | null;
};

export type HrDailyReportRow = {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  expected: boolean;
  leaveType: string | null;
  timezone: string;
  startTime: string | null;
  endTime: string | null;
  deadline: string;
  workMode: string;
  location: string | null;
  scheduleSource: "published" | "draft" | "recurring" | "default" | "leave" | "off";
  teamIds: string[];
  teamNames: string[];
  departments: string[];
  managerIds: string[];
  managerNames: string[];
  attendance: AttendanceRow | null;
  plan: PlanRow | null;
  tasks: TaskRow[];
  taskCount: number;
  completedTaskCount: number;
  blockedTaskCount: number;
  taskPlanValid: boolean;
  report: ReportRow | null;
  outcomes: OutcomeRow[];
  reportState: HrDailyReportState;
  submittedLate: boolean;
  reviewRequired: boolean;
};

export type HrDailyReportsData = {
  date: string;
  timezone: string;
  nowDate: string;
  nowTime: string;
  rows: HrDailyReportRow[];
  allRows: HrDailyReportRow[];
  metrics: {
    expected: number;
    submitted: number;
    pending: number;
    missing: number;
    submittedLate: number;
    reviewRequired: number;
    noPlan: number;
  };
  options: {
    teams: Array<{id: string; name: string}>;
    departments: string[];
    managers: Array<{id: string; name: string}>;
  };
};

function validDate(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
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

function timeMinutes(value: string | null | undefined) {
  const [hour = 0, minute = 0] = String(value ?? "00:00").slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function dateDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function submittedAfterDeadline(report: ReportRow, deadline: string, timezone: string) {
  const local = zonedParts(new Date(report.submitted_at), timezone);
  if (local.date > report.report_date) return true;
  if (local.date < report.report_date) return false;
  return timeMinutes(local.time) > timeMinutes(deadline);
}

function reportState(input: {
  report: ReportRow | null;
  expected: boolean;
  selectedDate: string;
  deadline: string;
  timezone: string;
  now: Date;
}): {state: HrDailyReportState; submittedLate: boolean; reviewRequired: boolean} {
  if (input.report) {
    const late = input.report.status === "late" || submittedAfterDeadline(input.report, input.deadline, input.timezone);
    const state: HrDailyReportState = input.report.status === "validated"
      ? "validated"
      : input.report.status === "needs_revision"
        ? "needs_revision"
        : input.report.status === "incomplete"
          ? "incomplete"
          : late
            ? "late"
            : "submitted";
    return {
      state,
      submittedLate: late,
      reviewRequired: !input.report.reviewed_at && !["needs_revision", "incomplete"].includes(input.report.status),
    };
  }
  if (!input.expected) return {state: "not_required", submittedLate: false, reviewRequired: false};
  const localNow = zonedParts(input.now, input.timezone);
  const overdue = input.selectedDate < localNow.date
    || (input.selectedDate === localNow.date && timeMinutes(localNow.time) > timeMinutes(input.deadline));
  return {state: overdue ? "missing" : "pending", submittedLate: false, reviewRequired: false};
}

function text(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export async function loadHrDailyReports({
  admin,
  organizationId,
  filters,
}: {
  admin: AdminClient;
  organizationId: string;
  filters: HrDailyReportFilters;
}): Promise<HrDailyReportsData> {
  const now = new Date();
  const {data: settingsData, error: settingsError} = await admin
    .from("performance_settings")
    .select("timezone, default_start_time, default_end_time, report_deadline_time")
    .eq("organization_id", organizationId)
    .maybeSingle<PerformanceSettingsRow>();
  if (settingsError) throw new Error(settingsError.message);

  const settings: PerformanceSettingsRow = settingsData ?? {
    timezone: "Europe/Dublin",
    default_start_time: "09:00",
    default_end_time: "17:00",
    report_deadline_time: "18:00",
  };
  const organizationTimezone = normalizeTimeZone(settings.timezone);
  const organizationNow = zonedParts(now, organizationTimezone);
  const selectedDate = validDate(filters.date) ? String(filters.date) : organizationNow.date;

  const {data: memberData, error: memberError} = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("role");
  if (memberError) throw new Error(memberError.message);
  const members = (memberData ?? []) as MemberRow[];
  const userIds = members.map((member) => member.user_id);

  if (!userIds.length) {
    return {
      date: selectedDate,
      timezone: organizationTimezone,
      nowDate: organizationNow.date,
      nowTime: organizationNow.time,
      rows: [],
      allRows: [],
      metrics: {expected: 0, submitted: 0, pending: 0, missing: 0, submittedLate: 0, reviewRequired: 0, noPlan: 0},
      options: {teams: [], departments: [], managers: []},
    };
  }

  const [
    profilesResult,
    scheduleEntriesResult,
    recurringSchedulesResult,
    attendanceResult,
    reportsResult,
    plansResult,
    tasksResult,
    teamsResult,
    leavesResult,
  ] = await Promise.all([
    admin.from("profiles").select("id, full_name, email").in("id", userIds),
    admin.from("work_schedule_entries").select("id, user_id, work_date, timezone, start_time, end_time, report_deadline_time, work_mode, location, supervisor_id, report_required, status").eq("organization_id", organizationId).eq("work_date", selectedDate).in("user_id", userIds),
    admin.from("member_work_schedules").select("user_id, timezone, work_days, start_time, end_time, report_deadline_time, effective_from, effective_to, supervisor_id, is_active").eq("organization_id", organizationId).eq("is_active", true).in("user_id", userIds),
    admin.from("attendance_records").select("id, user_id, status, clock_in_at, clock_out_at, late_minutes, total_work_minutes, scheduled_work_minutes, pause_minutes").eq("organization_id", organizationId).eq("work_date", selectedDate).in("user_id", userIds),
    admin.from("daily_reports").select("id, user_id, report_date, accomplishments, results, blockers, next_priorities, status, submitted_at, review_note, reviewed_at, revision_number, submission_mode").eq("organization_id", organizationId).eq("report_date", selectedDate).in("user_id", userIds),
    admin.from("daily_work_plans").select("id, user_id, status, minimum_tasks_snapshot").eq("organization_id", organizationId).eq("work_date", selectedDate).in("user_id", userIds),
    admin.from("daily_work_tasks").select("id, plan_id, user_id, position, title, expected_outcome, priority, progress_status").eq("organization_id", organizationId).eq("work_date", selectedDate).in("user_id", userIds).order("position"),
    admin.from("teams").select("id, name, department, manager_id, is_active").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    admin.from("leave_requests").select("user_id, leave_type").eq("organization_id", organizationId).eq("status", "approved").lte("start_date", selectedDate).gte("end_date", selectedDate).in("user_id", userIds),
  ]);

  const loadError = [profilesResult.error, scheduleEntriesResult.error, recurringSchedulesResult.error, attendanceResult.error, reportsResult.error, plansResult.error, tasksResult.error, teamsResult.error, leavesResult.error].find(Boolean);
  if (loadError) throw new Error(loadError.message);

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const scheduleEntries = (scheduleEntriesResult.data ?? []) as ScheduleEntryRow[];
  const recurringSchedules = (recurringSchedulesResult.data ?? []) as LegacyScheduleRow[];
  const attendanceRows = (attendanceResult.data ?? []) as AttendanceRow[];
  const reports = (reportsResult.data ?? []) as ReportRow[];
  const plans = (plansResult.data ?? []) as PlanRow[];
  const tasks = (tasksResult.data ?? []) as TaskRow[];
  const teams = (teamsResult.data ?? []) as TeamRow[];
  const leaves = (leavesResult.data ?? []) as LeaveRow[];

  const reportIds = reports.map((report) => report.id);
  const {data: outcomesData, error: outcomesError} = reportIds.length
    ? await admin.from("daily_work_task_outcome_versions").select("id, daily_report_id, report_revision_number, position, title, expected_outcome, final_status, actual_outcome, outcome_reason, next_action, next_action_date").in("daily_report_id", reportIds).order("position")
    : {data: [] as OutcomeRow[], error: null};
  if (outcomesError) throw new Error(outcomesError.message);
  const outcomes = (outcomesData ?? []) as OutcomeRow[];

  const teamIds = teams.map((team) => team.id);
  const {data: teamMemberData, error: teamMemberError} = teamIds.length
    ? await admin.from("team_members").select("team_id, user_id").in("team_id", teamIds).in("user_id", userIds)
    : {data: [] as TeamMemberRow[], error: null};
  if (teamMemberError) throw new Error(teamMemberError.message);
  const teamMembers = (teamMemberData ?? []) as TeamMemberRow[];

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const scheduleEntryByUser = new Map(scheduleEntries.map((entry) => [entry.user_id, entry]));
  const recurringByUser = new Map(recurringSchedules.map((entry) => [entry.user_id, entry]));
  const attendanceByUser = new Map(attendanceRows.map((entry) => [entry.user_id, entry]));
  const reportByUser = new Map(reports.map((entry) => [entry.user_id, entry]));
  const planByUser = new Map(plans.map((entry) => [entry.user_id, entry]));
  const tasksByUser = new Map<string, TaskRow[]>();
  tasks.forEach((task) => tasksByUser.set(task.user_id, [...(tasksByUser.get(task.user_id) ?? []), task]));
  const outcomesByReport = new Map<string, OutcomeRow[]>();
  outcomes.forEach((outcome) => outcomesByReport.set(outcome.daily_report_id, [...(outcomesByReport.get(outcome.daily_report_id) ?? []), outcome]));
  const leaveByUser = new Map(leaves.map((leave) => [leave.user_id, leave]));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const teamIdsByUser = new Map<string, string[]>();
  teamMembers.forEach((membership) => teamIdsByUser.set(membership.user_id, [...(teamIdsByUser.get(membership.user_id) ?? []), membership.team_id]));

  const allManagerIds = new Set<string>();
  teams.forEach((team) => { if (team.manager_id) allManagerIds.add(team.manager_id); });
  recurringSchedules.forEach((schedule) => { if (schedule.supervisor_id) allManagerIds.add(schedule.supervisor_id); });
  scheduleEntries.forEach((schedule) => { if (schedule.supervisor_id) allManagerIds.add(schedule.supervisor_id); });
  const missingManagerProfileIds = [...allManagerIds].filter((id) => !profileById.has(id));
  if (missingManagerProfileIds.length) {
    const {data: managerProfiles, error: managerProfileError} = await admin.from("profiles").select("id, full_name, email").in("id", missingManagerProfileIds);
    if (managerProfileError) throw new Error(managerProfileError.message);
    ((managerProfiles ?? []) as ProfileRow[]).forEach((profile) => profileById.set(profile.id, profile));
  }

  const weekday = dateDay(selectedDate);
  const allRows: HrDailyReportRow[] = members.map((member) => {
    const profile = profileById.get(member.user_id);
    const scheduleEntry = scheduleEntryByUser.get(member.user_id) ?? null;
    const recurring = recurringByUser.get(member.user_id) ?? null;
    const leave = leaveByUser.get(member.user_id) ?? null;
    const report = reportByUser.get(member.user_id) ?? null;
    const plan = planByUser.get(member.user_id) ?? null;
    const userTasks = tasksByUser.get(member.user_id) ?? [];
    const userTeamIds = teamIdsByUser.get(member.user_id) ?? [];
    const userTeams = userTeamIds.map((id) => teamById.get(id)).filter((team): team is TeamRow => Boolean(team));

    let expected = false;
    let timezone = organizationTimezone;
    let startTime: string | null = settings.default_start_time;
    let endTime: string | null = settings.default_end_time;
    let deadline = settings.report_deadline_time;
    let workMode = "onsite";
    let location: string | null = null;
    let scheduleSource: HrDailyReportRow["scheduleSource"] = "default";
    const managerIds = new Set<string>();

    if (scheduleEntry) {
      timezone = normalizeTimeZone(scheduleEntry.timezone, organizationTimezone);
      startTime = scheduleEntry.start_time;
      endTime = scheduleEntry.end_time;
      deadline = scheduleEntry.report_deadline_time || settings.report_deadline_time;
      workMode = scheduleEntry.work_mode;
      location = scheduleEntry.location;
      if (scheduleEntry.supervisor_id) managerIds.add(scheduleEntry.supervisor_id);
      expected = scheduleEntry.status === "published" && scheduleEntry.report_required && scheduleEntry.work_mode !== "off";
      scheduleSource = scheduleEntry.work_mode === "off" || scheduleEntry.status === "cancelled" ? "off" : scheduleEntry.status === "published" ? "published" : "draft";
    } else if (recurring && recurring.effective_from <= selectedDate && (!recurring.effective_to || recurring.effective_to >= selectedDate)) {
      timezone = normalizeTimeZone(recurring.timezone, organizationTimezone);
      startTime = recurring.start_time;
      endTime = recurring.end_time;
      deadline = recurring.report_deadline_time || settings.report_deadline_time;
      if (recurring.supervisor_id) managerIds.add(recurring.supervisor_id);
      expected = recurring.work_days.includes(weekday);
      scheduleSource = "recurring";
    } else {
      expected = weekday >= 1 && weekday <= 5;
    }

    userTeams.forEach((team) => { if (team.manager_id) managerIds.add(team.manager_id); });
    if (leave) {
      expected = false;
      scheduleSource = "leave";
      workMode = "off";
      startTime = null;
      endTime = null;
    }

    const state = reportState({report, expected, selectedDate, deadline, timezone, now});
    const taskCount = userTasks.length;
    const minimumTasks = plan?.minimum_tasks_snapshot ?? 6;
    const taskPlanValid = Boolean(plan && taskCount >= minimumTasks && ["submitted", "locked", "completed"].includes(plan.status));
    const activeOutcomes = report
      ? (outcomesByReport.get(report.id) ?? []).filter((outcome) => outcome.report_revision_number === (report.revision_number ?? 1))
      : [];

    return {
      userId: member.user_id,
      fullName: text(profile?.full_name) || text(profile?.email) || member.user_id,
      email: text(profile?.email),
      role: member.role,
      expected,
      leaveType: leave?.leave_type ?? null,
      timezone,
      startTime,
      endTime,
      deadline: deadline.slice(0, 5),
      workMode,
      location,
      scheduleSource,
      teamIds: userTeamIds,
      teamNames: userTeams.map((team) => team.name),
      departments: [...new Set(userTeams.map((team) => text(team.department)).filter(Boolean))],
      managerIds: [...managerIds],
      managerNames: [...managerIds].map((id) => {
        const managerProfile = profileById.get(id);
        return text(managerProfile?.full_name) || text(managerProfile?.email) || id;
      }),
      attendance: attendanceByUser.get(member.user_id) ?? null,
      plan,
      tasks: userTasks,
      taskCount,
      completedTaskCount: userTasks.filter((task) => task.progress_status === "completed").length,
      blockedTaskCount: userTasks.filter((task) => task.progress_status === "blocked").length,
      taskPlanValid,
      report,
      outcomes: activeOutcomes,
      reportState: state.state,
      submittedLate: state.submittedLate,
      reviewRequired: state.reviewRequired,
    };
  }).sort((a, b) => a.fullName.localeCompare(b.fullName));

  const statusFilter = text(filters.status);
  const teamFilter = text(filters.team);
  const departmentFilter = text(filters.department);
  const managerFilter = text(filters.manager);
  const searchFilter = text(filters.search).toLocaleLowerCase();
  const quickFilter = text(filters.quick);
  const rows = allRows.filter((row) => {
    if (statusFilter && statusFilter !== "all" && row.reportState !== statusFilter) return false;
    if (teamFilter && teamFilter !== "all" && !row.teamIds.includes(teamFilter)) return false;
    if (departmentFilter && departmentFilter !== "all" && !row.departments.includes(departmentFilter)) return false;
    if (managerFilter && managerFilter !== "all" && !row.managerIds.includes(managerFilter)) return false;
    if (searchFilter && !`${row.fullName} ${row.email}`.toLocaleLowerCase().includes(searchFilter)) return false;
    if (quickFilter === "expected" && !row.expected) return false;
    if (quickFilter === "submitted" && !(row.expected && row.report)) return false;
    if (quickFilter === "pending" && row.reportState !== "pending") return false;
    if (quickFilter === "missing" && row.reportState !== "missing") return false;
    if (quickFilter === "submittedLate" && !(row.expected && row.submittedLate)) return false;
    if (quickFilter === "reviewRequired" && !(row.expected && row.reviewRequired)) return false;
    if (quickFilter === "noPlan" && !(row.expected && !row.taskPlanValid)) return false;
    return true;
  });

  const expectedRows = allRows.filter((row) => row.expected);
  const managerOptions = [...new Set(allRows.flatMap((row) => row.managerIds))]
    .map((id) => ({id, name: allRows.flatMap((row) => row.managerIds.map((managerId, index) => ({managerId, name: row.managerNames[index]}))).find((entry) => entry.managerId === id)?.name ?? id}))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    date: selectedDate,
    timezone: organizationTimezone,
    nowDate: organizationNow.date,
    nowTime: organizationNow.time,
    rows,
    allRows,
    metrics: {
      expected: expectedRows.length,
      submitted: expectedRows.filter((row) => Boolean(row.report)).length,
      pending: expectedRows.filter((row) => row.reportState === "pending").length,
      missing: expectedRows.filter((row) => row.reportState === "missing").length,
      submittedLate: expectedRows.filter((row) => row.submittedLate).length,
      reviewRequired: expectedRows.filter((row) => row.reviewRequired).length,
      noPlan: expectedRows.filter((row) => !row.taskPlanValid).length,
    },
    options: {
      teams: teams.map((team) => ({id: team.id, name: team.name})),
      departments: [...new Set(teams.map((team) => text(team.department)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      managers: managerOptions,
    },
  };
}
