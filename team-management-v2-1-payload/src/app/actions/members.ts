"use server";

import { randomBytes, randomInt, randomUUID } from "crypto";
import {
  createClient as createSupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { sendTemporaryAccessEmail } from "@/lib/auth/temporary-access-email";
import { canManageTeamAssignments } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Role = "owner" | "admin" | "hr" | "manager" | "employee";
type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

const editableRoles: Role[] = ["admin", "hr", "manager", "employee"];

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/members?${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error || !membership) redirect("/dashboard/company");
  return { user: authData.user, membership, t };
}

async function requirePeopleAdmin() {
  const context = await getContext();
  if (!["owner", "admin", "hr"].includes(context.membership.role)) {
    go(context.t("members.actionMessages.noMemberPermission"), "error");
  }
  return context;
}

async function requireTeamAssignmentAdmin() {
  const context = await getContext();
  if (!canManageTeamAssignments(context.membership.role)) {
    go(context.t("members.actionMessages.noAssignmentPermission"), "error");
  }
  return context;
}

async function clearManagerAssignments({
  organizationId,
  managerId,
  actorId,
}: {
  organizationId: string;
  managerId: string;
  actorId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: managedTeams, error: teamsError } = await admin
    .from("teams")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("manager_id", managerId);

  if (teamsError) {
    console.error("Unable to load manager team assignments", teamsError);
    return;
  }

  const teamIds = (managedTeams ?? []).map((team) => String(team.id));
  if (teamIds.length) {
    const { error: clearTeamsError } = await admin
      .from("teams")
      .update({ manager_id: null, updated_at: new Date().toISOString() })
      .in("id", teamIds)
      .eq("organization_id", organizationId);

    if (clearTeamsError) {
      console.error("Unable to clear manager team assignments", clearTeamsError);
    } else {
      const { error: logError } = await admin.from("team_activity_log").insert(
        teamIds.map((teamId) => ({
          organization_id: organizationId,
          team_id: teamId,
          actor_id: actorId,
          action: "manager_removed",
          target_user_id: managerId,
          details: { reason: "role_or_status_changed" },
        })),
      );
      if (logError) console.error("Unable to log manager removal", logError);
    }
  }

  const { error: schedulesError } = await admin
    .from("member_work_schedules")
    .update({ supervisor_id: null, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("supervisor_id", managerId);

  if (schedulesError) {
    console.error("Unable to clear manager schedule supervision", schedulesError);
  }
}

export async function updateMemberRoleAction(formData: FormData) {
  const { user, membership, t } = await requirePeopleAdmin();
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;

  if (!memberId || !editableRoles.includes(role)) {
    go(t("members.actionMessages.invalidRoleOrMember"), "error");
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("organization_members")
    .select("id, user_id, organization_id, role")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  if (!target) go(t("members.actionMessages.memberNotFound"), "error");
  if (target.role === "owner") {
    go(t("members.actionMessages.ownerRoleLocked"), "error");
  }

  const { error } = await admin
    .from("organization_members")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    go(
      t("members.actionMessages.updateImpossible", { message: error.message }),
      "error",
    );
  }

  if (target.role === "manager" && role !== "manager") {
    await clearManagerAssignments({
      organizationId: membership.organization_id,
      managerId: target.user_id,
      actorId: user.id,
    });
  }

  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard");
  go(t("members.actionMessages.roleUpdated"));
}

export async function toggleMemberStatusAction(formData: FormData) {
  const { user, membership, t } = await requirePeopleAdmin();
  const memberId = String(formData.get("memberId") ?? "");
  const activate = String(formData.get("activate") ?? "false") === "true";
  if (!memberId) go(t("members.actionMessages.invalidMember"), "error");

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("organization_members")
    .select("id, user_id, organization_id, role")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  if (!target) go(t("members.actionMessages.memberNotFound"), "error");
  if (target.role === "owner") {
    go(t("members.actionMessages.ownerCannotDisable"), "error");
  }
  if (target.user_id === user.id && !activate) {
    go(t("members.actionMessages.cannotDisableSelf"), "error");
  }

  const { error } = await admin
    .from("organization_members")
    .update({
      is_active: activate,
      disabled_at: activate ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id);

  if (error) {
    go(
      t("members.actionMessages.statusUpdateImpossible", {
        message: error.message,
      }),
      "error",
    );
  }

  if (!activate && target.role === "manager") {
    await clearManagerAssignments({
      organizationId: membership.organization_id,
      managerId: target.user_id,
      actorId: user.id,
    });
  }

  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/team");
  go(
    activate
      ? t("members.actionMessages.memberReactivated")
      : t("members.actionMessages.memberDisabled"),
  );
}

export async function assignMemberToTeamAction(formData: FormData) {
  const { user, membership, t } = await requireTeamAssignmentAdmin();
  const userId = String(formData.get("userId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  if (!userId || !teamId) {
    go(t("members.actionMessages.chooseMemberTeam"), "error");
  }

  const admin = createAdminClient();

  const [{ data: targetMember }, { data: team }] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id,role")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    admin
      .from("teams")
      .select("id,manager_id,is_active")
      .eq("organization_id", membership.organization_id)
      .eq("id", teamId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (
    !targetMember ||
    !team ||
    targetMember.role === "owner" ||
    team.manager_id === userId
  ) {
    go(t("members.actionMessages.memberOrTeamWrongOrg"), "error");
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
    go(
      t("members.actionMessages.assignmentImpossible", {
        message: error.message,
      }),
      "error",
    );
  }
  const { error: logError } = await admin.from("team_activity_log").insert({
    organization_id: membership.organization_id,
    team_id: teamId,
    actor_id: user.id,
    action: "member_assigned",
    target_user_id: userId,
    details: {},
  });
  if (logError) console.error("Unable to log team assignment", logError);

  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/team");
  go(t("members.actionMessages.assigned"));
}

export async function removeMemberFromTeamAction(formData: FormData) {
  const { user, membership, t } = await requireTeamAssignmentAdmin();
  const userId = String(formData.get("userId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  if (!userId || !teamId) {
    go(t("members.actionMessages.invalidAssignment"), "error");
  }

  const admin = createAdminClient();

  const { data: team } = await admin
    .from("teams")
    .select("id,is_active")
    .eq("organization_id", membership.organization_id)
    .eq("id", teamId)
    .eq("is_active", true)
    .maybeSingle();
  if (!team) go(t("members.actionMessages.teamNotFound"), "error");

  const { error } = await admin
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (error) {
    go(
      t("members.actionMessages.removalImpossible", { message: error.message }),
      "error",
    );
  }
  const { error: logError } = await admin.from("team_activity_log").insert({
    organization_id: membership.organization_id,
    team_id: teamId,
    actor_id: user.id,
    action: "member_removed",
    target_user_id: userId,
    details: {},
  });
  if (logError) console.error("Unable to log team removal", logError);

  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/team");
  go(t("members.actionMessages.removed"));
}

export async function cancelInvitationAction(formData: FormData) {
  const { membership, t } = await requirePeopleAdmin();
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) {
    go(t("members.actionMessages.invalidInvitation"), "error");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organization_invitations")
    .update({ status: "cancelled" })
    .eq("id", invitationId)
    .eq("organization_id", membership.organization_id)
    .eq("status", "pending");

  if (error) {
    go(
      t("members.actionMessages.cancellationImpossible", {
        message: error.message,
      }),
      "error",
    );
  }
  revalidatePath("/dashboard/members");
  go(t("members.actionMessages.invitationCancelled"));
}

function cleanEnvironmentValue(value: string | undefined): string {
  return (value ?? "").trim().replace(/^['\"]|['\"]$/g, "");
}

function getSiteUrl(): string {
  const configuredUrl = cleanEnvironmentValue(
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  );

  return (configuredUrl || "http://localhost:3002").replace(/\/+$/, "");
}

function createPublicAuthClient(missingConfigMessage: string) {
  const supabaseUrl = cleanEnvironmentValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).replace(/\/+$/, "");
  const publishableKey = cleanEnvironmentValue(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  if (!supabaseUrl || !publishableKey) {
    throw new Error(missingConfigMessage);
  }

  return createSupabaseClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export type ManualMemberAccessState = {
  status: "idle" | "success" | "warning" | "error";
  message?: string;
  setupLink?: string;
  loginUrl?: string;
  activated?: boolean;
};

export type TemporaryPasswordAccessState = {
  status: "idle" | "success" | "warning" | "error";
  message?: string;
  temporaryPassword?: string;
  expiresAt?: string;
  loginUrl?: string;
  instructions?: string;
  emailSent?: boolean;
  activated?: boolean;
};

function isRetryableAuthAdminError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unrecognized jwt kid") ||
    normalized.includes("token is unverifiable") ||
    normalized.includes("invalid jwt")
  );
}

async function runAuthAdminWithRetry<
  T extends { error: { message: string } | null },
>(operation: () => Promise<T>, emptyResultMessage: string): Promise<T> {
  const maxAttempts = 4;
  let lastResult: T | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await operation();
    lastResult = result;

    if (!result.error || !isRetryableAuthAdminError(result.error.message)) {
      return result;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }

  if (!lastResult) throw new Error(emptyResultMessage);
  return lastResult;
}

function improveAuthAdminError(message: string): string {
  if (!isRetryableAuthAdminError(message)) return message;

  return (
    `${message}. ` +
    "Supabase Auth rejected the new sb_secret_ key. Add the legacy service_role key to SUPABASE_LEGACY_SERVICE_ROLE_KEY and restart the application."
  );
}

function fallbackFullName(email: string): string {
  const localPart = email.split("@")[0] ?? "Collaborateur";
  const normalized = localPart.replace(/[._-]+/g, " ").trim();

  if (!normalized) return "Collaborateur";

  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  t: Translator,
): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const perPage = 200;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await runAuthAdminWithRetry(
      () => admin.auth.admin.listUsers({ page, perPage }),
      t("members.actionMessages.emptyAuthResult"),
    );

    if (error) {
      throw new Error(
        t("members.actionMessages.searchImpossible", {
          message: improveAuthAdminError(error.message),
        }),
      );
    }

    const match = data.users.find(
      (candidate) =>
        candidate.email?.trim().toLowerCase() === normalizedEmail,
    );

    if (match) return match;
    if (data.users.length < perPage) return null;
  }

  throw new Error(t("members.actionMessages.searchLimit"));
}

async function generatePasswordSetupLink(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  t: Translator,
): Promise<string> {
  const redirectTo = `${getSiteUrl()}/update-password`;

  const { data, error } = await runAuthAdminWithRetry(
    () =>
      admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      }),
    t("members.actionMessages.emptyAuthResult"),
  );

  if (error) {
    throw new Error(
      t("members.actionMessages.linkImpossible", {
        message: improveAuthAdminError(error.message),
      }),
    );
  }

  const actionLink = data.properties?.action_link;
  if (!actionLink) throw new Error(t("members.actionMessages.noAccessLink"));
  return actionLink;
}

export async function activateInvitationManuallyAction(
  _previousState: ManualMemberAccessState,
  formData: FormData,
): Promise<ManualMemberAccessState> {
  const { membership, t } = await requirePeopleAdmin();
  const invitationId = String(formData.get("invitationId") ?? "").trim();
  const requestedFullName = String(formData.get("fullName") ?? "").trim();

  if (!invitationId) {
    return {
      status: "error",
      message: t("members.actionMessages.invalidInvitation"),
    };
  }

  const admin = createAdminClient();
  const { data: invitation, error: invitationError } = await admin
    .from("organization_invitations")
    .select("id,organization_id,email,role,status")
    .eq("id", invitationId)
    .eq("organization_id", membership.organization_id)
    .in("status", ["pending", "expired", "accepted"])
    .maybeSingle();

  if (invitationError) {
    return {
      status: "error",
      message: t("members.actionMessages.loadImpossible", {
        message: invitationError.message,
      }),
    };
  }

  if (!invitation) {
    return {
      status: "error",
      message: t("members.actionMessages.invitationUnavailable"),
    };
  }

  const email = invitation.email.trim().toLowerCase();
  const fullName = requestedFullName || fallbackFullName(email);
  let authUser: User | null = null;
  let activated = invitation.status === "accepted";

  try {
    authUser = await findAuthUserByEmail(admin, email, t);

    if (!authUser) {
      const temporaryPassword = randomBytes(32).toString("base64url");
      const { data: createData, error: createError } =
        await runAuthAdminWithRetry(
          () =>
            admin.auth.admin.createUser({
              email,
              password: temporaryPassword,
              email_confirm: true,
              user_metadata: { full_name: fullName },
            }),
          t("members.actionMessages.emptyAuthResult"),
        );

      if (createError || !createData.user) {
        throw new Error(
          t("members.actionMessages.createAccountImpossible", {
            message: createError
              ? improveAuthAdminError(createError.message)
              : t("members.actionMessages.noReturnedUser"),
          }),
        );
      }

      authUser = createData.user;
    } else {
      const existingUserId = authUser.id;
      const currentMetadata = authUser.user_metadata ?? {};
      const { data: updateData, error: updateError } =
        await runAuthAdminWithRetry(
          () =>
            admin.auth.admin.updateUserById(existingUserId, {
              email_confirm: true,
              user_metadata: {
                ...currentMetadata,
                full_name:
                  requestedFullName ||
                  String(currentMetadata.full_name ?? "").trim() ||
                  fullName,
              },
            }),
          t("members.actionMessages.emptyAuthResult"),
        );

      if (updateError) {
        throw new Error(
          t("members.actionMessages.updateAccountImpossible", {
            message: improveAuthAdminError(updateError.message),
          }),
        );
      }

      if (!updateData.user) {
        throw new Error(t("members.actionMessages.noUserAfterUpdate"));
      }

      authUser = updateData.user;
    }

    const effectiveFullName =
      String(authUser.user_metadata?.full_name ?? "").trim() || fullName;
    const now = new Date().toISOString();

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: authUser.id,
        full_name: effectiveFullName,
        email,
        updated_at: now,
      },
      { onConflict: "id" },
    );

    if (profileError) {
      throw new Error(
        t("members.actionMessages.profileImpossible", {
          message: profileError.message,
        }),
      );
    }

    const { error: membershipError } = await admin
      .from("organization_members")
      .upsert(
        {
          organization_id: invitation.organization_id,
          user_id: authUser.id,
          role: invitation.role,
          is_active: true,
          disabled_at: null,
          updated_at: now,
        },
        { onConflict: "organization_id,user_id" },
      );

    if (membershipError) {
      throw new Error(
        t("members.actionMessages.organisationActivationImpossible", {
          message: membershipError.message,
        }),
      );
    }

    activated = true;

    const { error: invitationUpdateError } = await admin
      .from("organization_invitations")
      .update({ status: "accepted" })
      .eq("id", invitation.id)
      .eq("organization_id", membership.organization_id);

    if (invitationUpdateError) {
      throw new Error(
        t("members.actionMessages.closeInvitationImpossible", {
          message: invitationUpdateError.message,
        }),
      );
    }

    const setupLink = await generatePasswordSetupLink(admin, email, t);
    const loginUrl = `${getSiteUrl()}/login`;

    revalidatePath("/dashboard/members");
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/recognition");
    revalidatePath("/dashboard/feedback");
    revalidatePath("/dashboard/actions");

    return {
      status: "success",
      activated,
      message:
        invitation.status === "accepted"
          ? t("members.actionMessages.newAccessLink", { email })
          : t("members.actionMessages.nowActive", { email }),
      setupLink,
      loginUrl,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : t("members.actionMessages.unknownActivationError");

    if (activated && authUser) {
      return {
        status: "warning",
        activated: true,
        message: t("members.actionMessages.activeButLinkFailed", { message }),
        loginUrl: `${getSiteUrl()}/login`,
      };
    }

    return { status: "error", activated: false, message };
  }
}


function temporaryPasswordExpiryHours(): number {
  const parsed = Number.parseInt(
    cleanEnvironmentValue(process.env.TEMPORARY_PASSWORD_EXPIRY_HOURS),
    10,
  );

  if (!Number.isFinite(parsed)) return 48;
  return Math.min(168, Math.max(1, parsed));
}

function generateTemporaryPassword(): string {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%*-_";
  const all = `${uppercase}${lowercase}${digits}${symbols}`;
  const characters = [
    uppercase[randomInt(uppercase.length)],
    lowercase[randomInt(lowercase.length)],
    digits[randomInt(digits.length)],
    symbols[randomInt(symbols.length)],
  ];

  while (characters.length < 14) {
    characters.push(all[randomInt(all.length)]);
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex],
      characters[index],
    ];
  }

  return `SL-${characters.join("")}`;
}

function accessInstructions(input: {
  locale: "fr" | "en";
  fullName: string;
  email: string;
  password: string;
  loginUrl: string;
  expiresAt: string;
}): string {
  const expiry = new Intl.DateTimeFormat(
    input.locale === "fr" ? "fr-FR" : "en-GB",
    { dateStyle: "long", timeStyle: "short" },
  ).format(new Date(input.expiresAt));

  if (input.locale === "en") {
    return [
      `Hello ${input.fullName},`,
      "Your Super Leader account is ready.",
      `Login: ${input.loginUrl}`,
      `Email: ${input.email}`,
      `Temporary password: ${input.password}`,
      `Expiry: ${expiry}`,
      "You must create your own password immediately after your first sign-in.",
    ].join("\n\n");
  }

  return [
    `Bonjour ${input.fullName},`,
    "Votre compte Super Leader est prêt.",
    `Connexion : ${input.loginUrl}`,
    `Email : ${input.email}`,
    `Mot de passe temporaire : ${input.password}`,
    `Expiration : ${expiry}`,
    "Vous devrez créer votre propre mot de passe immédiatement après votre première connexion.",
  ].join("\n\n");
}

export async function activateInvitationWithTemporaryPasswordAction(
  _previousState: TemporaryPasswordAccessState,
  formData: FormData,
): Promise<TemporaryPasswordAccessState> {
  const { user, membership, t } = await requirePeopleAdmin();
  const invitationId = String(formData.get("invitationId") ?? "").trim();
  const requestedFullName = String(formData.get("fullName") ?? "").trim();
  const locale = formData.get("locale") === "en" ? "en" : "fr";
  const shouldSendEmail = formData.get("sendEmail") === "on";

  if (!invitationId) {
    return {
      status: "error",
      message: t("members.actionMessages.invalidInvitation"),
    };
  }

  const admin = createAdminClient();
  const { data: invitation, error: invitationError } = await admin
    .from("organization_invitations")
    .select("id,organization_id,email,role,status")
    .eq("id", invitationId)
    .eq("organization_id", membership.organization_id)
    .in("status", ["pending", "expired", "accepted"])
    .maybeSingle();

  if (invitationError) {
    return {
      status: "error",
      message: t("members.actionMessages.loadImpossible", {
        message: invitationError.message,
      }),
    };
  }

  if (!invitation) {
    return {
      status: "error",
      message: t("members.actionMessages.invitationUnavailable"),
    };
  }

  const email = invitation.email.trim().toLowerCase();
  const fullName = requestedFullName || fallbackFullName(email);
  const temporaryPassword = generateTemporaryPassword();
  const issuedAt = new Date();
  const expiresAt = new Date(
    issuedAt.getTime() + temporaryPasswordExpiryHours() * 60 * 60 * 1000,
  ).toISOString();
  const loginUrl = `${getSiteUrl()}/login`;
  let authUser: User | null = null;
  let activated = invitation.status === "accepted";
  let existingAccount = false;

  try {
    authUser = await findAuthUserByEmail(admin, email, t);
    existingAccount = Boolean(authUser);

    if (!authUser) {
      const { data: createData, error: createError } =
        await runAuthAdminWithRetry(
          () =>
            admin.auth.admin.createUser({
              email,
              password: temporaryPassword,
              email_confirm: true,
              user_metadata: {
                full_name: fullName,
                must_change_password: true,
                temporary_password_expires_at: expiresAt,
              },
            }),
          t("members.actionMessages.emptyAuthResult"),
        );

      if (createError || !createData.user) {
        throw new Error(
          t("members.actionMessages.createAccountImpossible", {
            message: createError
              ? improveAuthAdminError(createError.message)
              : t("members.actionMessages.noReturnedUser"),
          }),
        );
      }

      authUser = createData.user;
    } else {
      const currentMetadata = authUser.user_metadata ?? {};
      const { data: updateData, error: updateError } =
        await runAuthAdminWithRetry(
          () =>
            admin.auth.admin.updateUserById(authUser!.id, {
              password: temporaryPassword,
              email_confirm: true,
              user_metadata: {
                ...currentMetadata,
                full_name:
                  requestedFullName ||
                  String(currentMetadata.full_name ?? "").trim() ||
                  fullName,
                must_change_password: true,
                temporary_password_expires_at: expiresAt,
              },
            }),
          t("members.actionMessages.emptyAuthResult"),
        );

      if (updateError || !updateData.user) {
        throw new Error(
          t("members.actionMessages.updateAccountImpossible", {
            message: updateError
              ? improveAuthAdminError(updateError.message)
              : t("members.actionMessages.noUserAfterUpdate"),
          }),
        );
      }

      authUser = updateData.user;
    }

    const effectiveFullName =
      String(authUser.user_metadata?.full_name ?? "").trim() || fullName;
    const now = issuedAt.toISOString();

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: authUser.id,
        full_name: effectiveFullName,
        email,
        must_change_password: true,
        temporary_password_issued_at: now,
        temporary_password_expires_at: expiresAt,
        temporary_password_issued_by: user.id,
        password_changed_at: null,
        updated_at: now,
      },
      { onConflict: "id" },
    );

    if (profileError) {
      throw new Error(
        t("members.actionMessages.profileImpossible", {
          message: profileError.message,
        }),
      );
    }

    const { error: membershipError } = await admin
      .from("organization_members")
      .upsert(
        {
          organization_id: invitation.organization_id,
          user_id: authUser.id,
          role: invitation.role,
          is_active: true,
          disabled_at: null,
          updated_at: now,
        },
        { onConflict: "organization_id,user_id" },
      );

    if (membershipError) {
      throw new Error(
        t("members.actionMessages.organisationActivationImpossible", {
          message: membershipError.message,
        }),
      );
    }

    activated = true;

    const { error: invitationUpdateError } = await admin
      .from("organization_invitations")
      .update({ status: "accepted" })
      .eq("id", invitation.id)
      .eq("organization_id", membership.organization_id);

    if (invitationUpdateError) {
      throw new Error(
        t("members.actionMessages.closeInvitationImpossible", {
          message: invitationUpdateError.message,
        }),
      );
    }

    await admin.from("temporary_access_audit_log").insert({
      organization_id: invitation.organization_id,
      user_id: authUser.id,
      invitation_id: invitation.id,
      event_type: existingAccount ? "regenerated" : "issued",
      actor_user_id: user.id,
      metadata: {
        expires_at: expiresAt,
        email_requested: shouldSendEmail,
      },
    });

    let emailSent = false;
    let emailWarning = "";

    if (shouldSendEmail) {
      const { data: organization } = await admin
        .from("organizations")
        .select("name")
        .eq("id", invitation.organization_id)
        .maybeSingle();
      const emailResult = await sendTemporaryAccessEmail({
        to: email,
        fullName: effectiveFullName,
        temporaryPassword,
        expiresAt,
        locale,
        organizationName: organization?.name ?? "Super Leader",
      });
      emailSent = emailResult.sent;
      emailWarning = emailResult.error ?? "";

      await admin.from("temporary_access_audit_log").insert({
        organization_id: invitation.organization_id,
        user_id: authUser.id,
        invitation_id: invitation.id,
        event_type: emailResult.sent ? "email_sent" : "email_failed",
        actor_user_id: user.id,
        metadata: {
          provider_message_id: emailResult.providerMessageId ?? null,
          configuration_missing: emailResult.configurationMissing ?? false,
          error: emailResult.error ?? null,
        },
      });
    }

    const instructions = accessInstructions({
      locale,
      fullName: effectiveFullName,
      email,
      password: temporaryPassword,
      loginUrl,
      expiresAt,
    });

    revalidatePath("/dashboard/members");
    revalidatePath("/dashboard");

    return {
      status: shouldSendEmail && !emailSent ? "warning" : "success",
      activated,
      temporaryPassword,
      expiresAt,
      loginUrl,
      instructions,
      emailSent,
      message:
        shouldSendEmail && !emailSent
          ? t("members.actionMessages.temporaryCreatedEmailFailed", {
              message: emailWarning || t("common.unknownError"),
            })
          : shouldSendEmail
            ? t("members.actionMessages.temporaryCreatedAndSent", { email })
            : t("members.actionMessages.temporaryCreated", { email }),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : t("members.actionMessages.unknownActivationError");

    if (activated && authUser) {
      return {
        status: "warning",
        activated: true,
        message: t("members.actionMessages.activeButTemporaryFailed", {
          message,
        }),
        loginUrl,
      };
    }

    return { status: "error", activated: false, message };
  }
}

export async function resendInvitationAction(formData: FormData) {
  const { membership, t } = await requirePeopleAdmin();
  const invitationId = String(formData.get("invitationId") ?? "").trim();

  if (!invitationId) {
    go(t("members.actionMessages.invalidInvitation"), "error");
  }

  const admin = createAdminClient();
  const { data: invitation, error: invitationError } = await admin
    .from("organization_invitations")
    .select("id,organization_id,email,role,status,token,expires_at")
    .eq("id", invitationId)
    .eq("organization_id", membership.organization_id)
    .in("status", ["pending", "expired"])
    .maybeSingle();

  if (invitationError) {
    go(
      t("members.actionMessages.loadImpossible", {
        message: invitationError.message,
      }),
      "error",
    );
  }

  if (!invitation) {
    go(t("members.actionMessages.invitationNotResendable"), "error");
  }

  const previousToken = invitation.token;
  const previousExpiresAt = invitation.expires_at;
  const previousStatus = invitation.status;
  const newToken = randomUUID();
  const newExpiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error: updateError } = await admin
    .from("organization_invitations")
    .update({
      token: newToken,
      status: "pending",
      expires_at: newExpiresAt,
    })
    .eq("id", invitation.id)
    .eq("organization_id", membership.organization_id);

  if (updateError) {
    go(
      t("members.actionMessages.renewalImpossible", {
        message: updateError.message,
      }),
      "error",
    );
  }

  const nextPath = `/accept-invite?token=${encodeURIComponent(newToken)}`;
  const redirectTo = `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(nextPath)}`;

  try {
    const publicAuth = createPublicAuthClient(
      t("members.actionMessages.publicConfigMissing"),
    );
    const { error: emailError } = await publicAuth.auth.signInWithOtp({
      email: invitation.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    });

    if (emailError) throw emailError;
  } catch (error) {
    await admin
      .from("organization_invitations")
      .update({
        token: previousToken,
        status: previousStatus,
        expires_at: previousExpiresAt,
      })
      .eq("id", invitation.id)
      .eq("organization_id", membership.organization_id);

    const message =
      error instanceof Error ? error.message : t("common.unknownError");
    go(t("members.actionMessages.resendFailed", { message }), "error");
  }

  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/company");
  go(t("members.actionMessages.resent", { email: invitation.email }));
}
