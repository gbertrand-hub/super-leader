"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { getVisibleUserIds } from "@/lib/auth/scope";
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
  const { t } = await getI18n();
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
    go(
      t("actionPlans.actionMessages.organisationLoadImpossible", {
        message: membershipError.message,
      }),
      "error",
    );
  }

  if (!membership) redirect("/dashboard/company");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });

  return { user: authData.user, membership, admin, t, visibleUserIds };
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
  const { user, membership, admin, t, visibleUserIds } = await getContext();

  const objective = String(formData.get("objective") ?? "").trim();
  const actionTitle = String(formData.get("actionTitle") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priority = String(formData.get("priority") ?? "medium") as Priority;
  const requestedOwnerId = String(formData.get("ownerId") ?? user.id).trim();
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  const dueDate = normalizeDate(formData.get("dueDate"));

  if (objective.length < 3 || objective.length > 200) {
    go(t("actionPlans.actionMessages.objectiveLength"), "error");
  }

  if (actionTitle.length < 3 || actionTitle.length > 200) {
    go(t("actionPlans.actionMessages.actionLength"), "error");
  }

  if (description.length > 2000) {
    go(t("actionPlans.actionMessages.descriptionLength"), "error");
  }

  if (!priorities.includes(priority)) {
    go(t("actionPlans.actionMessages.invalidPriority"), "error");
  }
  if (dueDateRaw && !dueDate) {
    go(t("actionPlans.actionMessages.invalidDueDate"), "error");
  }

  const ownerId = isLeader(membership.role)
    ? requestedOwnerId || user.id
    : user.id;

  if (!(await ensureActiveMember(membership.organization_id, ownerId, admin))) {
    go(t("actionPlans.actionMessages.ownerNotActive"), "error");
  }
  if (!visibleUserIds.includes(ownerId)) {
    go(t("actionPlans.actionMessages.noEditPermission"), "error");
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

  if (error) {
    go(
      t("actionPlans.actionMessages.createImpossible", { message: error.message }),
      "error",
    );
  }

  revalidatePath("/dashboard/actions");
  revalidatePath("/dashboard");
  go(t("actionPlans.actionMessages.created"));
}

export async function updateActionPlanAction(formData: FormData) {
  const { user, membership, admin, t, visibleUserIds } = await getContext();

  const planId = String(formData.get("planId") ?? "").trim();
  const status = String(formData.get("status") ?? "todo") as Status;
  const progress = Number(formData.get("progress") ?? 0);
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  const dueDate = normalizeDate(formData.get("dueDate"));

  if (!planId) go(t("actionPlans.actionMessages.notFound"), "error");
  if (!statuses.includes(status)) {
    go(t("actionPlans.actionMessages.invalidStatus"), "error");
  }
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    go(t("actionPlans.actionMessages.invalidProgress"), "error");
  }
  if (dueDateRaw && !dueDate) {
    go(t("actionPlans.actionMessages.invalidDueDate"), "error");
  }

  const { data: plan, error: planError } = await admin
    .from("action_plans")
    .select("id, organization_id, created_by, owner_id")
    .eq("id", planId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  if (planError || !plan) {
    go(t("actionPlans.actionMessages.notFound"), "error");
  }

  const canEdit =
    membership.role === "owner" ||
    membership.role === "admin" ||
    membership.role === "hr" ||
    (membership.role === "manager"
      && (visibleUserIds.includes(plan.owner_id) || visibleUserIds.includes(plan.created_by))) ||
    plan.owner_id === user.id ||
    plan.created_by === user.id;

  if (!canEdit) {
    go(t("actionPlans.actionMessages.noEditPermission"), "error");
  }

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

  if (error) {
    go(
      t("actionPlans.actionMessages.updateImpossible", { message: error.message }),
      "error",
    );
  }

  revalidatePath("/dashboard/actions");
  revalidatePath("/dashboard");
  go(t("actionPlans.actionMessages.updated"));
}
