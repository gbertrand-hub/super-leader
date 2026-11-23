"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/executive?${kind}=${encodeURIComponent(message)}`);
}

async function requireAssignmentAdministrator() {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();

  if (membershipError || !membership) redirect("/dashboard/company");
  if (!["owner", "admin", "hr"].includes(membership.role)) {
    go("Tu n’as pas l’autorisation de modifier la supervision exécutive.", "error");
  }

  return {user: authData.user, membership, admin};
}

async function activeRoleExists({
  organizationId,
  userId,
  role,
  admin,
}: {
  organizationId: string;
  userId: string;
  role: "executive" | "manager";
  admin: ReturnType<typeof createAdminClient>;
}) {
  const {data, error} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("role", role)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function assignManagerToExecutiveAction(formData: FormData) {
  const executiveUserId = String(formData.get("executiveUserId") ?? "").trim();
  const managerUserId = String(formData.get("managerUserId") ?? "").trim();
  if (!executiveUserId || !managerUserId || executiveUserId === managerUserId) {
    go("Sélectionne un Exécutif et un Manager valides.", "error");
  }

  const {user, membership, admin} = await requireAssignmentAdministrator();
  const organizationId = membership.organization_id;

  const [executiveValid, managerValid] = await Promise.all([
    activeRoleExists({organizationId, userId: executiveUserId, role: "executive", admin}),
    activeRoleExists({organizationId, userId: managerUserId, role: "manager", admin}),
  ]);

  if (!executiveValid || !managerValid) {
    go("L’Exécutif ou le Manager sélectionné n’est pas actif dans cette organisation.", "error");
  }

  const {data: previous, error: previousError} = await admin
    .from("executive_manager_assignments")
    .select("id, executive_user_id")
    .eq("organization_id", organizationId)
    .eq("manager_user_id", managerUserId)
    .maybeSingle<{id: string; executive_user_id: string}>();
  if (previousError && !["PGRST116"].includes(String(previousError.code ?? ""))) {
    go(`Impossible de vérifier l’affectation actuelle : ${previousError.message}`, "error");
  }

  const {data: assignment, error} = await admin
    .from("executive_manager_assignments")
    .upsert(
      {
        organization_id: organizationId,
        executive_user_id: executiveUserId,
        manager_user_id: managerUserId,
        assigned_by: user.id,
        assigned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {onConflict: "organization_id,manager_user_id"},
    )
    .select("id")
    .single<{id: string}>();

  if (error || !assignment) {
    go(`Affectation impossible : ${error?.message ?? "erreur inconnue"}`, "error");
  }

  const action = previous && previous.executive_user_id !== executiveUserId
    ? "reassigned"
    : "assigned";

  const {error: auditError} = await admin.from("executive_supervision_audit_log").insert({
    organization_id: organizationId,
    assignment_id: assignment.id,
    executive_user_id: executiveUserId,
    manager_user_id: managerUserId,
    actor_id: user.id,
    action,
    details: {
      previous_executive_user_id: previous?.executive_user_id ?? null,
    },
  });
  if (auditError) console.error("Executive supervision audit failed", auditError);

  revalidatePath("/dashboard/executive");
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/members");
  go(action === "reassigned" ? "Le Manager a été réaffecté à l’Exécutif." : "Le Manager a été affecté à l’Exécutif.");
}

export async function removeManagerFromExecutiveAction(formData: FormData) {
  const assignmentId = String(formData.get("assignmentId") ?? "").trim();
  if (!assignmentId) go("Affectation invalide.", "error");

  const {user, membership, admin} = await requireAssignmentAdministrator();
  const organizationId = membership.organization_id;

  const {data: assignment, error: loadError} = await admin
    .from("executive_manager_assignments")
    .select("id, executive_user_id, manager_user_id")
    .eq("id", assignmentId)
    .eq("organization_id", organizationId)
    .maybeSingle<{id: string; executive_user_id: string; manager_user_id: string}>();

  if (loadError || !assignment) go("Cette affectation est introuvable.", "error");

  const {error} = await admin
    .from("executive_manager_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("organization_id", organizationId);
  if (error) go(`Suppression impossible : ${error.message}`, "error");

  const {error: auditError} = await admin.from("executive_supervision_audit_log").insert({
    organization_id: organizationId,
    assignment_id: null,
    executive_user_id: assignment.executive_user_id,
    manager_user_id: assignment.manager_user_id,
    actor_id: user.id,
    action: "removed",
    details: {assignment_id: assignment.id},
  });
  if (auditError) console.error("Executive supervision audit failed", auditError);

  revalidatePath("/dashboard/executive");
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/members");
  go("L’affectation du Manager a été retirée.");
}
