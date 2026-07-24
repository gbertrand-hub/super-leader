"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type CompanyState = { error?: string; success?: string };

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";
}

async function currentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { supabase, user: data.user };
}

export async function createOrganizationAction(
  _state: CompanyState,
  formData: FormData,
): Promise<CompanyState> {
  const name = String(formData.get("name") ?? "").trim();
  const sector = String(formData.get("sector") ?? "").trim();
  if (name.length < 2) return { error: "Le nom de l’entreprise est obligatoire." };

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
  if (!organizationId || name.length < 2) return { error: "Nom d’équipe obligatoire." };

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
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "employee");
  const allowedRoles = ["admin", "hr", "manager", "employee"];

  if (!organizationId || !email.includes("@")) return { error: "Adresse email invalide." };
  if (!allowedRoles.includes(role)) return { error: "Rôle invalide." };

  await currentUser();
  const admin = createAdminClient();
  const token = randomUUID();

  const { error: invitationError } = await admin.from("organization_invitations").insert({
    organization_id: organizationId,
    email,
    role,
    token,
  });
  if (invitationError) return { error: `Invitation impossible : ${invitationError.message}` };

  const redirectTo = `${siteUrl()}/auth/callback?next=/accept-invite?token=${encodeURIComponent(token)}`;
  const { error: mailError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { invited_organization_id: organizationId, invited_role: role },
  });

  if (mailError) {
    await admin.from("organization_invitations").delete().eq("token", token);
    return { error: `Email non envoyé : ${mailError.message}` };
  }

  revalidatePath("/dashboard/company");
  return { success: `Invitation envoyée à ${email}.` };
}

export async function acceptInvitationAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/dashboard?error=invitation");

  const { supabase } = await currentUser();
  const { error } = await supabase.rpc("accept_organization_invitation", {
    invitation_token: token,
  });
  if (error) redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/company");
}
