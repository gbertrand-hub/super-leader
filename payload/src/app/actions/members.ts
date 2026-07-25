"use server";

import { randomBytes, randomUUID } from "crypto";
import {
  createClient as createSupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Role = "owner" | "admin" | "hr" | "manager" | "employee";
const editableRoles: Role[] = ["admin", "hr", "manager", "employee"];

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/members?${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
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
  return { user: authData.user, membership };
}

async function requirePeopleAdmin() {
  const context = await getContext();
  if (!["owner", "admin", "hr"].includes(context.membership.role)) {
    go("Tu n’as pas la permission de gérer les membres.", "error");
  }
  return context;
}

async function requireTeamManager() {
  const context = await getContext();
  if (!["owner", "admin", "hr", "manager"].includes(context.membership.role)) {
    go("Tu n’as pas la permission de gérer les affectations.", "error");
  }
  return context;
}

export async function updateMemberRoleAction(formData: FormData) {
  const { membership } = await requirePeopleAdmin();
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;

  if (!memberId || !editableRoles.includes(role)) go("Rôle ou membre invalide.", "error");

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("organization_members")
    .select("id, organization_id, role")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  if (!target) go("Membre introuvable.", "error");
  if (target.role === "owner") go("Le rôle du propriétaire ne peut pas être modifié.", "error");

  const { error } = await admin
    .from("organization_members")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id);

  if (error) go(`Modification impossible : ${error.message}`, "error");
  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard");
  go("Rôle mis à jour.");
}

export async function toggleMemberStatusAction(formData: FormData) {
  const { user, membership } = await requirePeopleAdmin();
  const memberId = String(formData.get("memberId") ?? "");
  const activate = String(formData.get("activate") ?? "false") === "true";
  if (!memberId) go("Membre invalide.", "error");

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("organization_members")
    .select("id, user_id, organization_id, role")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  if (!target) go("Membre introuvable.", "error");
  if (target.role === "owner") go("Le propriétaire ne peut pas être désactivé.", "error");
  if (target.user_id === user.id && !activate) go("Tu ne peux pas désactiver ton propre compte.", "error");

  const { error } = await admin
    .from("organization_members")
    .update({
      is_active: activate,
      disabled_at: activate ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id);

  if (error) go(`Mise à jour impossible : ${error.message}`, "error");
  revalidatePath("/dashboard/members");
  go(activate ? "Membre réactivé." : "Membre désactivé.");
}

export async function assignMemberToTeamAction(formData: FormData) {
  const { user, membership } = await requireTeamManager();
  const userId = String(formData.get("userId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  if (!userId || !teamId) go("Sélectionne un membre et une équipe.", "error");

  const admin = createAdminClient();
  const [{ data: targetMember }, { data: team }] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", membership.organization_id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    admin
      .from("teams")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .eq("id", teamId)
      .maybeSingle(),
  ]);

  if (!targetMember || !team) go("Le membre ou l’équipe n’appartient pas à cette organisation.", "error");

  const { error } = await admin.from("team_members").upsert(
    {
      team_id: teamId,
      user_id: userId,
      assigned_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id,user_id" },
  );

  if (error) go(`Affectation impossible : ${error.message}`, "error");
  revalidatePath("/dashboard/members");
  go("Membre affecté à l’équipe.");
}

export async function removeMemberFromTeamAction(formData: FormData) {
  const { membership } = await requireTeamManager();
  const userId = String(formData.get("userId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  if (!userId || !teamId) go("Affectation invalide.", "error");

  const admin = createAdminClient();
  const { data: team } = await admin
    .from("teams")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("id", teamId)
    .maybeSingle();
  if (!team) go("Équipe introuvable.", "error");

  const { error } = await admin
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (error) go(`Retrait impossible : ${error.message}`, "error");
  revalidatePath("/dashboard/members");
  go("Membre retiré de l’équipe.");
}

export async function cancelInvitationAction(formData: FormData) {
  const { membership } = await requirePeopleAdmin();
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) go("Invitation invalide.", "error");

  const admin = createAdminClient();
  const { error } = await admin
    .from("organization_invitations")
    .update({ status: "cancelled" })
    .eq("id", invitationId)
    .eq("organization_id", membership.organization_id)
    .eq("status", "pending");

  if (error) go(`Annulation impossible : ${error.message}`, "error");
  revalidatePath("/dashboard/members");
  go("Invitation annulée.");
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

function createPublicAuthClient() {
  const supabaseUrl = cleanEnvironmentValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).replace(/\/+$/, "");
  const publishableKey = cleanEnvironmentValue(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  if (!supabaseUrl || !publishableKey) {
    throw new Error("Configuration Supabase publique manquante.");
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
>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 4;
  let lastResult: T | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await operation();
    lastResult = result;

    if (!result.error || !isRetryableAuthAdminError(result.error.message)) {
      return result;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, 250 * attempt),
      );
    }
  }

  if (!lastResult) {
    throw new Error("La requête Supabase Auth n’a retourné aucun résultat.");
  }

  return lastResult;
}

function improveAuthAdminError(message: string): string {
  if (!isRetryableAuthAdminError(message)) return message;

  return (
    `${message}. ` +
    "Supabase Auth a rejeté temporairement la nouvelle clé sb_secret_. " +
    "Ajoute la clé legacy service_role dans SUPABASE_LEGACY_SERVICE_ROLE_KEY, puis redémarre l’application."
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
): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const perPage = 200;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await runAuthAdminWithRetry(() =>
      admin.auth.admin.listUsers({ page, perPage }),
    );

    if (error) {
      throw new Error(
        `Impossible de rechercher le compte : ${improveAuthAdminError(error.message)}`,
      );
    }

    const match = data.users.find(
      (candidate) => candidate.email?.trim().toLowerCase() === normalizedEmail,
    );

    if (match) return match;
    if (data.users.length < perPage) return null;
  }

  throw new Error(
    "La recherche du compte a dépassé la limite prévue. Contacte l’administrateur technique.",
  );
}

async function generatePasswordSetupLink(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string> {
  const redirectTo = `${getSiteUrl()}/update-password`;

  const { data, error } = await runAuthAdminWithRetry(() =>
    admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    }),
  );

  if (error) {
    throw new Error(
      `Impossible de générer le lien d’accès : ${improveAuthAdminError(error.message)}`,
    );
  }

  const actionLink = data.properties?.action_link;
  if (!actionLink) {
    throw new Error("Supabase n’a retourné aucun lien d’accès.");
  }

  return actionLink;
}

export async function activateInvitationManuallyAction(
  _previousState: ManualMemberAccessState,
  formData: FormData,
): Promise<ManualMemberAccessState> {
  const { membership } = await requirePeopleAdmin();
  const invitationId = String(formData.get("invitationId") ?? "").trim();
  const requestedFullName = String(formData.get("fullName") ?? "").trim();

  if (!invitationId) {
    return { status: "error", message: "Invitation invalide." };
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
      message: `Chargement impossible : ${invitationError.message}`,
    };
  }

  if (!invitation) {
    return {
      status: "error",
      message: "Cette invitation est introuvable ou a été annulée.",
    };
  }

  const email = invitation.email.trim().toLowerCase();
  const fullName = requestedFullName || fallbackFullName(email);
  let authUser: User | null = null;
  let activated = invitation.status === "accepted";

  try {
    authUser = await findAuthUserByEmail(admin, email);

    if (!authUser) {
      const temporaryPassword = randomBytes(32).toString("base64url");
      const { data: createData, error: createError } =
        await runAuthAdminWithRetry(() =>
          admin.auth.admin.createUser({
            email,
            password: temporaryPassword,
            email_confirm: true,
            user_metadata: { full_name: fullName },
          }),
        );

      if (createError || !createData.user) {
        throw new Error(
          `Création du compte impossible : ${
            createError
              ? improveAuthAdminError(createError.message)
              : "utilisateur non retourné"
          }`,
        );
      }

      authUser = createData.user;
    } else {
      const existingUserId = authUser.id;
      const currentMetadata = authUser.user_metadata ?? {};
      const { data: updateData, error: updateError } =
        await runAuthAdminWithRetry(() =>
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
        );

      if (updateError) {
        throw new Error(
          `Mise à jour du compte impossible : ${improveAuthAdminError(updateError.message)}`,
        );
      }

      if (!updateData.user) {
        throw new Error("Supabase n’a retourné aucun utilisateur après la mise à jour.");
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
      throw new Error(`Profil impossible à enregistrer : ${profileError.message}`);
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
        `Activation dans l’organisation impossible : ${membershipError.message}`,
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
        `Impossible de clôturer l’invitation : ${invitationUpdateError.message}`,
      );
    }

    const setupLink = await generatePasswordSetupLink(admin, email);
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
          ? `Un nouveau lien d’accès a été généré pour ${email}.`
          : `${email} est maintenant un collaborateur actif.`,
      setupLink,
      loginUrl,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue lors de l’activation.";

    if (activated && authUser) {
      return {
        status: "warning",
        activated: true,
        message: `Le collaborateur est actif, mais le lien n’a pas pu être généré : ${message}`,
        loginUrl: `${getSiteUrl()}/login`,
      };
    }

    return { status: "error", activated: false, message };
  }
}

export async function resendInvitationAction(formData: FormData) {
  const { membership } = await requirePeopleAdmin();
  const invitationId = String(formData.get("invitationId") ?? "").trim();

  if (!invitationId) {
    go("Invitation invalide.", "error");
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
    go(`Chargement impossible : ${invitationError.message}`, "error");
  }

  if (!invitation) {
    go("Cette invitation est introuvable, annulée ou déjà acceptée.", "error");
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
    go(`Impossible de renouveler l’invitation : ${updateError.message}`, "error");
  }

  const nextPath = `/accept-invite?token=${encodeURIComponent(newToken)}`;
  const redirectTo = `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(nextPath)}`;

  try {
    const publicAuth = createPublicAuthClient();
    const { error: emailError } = await publicAuth.auth.signInWithOtp({
      email: invitation.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    });

    if (emailError) {
      throw emailError;
    }
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

    const message = error instanceof Error ? error.message : "Erreur inconnue";
    go(`Le nouveau lien n’a pas pu être envoyé : ${message}`, "error");
  }

  revalidatePath("/dashboard/members");
  revalidatePath("/dashboard/company");
  go(`Nouveau lien envoyé à ${invitation.email}.`);
}
