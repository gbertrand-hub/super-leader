import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  calculateMonthlyPerformanceAction,
  cancelLeaveRequestAction,
  clockInAction,
  completeDailyReportForEmployeeAction,
  clockOutAction,
  createPerformanceMeetingAction,
  markMeetingAttendanceAction,
  publishEmployeeOfMonthAction,
  reviewPerformanceAppealAction,
  recordAttendanceAction,
  reopenDailyReportAction,
  reopenWorkdayAction,
  revokeDailyReportReopeningAction,
  reviewDailyReportAction,
  reviewLeaveRequestAction,
  submitDailyReportAction,
  submitLeaveRequestAction,
  submitPerformanceAppealAction,
  updatePerformanceSettingsAction,
  updatePerformanceMeetingAction,
  updateDailyReportReminderSettingsAction,
  upsertMemberScheduleAction,
  upsertMonthlyKpiScoreAction,
} from "@/app/actions/performance";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import {
  DailyTaskOutcomeFields,
  type DailyWorkTaskView,
} from "@/components/performance/daily-execution";
import { MemberTimeZoneFields } from "@/components/performance/member-time-zone-fields";
import {
  startZoomMeetingAction,
  syncZoomAttendanceAction,
} from "@/app/actions/integrations";
import { SecureAttachmentUpload } from "@/components/forms/secure-attachment-upload";
import { TimeZoneSelect } from "@/components/forms/time-zone-select";
import { ZoomHostSelector } from "@/components/zoom-host-selector";
import { MeetingParticipantSelector } from "@/components/meeting-participant-selector";
import { CopyMeetingLinkButton } from "@/components/copy-meeting-link-button";
import { dailyExecutionCopy } from "@/i18n/daily-execution";
import { getI18n } from "@/i18n/server";
import { getVisibleUserIds } from "@/lib/auth/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeTimeZone } from "@/lib/timezone";
import {
  getOrganizationZoomHosts,
  getOrganizationZoomSettings,
} from "@/lib/zoom/settings";

type SearchParams = {
  view?: string | string[];
  month?: string | string[];
  report?: string | string[];
  reportDate?: string | string[];
  success?: string | string[];
  error?: string | string[];
};

type PageProps = { searchParams?: Promise<SearchParams> };
type Membership = { organization_id: string; role: string };
type MemberRow = { user_id: string; role: string };
type TeamRow = { id: string; department: string | null; manager_id?: string | null };
type TeamMemberRow = { team_id: string; user_id: string };
type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  time_zone: string | null;
};
type SettingsRow = {
  timezone: string;
  default_start_time: string;
  default_end_time: string;
  grace_minutes: number;
  report_deadline_time: string;
  report_lock_enabled: boolean;
  report_reminders_enabled: boolean;
  report_first_reminder_minutes: number;
  report_urgent_reminder_minutes: number;
  report_supervisor_escalation_enabled: boolean;
  maximum_reopen_hours: number;
  maximum_reopenings_per_day: number;
  reopened_report_score_percent: number | string;
  supervisor_report_score_percent: number | string;
  workday_reopen_enabled: boolean;
  maximum_workday_reopenings_per_day: number;
  long_day_warning_minutes: number;
  night_work_start: string;
  night_work_end: string;
  minimum_work_days: number;
  minimum_report_rate: number | string;
  minimum_score: number | string;
  maximum_unexcused_absences: number;
  attendance_weight: number | string;
  punctuality_weight: number | string;
  meetings_weight: number | string;
  reports_weight: number | string;
  collaboration_weight: number | string;
  training_weight: number | string;
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
  supervisor_id: string | null;
  work_policy: "fixed" | "flexible" | "autonomous";
  start_window_from: string;
  start_window_until: string;
  daily_target_minutes: number;
  weekly_target_minutes: number;
  core_hours_start: string | null;
  core_hours_end: string | null;
  latest_end_time: string | null;
  allow_overnight: boolean;
  pause_tracking_enabled: boolean;
  short_day_justification_required: boolean;
  report_required_before_clock_out: boolean;
  attendance_tracking_required: boolean;
  employee_alert_delay_minutes: number;
  supervisor_alert_delay_minutes: number;
};
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
  status: string;
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
  total_work_minutes: number;
  scheduled_work_minutes: number;
  outside_schedule_minutes: number;
  night_minutes: number;
  weekend_minutes: number;
  work_timezone: string | null;
  closure_count: number;
  reopened_at: string | null;
  reopened_by: string | null;
  reopening_reason: string | null;
  work_policy?: "fixed" | "flexible" | "autonomous";
  target_work_minutes?: number;
  gross_work_minutes?: number;
  pause_minutes?: number;
  short_day?: boolean;
  short_day_justification?: string | null;
  target_met?: boolean;
};
type LeaveRow = {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  document_url: string | null;
  document_storage_path: string | null;
  document_file_name: string | null;
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
  submitted_by: string;
  submission_mode: "employee" | "reopened_employee" | "supervisor" | string;
  submission_score_factor: number | string;
  supervisor_reason: string | null;
  reopening_id: string | null;
  revision_number: number;
  locked_at: string | null;
  last_revision_reason: string | null;
};
type ReopeningRow = {
  id: string;
  user_id: string;
  report_date: string;
  reason: string;
  justified: boolean;
  score_factor: number | string;
  status: string;
  opened_by: string;
  opened_at: string;
  expires_at: string;
  used_at: string | null;
};
type AttendanceReopeningRow = {
  id: string;
  attendance_id: string;
  user_id: string;
  work_date: string;
  reason: string;
  previous_clock_out_at: string;
  previous_total_work_minutes: number;
  status: string;
  reopened_by: string;
  reopened_at: string;
  closed_at: string | null;
  new_clock_out_at: string | null;
};
type ReportVersionRow = {
  id: string;
  report_id: string;
  user_id: string;
  report_date: string;
  version_number: number;
  accomplishments: string;
  results: string;
  blockers: string;
  next_priorities: string;
  status: string;
  submitted_at: string;
  submission_mode: string;
  archive_reason: string;
  archived_at: string;
};
type DailyExecutionSettingsRow = {
  enabled: boolean;
  minimum_tasks: number;
  maximum_tasks: number;
  required_from: string;
  require_task_outcomes_for_report: boolean;
};
type DailyWorkPlanRow = {
  id: string;
  status: string;
  minimum_tasks_snapshot: number;
};
type DailyTaskOutcomeVersionRow = {
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
type MeetingRow = {
  id: string;
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
  zoom_host_email: string | null;
  zoom_department: string | null;
  zoom_status: string;
  zoom_last_synced_at: string | null;
  zoom_sync_error: string | null;
};
type MeetingAttendanceRow = {
  id: string;
  meeting_id: string;
  user_id: string;
  status: string;
  late_minutes: number;
  notes: string | null;
  duration_minutes: number;
  attendance_source: string;
};
type KpiRow = { user_id: string; score: number | string; notes: string | null };
type ScoreRow = {
  user_id: string;
  score_month: string;
  attendance_score: number | string;
  punctuality_score: number | string;
  meetings_score: number | string;
  reports_score: number | string;
  collaboration_score: number | string;
  training_score: number | string;
  role_kpi_score: number | string;
  growth_score: number | string;
  growth_credits: number | string;
  total_score: number | string;
  scheduled_days: number;
  attended_days: number;
  late_days: number;
  unexcused_absences: number;
  reports_expected: number;
  reports_submitted: number;
  mandatory_meetings: number;
  meetings_attended: number;
  trainings_required: number;
  trainings_completed: number;
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

const views = [
  "overview",
  "attendance",
  "absences",
  "reports",
  "meetings",
  "ranking",
  "settings",
] as const;
const leaderRoles = new Set(["owner", "admin", "executive", "hr", "manager"]);
const hrRoles = new Set(["owner", "admin", "hr"]);

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function monthValue(value: string) {
  return /^\d{4}-\d{2}$/.test(value)
    ? value
    : new Date().toISOString().slice(0, 7);
}

function zonedDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function zonedDateTime(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
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
  const remaining = minutes % 60;
  if (!hours) return `${remaining} min`;
  return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
}

function fieldClass() {
  return "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
}

function Metric({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "slate" | "indigo" | "emerald" | "amber" | "red";
}) {
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
      {detail ? (
        <p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p>
      ) : null}
    </article>
  );
}

function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "indigo" | "emerald" | "amber" | "red";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    indigo: "bg-indigo-100 text-indigo-800",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function statusTone(
  status: string,
): "slate" | "indigo" | "emerald" | "amber" | "red" {
  if (
    [
      "present",
      "approved",
      "accepted",
      "validated",
      "on_time",
      "published",
    ].includes(status)
  )
    return "emerald";
  if (["late", "pending", "submitted", "invited"].includes(status))
    return "amber";
  if (
    [
      "remote",
      "training",
      "supervisor_completed",
      "reopened_employee",
    ].includes(status)
  )
    return "indigo";
  if (["absent", "rejected", "incomplete", "needs_revision"].includes(status))
    return "red";
  return "slate";
}

export default async function PerformancePage({ searchParams }: PageProps) {
  const { t, locale } = await getI18n();
  const params = (await searchParams) ?? {};
  const rawView = firstValue(params.view);
  const view = views.includes(rawView as (typeof views)[number])
    ? rawView
    : "overview";
  const month = monthValue(firstValue(params.month));
  const scoreMonth = `${month}-01`;
  const success = firstValue(params.success);
  const errorMessage = firstValue(params.error);
  const requestedReportDate = firstValue(params.reportDate);
  const requestedReportId = firstValue(params.report);
  const dailyCopy = dailyExecutionCopy(locale);
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const requestNow = new Date();
  const requestNowTimestamp = requestNow.getTime();

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) redirect("/dashboard/company");

  const isLeader = leaderRoles.has(membership.role);
  const canReviewLeave = membership.role === "hr";
  const canConfigure = hrRoles.has(membership.role);
  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });
  const visibleUserIdSet = new Set(visibleUserIds);

  const schemaCheck = await admin
    .from("performance_settings")
    .select("organization_id", { head: true, count: "exact" })
    .limit(1);
  if (schemaCheck.error) {
    const missingTable =
      schemaCheck.error.code === "42P01" ||
      schemaCheck.error.code === "PGRST205";
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
        <div className="mx-auto max-w-4xl">
          <header className="rounded-3xl bg-slate-950 p-7 text-white">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">
              {t("performance.eyebrow")}
            </p>
            <h1 className="mt-2 text-3xl font-black">
              {t("performance.title")}
            </h1>
          </header>
          <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
            <h2 className="text-2xl font-black text-amber-950">
              {missingTable
                ? t("performance.databaseSetupTitle")
                : t("performance.loadFailedTitle")}
            </h2>
            <p className="mt-3 leading-7 text-amber-900">
              {missingTable
                ? t("performance.databaseSetupDescription")
                : schemaCheck.error.message}
            </p>
            {missingTable ? (
              <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">
                supabase/012_performance_employee_of_month.sql
              </code>
            ) : null}
          </section>
        </div>
      </main>
    );
  }

  const governanceSchemaCheck = await admin
    .from("daily_report_reopenings")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  if (governanceSchemaCheck.error) {
    const missingTable =
      governanceSchemaCheck.error.code === "42P01" ||
      governanceSchemaCheck.error.code === "PGRST205";
    if (missingTable) {
      return (
        <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
          <div className="mx-auto max-w-4xl">
            <header className="rounded-3xl bg-slate-950 p-7 text-white">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">
                {t("performance.eyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-black">
                {t("performance.title")}
              </h1>
            </header>
            <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
              <h2 className="text-2xl font-black text-amber-950">
                {t("performance.reportGovernanceSetupTitle")}
              </h2>
              <p className="mt-3 leading-7 text-amber-900">
                {t("performance.reportGovernanceSetupDescription")}
              </p>
              <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">
                supabase/013_daily_report_locking_supervisor.sql
              </code>
            </section>
          </div>
        </main>
      );
    }
    throw new Error(governanceSchemaCheck.error.message);
  }

  const dayGovernanceSchemaCheck = await admin
    .from("attendance_reopenings")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  if (dayGovernanceSchemaCheck.error) {
    const missingTable =
      dayGovernanceSchemaCheck.error.code === "42P01" ||
      dayGovernanceSchemaCheck.error.code === "PGRST205";
    if (missingTable) {
      return (
        <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
          <div className="mx-auto max-w-4xl">
            <header className="rounded-3xl bg-slate-950 p-7 text-white">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">
                {t("performance.eyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-black">
                {t("performance.title")}
              </h1>
            </header>
            <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-7">
              <h2 className="text-2xl font-black text-amber-950">
                {t("performance.dayGovernanceSetupTitle")}
              </h2>
              <p className="mt-3 leading-7 text-amber-900">
                {t("performance.dayGovernanceSetupDescription")}
              </p>
              <code className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">
                supabase/033_day_report_time_governance_v2_6.sql
              </code>
            </section>
          </div>
        </main>
      );
    }
    throw new Error(dayGovernanceSchemaCheck.error.message);
  }

  let { data: settings } = await admin
    .from("performance_settings")
    .select("*")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<SettingsRow>();
  if (!settings) {
    const { data } = await admin
      .from("performance_settings")
      .upsert(
        { organization_id: membership.organization_id },
        { onConflict: "organization_id" },
      )
      .select("*")
      .single<SettingsRow>();
    settings = data;
  }
  if (!settings) throw new Error(t("performance.messages.settingsMissing"));

  const [zoomSettings, zoomHosts, zoomTeamsResult] = await Promise.all([
    getOrganizationZoomSettings(admin, membership.organization_id),
    getOrganizationZoomHosts(admin, membership.organization_id, {
      activeOnly: true,
    }),
    admin
      .from("teams")
      .select("department, manager_id")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true),
  ]);
  if (
    zoomTeamsResult.error &&
    !["42P01", "PGRST205"].includes(zoomTeamsResult.error.code)
  )
    throw new Error(zoomTeamsResult.error.message);
  const zoomHostSelectionLocked = membership.role === "manager";
  const managerZoomDepartments = zoomHostSelectionLocked
    ? [...new Set((zoomTeamsResult.data || [])
        .filter((team) => team.manager_id === authData.user.id)
        .map((team) => String(team.department || "").trim())
        .filter(Boolean))]
    : [];
  const managerZoomDepartmentKeys = new Set(managerZoomDepartments.map((department) => department.toLocaleLowerCase()));
  const availableZoomHosts = zoomHostSelectionLocked
    ? zoomHosts.filter((host) => managerZoomDepartmentKeys.has(String(host.department || "").trim().toLocaleLowerCase()))
    : zoomHosts;
  const zoomEnabled = Boolean(
    zoomSettings.enabled &&
      (availableZoomHosts.length || (!zoomHostSelectionLocked && zoomSettings.default_host_email)),
  );
  const zoomDepartments = [
    ...new Set(
      [
        ...(zoomTeamsResult.data || []).map((team) =>
          String(team.department || "").trim(),
        ),
        ...availableZoomHosts.map((host) => String(host.department || "").trim()),
      ].filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const zoomHostOptions = availableZoomHosts.map((host) => ({
    id: host.id,
    email: host.email,
    displayName: host.display_name || host.email,
    department: host.department || "",
    isDepartmentDefault: host.is_department_default,
  }));
  const defaultZoomHostId =
    availableZoomHosts.find(
      (host) =>
        host.email.toLocaleLowerCase() ===
        String(zoomSettings.default_host_email || "").toLocaleLowerCase(),
    )?.id ||
    availableZoomHosts.find((host) => host.is_department_default)?.id ||
    availableZoomHosts[0]?.id ||
    null;

  const membersResult = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true)
    .order("created_at");
  if (membersResult.error) throw new Error(membersResult.error.message);
  const members = ((membersResult.data ?? []) as MemberRow[]).filter((member) =>
    visibleUserIdSet.has(member.user_id),
  );
  const memberIds = members.map((member) => member.user_id);
  const profilesResult = memberIds.length
    ? await admin
        .from("profiles")
        .select("id, full_name, email, time_zone")
        .in("id", memberIds)
    : { data: [] as ProfileRow[], error: null };
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const participantTeamsResult = await admin
    .from("teams")
    .select("id, department")
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true);
  if (participantTeamsResult.error) throw new Error(participantTeamsResult.error.message);
  const participantTeams = (participantTeamsResult.data ?? []) as TeamRow[];
  const participantTeamIds = participantTeams.map((team) => team.id);
  const participantMembershipsResult = participantTeamIds.length && memberIds.length
    ? await admin
        .from("team_members")
        .select("team_id, user_id")
        .in("team_id", participantTeamIds)
        .in("user_id", memberIds)
    : { data: [] as TeamMemberRow[], error: null };
  if (participantMembershipsResult.error) throw new Error(participantMembershipsResult.error.message);
  const departmentByTeamId = new Map(participantTeams.map((team) => [team.id, String(team.department || "").trim()]));
  const departmentsByUserId = new Map<string, Set<string>>();
  for (const row of (participantMembershipsResult.data ?? []) as TeamMemberRow[]) {
    const department = departmentByTeamId.get(row.team_id);
    if (!department) continue;
    const values = departmentsByUserId.get(row.user_id) ?? new Set<string>();
    values.add(department);
    departmentsByUserId.set(row.user_id, values);
  }
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const roleById = new Map(
    members.map((member) => [member.user_id, member.role]),
  );
  const memberOptions = memberIds
    .map((id) => ({
      id,
      name:
        profileById.get(id)?.full_name?.trim() ||
        profileById.get(id)?.email ||
        t("common.member"),
      email: profileById.get(id)?.email || "",
      timeZone: normalizeTimeZone(profileById.get(id)?.time_zone, settings.timezone),
      role: roleById.get(id) || "employee",
      departments: [...(departmentsByUserId.get(id) ?? [])].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const memberName = (id: string) =>
    memberOptions.find((member) => member.id === id)?.name ||
    t("common.member");
  const leaderOptions = memberOptions.filter((member) =>
    leaderRoles.has(member.role),
  );

  settings.timezone = normalizeTimeZone(settings.timezone);
  const today = zonedDate(requestNow, settings.timezone);
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0))
    .toISOString()
    .slice(0, 10);

  const [
    schedulesResult,
    detailedSchedulesResult,
    attendanceResult,
    attendanceReopeningsResult,
    leavesResult,
    reportsResult,
    reportVersionsResult,
    reopeningsResult,
    meetingsResult,
    meetingAttendanceResult,
    kpiResult,
    scoresResult,
    awardsResult,
    appealsResult,
  ] = await Promise.all([
    admin
      .from("member_work_schedules")
      .select("*")
      .eq("organization_id", membership.organization_id)
      .eq("is_active", true)
      .in("user_id", visibleUserIds),
    admin
      .from("work_schedule_entries")
      .select(
        "user_id, work_date, timezone, start_time, end_time, grace_minutes, report_deadline_time, work_mode, report_required, status",
      )
      .eq("organization_id", membership.organization_id)
      .eq("status", "published")
      .in("user_id", visibleUserIds)
      .gte("work_date", monthStart)
      .lte("work_date", monthEnd),
    admin
      .from("attendance_records")
      .select(
        "id, user_id, work_date, clock_in_at, clock_out_at, status, late_minutes, justification, source, total_work_minutes, scheduled_work_minutes, outside_schedule_minutes, night_minutes, weekend_minutes, work_timezone, closure_count, reopened_at, reopened_by, reopening_reason",
      )
      .eq("organization_id", membership.organization_id)
      .in("user_id", visibleUserIds)
      .gte("work_date", monthStart)
      .lte("work_date", monthEnd)
      .order("work_date", { ascending: false })
      .limit(500),
    admin
      .from("attendance_reopenings")
      .select(
        "id, attendance_id, user_id, work_date, reason, previous_clock_out_at, previous_total_work_minutes, status, reopened_by, reopened_at, closed_at, new_clock_out_at",
      )
      .eq("organization_id", membership.organization_id)
      .in("user_id", visibleUserIds)
      .gte("work_date", monthStart)
      .lte("work_date", monthEnd)
      .order("reopened_at", { ascending: false })
      .limit(500),
    admin
      .from("leave_requests")
      .select(
        "id, user_id, leave_type, start_date, end_date, reason, document_url, document_storage_path, document_file_name, status, review_note, created_at",
      )
      .eq("organization_id", membership.organization_id)
      .in("user_id", visibleUserIds)
      .order("created_at", { ascending: false })
      .limit(300),
    admin
      .from("daily_reports")
      .select(
        "id, user_id, report_date, accomplishments, results, blockers, next_priorities, status, review_note, submitted_at, submitted_by, submission_mode, submission_score_factor, supervisor_reason, reopening_id, revision_number, locked_at, last_revision_reason",
      )
      .eq("organization_id", membership.organization_id)
      .in("user_id", visibleUserIds)
      .gte("report_date", monthStart)
      .lte("report_date", monthEnd)
      .order("report_date", { ascending: false })
      .limit(500),
    admin
      .from("daily_report_versions")
      .select(
        "id, report_id, user_id, report_date, version_number, accomplishments, results, blockers, next_priorities, status, submitted_at, submission_mode, archive_reason, archived_at",
      )
      .eq("organization_id", membership.organization_id)
      .in("user_id", visibleUserIds)
      .gte("report_date", monthStart)
      .lte("report_date", monthEnd)
      .order("archived_at", { ascending: false })
      .limit(500),
    admin
      .from("daily_report_reopenings")
      .select(
        "id, user_id, report_date, reason, justified, score_factor, status, opened_by, opened_at, expires_at, used_at",
      )
      .eq("organization_id", membership.organization_id)
      .in("user_id", visibleUserIds)
      .gte("report_date", monthStart)
      .lte("report_date", monthEnd)
      .order("opened_at", { ascending: false })
      .limit(500),
    admin
      .from("performance_meetings")
      .select(
        "id, title, meeting_type, mandatory, starts_at, ends_at, notes, created_by, provider, meeting_url, zoom_meeting_id, zoom_host_email, zoom_department, zoom_status, zoom_last_synced_at, zoom_sync_error",
      )
      .eq("organization_id", membership.organization_id)
      .gte("starts_at", `${monthStart}T00:00:00Z`)
      .lte("starts_at", `${monthEnd}T23:59:59Z`)
      .order("starts_at", { ascending: false })
      .limit(200),
    admin
      .from("performance_meeting_attendance")
      .select(
        "id, meeting_id, user_id, status, late_minutes, notes, duration_minutes, attendance_source",
      )
      .eq("organization_id", membership.organization_id)
      .in("user_id", visibleUserIds),
    admin
      .from("monthly_kpi_scores")
      .select("user_id, score, notes")
      .eq("organization_id", membership.organization_id)
      .in("user_id", visibleUserIds)
      .eq("score_month", scoreMonth),
    admin
      .from("employee_month_scores")
      .select(
        "user_id, score_month, attendance_score, punctuality_score, meetings_score, reports_score, collaboration_score, training_score, role_kpi_score, growth_score, growth_credits, total_score, scheduled_days, attended_days, late_days, unexcused_absences, reports_expected, reports_submitted, mandatory_meetings, meetings_attended, trainings_required, trainings_completed, eligible, eligibility_note, position, calculated_at, locked_at",
      )
      .eq("organization_id", membership.organization_id)
      .in("user_id", visibleUserIds)
      .eq("score_month", scoreMonth)
      .order("total_score", { ascending: false }),
    admin
      .from("employee_month_awards")
      .select(
        "award_month, winner_id, final_score, announcement_note, published_at",
      )
      .eq("organization_id", membership.organization_id)
      .order("award_month", { ascending: false })
      .limit(12),
    admin
      .from("performance_score_appeals")
      .select(
        "id, user_id, score_month, reason, status, resolution_note, created_at",
      )
      .eq("organization_id", membership.organization_id)
      .in("user_id", visibleUserIds)
      .eq("score_month", scoreMonth)
      .order("created_at", { ascending: false }),
  ]);

  const detailedScheduleError =
    detailedSchedulesResult.error &&
    !["42P01", "PGRST205"].includes(detailedSchedulesResult.error.code)
      ? detailedSchedulesResult.error
      : null;
  const loadError = [
    schedulesResult.error,
    detailedScheduleError,
    attendanceResult.error,
    attendanceReopeningsResult.error,
    leavesResult.error,
    reportsResult.error,
    reportVersionsResult.error,
    reopeningsResult.error,
    meetingsResult.error,
    meetingAttendanceResult.error,
    kpiResult.error,
    scoresResult.error,
    awardsResult.error,
    appealsResult.error,
  ].find(Boolean);
  if (loadError)
    throw new Error(
      t("performance.messages.loadFailed", { message: loadError.message }),
    );

  const schedules = (schedulesResult.data ?? []) as ScheduleRow[];
  const detailedSchedules = (detailedSchedulesResult.data ??
    []) as DetailedScheduleRow[];
  const allAttendance = (attendanceResult.data ?? []) as AttendanceRow[];
  const attendanceReopenings = (attendanceReopeningsResult.data ??
    []) as AttendanceReopeningRow[];
  const allLeaves = (leavesResult.data ?? []) as LeaveRow[];
  const allReports = (reportsResult.data ?? []) as DailyReportRow[];
  const reportVersions = (reportVersionsResult.data ??
    []) as ReportVersionRow[];

  const dailyExecutionSettingsResult = await admin
    .from("daily_execution_settings")
    .select(
      "enabled, minimum_tasks, maximum_tasks, required_from, require_task_outcomes_for_report",
    )
    .eq("organization_id", membership.organization_id)
    .maybeSingle<DailyExecutionSettingsRow>();
  const dailyExecutionReady = !dailyExecutionSettingsResult.error;
  if (
    dailyExecutionSettingsResult.error &&
    !["42P01", "PGRST205"].includes(dailyExecutionSettingsResult.error.code)
  ) {
    console.error(
      "Performance: daily execution settings unavailable",
      dailyExecutionSettingsResult.error.message,
    );
  }
  const dailyExecutionSettings: DailyExecutionSettingsRow =
    dailyExecutionSettingsResult.data ?? {
      enabled: true,
      minimum_tasks: 6,
      maximum_tasks: 12,
      required_from: today,
      require_task_outcomes_for_report: true,
    };
  const visibleReportIds = allReports.map((report) => report.id);
  const taskOutcomeVersions: DailyTaskOutcomeVersionRow[] = [];
  if (dailyExecutionReady && visibleReportIds.length) {
    // Keep PostgREST URLs small. A single `.in(...)` with hundreds of UUIDs can
    // exceed proxy/fetch URL limits and surface as `TypeError: fetch failed`.
    const reportIdBatchSize = 50;
    for (
      let offset = 0;
      offset < visibleReportIds.length;
      offset += reportIdBatchSize
    ) {
      const reportIdBatch = visibleReportIds.slice(
        offset,
        offset + reportIdBatchSize,
      );
      const batchResult = await admin
        .from("daily_work_task_outcome_versions")
        .select(
          "id, daily_report_id, report_revision_number, position, title, expected_outcome, final_status, actual_outcome, outcome_reason, next_action, next_action_date",
        )
        .in("daily_report_id", reportIdBatch)
        .order("position");

      if (batchResult.error) {
        // Outcome history is supplementary on the Performance page. Keep the
        // rest of the page available while reporting the failed batch once.
        console.warn(
          "Performance: daily task outcome history unavailable",
          batchResult.error.message,
        );
        break;
      }

      taskOutcomeVersions.push(
        ...((batchResult.data ?? []) as DailyTaskOutcomeVersionRow[]),
      );
    }
  }
  const taskOutcomesByReport = new Map<string, DailyTaskOutcomeVersionRow[]>();
  for (const outcome of taskOutcomeVersions) {
    const rows = taskOutcomesByReport.get(outcome.daily_report_id) ?? [];
    rows.push(outcome);
    taskOutcomesByReport.set(outcome.daily_report_id, rows);
  }
  const reopenings = (reopeningsResult.data ?? []) as ReopeningRow[];
  const allMeetings = (meetingsResult.data ?? []) as MeetingRow[];
  const meetingAttendance = (meetingAttendanceResult.data ??
    []) as MeetingAttendanceRow[];
  const visibleMeetingIds = new Set(
    meetingAttendance.map((row) => row.meeting_id),
  );
  const meetings = ["owner", "admin", "hr"].includes(membership.role)
    ? allMeetings
    : allMeetings.filter(
        (meeting) =>
          visibleMeetingIds.has(meeting.id) ||
          (membership.role === "manager" &&
            meeting.created_by === authData.user.id),
      );
  const kpis = (kpiResult.data ?? []) as KpiRow[];
  const scores = (scoresResult.data ?? []) as ScoreRow[];
  const awards = (awardsResult.data ?? []) as AwardRow[];
  const appeals = (appealsResult.data ?? []) as AppealRow[];
  const managerSupervisedIds = new Set(
    schedules
      .filter((schedule) => schedule.supervisor_id === authData.user.id)
      .map((schedule) => schedule.user_id),
  );
  const visibleAttendance = allAttendance;
  const visibleLeaves = allLeaves;
  const visibleReports =
    membership.role === "manager"
      ? allReports.filter(
          (row) =>
            row.user_id === authData.user.id ||
            managerSupervisedIds.has(row.user_id),
        )
      : isLeader
        ? allReports
        : allReports.filter((row) => row.user_id === authData.user.id);
  const visibleMeetingAttendance = meetingAttendance;
  const ownAttendanceToday = allAttendance.find(
    (row) => row.user_id === authData.user.id && row.work_date === today,
  );
  const { data: ownOpenAttendanceData, error: ownOpenAttendanceError } =
    await admin
      .from("attendance_records")
      .select(
        "id, user_id, work_date, clock_in_at, clock_out_at, status, late_minutes, justification, source, total_work_minutes, scheduled_work_minutes, outside_schedule_minutes, night_minutes, weekend_minutes, work_timezone, closure_count, reopened_at, reopened_by, reopening_reason",
      )
      .eq("organization_id", membership.organization_id)
      .eq("user_id", authData.user.id)
      .not("clock_in_at", "is", null)
      .is("clock_out_at", null)
      .order("work_date", { ascending: false })
      .limit(1)
      .maybeSingle<AttendanceRow>();
  if (ownOpenAttendanceError)
    throw new Error(
      t("performance.messages.loadFailed", {
        message: ownOpenAttendanceError.message,
      }),
    );
  const ownAttendanceForClock = ownOpenAttendanceData ?? ownAttendanceToday;
  const ownScore = scores.find((score) => score.user_id === authData.user.id);
  const publishedAward = awards.find(
    (award) => award.award_month === scoreMonth,
  );
  const visibleScores =
    isLeader || publishedAward
      ? scores
      : scores.filter((score) => score.user_id === authData.user.id);
  const visibleAppeals = appeals;
  const ownAppeal = appeals.find(
    (appeal) => appeal.user_id === authData.user.id,
  );
  const currentReport = allReports.find(
    (row) => row.user_id === authData.user.id && row.report_date === today,
  );
  const currentSchedule = schedules.find(
    (row) => row.user_id === authData.user.id,
  );
  const baselineLocalNow = zonedDateTime(
    requestNow,
    currentSchedule?.timezone || settings.timezone,
  );
  const currentDetailedSchedule =
    detailedSchedules.find(
      (row) =>
        row.user_id === authData.user.id &&
        row.work_date === baselineLocalNow.date,
    ) ?? null;
  const localNow = zonedDateTime(
    requestNow,
    currentDetailedSchedule?.timezone ||
      currentSchedule?.timezone ||
      settings.timezone,
  );
  const ownReportDeadline = (
    currentDetailedSchedule?.report_deadline_time ||
    currentSchedule?.report_deadline_time ||
    settings.report_deadline_time
  ).slice(0, 5);
  const reportRequiredToday = currentDetailedSchedule
    ? currentDetailedSchedule.report_required &&
      currentDetailedSchedule.work_mode !== "off"
    : true;
  const currentDayReportOpen =
    reportRequiredToday &&
    (settings.report_lock_enabled === false ||
      timeToMinutes(localNow.time) <= timeToMinutes(ownReportDeadline));
  const activeOwnReopenings = reopenings.filter(
    (row) =>
      row.user_id === authData.user.id &&
      row.status === "active" &&
      new Date(row.expires_at).getTime() > requestNowTimestamp,
  );
  const availableReportDates = Array.from(
    new Set([
      ...(currentDayReportOpen && !currentReport ? [localNow.date] : []),
      ...activeOwnReopenings.map((row) => row.report_date),
    ]),
  )
    .sort()
    .reverse();
  const selectedReportDate = availableReportDates.includes(requestedReportDate)
    ? requestedReportDate
    : (availableReportDates[0] ?? "");
  const editableReport = selectedReportDate
    ? (allReports.find(
        (row) =>
          row.user_id === authData.user.id &&
          row.report_date === selectedReportDate,
      ) ?? null)
    : null;
  const reportDailyPlanResult =
    dailyExecutionReady && selectedReportDate
      ? await admin
          .from("daily_work_plans")
          .select("id, status, minimum_tasks_snapshot")
          .eq("organization_id", membership.organization_id)
          .eq("user_id", authData.user.id)
          .eq("work_date", selectedReportDate)
          .maybeSingle<DailyWorkPlanRow>()
      : { data: null as DailyWorkPlanRow | null, error: null };
  if (reportDailyPlanResult.error)
    console.error(
      "Performance: daily plan unavailable",
      reportDailyPlanResult.error.message,
    );
  const reportDailyPlan = reportDailyPlanResult.data ?? null;
  const reportDailyTasksResult =
    dailyExecutionReady && reportDailyPlan?.id
      ? await admin
          .from("daily_work_tasks")
          .select(
            "id, position, title, expected_outcome, priority, due_time, category, progress_status, actual_outcome, outcome_reason, next_action, next_action_date",
          )
          .eq("plan_id", reportDailyPlan.id)
          .eq("organization_id", membership.organization_id)
          .eq("user_id", authData.user.id)
          .order("position")
      : { data: [] as DailyWorkTaskView[], error: null };
  if (reportDailyTasksResult.error)
    console.error(
      "Performance: daily tasks unavailable",
      reportDailyTasksResult.error.message,
    );
  const reportDailyTasks = (reportDailyTasksResult.data ??
    []) as DailyWorkTaskView[];
  const reportDailyCycleRequired = Boolean(
    selectedReportDate &&
      dailyExecutionSettings.enabled &&
      dailyExecutionSettings.require_task_outcomes_for_report &&
      selectedReportDate >= dailyExecutionSettings.required_from,
  );
  const reportDailyMinimum = Math.max(
    1,
    Number(
      reportDailyPlan?.minimum_tasks_snapshot ||
        dailyExecutionSettings.minimum_tasks ||
        6,
    ),
  );
  const reportDailyPlanValid =
    !reportDailyCycleRequired ||
    Boolean(reportDailyPlan && reportDailyTasks.length >= reportDailyMinimum);
  const reportFormReady = dailyExecutionReady && reportDailyPlanValid;
  const supervisedMemberOptions =
    membership.role === "manager"
      ? memberOptions.filter((member) =>
          schedules.some(
            (schedule) =>
              schedule.user_id === member.id &&
              schedule.supervisor_id === authData.user.id,
          ),
        )
      : memberOptions.filter((member) => member.id !== authData.user.id);
  const kpiMemberOptions =
    membership.role === "manager" ? supervisedMemberOptions : memberOptions;
  const supervisedAttendanceRows = visibleAttendance.filter(
    (row) =>
      row.clock_out_at &&
      supervisedMemberOptions.some((member) => member.id === row.user_id),
  );
  const visibleReopenings = isLeader
    ? reopenings.filter(
        (row) =>
          !["manager", "executive"].includes(membership.role) ||
          supervisedMemberOptions.some((member) => member.id === row.user_id),
      )
    : activeOwnReopenings;
  const reportRate = ownScore?.reports_expected
    ? Math.round((ownScore.reports_submitted / ownScore.reports_expected) * 100)
    : 0;

  const tabHref = (target: string) =>
    `/dashboard/performance?view=${target}&month=${month}`;
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(dateLocale, { dateStyle: "medium" }).format(
      new Date(`${value.slice(0, 10)}T00:00:00Z`),
    );
  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat(dateLocale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: normalizeTimeZone(settings.timezone),
    }).format(new Date(value));
  const formatTime = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(dateLocale, {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: normalizeTimeZone(settings.timezone),
        }).format(new Date(value))
      : "—";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl bg-slate-950 p-7 text-white">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-400">
                {t("performance.eyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-black">
                {t("performance.title")}
              </h1>
              <p className="mt-2 max-w-3xl text-slate-300">
                {t("performance.subtitle")}
              </p>
            </div>
            <form method="get" className="flex items-end gap-3">
              <input type="hidden" name="view" value={view} />
              <label className="text-sm font-bold text-slate-300">
                {t("performance.month")}
                <input
                  name="month"
                  type="month"
                  defaultValue={month}
                  className="mt-2 block rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-white"
                />
              </label>
              <button className="rounded-xl bg-amber-400 px-4 py-2.5 font-black text-slate-950">
                {t("performance.apply")}
              </button>
            </form>
          </div>
        </header>

        {success ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-bold text-emerald-800">
            {success}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-bold text-red-800">
            {errorMessage}
          </div>
        ) : null}

        <nav className="mt-6 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {views
            .filter((item) => item !== "settings" || canConfigure)
            .map((item) => (
              <Link
                key={item}
                href={tabHref(item)}
                className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${view === item ? "bg-indigo-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {t(`performance.tabs.${item}`)}
              </Link>
            ))}
        </nav>

        {view === "overview" ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Metric
                label={t("performance.currentScore")}
                value={
                  ownScore
                    ? `${number(ownScore.total_score).toFixed(1)} / 100`
                    : "—"
                }
                detail={
                  ownScore
                    ? ownScore.eligible
                      ? t("performance.eligible")
                      : t("performance.notEligible")
                    : t("performance.awaitingCalculation")
                }
                tone={ownScore?.eligible ? "emerald" : "slate"}
              />
              <Metric
                label={t("performance.attendanceRate")}
                value={
                  ownScore?.scheduled_days
                    ? `${Math.round((ownScore.attended_days / ownScore.scheduled_days) * 100)}%`
                    : "—"
                }
                detail={t("performance.daysSummary", {
                  present: ownScore?.attended_days ?? 0,
                  expected: ownScore?.scheduled_days ?? 0,
                })}
                tone="indigo"
              />
              <Metric
                label={t("performance.punctuality")}
                value={
                  ownScore?.attended_days
                    ? `${Math.round(((ownScore.attended_days - ownScore.late_days) / ownScore.attended_days) * 100)}%`
                    : "—"
                }
                detail={t("performance.lateCount", {
                  count: ownScore?.late_days ?? 0,
                })}
              />
              <Metric
                label={t("performance.dailyReports")}
                value={ownScore ? `${reportRate}%` : "—"}
                detail={t("performance.reportsSummary", {
                  submitted: ownScore?.reports_submitted ?? 0,
                  expected: ownScore?.reports_expected ?? 0,
                })}
                tone="amber"
              />
              <Metric
                label={t("performance.position")}
                value={ownScore?.position ? `#${ownScore.position}` : "—"}
                detail={t("performance.monthlyRanking")}
                tone="emerald"
              />
            </section>

            {publishedAward ? (
              <section className="mt-6 rounded-3xl border border-amber-300 bg-gradient-to-r from-amber-100 to-yellow-50 p-7 shadow-sm">
                <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-700">
                  {t("performance.employeeOfMonth")}
                </p>
                <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-3xl font-black">
                      🏆 {memberName(publishedAward.winner_id)}
                    </h2>
                    <p className="mt-2 text-slate-700">
                      {publishedAward.announcement_note ||
                        t("performance.awardDefaultMessage")}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white px-6 py-4 text-center shadow-sm">
                    <p className="text-xs font-black uppercase text-slate-500">
                      {t("performance.finalScore")}
                    </p>
                    <p className="mt-1 text-3xl font-black text-amber-700">
                      {number(publishedAward.final_score).toFixed(1)}
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">
                  {t("performance.today")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {formatDate(today)} ·{" "}
                  {currentSchedule?.start_time?.slice(0, 5) ||
                    settings.default_start_time.slice(0, 5)}
                  –
                  {currentSchedule?.end_time?.slice(0, 5) ||
                    settings.default_end_time.slice(0, 5)}
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <form action={clockInAction}>
                    <input
                      type="hidden"
                      name="returnTo"
                      value="/dashboard/performance?view=attendance"
                    />
                    <button
                      disabled={Boolean(ownAttendanceForClock?.clock_in_at)}
                      className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {ownAttendanceForClock?.clock_in_at
                        ? t("performance.clockedInAt", {
                            time: formatTime(ownAttendanceForClock.clock_in_at),
                          })
                        : t("performance.clockIn")}
                    </button>
                  </form>
                  <form action={clockOutAction} className="space-y-2">
                    <input
                      type="hidden"
                      name="returnTo"
                      value="/dashboard/performance?view=attendance"
                    />
                    <textarea
                      name="shortDayJustification"
                      rows={2}
                      placeholder={t("myDay.quickActions.shortDayPlaceholder")}
                      className={fieldClass()}
                    />
                    <ConfirmSubmitButton
                      confirmation={t("performance.clockOutConfirmation")}
                      dialogTitle={t("common.confirmationTitle")}
                      confirmLabel={t("common.confirm")}
                      cancelLabel={t("common.cancel")}
                      disabled={
                        !ownAttendanceForClock?.clock_in_at ||
                        Boolean(ownAttendanceForClock?.clock_out_at)
                      }
                      className="w-full rounded-xl border border-indigo-300 bg-indigo-50 px-5 py-3 font-black text-indigo-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {ownAttendanceForClock?.clock_out_at
                        ? t("performance.clockedOutAt", {
                            time: formatTime(
                              ownAttendanceForClock.clock_out_at,
                            ),
                          })
                        : t("performance.clockOut")}
                    </ConfirmSubmitButton>
                  </form>
                </div>
                {ownAttendanceForClock ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge tone={statusTone(ownAttendanceForClock.status)}>
                      {t(
                        `performance.statuses.${ownAttendanceForClock.status}`,
                      )}
                    </Badge>
                    {ownAttendanceForClock.late_minutes ? (
                      <Badge tone="red">
                        {t("performance.minutesLate", {
                          count: ownAttendanceForClock.late_minutes,
                        })}
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">
                  {t("performance.transparentFormula")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {t("performance.transparentFormulaHelp")}
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["attendance", settings.attendance_weight],
                    ["punctuality", settings.punctuality_weight],
                    ["meetings", settings.meetings_weight],
                    ["reports", settings.reports_weight],
                    ["collaboration", settings.collaboration_weight],
                    ["training", settings.training_weight],
                    ["roleKpi", settings.role_kpi_weight],
                  ].map(([key, weight]) => (
                    <div
                      key={String(key)}
                      className="rounded-2xl bg-slate-50 p-4"
                    >
                      <p className="text-sm font-bold text-slate-600">
                        {t(`performance.criteria.${key}`)}
                      </p>
                      <p className="mt-1 text-2xl font-black">
                        {number(weight)} pts
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </>
        ) : null}

        {view === "attendance" ? (
          <section className="mt-6 space-y-6">
            <div className="space-y-6">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">
                  {t("performance.clockTitle")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {t("performance.clockHelp")}
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <form action={clockInAction}>
                    <input
                      type="hidden"
                      name="returnTo"
                      value="/dashboard/performance?view=attendance"
                    />
                    <button
                      disabled={Boolean(ownAttendanceForClock?.clock_in_at)}
                      className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white disabled:opacity-40"
                    >
                      {t("performance.clockIn")}
                    </button>
                  </form>
                  <form action={clockOutAction} className="space-y-2">
                    <input
                      type="hidden"
                      name="returnTo"
                      value="/dashboard/performance?view=attendance"
                    />
                    <textarea
                      name="shortDayJustification"
                      rows={2}
                      placeholder={t("myDay.quickActions.shortDayPlaceholder")}
                      className={fieldClass()}
                    />
                    <ConfirmSubmitButton
                      confirmation={t("performance.clockOutConfirmation")}
                      dialogTitle={t("common.confirmationTitle")}
                      confirmLabel={t("common.confirm")}
                      cancelLabel={t("common.cancel")}
                      disabled={
                        !ownAttendanceForClock?.clock_in_at ||
                        Boolean(ownAttendanceForClock?.clock_out_at)
                      }
                      className="w-full rounded-xl border border-indigo-300 px-5 py-3 font-black text-indigo-800 disabled:opacity-40"
                    >
                      {t("performance.clockOut")}
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </article>

              {isLeader ? (
                <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-2xl font-black">
                    {t("performance.manualAttendance")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {t("performance.manualAttendanceHelp")}
                  </p>
                  <form
                    action={recordAttendanceAction}
                    className="mt-5 space-y-4"
                  >
                    <label className="block text-sm font-black">
                      {t("performance.employee")}
                      <select name="userId" required className={fieldClass()}>
                        {memberOptions.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block text-sm font-black">
                        {t("performance.date")}
                        <input
                          name="workDate"
                          type="date"
                          defaultValue={today}
                          required
                          className={fieldClass()}
                        />
                      </label>
                      <label className="block text-sm font-black">
                        {t("common.status")}
                        <select name="status" className={fieldClass()}>
                          {[
                            "present",
                            "late",
                            "absent",
                            "excused",
                            "remote",
                          ].map((status) => (
                            <option key={status} value={status}>
                              {t(`performance.statuses.${status}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="block text-sm font-black">
                      {t("performance.lateMinutes")}
                      <input
                        name="lateMinutes"
                        type="number"
                        min="0"
                        defaultValue="0"
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.justification")}
                      <textarea
                        name="justification"
                        rows={3}
                        className={fieldClass()}
                      />
                    </label>
                    <button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">
                      {t("performance.saveAttendance")}
                    </button>
                  </form>
                </article>
              ) : null}
              {isLeader ? (
                <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
                  <h2 className="text-2xl font-black text-amber-950">
                    {t("performance.reopenWorkdayTitle")}
                  </h2>
                  <p className="mt-1 text-sm text-amber-800">
                    {t("performance.reopenWorkdayHelp")}
                  </p>
                  {supervisedAttendanceRows.length ? (
                    <form
                      action={reopenWorkdayAction}
                      className="mt-5 space-y-4"
                    >
                      <label className="block text-sm font-black text-amber-950">
                        {t("performance.closedWorkday")}
                        <select
                          name="attendanceId"
                          required
                          className={fieldClass()}
                        >
                          {supervisedAttendanceRows.map((row) => (
                            <option key={row.id} value={row.id}>
                              {memberName(row.user_id)} ·{" "}
                              {formatDate(row.work_date)} ·{" "}
                              {formatTime(row.clock_out_at)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm font-black text-amber-950">
                        {t("performance.reopeningReason")}
                        <textarea
                          name="reason"
                          minLength={10}
                          rows={3}
                          required
                          className={fieldClass()}
                        />
                      </label>
                      <ConfirmSubmitButton
                        confirmation={t(
                          "performance.reopenWorkdayConfirmation",
                        )}
                        dialogTitle={t("common.confirmationTitle")}
                        confirmLabel={t("common.confirm")}
                        cancelLabel={t("common.cancel")}
                        className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950"
                      >
                        {t("performance.reopenWorkdayButton")}
                      </ConfirmSubmitButton>
                    </form>
                  ) : (
                    <p className="mt-5 rounded-xl bg-white/70 p-4 text-sm text-amber-900">
                      {t("performance.noClosedSupervisedWorkdays")}
                    </p>
                  )}
                </article>
              ) : null}
            </div>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">
                {t("performance.attendanceHistory")}
              </h2>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[1180px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-3">{t("performance.date")}</th>
                      {isLeader ? (
                        <th className="px-3 py-3">
                          {t("performance.employee")}
                        </th>
                      ) : null}
                      <th className="px-3 py-3">{t("performance.clockIn")}</th>
                      <th className="px-3 py-3">{t("performance.clockOut")}</th>
                      <th className="px-3 py-3">
                        {t("performance.workedTime")}
                      </th>
                      <th className="px-3 py-3">
                        {t("performance.outsideSchedule")}
                      </th>
                      <th className="px-3 py-3">
                        {t("performance.nightTime")}
                      </th>
                      <th className="px-3 py-3">
                        {t("performance.weekendTime")}
                      </th>
                      <th className="px-3 py-3">{t("common.status")}</th>
                      <th className="px-3 py-3">{t("performance.details")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAttendance.map((row) => {
                      const reopeningHistory = attendanceReopenings
                        .filter((item) => item.attendance_id === row.id)
                        .sort(
                          (a, b) =>
                            new Date(b.reopened_at).getTime() -
                            new Date(a.reopened_at).getTime(),
                        );
                      const activeReopening = reopeningHistory.find(
                        (item) => item.status === "active",
                      );
                      const latestReopening = reopeningHistory[0] ?? null;
                      return (
                        <tr key={row.id} className="border-b border-slate-100">
                          <td className="px-3 py-4 font-bold">
                            {formatDate(row.work_date)}
                          </td>
                          {isLeader ? (
                            <td className="px-3 py-4">
                              {memberName(row.user_id)}
                            </td>
                          ) : null}
                          <td className="px-3 py-4">
                            {formatTime(row.clock_in_at)}
                          </td>
                          <td className="px-3 py-4">
                            {row.clock_out_at ? (
                              formatTime(row.clock_out_at)
                            ) : activeReopening ? (
                              <Badge tone="amber">
                                {t("performance.workdayReopenedStatus")}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-4 font-bold">
                            {row.clock_out_at
                              ? formatMinutes(row.total_work_minutes)
                              : "—"}
                          </td>
                          <td className="px-3 py-4">
                            {row.clock_out_at
                              ? formatMinutes(row.outside_schedule_minutes)
                              : "—"}
                          </td>
                          <td className="px-3 py-4">
                            {row.clock_out_at
                              ? formatMinutes(row.night_minutes)
                              : "—"}
                          </td>
                          <td className="px-3 py-4">
                            {row.clock_out_at
                              ? formatMinutes(row.weekend_minutes)
                              : "—"}
                          </td>
                          <td className="px-3 py-4">
                            <Badge tone={statusTone(row.status)}>
                              {t(`performance.statuses.${row.status}`)}
                            </Badge>
                          </td>
                          <td className="px-3 py-4 text-slate-500">
                            {activeReopening
                              ? activeReopening.reason
                              : latestReopening
                                ? t("performance.workdayReopeningHistory", {
                                    time: formatTime(
                                      latestReopening.previous_clock_out_at,
                                    ),
                                    reason: latestReopening.reason,
                                  })
                                : row.late_minutes
                                  ? t("performance.minutesLate", {
                                      count: row.late_minutes,
                                    })
                                  : row.justification || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!visibleAttendance.length ? (
                  <p className="py-12 text-center text-slate-500">
                    {t("performance.noAttendance")}
                  </p>
                ) : null}
              </div>
            </article>
          </section>
        ) : null}

        {view === "absences" ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">
                {t("performance.requestLeave")}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {t("performance.requestLeaveHelp")}
              </p>
              <form
                action={submitLeaveRequestAction}
                className="mt-5 space-y-4"
              >
                <label className="block text-sm font-black">
                  {t("performance.leaveType")}
                  <select name="leaveType" className={fieldClass()}>
                    {[
                      "annual",
                      "sick",
                      "family",
                      "training",
                      "unpaid",
                      "other",
                    ].map((type) => (
                      <option key={type} value={type}>
                        {t(`performance.leaveTypes.${type}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-black">
                    {t("performance.startDate")}
                    <input
                      name="startDate"
                      type="date"
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.endDate")}
                    <input
                      name="endDate"
                      type="date"
                      required
                      className={fieldClass()}
                    />
                  </label>
                </div>
                <label className="block text-sm font-black">
                  {t("performance.reason")}
                  <textarea
                    name="reason"
                    rows={4}
                    required
                    className={fieldClass()}
                  />
                </label>
                <SecureAttachmentUpload
                  purpose="leave"
                  prefix="document"
                  label={t("performance.documentUpload")}
                  help={t("attachments.help")}
                  chooseLabel={t("attachments.chooseFile")}
                  uploadingLabel={t("attachments.uploading")}
                  uploadedLabel={t("attachments.uploaded")}
                  removeLabel={t("attachments.remove")}
                  errorLabel={t("attachments.invalidFile")}
                />
                <label className="block text-sm font-black">
                  {t("attachments.externalLinkOptional")}
                  <input
                    name="documentUrl"
                    type="url"
                    placeholder="https://..."
                    className={fieldClass()}
                  />
                </label>
                <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">
                  {t("performance.submitRequest")}
                </button>
              </form>
            </article>

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">
                {t("performance.leaveRequests")}
              </h2>
              <div className="mt-5 space-y-4">
                {visibleLeaves.map((leave) => (
                  <div
                    key={leave.id}
                    className="rounded-2xl border border-slate-200 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-black">
                          {isLeader ? `${memberName(leave.user_id)} · ` : ""}
                          {t(`performance.leaveTypes.${leave.leave_type}`)}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {formatDate(leave.start_date)} →{" "}
                          {formatDate(leave.end_date)}
                        </p>
                      </div>
                      <Badge tone={statusTone(leave.status)}>
                        {t(`performance.leaveStatuses.${leave.status}`)}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      {leave.reason}
                    </p>
                    {leave.document_storage_path ? (
                      <a
                        href={`/api/attachments/leave/${leave.id}`}
                        className="mt-3 inline-block text-sm font-black text-indigo-700 underline"
                      >
                        {t("performance.openDocument")}
                        {leave.document_file_name
                          ? ` · ${leave.document_file_name}`
                          : ""}
                      </a>
                    ) : leave.document_url ? (
                      <a
                        href={leave.document_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block text-sm font-black text-indigo-700 underline"
                      >
                        {t("performance.openDocument")}
                      </a>
                    ) : null}
                    {leave.review_note ? (
                      <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                        {leave.review_note}
                      </p>
                    ) : null}
                    {leave.user_id === authData.user.id && leave.status === "pending" ? (
                      <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">
                          {locale === "fr" ? "Annuler ma demande" : "Cancel my request"}
                        </summary>
                        <form action={cancelLeaveRequestAction} className="space-y-3 border-t border-slate-200 p-4">
                          <input type="hidden" name="requestId" value={leave.id} />
                          <input type="hidden" name="returnTo" value="/dashboard/performance?view=absences" />
                          <textarea
                            name="cancellationReason"
                            minLength={3}
                            maxLength={1000}
                            required
                            placeholder={locale === "fr" ? "Motif de l’annulation" : "Cancellation reason"}
                            className="min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                          />
                          <ConfirmSubmitButton
                            confirmation={locale === "fr" ? "Annuler cette demande de congé ?" : "Cancel this leave request?"}
                            dialogTitle={locale === "fr" ? "Confirmer l’annulation" : "Confirm cancellation"}
                            confirmLabel={locale === "fr" ? "Oui, annuler" : "Yes, cancel"}
                            cancelLabel={locale === "fr" ? "Retour" : "Back"}
                            className="w-full rounded-xl bg-slate-800 px-4 py-2.5 font-black text-white"
                          >
                            {locale === "fr" ? "Confirmer l’annulation" : "Confirm cancellation"}
                          </ConfirmSubmitButton>
                        </form>
                      </details>
                    ) : null}
                    {canReviewLeave && leave.status === "pending" ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <form
                          action={reviewLeaveRequestAction}
                          className="space-y-2"
                        >
                          <input
                            type="hidden"
                            name="requestId"
                            value={leave.id}
                          />
                          <input type="hidden" name="status" value="approved" />
                          <input
                            name="reviewNote"
                            placeholder={t("performance.reviewNote")}
                            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 font-black text-white">
                            {t("performance.approve")}
                          </button>
                        </form>
                        <form
                          action={reviewLeaveRequestAction}
                          className="space-y-2"
                        >
                          <input
                            type="hidden"
                            name="requestId"
                            value={leave.id}
                          />
                          <input type="hidden" name="status" value="rejected" />
                          <input
                            name="reviewNote"
                            required
                            placeholder={t("performance.reviewNote")}
                            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button className="w-full rounded-xl bg-red-600 px-4 py-2.5 font-black text-white">
                            {t("performance.reject")}
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              {!visibleLeaves.length ? (
                <p className="py-12 text-center text-slate-500">
                  {t("performance.noLeaveRequests")}
                </p>
              ) : null}
            </article>
          </section>
        ) : null}

        {view === "reports" ? (
          <section className="mt-6 space-y-6">
            <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-black">
                      {t("performance.dailyReportTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {t("performance.dailyReportHelp", {
                        deadline: ownReportDeadline,
                      })}
                    </p>
                  </div>
                  <Badge tone={availableReportDates.length ? "emerald" : "red"}>
                    {availableReportDates.length
                      ? t("performance.reportWindowOpen")
                      : t("performance.reportWindowLocked")}
                  </Badge>
                </div>
                {availableReportDates.length ? (
                  <>
                    {availableReportDates.length > 1 ? (
                      <form
                        method="get"
                        className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[1fr_auto] sm:items-end"
                      >
                        <input type="hidden" name="view" value="reports" />
                        <input type="hidden" name="month" value={month} />
                        <label className="block text-sm font-black">
                          {dailyCopy.reportDateDisplay}
                          <select
                            name="reportDate"
                            defaultValue={selectedReportDate}
                            required
                            className={fieldClass()}
                          >
                            {availableReportDates.map((date) => (
                              <option key={date} value={date}>
                                {formatDate(date)}
                                {date !== localNow.date
                                  ? ` · ${t("performance.exceptionallyReopened")}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white">
                          {dailyCopy.displayDate}
                        </button>
                      </form>
                    ) : null}
                    {!dailyExecutionReady ? (
                      <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
                        <p className="font-black">
                          {dailyCopy.migrationRequired}
                        </p>
                        <p className="mt-2 text-sm leading-6">
                          {dailyCopy.migrationHelp}
                        </p>
                      </div>
                    ) : reportDailyCycleRequired && !reportDailyPlanValid ? (
                      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
                        <p className="font-black">
                          {dailyCopy.noPlanForReport}
                        </p>
                        <p className="mt-2 text-sm leading-6">
                          {dailyCopy.noPlanForReportHelp}
                        </p>
                        <Link
                          href="/dashboard/my-day?plan=required#daily-priorities"
                          className="mt-4 inline-flex rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950"
                        >
                          {dailyCopy.createPlan}
                        </Link>
                      </div>
                    ) : reportFormReady ? (
                      <form
                        action={submitDailyReportAction}
                        className="mt-5 space-y-4"
                      >
                        <input
                          type="hidden"
                          name="reportDate"
                          value={selectedReportDate}
                        />
                        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-700">
                          {dailyCopy.reportDateDisplay}:{" "}
                          {formatDate(selectedReportDate)}
                        </p>
                        {editableReport ? (
                          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
                            <strong>{t("performance.revisionMode")}</strong>
                            <p className="mt-1">
                              {t("performance.revisionModeHelp", {
                                version: editableReport.revision_number,
                              })}
                            </p>
                          </div>
                        ) : null}
                        {reportDailyCycleRequired ? (
                          <DailyTaskOutcomeFields
                            locale={locale}
                            tasks={reportDailyTasks}
                          />
                        ) : null}
                        <label className="block text-sm font-black">
                          {t("performance.accomplishments")}
                          <textarea
                            name="accomplishments"
                            minLength={3}
                            rows={4}
                            required
                            defaultValue={editableReport?.accomplishments || ""}
                            className={fieldClass()}
                          />
                        </label>
                        <label className="block text-sm font-black">
                          {t("performance.results")}
                          <textarea
                            name="results"
                            minLength={3}
                            rows={3}
                            required
                            defaultValue={editableReport?.results || ""}
                            className={fieldClass()}
                          />
                        </label>
                        <label className="block text-sm font-black">
                          {t("performance.blockers")}
                          <textarea
                            name="blockers"
                            rows={3}
                            defaultValue={editableReport?.blockers || ""}
                            className={fieldClass()}
                          />
                        </label>
                        <label className="block text-sm font-black">
                          {t("performance.nextPriorities")}
                          <textarea
                            name="nextPriorities"
                            minLength={3}
                            rows={3}
                            required
                            defaultValue={editableReport?.next_priorities || ""}
                            className={fieldClass()}
                          />
                        </label>
                        <ConfirmSubmitButton
                          confirmation={
                            editableReport
                              ? t("performance.reportRevisionConfirmation")
                              : t("performance.reportSubmitConfirmation")
                          }
                          dialogTitle={t("common.confirmationTitle")}
                          confirmLabel={t("common.confirm")}
                          cancelLabel={t("common.cancel")}
                          className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white"
                        >
                          {editableReport
                            ? t("performance.submitRevision")
                            : t("performance.submitReport")}
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </>
                ) : currentReport ? (
                  <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
                    <p className="font-black">
                      {t("performance.reportAlreadySubmittedTitle")}
                    </p>
                    <p className="mt-2 text-sm leading-6">
                      {t("performance.reportAlreadySubmittedHelp", {
                        date: formatDateTime(currentReport.submitted_at),
                        version: currentReport.revision_number,
                      })}
                    </p>
                    <div className="mt-3">
                      <Badge tone="emerald">
                        {t(
                          `performance.reportStatuses.${currentReport.status}`,
                        )}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
                    <p className="font-black">
                      {t("performance.reportLockedTitle")}
                    </p>
                    <p className="mt-2 text-sm leading-6">
                      {t("performance.reportLockedHelp")}
                    </p>
                  </div>
                )}
                {activeOwnReopenings.length ? (
                  <div className="mt-5 space-y-3">
                    {activeOwnReopenings.map((reopening) => (
                      <div
                        key={reopening.id}
                        className="rounded-xl border border-indigo-200 bg-indigo-50 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="font-black text-indigo-950">
                            {formatDate(reopening.report_date)}
                          </p>
                          <Badge tone="indigo">
                            {t("performance.availableUntil", {
                              date: formatDateTime(reopening.expires_at),
                            })}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm text-indigo-800">
                          {reopening.reason}
                        </p>
                        <p className="mt-2 text-xs font-bold text-indigo-700">
                          {t("performance.scoreFactor", {
                            percent: Math.round(
                              number(reopening.score_factor) * 100,
                            ),
                          })}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">
                  {t("performance.reportHistory")}
                </h2>
                <div className="mt-5 space-y-4">
                  {visibleReports.map((report) => (
                    <details
                      id={`report-${report.id}`}
                      key={report.id}
                      open={requestedReportId === report.id}
                      className="rounded-2xl border border-slate-200 p-5"
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-black">
                              {isLeader
                                ? `${memberName(report.user_id)} · `
                                : ""}
                              {formatDate(report.report_date)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDateTime(report.submitted_at)} ·{" "}
                              {t(
                                `performance.submissionModes.${report.submission_mode || "employee"}`,
                              )}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge tone={statusTone(report.status)}>
                              {t(`performance.reportStatuses.${report.status}`)}
                            </Badge>
                            <Badge tone="indigo">
                              {t("performance.scoreFactor", {
                                percent: Math.round(
                                  number(report.submission_score_factor) * 100,
                                ),
                              })}
                            </Badge>
                          </div>
                        </div>
                      </summary>
                      <div className="mt-5 grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-black uppercase text-slate-500">
                            {t("performance.accomplishments")}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                            {report.accomplishments}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase text-slate-500">
                            {t("performance.results")}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                            {report.results}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase text-slate-500">
                            {t("performance.blockers")}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                            {report.blockers}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase text-slate-500">
                            {t("performance.nextPriorities")}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                            {report.next_priorities}
                          </p>
                        </div>
                      </div>
                      {(taskOutcomesByReport.get(report.id) ?? []).some(
                        (outcome) =>
                          outcome.report_revision_number ===
                          report.revision_number,
                      ) ? (
                        <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                          <p className="font-black text-indigo-950">
                            {dailyCopy.reportSectionTitle}
                          </p>
                          <div className="mt-3 space-y-3">
                            {(taskOutcomesByReport.get(report.id) ?? [])
                              .filter(
                                (outcome) =>
                                  outcome.report_revision_number ===
                                  report.revision_number,
                              )
                              .map((outcome) => (
                                <div
                                  key={outcome.id}
                                  className="rounded-xl bg-white p-4"
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <p className="font-black">
                                      #{outcome.position} · {outcome.title}
                                    </p>
                                    <Badge
                                      tone={statusTone(outcome.final_status)}
                                    >
                                      {dailyCopy.progressStatuses[
                                        outcome.final_status as keyof typeof dailyCopy.progressStatuses
                                      ] ?? outcome.final_status}
                                    </Badge>
                                  </div>
                                  <p className="mt-2 text-sm text-slate-600">
                                    <strong>
                                      {dailyCopy.expectedOutcome}:
                                    </strong>{" "}
                                    {outcome.expected_outcome}
                                  </p>
                                  <p className="mt-2 text-sm text-slate-800">
                                    <strong>{dailyCopy.actualOutcome}:</strong>{" "}
                                    {outcome.actual_outcome}
                                  </p>
                                  {outcome.outcome_reason ? (
                                    <p className="mt-2 text-sm text-amber-900">
                                      <strong>{dailyCopy.reason}:</strong>{" "}
                                      {outcome.outcome_reason}
                                    </p>
                                  ) : null}
                                </div>
                              ))}
                          </div>
                        </div>
                      ) : null}
                      {report.supervisor_reason ? (
                        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          <strong>{t("performance.supervisorReason")}:</strong>{" "}
                          {report.supervisor_reason}
                        </p>
                      ) : null}
                      {report.review_note ? (
                        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                          {report.review_note}
                        </p>
                      ) : null}
                      {reportVersions.filter(
                        (version) => version.report_id === report.id,
                      ).length ? (
                        <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <summary className="cursor-pointer font-black text-slate-800">
                            {t("performance.previousVersions", {
                              count: reportVersions.filter(
                                (version) => version.report_id === report.id,
                              ).length,
                            })}
                          </summary>
                          <div className="mt-3 space-y-3">
                            {reportVersions
                              .filter(
                                (version) => version.report_id === report.id,
                              )
                              .sort(
                                (a, b) => b.version_number - a.version_number,
                              )
                              .map((version) => (
                                <div
                                  key={version.id}
                                  className="rounded-xl border border-slate-200 bg-white p-4"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <p className="font-black">
                                      {t("performance.versionLabel", {
                                        version: version.version_number,
                                      })}
                                    </p>
                                    <span className="text-xs font-bold text-slate-500">
                                      {formatDateTime(version.archived_at)}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-xs text-slate-500">
                                    {version.archive_reason}
                                  </p>
                                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <p className="text-sm">
                                      <strong>
                                        {t("performance.accomplishments")}:
                                      </strong>{" "}
                                      {version.accomplishments}
                                    </p>
                                    <p className="text-sm">
                                      <strong>
                                        {t("performance.results")}:
                                      </strong>{" "}
                                      {version.results}
                                    </p>
                                    <p className="text-sm">
                                      <strong>
                                        {t("performance.blockers")}:
                                      </strong>{" "}
                                      {version.blockers}
                                    </p>
                                    <p className="text-sm">
                                      <strong>
                                        {t("performance.nextPriorities")}:
                                      </strong>{" "}
                                      {version.next_priorities}
                                    </p>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </details>
                      ) : null}
                      {isLeader ? (
                        <form
                          action={reviewDailyReportAction}
                          className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                        >
                          <input
                            type="hidden"
                            name="reportId"
                            value={report.id}
                          />
                          <select
                            name="status"
                            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                          >
                            {["validated", "needs_revision", "incomplete"].map(
                              (status) => (
                                <option key={status} value={status}>
                                  {t(`performance.reportStatuses.${status}`)}
                                </option>
                              ),
                            )}
                          </select>
                          <input
                            name="reviewNote"
                            placeholder={t("performance.reviewNote")}
                            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                          />
                          <button className="rounded-xl bg-slate-950 px-4 py-2.5 font-black text-white">
                            {t("performance.review")}
                          </button>
                        </form>
                      ) : null}
                    </details>
                  ))}
                </div>
                {!visibleReports.length ? (
                  <p className="py-12 text-center text-slate-500">
                    {t("performance.noReports")}
                  </p>
                ) : null}
              </article>
            </div>

            {isLeader ? (
              <div className="grid gap-6 xl:grid-cols-2">
                <article className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
                  <h2 className="text-2xl font-black text-indigo-950">
                    {t("performance.reopenReportTitle")}
                  </h2>
                  <p className="mt-1 text-sm text-indigo-800">
                    {t("performance.reopenReportHelp")}
                  </p>
                  {supervisedMemberOptions.length ? (
                    <form
                      action={reopenDailyReportAction}
                      className="mt-5 space-y-4"
                    >
                      <label className="block text-sm font-black text-indigo-950">
                        {t("performance.employee")}
                        <select name="userId" required className={fieldClass()}>
                          {supervisedMemberOptions.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block text-sm font-black text-indigo-950">
                          {t("performance.reportDate")}
                          <input
                            name="reportDate"
                            type="date"
                            max={today}
                            required
                            className={fieldClass()}
                          />
                        </label>
                        <label className="block text-sm font-black text-indigo-950">
                          {t("performance.reopenDuration")}
                          <input
                            name="durationHours"
                            type="number"
                            min="1"
                            max={settings.maximum_reopen_hours}
                            defaultValue={Math.min(
                              24,
                              settings.maximum_reopen_hours,
                            )}
                            required
                            className={fieldClass()}
                          />
                        </label>
                      </div>
                      <label className="block text-sm font-black text-indigo-950">
                        {t("performance.reopeningReason")}
                        <textarea
                          name="reason"
                          minLength={10}
                          rows={3}
                          required
                          className={fieldClass()}
                        />
                      </label>
                      <label className="flex items-center gap-3 rounded-xl bg-white/70 p-4 text-sm font-bold text-indigo-950">
                        <input name="justified" type="checkbox" />
                        {t("performance.justifiedReopening")}
                      </label>
                      <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">
                        {t("performance.reopenButton")}
                      </button>
                    </form>
                  ) : (
                    <p className="mt-5 rounded-xl bg-white/70 p-4 text-sm text-indigo-900">
                      {t("performance.noSupervisedEmployees")}
                    </p>
                  )}
                  <div className="mt-6 space-y-3">
                    {visibleReopenings.map((reopening) => (
                      <div
                        key={reopening.id}
                        className="rounded-xl bg-white p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-black">
                              {memberName(reopening.user_id)} ·{" "}
                              {formatDate(reopening.report_date)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {t(
                                `performance.reopeningStatuses.${reopening.status}`,
                              )}{" "}
                              · {formatDateTime(reopening.expires_at)}
                            </p>
                          </div>
                          {reopening.status === "active" &&
                          new Date(reopening.expires_at).getTime() >
                            requestNowTimestamp ? (
                            <form action={revokeDailyReportReopeningAction}>
                              <input
                                type="hidden"
                                name="reopeningId"
                                value={reopening.id}
                              />
                              <button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-700">
                                {t("performance.revokeReopening")}
                              </button>
                            </form>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {reopening.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
                  <h2 className="text-2xl font-black text-amber-950">
                    {t("performance.completeForEmployeeTitle")}
                  </h2>
                  <p className="mt-1 text-sm text-amber-800">
                    {t("performance.completeForEmployeeHelp", {
                      percent: number(settings.supervisor_report_score_percent),
                    })}
                  </p>
                  {supervisedMemberOptions.length ? (
                    <form
                      action={completeDailyReportForEmployeeAction}
                      className="mt-5 space-y-4"
                    >
                      <label className="block text-sm font-black text-amber-950">
                        {t("performance.employee")}
                        <select name="userId" required className={fieldClass()}>
                          {supervisedMemberOptions.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm font-black text-amber-950">
                        {t("performance.reportDate")}
                        <input
                          name="reportDate"
                          type="date"
                          max={today}
                          required
                          className={fieldClass()}
                        />
                      </label>
                      <label className="block text-sm font-black text-amber-950">
                        {t("performance.supervisorReason")}
                        <textarea
                          name="supervisorReason"
                          minLength={10}
                          rows={3}
                          required
                          className={fieldClass()}
                        />
                      </label>
                      <label className="block text-sm font-black text-amber-950">
                        {t("performance.accomplishments")}
                        <textarea
                          name="accomplishments"
                          minLength={3}
                          rows={3}
                          required
                          className={fieldClass()}
                        />
                      </label>
                      <label className="block text-sm font-black text-amber-950">
                        {t("performance.results")}
                        <textarea
                          name="results"
                          minLength={3}
                          rows={3}
                          required
                          className={fieldClass()}
                        />
                      </label>
                      <label className="block text-sm font-black text-amber-950">
                        {t("performance.blockers")}
                        <textarea
                          name="blockers"
                          rows={2}
                          className={fieldClass()}
                        />
                      </label>
                      <label className="block text-sm font-black text-amber-950">
                        {t("performance.nextPriorities")}
                        <textarea
                          name="nextPriorities"
                          minLength={3}
                          rows={3}
                          required
                          className={fieldClass()}
                        />
                      </label>
                      <button className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950">
                        {t("performance.completeForEmployeeButton")}
                      </button>
                    </form>
                  ) : (
                    <p className="mt-5 rounded-xl bg-white/70 p-4 text-sm text-amber-900">
                      {t("performance.noSupervisedEmployees")}
                    </p>
                  )}
                </article>
              </div>
            ) : null}
          </section>
        ) : null}

        {view === "meetings" ? (
          <section className="mt-6 grid min-w-0 gap-6">
            {isLeader ? (
              <article className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-black">
                      {t("performance.createMeeting")}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {t("performance.createMeetingHelp")}
                    </p>
                  </div>
                  <Link
                    href="/dashboard/integrations"
                    className="text-sm font-black text-indigo-700"
                  >
                    {locale === "fr" ? "Configurer Zoom" : "Configure Zoom"}
                  </Link>
                </div>
                <form
                  action={createPerformanceMeetingAction}
                  className="mt-6 grid gap-5 lg:grid-cols-2"
                >
                  <label className="block text-sm font-black">
                    {t("performance.meetingTitle")}
                    <input name="title" required className={fieldClass()} />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.meetingType")}
                    <select name="meetingType" className={fieldClass()}>
                      {["team", "training", "client", "company", "other"].map(
                        (type) => (
                          <option key={type} value={type}>
                            {t(`performance.meetingTypes.${type}`)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
                    <label className="block text-sm font-black">
                      {t("performance.startsAt")}
                      <input
                        name="startsAt"
                        type="datetime-local"
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.endsAt")}
                      <input
                        name="endsAt"
                        type="datetime-local"
                        className={fieldClass()}
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold lg:col-span-2">
                    <input name="mandatory" type="checkbox" defaultChecked />
                    {t("performance.mandatoryMeeting")}
                  </label>
                  <div className="space-y-3 lg:col-span-2">
                    <label
                      className={`flex items-center gap-3 rounded-xl p-4 text-sm font-bold ${zoomEnabled ? "bg-blue-50 text-blue-950" : "bg-amber-50 text-amber-950"}`}
                    >
                      <input
                        name="createZoom"
                        type="checkbox"
                        defaultChecked={Boolean(
                          zoomSettings.auto_create_meetings,
                        )}
                        disabled={!zoomEnabled}
                      />
                      {zoomEnabled
                        ? locale === "fr"
                          ? "Créer automatiquement la réunion Zoom"
                          : "Automatically create the Zoom meeting"
                        : locale === "fr"
                          ? "Configure Zoom dans Intégrations pour activer cette option"
                          : "Configure Zoom in Integrations to enable this option"}
                    </label>
                    {zoomEnabled ? (
                      <ZoomHostSelector
                        hosts={zoomHostOptions}
                        departments={zoomHostSelectionLocked ? managerZoomDepartments : zoomDepartments}
                        defaultHostId={defaultZoomHostId}
                        defaultDepartment={zoomHostSelectionLocked ? managerZoomDepartments[0] || null : null}
                        locale={locale}
                        locked={zoomHostSelectionLocked}
                      />
                    ) : null}
                    <label className="block text-sm font-black">
                      {locale === "fr"
                        ? "Ou coller un lien Zoom existant"
                        : "Or paste an existing Zoom link"}
                      <input
                        name="meetingUrl"
                        type="url"
                        inputMode="url"
                        placeholder="https://zoom.us/j/..."
                        className={fieldClass()}
                      />
                      <span className="mt-1 block text-xs font-medium text-slate-500">
                        {locale === "fr"
                          ? "Laisse vide si tu utilises la création automatique ci-dessus."
                          : "Leave blank when using automatic creation above."}
                      </span>
                    </label>
                  </div>
                  <MeetingParticipantSelector
                    participants={memberOptions.map((member) => ({
                      ...member,
                      roleLabel: t(`roles.${member.role}`),
                    }))}
                    locale={locale}
                  />
                  <label className="block text-sm font-black lg:col-span-2">
                    {t("performance.notes")}
                    <textarea name="notes" rows={3} className={fieldClass()} />
                  </label>
                  <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white lg:col-span-2">
                    {t("performance.createMeetingButton")}
                  </button>
                </form>
              </article>
            ) : (
              <article className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6">
                <h2 className="text-2xl font-black text-indigo-950">
                  {t("performance.meetingsTitle")}
                </h2>
                <p className="mt-2 text-indigo-800">
                  {t("performance.employeeMeetingsHelp")}
                </p>
              </article>
            )}

            <article className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">
                {t("performance.meetingsTitle")}
              </h2>
              <div className="mt-5 space-y-5">
                {meetings.map((meeting) => {
                  const attendees = visibleMeetingAttendance.filter(
                    (row) => row.meeting_id === meeting.id,
                  );
                  if (!isLeader && !attendees.length) return null;
                  const canHost =
                    ["owner", "admin", "hr"].includes(membership.role) ||
                    meeting.created_by === authData.user.id;
                  const startLocal = zonedDateTime(new Date(meeting.starts_at), settings.timezone);
                  const endLocal = meeting.ends_at ? zonedDateTime(new Date(meeting.ends_at), settings.timezone) : null;
                  return (
                    <div
                      key={meeting.id}
                      className="rounded-2xl border border-slate-200 p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-black">
                              {meeting.title}
                            </p>
                            {meeting.provider === "zoom" ? (
                              <Badge tone="indigo">
                                Zoom · {meeting.zoom_status}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-slate-500">
                            {formatDateTime(meeting.starts_at)} ·{" "}
                            {t(
                              `performance.meetingTypes.${meeting.meeting_type}`,
                            )}
                          </p>
                          {meeting.provider === "zoom" &&
                          (meeting.zoom_department ||
                            meeting.zoom_host_email) ? (
                            <p className="mt-1 text-xs font-bold text-indigo-700">
                              {[
                                meeting.zoom_department,
                                meeting.zoom_host_email,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        <Badge tone={meeting.mandatory ? "red" : "slate"}>
                          {meeting.mandatory
                            ? t("performance.mandatory")
                            : t("performance.optionalMeeting")}
                        </Badge>
                      </div>
                      {meeting.notes ? (
                        <p className="mt-3 text-sm text-slate-600">
                          {meeting.notes}
                        </p>
                      ) : null}
                      {meeting.meeting_url ? (
                        <>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <a
                              href={meeting.meeting_url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white"
                            >
                              {locale === "fr"
                                ? "Rejoindre sur Zoom"
                                : "Join on Zoom"}
                            </a>
                            {canHost ? (
                              <form action={startZoomMeetingAction}>
                                <input
                                  type="hidden"
                                  name="meetingId"
                                  value={meeting.id}
                                />
                                <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white">
                                  {locale === "fr"
                                    ? "Démarrer comme hôte"
                                    : "Start as host"}
                                </button>
                              </form>
                            ) : null}
                            {isLeader && meeting.zoom_meeting_id ? (
                              <form action={syncZoomAttendanceAction}>
                                <input
                                  type="hidden"
                                  name="meetingId"
                                  value={meeting.id}
                                />
                                <button className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-black text-indigo-800">
                                  {locale === "fr"
                                    ? "Synchroniser la présence"
                                    : "Sync attendance"}
                                </button>
                              </form>
                            ) : null}
                          </div>
                          {canHost ? (
                            <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                              <p className="text-xs font-black uppercase tracking-wide text-indigo-700">
                                {locale === "fr" ? "Lien pour invités externes" : "External guest link"}
                              </p>
                              <p className="mt-1 text-xs text-indigo-900">
                                {locale === "fr"
                                  ? "Partage ce lien avec un participant externe. Il permet de rejoindre la réunion sans compte Super Leader."
                                  : "Share this link with an external guest. It allows them to join without a Super Leader account."}
                              </p>
                              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                                <input readOnly value={meeting.meeting_url} className="min-w-0 flex-1 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs text-slate-700" />
                                <CopyMeetingLinkButton url={meeting.meeting_url} locale={locale} />
                                <a href={meeting.meeting_url} target="_blank" rel="noreferrer" className="rounded-xl border border-indigo-300 bg-white px-3 py-2 text-center text-xs font-black text-indigo-800 hover:bg-indigo-50">
                                  {locale === "fr" ? "Ouvrir" : "Open"}
                                </a>
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {canHost ? (
                        <details className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <summary className="cursor-pointer text-sm font-black text-amber-950">
                            {locale === "fr" ? "Modifier la réunion" : "Edit meeting"}
                          </summary>
                          <form action={updatePerformanceMeetingAction} className="mt-4 grid gap-3 lg:grid-cols-2">
                            <input type="hidden" name="meetingId" value={meeting.id} />
                            <label className="block text-sm font-black lg:col-span-2">
                              {locale === "fr" ? "Titre" : "Title"}
                              <input name="title" required defaultValue={meeting.title} className={fieldClass()} />
                            </label>
                            <label className="block text-sm font-black">
                              {locale === "fr" ? "Type" : "Type"}
                              <select name="meetingType" defaultValue={meeting.meeting_type} className={fieldClass()}>
                                {["team", "training", "client", "company", "other"].map((type) => (
                                  <option key={type} value={type}>{t(`performance.meetingTypes.${type}`)}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-black">
                              <input name="mandatory" type="checkbox" defaultChecked={meeting.mandatory} />
                              {locale === "fr" ? "Réunion obligatoire" : "Mandatory meeting"}
                            </label>
                            <label className="block text-sm font-black">
                              {locale === "fr" ? "Début" : "Start"}
                              <input name="startsAt" type="datetime-local" required defaultValue={`${startLocal.date}T${startLocal.time}`} className={fieldClass()} />
                            </label>
                            <label className="block text-sm font-black">
                              {locale === "fr" ? "Fin (optionnelle)" : "End (optional)"}
                              <input name="endsAt" type="datetime-local" defaultValue={endLocal ? `${endLocal.date}T${endLocal.time}` : ""} className={fieldClass()} />
                            </label>
                            <label className="block text-sm font-black lg:col-span-2">
                              {locale === "fr" ? "Notes" : "Notes"}
                              <textarea name="notes" defaultValue={meeting.notes || ""} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                            </label>
                            {meeting.provider === "zoom" ? (
                              <p className="rounded-xl bg-blue-50 p-3 text-xs font-bold text-blue-900 lg:col-span-2">
                                {locale === "fr"
                                  ? "La date, l’heure, le titre et la durée seront également mis à jour dans Zoom. Les participants internes seront notifiés si le créneau change."
                                  : "Date, time, title and duration will also be updated in Zoom. Internal participants will be notified if the schedule changes."}
                              </p>
                            ) : null}
                            <button className="rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 lg:col-span-2">
                              {locale === "fr" ? "Enregistrer les modifications" : "Save changes"}
                            </button>
                          </form>
                        </details>
                      ) : null}
                      {meeting.zoom_sync_error ? (
                        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">
                          {meeting.zoom_sync_error}
                        </p>
                      ) : null}
                      {meeting.zoom_last_synced_at ? (
                        <p className="mt-2 text-xs text-slate-500">
                          {locale === "fr"
                            ? "Dernière synchronisation"
                            : "Last sync"}
                          : {formatDateTime(meeting.zoom_last_synced_at)}
                        </p>
                      ) : null}
                      <div className="mt-4 space-y-3">
                        {attendees.map((attendee) => (
                          <div
                            key={attendee.id}
                            className="rounded-xl bg-slate-50 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-bold">
                                  {memberName(attendee.user_id)}
                                </p>
                                {attendee.attendance_source !== "manual" ? (
                                  <p className="mt-1 text-xs text-slate-500">
                                    Zoom · {attendee.duration_minutes} min
                                  </p>
                                ) : null}
                              </div>
                              <Badge tone={statusTone(attendee.status)}>
                                {t(
                                  `performance.meetingStatuses.${attendee.status}`,
                                )}
                              </Badge>
                            </div>
                            {isLeader ? (
                              <form
                                action={markMeetingAttendanceAction}
                                className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px_1fr_auto]"
                              >
                                <input
                                  type="hidden"
                                  name="attendanceId"
                                  value={attendee.id}
                                />
                                <select
                                  name="status"
                                  defaultValue={
                                    attendee.status === "invited"
                                      ? "present"
                                      : attendee.status
                                  }
                                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                                >
                                  {["present", "late", "absent", "excused"].map(
                                    (status) => (
                                      <option key={status} value={status}>
                                        {t(
                                          `performance.meetingStatuses.${status}`,
                                        )}
                                      </option>
                                    ),
                                  )}
                                </select>
                                <input
                                  name="lateMinutes"
                                  type="number"
                                  min="0"
                                  defaultValue={attendee.late_minutes}
                                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                                />
                                <input
                                  name="notes"
                                  defaultValue={attendee.notes || ""}
                                  placeholder={t("performance.notes")}
                                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                                />
                                <button className="rounded-xl bg-slate-950 px-4 py-2 font-black text-white">
                                  {t("performance.save")}
                                </button>
                              </form>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!meetings.length ? (
                <p className="py-12 text-center text-slate-500">
                  {t("performance.noMeetings")}
                </p>
              ) : null}
            </article>
          </section>
        ) : null}

        {view === "ranking" ? (
          <section className="mt-6 space-y-6">
            {isLeader ? (
              <div className="grid gap-6 xl:grid-cols-3">
                <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-black">
                    {t("performance.roleKpiTitle")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {t("performance.roleKpiHelp")}
                  </p>
                  <form
                    action={upsertMonthlyKpiScoreAction}
                    className="mt-5 space-y-4"
                  >
                    <input type="hidden" name="month" value={month} />
                    <label className="block text-sm font-black">
                      {t("performance.employee")}
                      <select name="userId" className={fieldClass()}>
                        {kpiMemberOptions.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.kpiScore")}
                      <input
                        name="score"
                        type="number"
                        min="0"
                        max="30"
                        step="0.1"
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.notes")}
                      <textarea
                        name="notes"
                        rows={3}
                        className={fieldClass()}
                      />
                    </label>
                    <button className="w-full rounded-xl bg-indigo-700 px-4 py-3 font-black text-white">
                      {t("performance.saveKpi")}
                    </button>
                  </form>
                </article>
                {canConfigure ? (
                  <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="text-xl font-black">
                      {t("performance.calculateRanking")}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {t("performance.calculateRankingHelp")}
                    </p>
                    <form
                      action={calculateMonthlyPerformanceAction}
                      className="mt-5"
                    >
                      <input type="hidden" name="month" value={month} />
                      <button
                        disabled={Boolean(scores[0]?.locked_at)}
                        className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-40"
                      >
                        {scores[0]?.locked_at
                          ? t("performance.rankingLocked")
                          : t("performance.calculateButton")}
                      </button>
                    </form>
                    <p className="mt-4 text-xs text-slate-500">
                      {scores[0]
                        ? t("performance.lastCalculated", {
                            date: formatDateTime(scores[0].calculated_at),
                          })
                        : t("performance.neverCalculated")}
                    </p>
                  </article>
                ) : null}
                {canConfigure ? (
                  <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
                    <h2 className="text-xl font-black text-amber-950">
                      {t("performance.publishWinner")}
                    </h2>
                    <p className="mt-1 text-sm text-amber-800">
                      {t("performance.publishWinnerHelp")}
                    </p>
                    <form
                      action={publishEmployeeOfMonthAction}
                      className="mt-5 space-y-4"
                    >
                      <input type="hidden" name="month" value={month} />
                      <textarea
                        name="announcementNote"
                        rows={3}
                        placeholder={t("performance.announcementNote")}
                        className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm"
                      />
                      <button
                        disabled={!scores.length || Boolean(publishedAward)}
                        className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-40"
                      >
                        {publishedAward
                          ? t("performance.alreadyPublished")
                          : t("performance.publishButton")}
                      </button>
                    </form>
                  </article>
                ) : null}
              </div>
            ) : null}

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-black">
                    {t("performance.monthlyRanking")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {t("performance.rankingTransparency")}
                  </p>
                </div>
                {publishedAward ? (
                  <Badge tone="emerald">
                    {t("performance.publishedAndLocked")}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[1280px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-3">#</th>
                      <th className="px-3 py-3">{t("performance.employee")}</th>
                      <th className="px-3 py-3">
                        {t("performance.criteria.attendance")}
                      </th>
                      <th className="px-3 py-3">
                        {t("performance.criteria.punctuality")}
                      </th>
                      <th className="px-3 py-3">
                        {t("performance.criteria.meetings")}
                      </th>
                      <th className="px-3 py-3">
                        {t("performance.criteria.reports")}
                      </th>
                      <th className="px-3 py-3">
                        {t("performance.criteria.collaboration")}
                      </th>
                      <th className="px-3 py-3">
                        {t("performance.criteria.training")}
                      </th>
                      <th className="px-3 py-3">
                        {t("performance.criteria.roleKpi")}
                      </th>
                      <th className="px-3 py-3">
                        {t("performance.criteria.growth")}
                      </th>
                      <th className="px-3 py-3">{t("performance.total")}</th>
                      <th className="px-3 py-3">
                        {t("performance.eligibility")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleScores.map((score) => (
                      <tr
                        key={score.user_id}
                        className="border-b border-slate-100"
                      >
                        <td className="px-3 py-4 text-xl font-black">
                          {score.position ? `#${score.position}` : "—"}
                        </td>
                        <td className="px-3 py-4">
                          <p className="font-black">
                            {memberName(score.user_id)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {t(
                              `roles.${roleById.get(score.user_id) || "employee"}`,
                            )}
                          </p>
                        </td>
                        <td className="px-3 py-4 font-bold">
                          {number(score.attendance_score).toFixed(1)}
                        </td>
                        <td className="px-3 py-4 font-bold">
                          {number(score.punctuality_score).toFixed(1)}
                        </td>
                        <td className="px-3 py-4 font-bold">
                          {number(score.meetings_score).toFixed(1)}
                        </td>
                        <td className="px-3 py-4 font-bold">
                          {number(score.reports_score).toFixed(1)}
                        </td>
                        <td className="px-3 py-4 font-bold">
                          {number(score.collaboration_score).toFixed(1)}
                        </td>
                        <td className="px-3 py-4 font-bold">
                          {number(score.training_score).toFixed(1)}
                          <p className="text-[10px] font-medium text-slate-500">
                            {score.trainings_completed}/
                            {score.trainings_required}
                          </p>
                        </td>
                        <td className="px-3 py-4 font-bold">
                          {number(score.role_kpi_score).toFixed(1)}
                        </td>
                        <td className="px-3 py-4 font-bold">
                          {number(score.growth_score).toFixed(1)}
                          <p className="text-[10px] font-medium text-slate-500">
                            {number(score.growth_credits).toFixed(1)}{" "}
                            {t("growth.credits").toLowerCase()}
                          </p>
                        </td>
                        <td className="px-3 py-4 text-xl font-black text-indigo-700">
                          {number(score.total_score).toFixed(1)}
                        </td>
                        <td className="px-3 py-4">
                          <Badge tone={score.eligible ? "emerald" : "red"}>
                            {score.eligible
                              ? t("performance.eligible")
                              : t("performance.notEligible")}
                          </Badge>
                          {!score.eligible && score.eligibility_note ? (
                            <p className="mt-2 max-w-48 text-xs text-red-600">
                              {score.eligibility_note
                                .split(",")
                                .map((reason) =>
                                  t(`performance.eligibilityReasons.${reason}`),
                                )
                                .join(" · ")}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visibleScores.length ? (
                  <p className="py-14 text-center text-slate-500">
                    {t("performance.noScores")}
                  </p>
                ) : null}
              </div>
            </article>

            <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">
                  {t("performance.appealTitle")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {t("performance.appealHelp")}
                </p>
                {ownScore && !ownScore.locked_at ? (
                  <form
                    action={submitPerformanceAppealAction}
                    className="mt-5 space-y-4"
                  >
                    <input type="hidden" name="month" value={month} />
                    <label className="block text-sm font-black">
                      {t("performance.appealReason")}
                      <textarea
                        name="reason"
                        minLength={10}
                        rows={4}
                        defaultValue={ownAppeal?.reason || ""}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">
                      {ownAppeal
                        ? t("performance.updateAppeal")
                        : t("performance.submitAppeal")}
                    </button>
                  </form>
                ) : (
                  <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                    {ownScore?.locked_at
                      ? t("performance.appealClosed")
                      : t("performance.calculateBeforeAppeal")}
                  </p>
                )}
              </article>
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">
                  {t("performance.appealsList")}
                </h2>
                <div className="mt-5 space-y-4">
                  {visibleAppeals.map((appeal) => (
                    <div
                      key={appeal.id}
                      className="rounded-2xl border border-slate-200 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-black">
                          {memberName(appeal.user_id)}
                        </p>
                        <Badge tone={statusTone(appeal.status)}>
                          {t(`performance.appealStatuses.${appeal.status}`)}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">
                        {appeal.reason}
                      </p>
                      {appeal.resolution_note ? (
                        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                          {appeal.resolution_note}
                        </p>
                      ) : null}
                      {canConfigure && appeal.status === "pending" ? (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <form
                            action={reviewPerformanceAppealAction}
                            className="space-y-2"
                          >
                            <input
                              type="hidden"
                              name="appealId"
                              value={appeal.id}
                            />
                            <input
                              type="hidden"
                              name="status"
                              value="accepted"
                            />
                            <input
                              name="resolutionNote"
                              required
                              placeholder={t("performance.resolutionNote")}
                              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                            />
                            <button className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 font-black text-white">
                              {t("performance.acceptAppeal")}
                            </button>
                          </form>
                          <form
                            action={reviewPerformanceAppealAction}
                            className="space-y-2"
                          >
                            <input
                              type="hidden"
                              name="appealId"
                              value={appeal.id}
                            />
                            <input
                              type="hidden"
                              name="status"
                              value="rejected"
                            />
                            <input
                              name="resolutionNote"
                              required
                              placeholder={t("performance.resolutionNote")}
                              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                            />
                            <button className="w-full rounded-xl bg-red-600 px-4 py-2.5 font-black text-white">
                              {t("performance.rejectAppeal")}
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                {!visibleAppeals.length ? (
                  <p className="py-10 text-center text-slate-500">
                    {t("performance.noAppeals")}
                  </p>
                ) : null}
              </article>
            </section>

            {isLeader ? (
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">
                  {t("performance.kpiEntries")}
                </h2>
                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {kpiMemberOptions.map((member) => {
                    const kpi = kpis.find((item) => item.user_id === member.id);
                    return (
                      <div
                        key={member.id}
                        className="rounded-2xl bg-slate-50 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-black">{member.name}</p>
                          <Badge tone={kpi ? "indigo" : "slate"}>
                            {kpi
                              ? `${number(kpi.score).toFixed(1)} / 30`
                              : t("performance.notEntered")}
                          </Badge>
                        </div>
                        {kpi?.notes ? (
                          <p className="mt-2 text-sm text-slate-600">
                            {kpi.notes}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </article>
            ) : null}
          </section>
        ) : null}

        {view === "settings" && canConfigure ? (
          <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <article
              id="daily-report-reminders"
              className="scroll-mt-6 rounded-3xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm xl:col-span-2"
            >
              <h2 className="text-2xl font-black text-indigo-950">
                {locale === "fr"
                  ? "Relances automatiques des rapports"
                  : "Automatic report reminders"}
              </h2>
              <p className="mt-1 text-sm text-indigo-800">
                {locale === "fr"
                  ? "Configurez les rappels avant la clôture et l’escalade au superviseur lorsqu’un rapport manque."
                  : "Configure reminders before the deadline and supervisor escalation when a report is missing."}
              </p>
              <form
                action={updateDailyReportReminderSettingsAction}
                className="mt-5 space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-xl bg-white p-4 text-sm font-bold">
                    <input
                      name="reportRemindersEnabled"
                      type="checkbox"
                      defaultChecked={settings.report_reminders_enabled}
                    />
                    {t("performance.reportRemindersEnabled")}
                  </label>
                  <label className="flex items-center gap-3 rounded-xl bg-white p-4 text-sm font-bold">
                    <input
                      name="reportSupervisorEscalationEnabled"
                      type="checkbox"
                      defaultChecked={
                        settings.report_supervisor_escalation_enabled
                      }
                    />
                    {t("performance.reportSupervisorEscalationEnabled")}
                  </label>
                  <label className="block text-sm font-black text-indigo-950">
                    {t("performance.reportFirstReminderMinutes")}
                    <input
                      name="reportFirstReminderMinutes"
                      type="number"
                      min="30"
                      max="720"
                      defaultValue={
                        settings.report_first_reminder_minutes ?? 120
                      }
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black text-indigo-950">
                    {t("performance.reportUrgentReminderMinutes")}
                    <input
                      name="reportUrgentReminderMinutes"
                      type="number"
                      min="5"
                      max="120"
                      defaultValue={
                        settings.report_urgent_reminder_minutes ?? 30
                      }
                      required
                      className={fieldClass()}
                    />
                  </label>
                </div>
                <p className="text-xs font-semibold text-indigo-700">
                  {locale === "fr"
                    ? "Le premier rappel doit précéder le rappel urgent. Valeurs par défaut : 120 et 30 minutes."
                    : "The first reminder must occur before the urgent reminder. Defaults: 120 and 30 minutes."}
                </p>
                <button className="rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">
                  {t("performance.saveSettings")}
                </button>
              </form>
            </article>
            {canConfigure ? (
              <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-2xl font-black">
                  {t("performance.scoringSettings")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {t("performance.scoringSettingsHelp")}
                </p>
                <form
                  action={updatePerformanceSettingsAction}
                  className="mt-5 space-y-5"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="block text-sm font-black">
                      <p>{t("performance.timezone")}</p>
                      <TimeZoneSelect
                        name="timezone"
                        defaultValue={settings.timezone}
                        locale={locale === "fr" ? "fr" : "en"}
                        className={fieldClass()}
                      />
                    </div>
                    <label className="block text-sm font-black">
                      {t("performance.graceMinutes")}
                      <input
                        name="graceMinutes"
                        type="number"
                        min="0"
                        max="180"
                        defaultValue={settings.grace_minutes}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.defaultStart")}
                      <input
                        name="defaultStart"
                        type="time"
                        defaultValue={settings.default_start_time.slice(0, 5)}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.defaultEnd")}
                      <input
                        name="defaultEnd"
                        type="time"
                        defaultValue={settings.default_end_time.slice(0, 5)}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.reportDeadline")}
                      <input
                        name="reportDeadline"
                        type="time"
                        defaultValue={settings.report_deadline_time.slice(0, 5)}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold">
                      <input
                        name="reportLockEnabled"
                        type="checkbox"
                        defaultChecked={settings.report_lock_enabled}
                      />
                      {t("performance.reportLockEnabled")}
                    </label>
                    <label className="flex items-center gap-3 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-950">
                      <input
                        name="workdayReopenEnabled"
                        type="checkbox"
                        defaultChecked={settings.workday_reopen_enabled}
                      />
                      {t("performance.workdayReopenEnabled")}
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.maximumWorkdayReopeningsPerDay")}
                      <input
                        name="maximumWorkdayReopeningsPerDay"
                        type="number"
                        min="1"
                        max="10"
                        defaultValue={
                          settings.maximum_workday_reopenings_per_day
                        }
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.longDayWarningMinutes")}
                      <input
                        name="longDayWarningMinutes"
                        type="number"
                        min="240"
                        max="1440"
                        defaultValue={settings.long_day_warning_minutes}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.nightWorkStart")}
                      <input
                        name="nightWorkStart"
                        type="time"
                        defaultValue={settings.night_work_start.slice(0, 5)}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.nightWorkEnd")}
                      <input
                        name="nightWorkEnd"
                        type="time"
                        defaultValue={settings.night_work_end.slice(0, 5)}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.maximumReopenHours")}
                      <input
                        name="maximumReopenHours"
                        type="number"
                        min="1"
                        max="168"
                        defaultValue={settings.maximum_reopen_hours}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.maximumReopeningsPerDay")}
                      <input
                        name="maximumReopeningsPerDay"
                        type="number"
                        min="1"
                        max="10"
                        defaultValue={settings.maximum_reopenings_per_day}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.reopenedReportScorePercent")}
                      <input
                        name="reopenedReportScorePercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        defaultValue={number(
                          settings.reopened_report_score_percent,
                        )}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.supervisorReportScorePercent")}
                      <input
                        name="supervisorReportScorePercent"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        defaultValue={number(
                          settings.supervisor_report_score_percent,
                        )}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.minimumWorkDays")}
                      <input
                        name="minimumWorkDays"
                        type="number"
                        min="1"
                        max="31"
                        defaultValue={settings.minimum_work_days}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.minimumReportRate")}
                      <input
                        name="minimumReportRate"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        defaultValue={number(settings.minimum_report_rate)}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.minimumScore")}
                      <input
                        name="minimumScore"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        defaultValue={number(settings.minimum_score)}
                        required
                        className={fieldClass()}
                      />
                    </label>
                    <label className="block text-sm font-black">
                      {t("performance.maximumUnexcusedAbsences")}
                      <input
                        name="maximumUnexcusedAbsences"
                        type="number"
                        min="0"
                        max="31"
                        defaultValue={settings.maximum_unexcused_absences}
                        required
                        className={fieldClass()}
                      />
                    </label>
                  </div>
                  <div>
                    <h3 className="font-black">{t("performance.weights")}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {t("performance.weightsHelp")}
                    </p>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      {[
                        [
                          "attendanceWeight",
                          "attendance",
                          settings.attendance_weight,
                        ],
                        [
                          "punctualityWeight",
                          "punctuality",
                          settings.punctuality_weight,
                        ],
                        [
                          "meetingsWeight",
                          "meetings",
                          settings.meetings_weight,
                        ],
                        ["reportsWeight", "reports", settings.reports_weight],
                        [
                          "collaborationWeight",
                          "collaboration",
                          settings.collaboration_weight,
                        ],
                        [
                          "trainingWeight",
                          "training",
                          settings.training_weight,
                        ],
                        ["roleKpiWeight", "roleKpi", settings.role_kpi_weight],
                      ].map(([name, key, value]) => (
                        <label
                          key={String(name)}
                          className="block text-sm font-black"
                        >
                          {t(`performance.criteria.${key}`)}
                          <input
                            name={String(name)}
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            defaultValue={number(value)}
                            required
                            className={fieldClass()}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                  <button className="w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white">
                    {t("performance.saveSettings")}
                  </button>
                </form>
              </article>
            ) : (
              <article className="rounded-3xl border border-slate-200 bg-white p-6">
                <h2 className="text-2xl font-black">
                  {t("performance.scoringSettings")}
                </h2>
                <p className="mt-2 text-slate-600">
                  {t("performance.hrOnlySettings")}
                </p>
              </article>
            )}

            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">
                {t("performance.memberSchedule")}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {t("performance.memberScheduleHelp")}
              </p>
              <form
                action={upsertMemberScheduleAction}
                className="mt-5 space-y-5"
              >
                <MemberTimeZoneFields
                  members={memberOptions.map((member) => ({
                    id: member.id,
                    name: member.name,
                    timeZone: member.timeZone,
                  }))}
                  defaultTimeZone={settings.timezone}
                  locale={locale === "fr" ? "fr" : "en"}
                  fieldClassName={fieldClass()}
                  employeeLabel={t("performance.employee")}
                  timeZoneLabel={t("performance.timezone")}
                />
                <label className="block text-sm font-black">
                  {t("performance.assignedSupervisor")}
                  <select name="supervisorId" required className={fieldClass()}>
                    <option value="">
                      {t("performance.selectSupervisor")}
                    </option>
                    {leaderOptions.map((leader) => (
                      <option key={leader.id} value={leader.id}>
                        {leader.name} · {t(`roles.${leader.role}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-black">
                  {t("performance.workPolicy")}
                  <select
                    name="workPolicy"
                    defaultValue="fixed"
                    className={fieldClass()}
                  >
                    <option value="fixed">
                      {t("performance.workPolicies.fixed")}
                    </option>
                    <option value="flexible">
                      {t("performance.workPolicies.flexible")}
                    </option>
                    <option value="autonomous">
                      {t("performance.workPolicies.autonomous")}
                    </option>
                  </select>
                </label>
                <p className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
                  {t("performance.workPolicyHelp")}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-black">
                    {t("performance.startTime")}
                    <input
                      name="startTime"
                      type="time"
                      defaultValue={settings.default_start_time.slice(0, 5)}
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.endTime")}
                    <input
                      name="endTime"
                      type="time"
                      defaultValue={settings.default_end_time.slice(0, 5)}
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.startWindowFrom")}
                    <input
                      name="startWindowFrom"
                      type="time"
                      defaultValue={settings.default_start_time.slice(0, 5)}
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.startWindowUntil")}
                    <input
                      name="startWindowUntil"
                      type="time"
                      defaultValue="11:00"
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.dailyTargetMinutes")}
                    <input
                      name="dailyTargetMinutes"
                      type="number"
                      min="0"
                      max="1440"
                      defaultValue={480}
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.weeklyTargetMinutes")}
                    <input
                      name="weeklyTargetMinutes"
                      type="number"
                      min="0"
                      max="10080"
                      defaultValue={2400}
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.coreHoursStart")}
                    <input
                      name="coreHoursStart"
                      type="time"
                      defaultValue="10:00"
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.coreHoursEnd")}
                    <input
                      name="coreHoursEnd"
                      type="time"
                      defaultValue="15:00"
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.latestEndTime")}
                    <input
                      name="latestEndTime"
                      type="time"
                      defaultValue="23:00"
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.graceMinutes")}
                    <input
                      name="graceMinutes"
                      type="number"
                      min="0"
                      max="180"
                      defaultValue={settings.grace_minutes}
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.reportDeadline")}
                    <input
                      name="reportDeadline"
                      type="time"
                      defaultValue={settings.report_deadline_time.slice(0, 5)}
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.employeeAlertDelayMinutes")}
                    <input
                      name="employeeAlertDelayMinutes"
                      type="number"
                      min="0"
                      max="1440"
                      defaultValue={0}
                      required
                      className={fieldClass()}
                    />
                  </label>
                  <label className="block text-sm font-black">
                    {t("performance.supervisorAlertDelayMinutes")}
                    <input
                      name="supervisorAlertDelayMinutes"
                      type="number"
                      min="0"
                      max="1440"
                      defaultValue={30}
                      required
                      className={fieldClass()}
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold">
                    <input
                      name="attendanceTrackingRequired"
                      type="checkbox"
                      defaultChecked
                    />
                    {t("performance.attendanceTrackingRequired")}
                  </label>
                  <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold">
                    <input
                      name="pauseTrackingEnabled"
                      type="checkbox"
                      defaultChecked
                    />
                    {t("performance.pauseTrackingEnabled")}
                  </label>
                  <label className="flex items-center gap-3 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-950">
                    <input
                      name="shortDayJustificationRequired"
                      type="checkbox"
                      defaultChecked
                    />
                    {t("performance.shortDayJustificationRequired")}
                  </label>
                  <label className="flex items-center gap-3 rounded-xl bg-indigo-50 p-4 text-sm font-bold text-indigo-950">
                    <input
                      name="reportRequiredBeforeClockOut"
                      type="checkbox"
                    />
                    {t("performance.reportRequiredBeforeClockOut")}
                  </label>
                  <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold">
                    <input name="allowOvernight" type="checkbox" />
                    {t("performance.allowOvernight")}
                  </label>
                </div>
                <fieldset>
                  <legend className="text-sm font-black">
                    {t("performance.workDays")}
                  </legend>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                      <label
                        key={day}
                        className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold"
                      >
                        <input
                          name="workDays"
                          type="checkbox"
                          value={day}
                          defaultChecked={day <= 5}
                        />
                        {t(`performance.weekdays.${day}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button className="w-full rounded-xl bg-indigo-700 px-5 py-3 font-black text-white">
                  {t("performance.saveSchedule")}
                </button>
              </form>
              <div className="mt-6 space-y-3">
                {schedules.map((schedule) => {
                  const policy = schedule.work_policy || "fixed";
                  const policySummary =
                    policy === "flexible"
                      ? `${String(schedule.start_window_from || schedule.start_time).slice(0, 5)}–${String(schedule.start_window_until || schedule.start_time).slice(0, 5)} · ${formatMinutes(schedule.daily_target_minutes || 480)}`
                      : policy === "autonomous"
                        ? `${formatMinutes(schedule.weekly_target_minutes || 0)} / ${t("performance.week")}`
                        : `${schedule.start_time.slice(0, 5)}–${schedule.end_time.slice(0, 5)}`;
                  return (
                    <div
                      key={schedule.id}
                      className="rounded-xl bg-slate-50 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-black">
                          {memberName(schedule.user_id)}
                        </p>
                        <Badge
                          tone={
                            policy === "fixed"
                              ? "slate"
                              : policy === "flexible"
                                ? "indigo"
                                : "emerald"
                          }
                        >
                          {t(`performance.workPolicies.${policy}`)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm font-bold text-slate-800">
                        {policySummary}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        {schedule.work_days
                          .map((day) => t(`performance.weekdays.${day}`))
                          .join(" · ")}{" "}
                        ·{" "}
                        {normalizeTimeZone(
                          schedule.timezone,
                          settings.timezone,
                        )}
                      </p>
                      <p className="mt-1 text-xs font-bold text-indigo-700">
                        {t("performance.supervisorLabel", {
                          name: schedule.supervisor_id
                            ? memberName(schedule.supervisor_id)
                            : t("performance.notAssigned"),
                        })}
                      </p>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>
        ) : null}
      </div>
    </main>
  );
}
