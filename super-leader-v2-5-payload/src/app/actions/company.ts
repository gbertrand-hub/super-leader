"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import {
  canManageTeamAssignments,
  canManageTeamMembers,
  canManageTeamStructure,
} from "@/lib/auth/permissions";
import { isTeamWithinManagerScope, isUserWithinScope } from "@/lib/auth/scope";
import { assertOrganizationCanAddMember, enforceOrganizationFeature } from "@/lib/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type CompanyState = { error?: string; success?: string };

function cleanUrl(value?: string): string | null {
  if (!value) return null;

  const cleaned = value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/+$/, "");

  return cleaned || null;
}

function siteUrl(): string {
  const configured = cleanUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured;

  const productionDomain = cleanUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (productionDomain) {
    return `https://${productionDomain.replace(/^https?:\/\//, "")}`;
  }

  const deploymentDomain = cleanUrl(process.env.VERCEL_URL);
  if (deploymentDomain) {
    return `https://${deploymentDomain.replace(/^https?:\/\//, "")}`;
  }

  return "http://localhost:3002";
}

async function currentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) redirect("/login");

  return { supabase, user: data.user };
}

async function assertCanManagePeople(
  organizationId: string,
  userId: string,
  noPermissionMessage: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data: membership, error } = await admin
    .from("organization_members")
    .select("role,is_active")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (
    error ||
    !membership ||
    membership.is_active === false ||
    !["owner", "admin", "hr"].includes(membership.role)
  ) {
    throw new Error(noPermissionMessage);
  }
}


async function assertCanManageTeams(
  organizationId: string,
  userId: string,
  noPermissionMessage: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data: membership, error } = await admin
    .from("organization_members")
    .select("role,is_active")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (
    error ||
    !membership ||
    membership.is_active === false ||
    !canManageTeamStructure(membership.role)
  ) {
    throw new Error(noPermissionMessage);
  }
}


export async function createOrganizationAction(
  _state: CompanyState,
  _formData: FormData,
): Promise<CompanyState> {
  return {
    error:
      "La création libre d’une organisation est désactivée. Une organisation est activée après validation de la demande de démonstration par l’équipe Super Leader.",
  };
}

export async function createTeamAction(
  _state: CompanyState,
  formData: FormData,
): Promise<CompanyState> {
  const { t } = await getI18n();
  const organizationId = String(formData.get("organizationId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const department = String(formData.get("department") ?? "").trim();

  if (!organizationId || name.length < 2) {
    return { error: t("companyActions.teamNameRequired") };
  }

  const { supabase, user } = await currentUser();
  try {
    await assertCanManageTeams(
      organizationId,
      user.id,
      t("members.actionMessages.noAssignmentPermission"),
    );
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("companyActions.inviteNotAllowed"),
    };
  }

  const { error } = await supabase.from("teams").insert({
    organization_id: organizationId,
    name,
    department: department || null,
    created_by: user.id,
  });

  if (error) {
    return {
      error: t("companyActions.createImpossible", { message: error.message }),
    };
  }

  revalidatePath("/dashboard/team");
  return { success: t("companyActions.teamCreated") };
}


type TeamActivityAction =
  | "team_created"
  | "team_updated"
  | "manager_assigned"
  | "manager_removed"
  | "member_assigned"
  | "member_removed"
  | "team_archived"
  | "team_restored";

function goTeam(
  message: string,
  kind: "success" | "error" = "success",
  teamId?: string,
): never {
  const params = new URLSearchParams({ [kind]: message });
  if (teamId) params.set("team", teamId);
  redirect(`/dashboard/team?${params.toString()}`);
}

async function logTeamActivity({
  organizationId,
  teamId,
  actorId,
  action,
  targetUserId,
  details,
}: {
  organizationId: string;
  teamId: string;
  actorId: string;
  action: TeamActivityAction;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("team_activity_log").insert({
    organization_id: organizationId,
    team_id: teamId,
    actor_id: actorId,
    action,
    target_user_id: targetUserId || null,
    details: details ?? {},
  });

  if (error) {
    console.error("Unable to write team activity log", error);
  }
}

async function activeManagerExists(
  organizationId: string,
  managerId: string,
): Promise<boolean> {
  if (!managerId) return false;
  const admin = createAdminClient();
  const { data } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", managerId)
    .eq("role", "manager")
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}

async function teamContext(teamId: string) {
  const { t } = await getI18n();
  const { user } = await currentUser();
  const admin = createAdminClient();
  const { data: team, error } = await admin
    .from("teams")
    .select("id,organization_id,name,department,manager_id,is_active")
    .eq("id", teamId)
    .maybeSingle();

  if (error) {
    goTeam(
      t("companyActions.teamModuleUnavailable", { message: error.message }),
      "error",
    );
  }
  if (!team) goTeam(t("companyActions.teamNotFound"), "error");

  const { data: membership } = await admin
    .from("organization_members")
    .select("role,is_active")
    .eq("organization_id", team.organization_id)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!membership) goTeam(t("companyActions.teamViewDenied"), "error");
  await enforceOrganizationFeature(team.organization_id, "teams");

  return { t, user, admin, team, membership };
}

export async function createTeamDirectAction(formData: FormData) {
  const { t } = await getI18n();
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const department = String(formData.get("department") ?? "").trim();
  const managerId = String(formData.get("managerId") ?? "").trim();

  if (!organizationId || name.length < 2 || name.length > 120) {
    goTeam(t("companyActions.teamNameRequired"), "error");
  }

  const { user } = await currentUser();
  try {
    await assertCanManageTeams(
      organizationId,
      user.id,
      t("companyActions.teamStructureDenied"),
    );
  } catch (error) {
    goTeam(
      error instanceof Error ? error.message : t("companyActions.teamStructureDenied"),
      "error",
    );
  }

  if (managerId && !(await activeManagerExists(organizationId, managerId))) {
    goTeam(t("companyActions.invalidTeamManager"), "error");
  }

  const admin = createAdminClient();
  const { data: team, error } = await admin
    .from("teams")
    .insert({
      organization_id: organizationId,
      name,
      department: department || null,
      manager_id: managerId || null,
      created_by: user.id,
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !team) {
    goTeam(
      t("companyActions.createImpossible", {
        message: error?.message ?? t("common.unknownError"),
      }),
      "error",
    );
  }

  await logTeamActivity({
    organizationId,
    teamId: team.id,
    actorId: user.id,
    action: "team_created",
    targetUserId: managerId || null,
    details: { name, department: department || null, manager_id: managerId || null },
  });

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/members");
  goTeam(t("companyActions.teamCreated"), "success", team.id);
}

export async function updateTeamDetailsAction(formData: FormData) {
  const teamId = String(formData.get("teamId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const department = String(formData.get("department") ?? "").trim();
  if (!teamId) redirect("/dashboard/team");

  const { t, user, admin, team, membership } = await teamContext(teamId);
  if (!canManageTeamStructure(membership.role)) {
    goTeam(t("companyActions.teamStructureDenied"), "error", teamId);
  }
  if (name.length < 2 || name.length > 120) {
    goTeam(t("companyActions.teamNameRequired"), "error", teamId);
  }

  const { error } = await admin
    .from("teams")
    .update({
      name,
      department: department || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", teamId)
    .eq("organization_id", team.organization_id);

  if (error) {
    goTeam(
      t("companyActions.teamUpdateImpossible", { message: error.message }),
      "error",
      teamId,
    );
  }

  await logTeamActivity({
    organizationId: team.organization_id,
    teamId,
    actorId: user.id,
    action: "team_updated",
    details: {
      previous_name: team.name,
      name,
      previous_department: team.department,
      department: department || null,
    },
  });

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/members");
  goTeam(t("companyActions.teamUpdated"), "success", teamId);
}

export async function assignTeamManagerAction(formData: FormData) {
  const teamId = String(formData.get("teamId") ?? "").trim();
  const managerId = String(formData.get("managerId") ?? "").trim();
  if (!teamId) redirect("/dashboard/team");

  const { t, user, admin, team, membership } = await teamContext(teamId);
  if (!canManageTeamAssignments(membership.role)) {
    goTeam(t("companyActions.teamAssignmentDenied"), "error", teamId);
  }
  if (managerId && !(await activeManagerExists(team.organization_id, managerId))) {
    goTeam(t("companyActions.invalidTeamManager"), "error", teamId);
  }

  if (managerId) {
    const { error: memberRemovalError } = await admin
      .from("team_members")
      .delete()
      .eq("team_id", teamId)
      .eq("user_id", managerId);

    if (memberRemovalError) {
      goTeam(
        t("companyActions.managerUpdateImpossible", {
          message: memberRemovalError.message,
        }),
        "error",
        teamId,
      );
    }
  }

  const { error } = await admin
    .from("teams")
    .update({
      manager_id: managerId || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", teamId)
    .eq("organization_id", team.organization_id);

  if (error) {
    goTeam(
      t("companyActions.managerUpdateImpossible", { message: error.message }),
      "error",
      teamId,
    );
  }

  await logTeamActivity({
    organizationId: team.organization_id,
    teamId,
    actorId: user.id,
    action: managerId ? "manager_assigned" : "manager_removed",
    targetUserId: managerId || team.manager_id || null,
    details: { previous_manager_id: team.manager_id, manager_id: managerId || null },
  });

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/members");
  goTeam(
    managerId
      ? t("companyActions.managerAssigned")
      : t("companyActions.managerRemoved"),
    "success",
    teamId,
  );
}

export async function assignTeamMemberAction(formData: FormData) {
  const teamId = String(formData.get("teamId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!teamId) redirect("/dashboard/team");

  const { t, user, admin, team, membership } = await teamContext(teamId);
  if (!canManageTeamMembers(membership.role)) {
    goTeam(t("companyActions.teamAssignmentDenied"), "error", teamId);
  }
  if (membership.role === "manager") {
    const [teamAllowed, userAllowed] = await Promise.all([
      isTeamWithinManagerScope({
        admin,
        organizationId: team.organization_id,
        actorId: user.id,
        role: membership.role,
        teamId,
      }),
      isUserWithinScope({
        admin,
        organizationId: team.organization_id,
        actorId: user.id,
        role: membership.role,
        targetUserId: userId,
      }),
    ]);

    if (!teamAllowed || !userAllowed) {
      goTeam(t("companyActions.managerTeamScopeDenied"), "error", teamId);
    }
  }
  if (!team.is_active) {
    goTeam(t("companyActions.archivedTeamReadOnly"), "error", teamId);
  }
  if (!userId || userId === team.manager_id) {
    goTeam(t("companyActions.invalidTeamMember"), "error", teamId);
  }

  const { data: target } = await admin
    .from("organization_members")
    .select("user_id,role,is_active")
    .eq("organization_id", team.organization_id)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!target || target.role === "owner") {
    goTeam(t("companyActions.invalidTeamMember"), "error", teamId);
  }

  const { error } = await admin.from("team_members").upsert(
    {
      team_id: teamId,
      user_id: userId,
      assigned_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id,user_id" },
  );

  if (error) {
    goTeam(
      t("companyActions.memberAssignmentImpossible", { message: error.message }),
      "error",
      teamId,
    );
  }

  await logTeamActivity({
    organizationId: team.organization_id,
    teamId,
    actorId: user.id,
    action: "member_assigned",
    targetUserId: userId,
  });

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/members");
  goTeam(t("companyActions.memberAssigned"), "success", teamId);
}

export async function removeTeamMemberDirectAction(formData: FormData) {
  const teamId = String(formData.get("teamId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!teamId) redirect("/dashboard/team");

  const { t, user, admin, team, membership } = await teamContext(teamId);
  if (!canManageTeamMembers(membership.role)) {
    goTeam(t("companyActions.teamAssignmentDenied"), "error", teamId);
  }
  if (!userId) goTeam(t("companyActions.invalidTeamMember"), "error", teamId);
  if (membership.role === "manager") {
    const [teamAllowed, userAllowed] = await Promise.all([
      isTeamWithinManagerScope({
        admin,
        organizationId: team.organization_id,
        actorId: user.id,
        role: membership.role,
        teamId,
      }),
      isUserWithinScope({
        admin,
        organizationId: team.organization_id,
        actorId: user.id,
        role: membership.role,
        targetUserId: userId,
      }),
    ]);

    if (!teamAllowed || !userAllowed) {
      goTeam(t("companyActions.managerTeamScopeDenied"), "error", teamId);
    }
  }

  const { error } = await admin
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (error) {
    goTeam(
      t("companyActions.memberRemovalImpossible", { message: error.message }),
      "error",
      teamId,
    );
  }

  await logTeamActivity({
    organizationId: team.organization_id,
    teamId,
    actorId: user.id,
    action: "member_removed",
    targetUserId: userId,
  });

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/members");
  goTeam(t("companyActions.memberRemoved"), "success", teamId);
}

export async function archiveTeamAction(formData: FormData) {
  const teamId = String(formData.get("teamId") ?? "").trim();
  if (!teamId) redirect("/dashboard/team");

  const { t, user, admin, team, membership } = await teamContext(teamId);
  if (!canManageTeamStructure(membership.role)) {
    goTeam(t("companyActions.teamStructureDenied"), "error", teamId);
  }
  if (!team.is_active) goTeam(t("companyActions.teamAlreadyArchived"), "error", teamId);

  const now = new Date().toISOString();
  const { error } = await admin
    .from("teams")
    .update({ is_active: false, archived_at: now, updated_at: now })
    .eq("id", teamId)
    .eq("organization_id", team.organization_id);

  if (error) {
    goTeam(
      t("companyActions.teamArchiveImpossible", { message: error.message }),
      "error",
      teamId,
    );
  }

  await logTeamActivity({
    organizationId: team.organization_id,
    teamId,
    actorId: user.id,
    action: "team_archived",
  });

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/members");
  goTeam(t("companyActions.teamArchived"));
}

export async function restoreTeamAction(formData: FormData) {
  const teamId = String(formData.get("teamId") ?? "").trim();
  if (!teamId) redirect("/dashboard/team");

  const { t, user, admin, team, membership } = await teamContext(teamId);
  if (!canManageTeamStructure(membership.role)) {
    goTeam(t("companyActions.teamStructureDenied"), "error", teamId);
  }

  const { error } = await admin
    .from("teams")
    .update({
      is_active: true,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", teamId)
    .eq("organization_id", team.organization_id);

  if (error) {
    goTeam(
      t("companyActions.teamRestoreImpossible", { message: error.message }),
      "error",
      teamId,
    );
  }

  await logTeamActivity({
    organizationId: team.organization_id,
    teamId,
    actorId: user.id,
    action: "team_restored",
  });

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/members");
  goTeam(t("companyActions.teamRestored"), "success", teamId);
}

export async function inviteMemberAction(
  _state: CompanyState,
  formData: FormData,
): Promise<CompanyState> {
  const { t } = await getI18n();
  const organizationId = String(formData.get("organizationId") ?? "");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "employee");
  const allowedRoles = ["admin", "hr", "manager", "employee"];

  if (!organizationId || !email.includes("@")) {
    return { error: t("companyActions.invalidEmail") };
  }

  if (!allowedRoles.includes(role)) {
    return { error: t("companyActions.invalidRole") };
  }

  const { user } = await currentUser();

  try {
    await assertCanManagePeople(
      organizationId,
      user.id,
      t("companyActions.noInvitePermission"),
    );
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : t("companyActions.inviteNotAllowed"),
    };
  }

  try {
    const capacity = await assertOrganizationCanAddMember(organizationId);
    if (!capacity.allowed) {
      return {
        error: `La limite du plan est atteinte (${capacity.current}/${capacity.limit}). Modifie le plan ou désactive un compte avant d’envoyer une nouvelle invitation.`,
      };
    }
  } catch (error) {
    console.error("Subscription member limit unavailable", error);
  }

  const admin = createAdminClient();
  const token = randomUUID();

  const { error: invitationError } = await admin
    .from("organization_invitations")
    .insert({
      organization_id: organizationId,
      email,
      role,
      token,
    });

  if (invitationError) {
    return {
      error: t("companyActions.invitationImpossible", {
        message: invitationError.message,
      }),
    };
  }

  const destination = siteUrl();
  const nextPath = `/accept-invite?token=${encodeURIComponent(token)}`;
  const redirectTo = `${destination}/auth/callback?next=${encodeURIComponent(nextPath)}`;

  const { error: mailError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      invited_organization_id: organizationId,
      invited_role: role,
    },
  });

  if (mailError) {
    await admin.from("organization_invitations").delete().eq("token", token);
    return {
      error: t("companyActions.emailNotSent", { message: mailError.message }),
    };
  }

  revalidatePath("/dashboard/company");
  revalidatePath("/dashboard/members");

  return {
    success: t("companyActions.invitationSent", { email, destination }),
  };
}

export async function acceptInvitationAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/dashboard?error=invitation");

  const { supabase } = await currentUser();
  const { error } = await supabase.rpc("accept_organization_invitation", {
    invitation_token: token,
  });

  if (error) {
    redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/company");
}
