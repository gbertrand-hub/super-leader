export type PerformanceSettings = {
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

export type MemberSchedule = {
  user_id: string;
  timezone: string;
  work_days: number[];
  start_time: string;
  end_time: string;
  grace_minutes: number;
  report_deadline_time: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
};

export type AttendanceRecord = {
  user_id: string;
  work_date: string;
  status: string;
  late_minutes: number;
};

export type LeaveRequest = {
  user_id: string;
  start_date: string;
  end_date: string;
  status: string;
};

export type DailyReportRecord = {
  user_id: string;
  report_date: string;
  status: string;
};

export type MeetingRecord = {
  id: string;
  mandatory: boolean;
  starts_at: string;
};

export type MeetingAttendanceRecord = {
  meeting_id: string;
  user_id: string;
  status: string;
};

export type FeedbackRecord = {
  recipient_id: string;
  score: number;
  created_at: string;
};

export type RecognitionRecord = {
  recipient_id: string;
  created_at: string;
};

export type KpiScoreRecord = {
  user_id: string;
  score: number | string;
};

export type ScoreInput = {
  userId: string;
  month: string;
  today: string;
  settings: PerformanceSettings;
  schedule?: MemberSchedule | null;
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  reports: DailyReportRecord[];
  meetings: MeetingRecord[];
  meetingAttendance: MeetingAttendanceRecord[];
  feedback: FeedbackRecord[];
  recognitions: RecognitionRecord[];
  kpi?: KpiScoreRecord | null;
};

export type CalculatedPerformanceScore = {
  attendanceScore: number;
  punctualityScore: number;
  meetingsScore: number;
  reportsScore: number;
  collaborationScore: number;
  roleKpiScore: number;
  totalScore: number;
  scheduledDays: number;
  attendedDays: number;
  lateDays: number;
  unexcusedAbsences: number;
  reportsExpected: number;
  reportsSubmitted: number;
  mandatoryMeetings: number;
  meetingsAttended: number;
  reportRate: number;
  eligible: boolean;
  eligibilityNote: string;
};

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateRange(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isoWeekday(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function monthBounds(month: string, today: string) {
  const start = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  if (today < start) return {start, end: ""};
  if (today <= monthEnd) {
    const previousDay = new Date(`${today}T00:00:00Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const end = previousDay.toISOString().slice(0, 10);
    return {start, end: end < start ? "" : end};
  }
  return {start, end: monthEnd};
}

function overlapsDate(date: string, leave: LeaveRequest) {
  return leave.status === "approved" && date >= leave.start_date && date <= leave.end_date;
}

function reportValue(status: string) {
  if (["on_time", "validated", "submitted"].includes(status)) return 1;
  if (status === "late") return 0.75;
  if (["incomplete", "needs_revision"].includes(status)) return 0.5;
  return 0;
}

function meetingValue(status: string) {
  if (status === "present") return 1;
  if (status === "late") return 0.75;
  return 0;
}

export function calculatePerformanceScore(input: ScoreInput): CalculatedPerformanceScore {
  const {start, end} = monthBounds(input.month, input.today);
  const settings = input.settings;
  const schedule = input.schedule;
  const workDays = schedule?.work_days?.length ? schedule.work_days : [1, 2, 3, 4, 5];
  const effectiveFrom = schedule?.effective_from ?? start;
  const effectiveTo = schedule?.effective_to ?? end;

  const candidateDates = end ? dateRange(start, end) : [];
  const scheduledDates = candidateDates.filter((date) => {
    if (!workDays.includes(isoWeekday(date))) return false;
    if (date < effectiveFrom) return false;
    if (effectiveTo && date > effectiveTo) return false;
    return !input.leaves.some((leave) => leave.user_id === input.userId && overlapsDate(date, leave));
  });

  const attendanceByDate = new Map(
    input.attendance
      .filter((row) => row.user_id === input.userId)
      .map((row) => [row.work_date, row]),
  );

  const attendanceRows = scheduledDates
    .map((date) => attendanceByDate.get(date))
    .filter((row): row is AttendanceRecord => Boolean(row));
  const attendedRows = attendanceRows.filter((row) => ["present", "late", "remote"].includes(row.status));
  const lateRows = attendedRows.filter((row) => row.status === "late" || row.late_minutes > 0);
  const scheduledDays = scheduledDates.length;
  const attendedDays = attendedRows.length;
  const lateDays = lateRows.length;
  const unexcusedAbsences = Math.max(0, scheduledDays - attendedDays);

  const attendanceWeight = toNumber(settings.attendance_weight, 20);
  const punctualityWeight = toNumber(settings.punctuality_weight, 15);
  const meetingsWeight = toNumber(settings.meetings_weight, 10);
  const reportsWeight = toNumber(settings.reports_weight, 15);
  const collaborationWeight = toNumber(settings.collaboration_weight, 10);
  const roleKpiWeight = toNumber(settings.role_kpi_weight, 30);

  const attendanceScore = scheduledDays ? (attendedDays / scheduledDays) * attendanceWeight : 0;
  const punctualityScore = attendedDays
    ? ((attendedDays - lateDays) / attendedDays) * punctualityWeight
    : 0;

  const reportByDate = new Map(
    input.reports
      .filter((row) => row.user_id === input.userId)
      .map((row) => [row.report_date, row]),
  );
  const reportValues = scheduledDates.map((date) => reportValue(reportByDate.get(date)?.status ?? "missing"));
  const reportsExpected = scheduledDates.length;
  const reportsSubmitted = reportValues.filter((value) => value > 0).length;
  const reportRate = reportsExpected ? (reportsSubmitted / reportsExpected) * 100 : 0;
  const reportsScore = reportsExpected
    ? (reportValues.reduce<number>((sum, value) => sum + value, 0) / reportsExpected) * reportsWeight
    : 0;

  const meetingIds = new Set(
    input.meetings
      .filter((meeting) => meeting.mandatory && meeting.starts_at.slice(0, 7) === input.month)
      .map((meeting) => meeting.id),
  );
  const assignedMeetingRows = input.meetingAttendance.filter(
    (row) => row.user_id === input.userId && meetingIds.has(row.meeting_id),
  );
  const relevantMeetingRows = assignedMeetingRows.filter((row) => row.status !== "excused");
  const mandatoryMeetings = relevantMeetingRows.length;
  const meetingsAttended = relevantMeetingRows.filter((row) => ["present", "late"].includes(row.status)).length;
  const meetingsScore = mandatoryMeetings
    ? (relevantMeetingRows.reduce((sum, row) => sum + meetingValue(row.status), 0) / mandatoryMeetings) * meetingsWeight
    : meetingsWeight;

  const monthFeedback = input.feedback.filter(
    (row) => row.recipient_id === input.userId && row.created_at.slice(0, 7) === input.month,
  );
  const feedbackAverage = monthFeedback.length
    ? monthFeedback.reduce((sum, row) => sum + Number(row.score), 0) / monthFeedback.length
    : 0;
  const monthRecognitions = input.recognitions.filter(
    (row) => row.recipient_id === input.userId && row.created_at.slice(0, 7) === input.month,
  ).length;
  const feedbackPart = monthFeedback.length ? (feedbackAverage / 5) * 0.7 : 0;
  const recognitionPart = (Math.min(monthRecognitions, 5) / 5) * 0.3;
  const collaborationScore = (feedbackPart + recognitionPart) * collaborationWeight;

  const rawKpiScore = toNumber(input.kpi?.score, 0);
  const roleKpiScore = (Math.min(30, Math.max(0, rawKpiScore)) / 30) * roleKpiWeight;

  const totalScore = round(
    attendanceScore +
      punctualityScore +
      meetingsScore +
      reportsScore +
      collaborationScore +
      roleKpiScore,
  );

  const reasons: string[] = [];
  if (scheduledDays < settings.minimum_work_days) reasons.push("minimum_work_days");
  if (reportRate < toNumber(settings.minimum_report_rate, 90)) reasons.push("minimum_report_rate");
  if (unexcusedAbsences > settings.maximum_unexcused_absences) reasons.push("unexcused_absences");
  if (totalScore < toNumber(settings.minimum_score, 80)) reasons.push("minimum_score");

  return {
    attendanceScore: round(attendanceScore),
    punctualityScore: round(punctualityScore),
    meetingsScore: round(meetingsScore),
    reportsScore: round(reportsScore),
    collaborationScore: round(collaborationScore),
    roleKpiScore: round(roleKpiScore),
    totalScore,
    scheduledDays,
    attendedDays,
    lateDays,
    unexcusedAbsences,
    reportsExpected,
    reportsSubmitted,
    mandatoryMeetings,
    meetingsAttended,
    reportRate: round(reportRate),
    eligible: reasons.length === 0,
    eligibilityNote: reasons.join(","),
  };
}
