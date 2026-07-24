"use server";

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
