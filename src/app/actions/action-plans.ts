"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const priorities = ["low", "medium", "high"] as const;
const statuses = ["todo", "in_progress", "blocked", "completed", "cancelled"] as const;

type Priority = (typeof priorities)[number];
type Status = (typeof statuses)[number];

type Membership = {
  organization_id: string;
  role: string;
  is_active: boolean;
};

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/actions?${kind}=${encodeURIComponent(message)}`);
}

function isLeader(role: string) {
  return ["owner", "admin", "hr", "manager"].includes(role);
}

function normalizeDate(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : raw;
}

async function getContext() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (membershipError) {
    go(`Impossible de charger ton organisation : ${membershipError.message}`, "error");
  }

  if (!membership) redirect("/dashboard/company");

  return { user: authData.user, membership, admin };
}

async function ensureActiveMember(
  organizationId: string,
  userId: string,
  admin: ReturnType<typeof createAdminClient>,
) {
  const { data } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  return Boolean(data);
}

export async function createActionPlanAction(formData: FormData) {
  const { user, membership, admin } = await getContext();

  const objective = String(formData.get("objective") ?? "").trim();
  const actionTitle = String(formData.get("actionTitle") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priority = String(formData.get("priority") ?? "medium") as Priority;
  const requestedOwnerId = String(formData.get("ownerId") ?? user.id).trim();
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  const dueDate = normalizeDate(formData.get("dueDate"));

  if (objective.length < 3 || objective.length > 200) {
    go("L’objectif doit contenir entre 3 et 200 caractères.", "error");
  }

  if (actionTitle.length < 3 || actionTitle.length > 200) {
    go("L’action doit contenir entre 3 et 200 caractères.", "error");
  }

  if (description.length > 2000) {
    go("La description ne peut pas dépasser 2 000 caractères.", "error");
  }

  if (!priorities.includes(priority)) go("Priorité invalide.", "error");
  if (dueDateRaw && !dueDate) go("Date d’échéance invalide.", "error");

  const ownerId = isLeader(membership.role) ? requestedOwnerId || user.id : user.id;

  if (!(await ensureActiveMember(membership.organization_id, ownerId, admin))) {
    go("Le responsable choisi n’est pas un membre actif de l’organisation.", "error");
  }

  const { error } = await admin.from("action_plans").insert({
    organization_id: membership.organization_id,
    created_by: user.id,
    owner_id: ownerId,
    objective,
    action_title: actionTitle,
    description: description || null,
    priority,
    due_date: dueDate,
  });

  if (error) go(`Création impossible : ${error.message}`, "error");

  revalidatePath("/dashboard/actions");
  revalidatePath("/dashboard");
  go("Plan d’action créé avec succès.");
}

export async function updateActionPlanAction(formData: FormData) {
  const { user, membership, admin } = await getContext();

  const planId = String(formData.get("planId") ?? "").trim();
  const status = String(formData.get("status") ?? "todo") as Status;
  const progress = Number(formData.get("progress") ?? 0);
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  const dueDate = normalizeDate(formData.get("dueDate"));

  if (!planId) go("Plan d’action introuvable.", "error");
  if (!statuses.includes(status)) go("Statut invalide.", "error");
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    go("La progression doit être comprise entre 0 et 100.", "error");
  }
  if (dueDateRaw && !dueDate) go("Date d’échéance invalide.", "error");

  const { data: plan, error: planError } = await admin
    .from("action_plans")
    .select("id, organization_id, created_by, owner_id")
    .eq("id", planId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  if (planError || !plan) go("Plan d’action introuvable.", "error");

  const canEdit =
    isLeader(membership.role) || plan.owner_id === user.id || plan.created_by === user.id;

  if (!canEdit) go("Tu n’as pas la permission de modifier ce plan.", "error");

  const normalizedProgress = status === "completed" ? 100 : progress;
  const completedAt = status === "completed" ? new Date().toISOString() : null;

  const { error } = await admin
    .from("action_plans")
    .update({
      status,
      progress: normalizedProgress,
      due_date: dueDate,
      completed_at: completedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId)
    .eq("organization_id", membership.organization_id);

  if (error) go(`Mise à jour impossible : ${error.message}`, "error");

  revalidatePath("/dashboard/actions");
  revalidatePath("/dashboard");
  go("Plan d’action mis à jour.");
}
