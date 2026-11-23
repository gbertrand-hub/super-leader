import { createAdminClient } from "@/lib/supabase/admin";
import {
  hasOrganizationWideAccess,
  normalizeOrganizationRole,
  type OrganizationRole,
} from "@/lib/auth/permissions";

type AdminClient = ReturnType<typeof createAdminClient>;
type UserIdRow = { user_id: string };

export type OrganizationScope = {
  organizationId: string;
  actorId: string;
  role: OrganizationRole;
  visibleUserIds: string[];
};

export async function getVisibleUserIds({
  admin,
  organizationId,
  actorId,
  role,
  includeInactive = false,
}: {
  admin: AdminClient;
  organizationId: string;
  actorId: string;
  role: string;
  includeInactive?: boolean;
}): Promise<string[]> {
  const normalizedRole = normalizeOrganizationRole(role);

  if (hasOrganizationWideAccess(normalizedRole) || normalizedRole === "hr") {
    let query = admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId);

    if (!includeInactive) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return Array.from(
      new Set(((data ?? []) as UserIdRow[]).map((row) => row.user_id)),
    );
  }

  if (normalizedRole === "executive") {
    const { data: assignmentRows, error: assignmentError } = await admin
      .from("executive_manager_assignments")
      .select("manager_user_id")
      .eq("organization_id", organizationId)
      .eq("executive_user_id", actorId);

    if (assignmentError) {
      if (!["42P01", "PGRST205"].includes(String(assignmentError.code ?? ""))) {
        console.error("Executive assignment scope lookup failed", assignmentError);
      }
      return [actorId];
    }

    const managerIds = Array.from(
      new Set((assignmentRows ?? []).map((row) => String(row.manager_user_id))),
    );
    if (!managerIds.length) return [actorId];

    const [{ data: scheduleRows, error: scheduleError }, { data: managedTeams, error: teamError }] =
      await Promise.all([
        admin
          .from("member_work_schedules")
          .select("user_id")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .in("supervisor_id", managerIds),
        admin
          .from("teams")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .in("manager_id", managerIds),
      ]);

    if (scheduleError) console.error("Executive schedule scope lookup failed", scheduleError);
    if (teamError) console.error("Executive team scope lookup failed", teamError);

    const teamIds = (managedTeams ?? []).map((team) => String(team.id));
    const { data: teamMemberRows, error: teamMemberError } = teamIds.length
      ? await admin.from("team_members").select("user_id").in("team_id", teamIds)
      : { data: [] as UserIdRow[], error: null };

    if (teamMemberError) console.error("Executive team member scope lookup failed", teamMemberError);

    const candidateIds = Array.from(
      new Set([
        actorId,
        ...managerIds,
        ...((scheduleRows ?? []) as UserIdRow[]).map((row) => row.user_id),
        ...((teamMemberRows ?? []) as UserIdRow[]).map((row) => row.user_id),
      ]),
    );

    const { data: activeMembers, error: activeMembersError } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .in("user_id", candidateIds);

    if (activeMembersError) {
      console.error("Executive active member scope lookup failed", activeMembersError);
      return [actorId];
    }

    return Array.from(
      new Set(((activeMembers ?? []) as UserIdRow[]).map((row) => row.user_id)),
    );
  }

  if (normalizedRole !== "manager") return [actorId];

  const [{ data: scheduleRows, error: scheduleError }, { data: managedTeams, error: teamError }] =
    await Promise.all([
      admin
        .from("member_work_schedules")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("supervisor_id", actorId)
        .eq("is_active", true),
      admin
        .from("teams")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("manager_id", actorId)
        .eq("is_active", true),
    ]);

  if (scheduleError) {
    console.error("Manager schedule scope lookup failed", scheduleError);
  }
  if (teamError) {
    console.error("Manager team scope lookup failed", teamError);
  }

  const teamIds = (managedTeams ?? []).map((team) => String(team.id));
  const { data: teamMemberRows, error: teamMemberError } = teamIds.length
    ? await admin.from("team_members").select("user_id").in("team_id", teamIds)
    : { data: [] as UserIdRow[], error: null };

  if (teamMemberError) {
    console.error("Manager team member scope lookup failed", teamMemberError);
  }

  const supervisedUserIds = Array.from(
    new Set([
      ...((scheduleRows ?? []) as UserIdRow[]).map((row) => row.user_id),
      ...((teamMemberRows ?? []) as UserIdRow[]).map((row) => row.user_id),
    ]),
  );
  if (!supervisedUserIds.length) return [actorId];

  const { data: activeMembers, error: activeMembersError } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .in("user_id", supervisedUserIds);

  if (activeMembersError) {
    console.error("Manager active member scope lookup failed", activeMembersError);
    return [actorId];
  }

  return Array.from(
    new Set([
      actorId,
      ...((activeMembers ?? []) as UserIdRow[]).map((row) => row.user_id),
    ]),
  );
}

export async function getOrganizationScope({
  admin,
  organizationId,
  actorId,
  role,
}: {
  admin: AdminClient;
  organizationId: string;
  actorId: string;
  role: string;
}): Promise<OrganizationScope> {
  const normalizedRole = normalizeOrganizationRole(role);
  return {
    organizationId,
    actorId,
    role: normalizedRole,
    visibleUserIds: await getVisibleUserIds({
      admin,
      organizationId,
      actorId,
      role: normalizedRole,
    }),
  };
}

export async function isUserWithinScope({
  admin,
  organizationId,
  actorId,
  role,
  targetUserId,
}: {
  admin: AdminClient;
  organizationId: string;
  actorId: string;
  role: string;
  targetUserId: string;
}): Promise<boolean> {
  if (!targetUserId) return false;
  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId,
    actorId,
    role,
  });
  return visibleUserIds.includes(targetUserId);
}

export async function isTeamWithinManagerScope({
  admin,
  organizationId,
  actorId,
  role,
  teamId,
}: {
  admin: AdminClient;
  organizationId: string;
  actorId: string;
  role: string;
  teamId: string;
}): Promise<boolean> {
  const normalizedRole = normalizeOrganizationRole(role);
  if (normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "hr") {
    const { data } = await admin
      .from("teams")
      .select("id")
      .eq("id", teamId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    return Boolean(data);
  }

  if (normalizedRole === "executive") {
    const { data: assignmentRows, error: assignmentError } = await admin
      .from("executive_manager_assignments")
      .select("manager_user_id")
      .eq("organization_id", organizationId)
      .eq("executive_user_id", actorId);
    if (assignmentError) return false;
    const managerIds = (assignmentRows ?? []).map((row) => String(row.manager_user_id));
    if (!managerIds.length) return false;
    const { data: team } = await admin
      .from("teams")
      .select("id, manager_id")
      .eq("id", teamId)
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .in("manager_id", managerIds)
      .maybeSingle();
    return Boolean(team);
  }

  if (normalizedRole !== "manager") return false;

  const { data: team } = await admin
    .from("teams")
    .select("id, manager_id")
    .eq("id", teamId)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  return Boolean(team && team.manager_id === actorId);
}
