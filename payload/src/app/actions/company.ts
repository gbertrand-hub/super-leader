"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

  const productionDomain = cleanUrl(
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  );
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
    throw new Error(
      "Tu n’as pas l’autorisation d’inviter des collaborateurs.",
    );
  }
}

export async function createOrganizationAction(
  _state: CompanyState,
  formData: FormData,
): Promise<CompanyState> {
  const name = String(formData.get("name") ?? "").trim();
  const sector = String(formData.get("sector") ?? "").trim();

  if (name.length < 2) {
    return { error: "Le nom de l’entreprise est obligatoire." };
  }

  const { supabase } = await currentUser();
  const { error } = await supabase.rpc("create_organization_with_owner", {
    organization_name: name,
    organization_sector: sector || null,
  });

  if (error) return { error: `Création impossible : ${error.message}` };

  revalidatePath("/dashboard");
  redirect("/dashboard/company");
}

export async function createTeamAction(
  _state: CompanyState,
  formData: FormData,
): Promise<CompanyState> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const department = String(formData.get("department") ?? "").trim();

  if (!organizationId || name.length < 2) {
    return { error: "Nom d’équipe obligatoire." };
  }

  const { supabase, user } = await currentUser();
  const { error } = await supabase.from("teams").insert({
    organization_id: organizationId,
    name,
    department: department || null,
    created_by: user.id,
  });

  if (error) return { error: `Création impossible : ${error.message}` };

  revalidatePath("/dashboard/team");
  return { success: "Équipe créée." };
}

export async function inviteMemberAction(
  _state: CompanyState,
  formData: FormData,
): Promise<CompanyState> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "employee");
  const allowedRoles = ["admin", "hr", "manager", "employee"];

  if (!organizationId || !email.includes("@")) {
    return { error: "Adresse email invalide." };
  }

  if (!allowedRoles.includes(role)) {
    return { error: "Rôle invalide." };
  }

  const { user } = await currentUser();

  try {
    await assertCanManagePeople(organizationId, user.id);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Invitation non autorisée.",
    };
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
      error: `Invitation impossible : ${invitationError.message}`,
    };
  }

  const destination = siteUrl();
  const nextPath = `/accept-invite?token=${encodeURIComponent(token)}`;
  const redirectTo = `${destination}/auth/callback?next=${encodeURIComponent(nextPath)}`;

  const { error: mailError } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo,
      data: {
        invited_organization_id: organizationId,
        invited_role: role,
      },
    },
  );

  if (mailError) {
    await admin.from("organization_invitations").delete().eq("token", token);
    return { error: `Email non envoyé : ${mailError.message}` };
  }

  revalidatePath("/dashboard/company");
  revalidatePath("/dashboard/members");

  return {
    success: `Invitation envoyée à ${email} via ${destination}.`,
  };
}

export async function acceptInvitationAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/dashboard?error=invitation");

  const { supabase } = await currentUser();
  const { error } = await supabase.rpc(
    "accept_organization_invitation",
    {
      invitation_token: token,
    },
  );

  if (error) {
    redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/company");
}
