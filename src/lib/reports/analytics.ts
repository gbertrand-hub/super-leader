import {createAdminClient} from "@/lib/supabase/admin";
import type {Locale} from "@/i18n/config";

export const reportPeriods = ["30", "90", "180", "365", "all"] as const;
export type ReportPeriod = (typeof reportPeriods)[number];

export type ReportFilterInput = {
  period?: string | null;
  team?: string | null;
  member?: string | null;
};

export type ReportFilters = {
  period: ReportPeriod;
  teamId: string;
  memberId: string;
};

type MemberRow = {
  user_id: string;
  role: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  department: string | null;
};

type TeamMemberRow = {
  team_id: string;
  user_id: string;
};

type FeedbackRow = {
  sender_id: string;
  recipient_id: string;
  category: string;
  score: number;
  created_at: string;
};

type RecognitionRow = {
  recipient_id: string;
  badge: string;
  created_at: string;
};

type ActionPlanRow = {
  owner_id: string;
  status: string;
  progress: number;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
};

export type ReportMember = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ReportTeam = {
  id: string;
  name: string;
  department: string | null;
};

export type CategoryMetric = {
  category: string;
  count: number;
  average: number;
};

export type BadgeMetric = {
  badge: string;
  count: number;
};

export type StatusMetric = {
  status: string;
  count: number;
};

export type MonthlyMetric = {
  key: string;
  label: string;
  feedbackCount: number;
  feedbackAverage: number;
  recognitionCount: number;
  completedPlans: number;
};

export type TeamMetric = {
  id: string;
  name: string;
  department: string | null;
  memberCount: number;
  feedbackCount: number;
  feedbackAverage: number;
  recognitionCount: number;
  activePlans: number;
  completionRate: number;
};

export type ReportAnalytics = {
  filters: ReportFilters;
  members: ReportMember[];
  teams: ReportTeam[];
  selectedMemberIds: string[];
  selectedMemberName: string | null;
  selectedTeamName: string | null;
  periodStart: string | null;
  generatedAt: string;
  metrics: {
    memberCount: number;
    feedbackCount: number;
    feedbackAverage: number;
    participationRate: number;
    recognitionCount: number;
    activePlans: number;
    completedPlans: number;
    overduePlans: number;
    averageProgress: number;
  };
  categories: CategoryMetric[];
  badges: BadgeMetric[];
  actionStatuses: StatusMetric[];
  monthly: MonthlyMetric[];
  teamMetrics: TeamMetric[];
};

const feedbackCategories = [
  "communication",
  "collaboration",
  "leadership",
  "fiabilite",
  "organisation",
  "qualite",
  "service_client",
  "innovation",
  "autre",
] as const;

const recognitionBadges = [
  "leadership",
  "teamwork",
  "service",
  "innovation",
  "reliability",
  "communication",
  "courage",
  "excellence",
] as const;

const actionStatuses = [
  "todo",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const;

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function percentage(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function getPeriodStart(period: ReportPeriod, now: Date) {
  if (period === "all") return null;
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - Number(period) + 1);
  return start.toISOString();
}

function monthKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildMonthBuckets(locale: Locale, period: ReportPeriod, now: Date) {
  const monthCount = period === "30" ? 3 : period === "90" ? 4 : period === "180" ? 6 : 12;
  const dateLocale = locale === "fr" ? "fr-FR" : "en-GB";
  const formatter = new Intl.DateTimeFormat(dateLocale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });

  return Array.from({length: monthCount}, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthCount - index - 1), 1));
    return {
      key: monthKey(date),
      label: formatter.format(date),
    };
  });
}

export function normalizeReportFilters(input: ReportFilterInput): ReportFilters {
  const period = reportPeriods.includes(input.period as ReportPeriod)
    ? (input.period as ReportPeriod)
    : "90";

  return {
    period,
    teamId: typeof input.team === "string" ? input.team : "",
    memberId: typeof input.member === "string" ? input.member : "",
  };
}

export async function loadReportAnalytics({
  organizationId,
  filters: rawFilters,
  locale,
  now = new Date(),
}: {
  organizationId: string;
  filters: ReportFilterInput;
  locale: Locale;
  now?: Date;
}): Promise<ReportAnalytics> {
  const admin = createAdminClient();
  const filters = normalizeReportFilters(rawFilters);
  const periodStart = getPeriodStart(filters.period, now);

  const [membersResult, teamsResult] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("created_at"),
    admin
      .from("teams")
      .select("id, name, department")
      .eq("organization_id", organizationId)
      .order("department")
      .order("name"),
  ]);

  if (membersResult.error) throw membersResult.error;
  if (teamsResult.error) throw teamsResult.error;

  const memberRows = (membersResult.data ?? []) as MemberRow[];
  const teamRows = (teamsResult.data ?? []) as TeamRow[];
  const activeMemberIds = memberRows.map((member) => member.user_id);
  const activeMemberSet = new Set(activeMemberIds);
  const validTeamIdList = teamRows.map((team) => team.id);

  const [profileResult, teamMembersResult] = await Promise.all([
    activeMemberIds.length
      ? admin
          .from("profiles")
          .select("id, full_name, email")
          .in("id", activeMemberIds)
      : Promise.resolve({data: [] as ProfileRow[], error: null}),
    validTeamIdList.length
      ? admin
          .from("team_members")
          .select("team_id, user_id")
          .in("team_id", validTeamIdList)
      : Promise.resolve({data: [] as TeamMemberRow[], error: null}),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (teamMembersResult.error) throw teamMembersResult.error;

  const relevantTeamMembers = ((teamMembersResult.data ?? []) as TeamMemberRow[]).filter(
    (row) => activeMemberSet.has(row.user_id),
  );

  const profiles = (profileResult.data ?? []) as ProfileRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const roleById = new Map(memberRows.map((member) => [member.user_id, member.role]));

  const members: ReportMember[] = activeMemberIds
    .map((id) => {
      const profile = profileById.get(id);
      return {
        id,
        name: profile?.full_name?.trim() || profile?.email || "Member",
        email: profile?.email ?? "",
        role: roleById.get(id) ?? "employee",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const teams: ReportTeam[] = teamRows.map((team) => ({
    id: team.id,
    name: team.name,
    department: team.department,
  }));

  const validSelectedTeam = teams.find((team) => team.id === filters.teamId) ?? null;
  const validSelectedMember = members.find((member) => member.id === filters.memberId) ?? null;

  let selectedMemberIds = [...activeMemberIds];
  if (validSelectedTeam) {
    const teamMemberSet = new Set(
      relevantTeamMembers
        .filter((row) => row.team_id === validSelectedTeam.id)
        .map((row) => row.user_id),
    );
    selectedMemberIds = selectedMemberIds.filter((id) => teamMemberSet.has(id));
  }
  if (validSelectedMember) {
    selectedMemberIds = selectedMemberIds.includes(validSelectedMember.id)
      ? [validSelectedMember.id]
      : [];
  }

  const selectedMemberSet = new Set(selectedMemberIds);

  let feedbackQuery = admin
    .from("peer_feedback")
    .select("sender_id, recipient_id, category, score, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "published");
  let recognitionQuery = admin
    .from("recognitions")
    .select("recipient_id, badge, created_at")
    .eq("organization_id", organizationId);
  let actionQuery = admin
    .from("action_plans")
    .select("owner_id, status, progress, due_date, created_at, completed_at")
    .eq("organization_id", organizationId);

  if (periodStart) {
    feedbackQuery = feedbackQuery.gte("created_at", periodStart);
    recognitionQuery = recognitionQuery.gte("created_at", periodStart);
    actionQuery = actionQuery.gte("created_at", periodStart);
  }

  const [feedbackResult, recognitionResult, actionResult] = await Promise.all([
    feedbackQuery,
    recognitionQuery,
    actionQuery,
  ]);

  if (feedbackResult.error) throw feedbackResult.error;
  if (recognitionResult.error) throw recognitionResult.error;
  if (actionResult.error) throw actionResult.error;

  const feedback = (feedbackResult.data ?? []) as FeedbackRow[];
  const recognitions = (recognitionResult.data ?? []) as RecognitionRow[];
  const actions = (actionResult.data ?? []) as ActionPlanRow[];

  const feedbackReceived = feedback.filter((row) => selectedMemberSet.has(row.recipient_id));
  const feedbackSent = feedback.filter((row) => selectedMemberSet.has(row.sender_id));
  const recognitionsReceived = recognitions.filter((row) => selectedMemberSet.has(row.recipient_id));
  const selectedActions = actions.filter((row) => selectedMemberSet.has(row.owner_id));

  const activeActions = selectedActions.filter(
    (row) => !["completed", "cancelled"].includes(row.status),
  );
  const completedActions = selectedActions.filter((row) => row.status === "completed");
  const today = now.toISOString().slice(0, 10);
  const overdueActions = selectedActions.filter(
    (row) =>
      Boolean(row.due_date) &&
      row.due_date! < today &&
      !["completed", "cancelled"].includes(row.status),
  );
  const participatingSenders = new Set(feedbackSent.map((row) => row.sender_id));

  const categories: CategoryMetric[] = feedbackCategories.map((category) => {
    const rows = feedbackReceived.filter((row) => row.category === category);
    return {
      category,
      count: rows.length,
      average: average(rows.map((row) => row.score)),
    };
  });

  const badges: BadgeMetric[] = recognitionBadges
    .map((badge) => ({
      badge,
      count: recognitionsReceived.filter((row) => row.badge === badge).length,
    }))
    .sort((a, b) => b.count - a.count);

  const actionStatusMetrics: StatusMetric[] = actionStatuses.map((status) => ({
    status,
    count: selectedActions.filter((row) => row.status === status).length,
  }));

  const monthly = buildMonthBuckets(locale, filters.period, now).map((bucket) => {
    const monthFeedback = feedbackReceived.filter(
      (row) => monthKey(row.created_at) === bucket.key,
    );
    const monthRecognition = recognitionsReceived.filter(
      (row) => monthKey(row.created_at) === bucket.key,
    );
    const monthCompleted = completedActions.filter(
      (row) => row.completed_at && monthKey(row.completed_at) === bucket.key,
    );

    return {
      ...bucket,
      feedbackCount: monthFeedback.length,
      feedbackAverage: average(monthFeedback.map((row) => row.score)),
      recognitionCount: monthRecognition.length,
      completedPlans: monthCompleted.length,
    };
  });

  const filteredTeams = teams.filter((team) => {
    if (validSelectedTeam) return team.id === validSelectedTeam.id;
    if (!validSelectedMember) return true;
    return relevantTeamMembers.some(
      (row) => row.team_id === team.id && row.user_id === validSelectedMember.id,
    );
  });

  const teamMetrics: TeamMetric[] = filteredTeams.map((team) => {
    const memberIds = relevantTeamMembers
      .filter((row) => row.team_id === team.id && selectedMemberSet.has(row.user_id))
      .map((row) => row.user_id);
    const memberSet = new Set(memberIds);
    const teamFeedback = feedback.filter((row) => memberSet.has(row.recipient_id));
    const teamRecognitions = recognitions.filter((row) => memberSet.has(row.recipient_id));
    const teamActions = actions.filter((row) => memberSet.has(row.owner_id));
    const teamCompleted = teamActions.filter((row) => row.status === "completed").length;

    return {
      id: team.id,
      name: team.name,
      department: team.department,
      memberCount: memberIds.length,
      feedbackCount: teamFeedback.length,
      feedbackAverage: average(teamFeedback.map((row) => row.score)),
      recognitionCount: teamRecognitions.length,
      activePlans: teamActions.filter(
        (row) => !["completed", "cancelled"].includes(row.status),
      ).length,
      completionRate: percentage(teamCompleted, teamActions.length),
    };
  });

  return {
    filters: {
      period: filters.period,
      teamId: validSelectedTeam?.id ?? "",
      memberId: validSelectedMember?.id ?? "",
    },
    members,
    teams,
    selectedMemberIds,
    selectedMemberName: validSelectedMember?.name ?? null,
    selectedTeamName: validSelectedTeam?.name ?? null,
    periodStart,
    generatedAt: now.toISOString(),
    metrics: {
      memberCount: selectedMemberIds.length,
      feedbackCount: feedbackReceived.length,
      feedbackAverage: average(feedbackReceived.map((row) => row.score)),
      participationRate: percentage(participatingSenders.size, selectedMemberIds.length),
      recognitionCount: recognitionsReceived.length,
      activePlans: activeActions.length,
      completedPlans: completedActions.length,
      overduePlans: overdueActions.length,
      averageProgress: Math.round(average(activeActions.map((row) => row.progress))),
    },
    categories,
    badges,
    actionStatuses: actionStatusMetrics,
    monthly,
    teamMetrics,
  };
}
