"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const ALLOWED_ROLES = new Set(["owner", "admin", "hr"]);

function integer(value: FormDataEntryValue | null, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function checked(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function go(message: string, kind: "success" | "error"): never {
  redirect(`/dashboard/hr/priority-rules?${kind}=${encodeURIComponent(message)}`);
}

export async function savePriorityRulesAction(formData: FormData) {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin.from("organization_members").select("organization_id,role").eq("user_id", authData.user.id).eq("is_active", true).limit(1).maybeSingle<{organization_id: string; role: string}>();
  if (!membership || !ALLOWED_ROLES.has(membership.role)) go("Accès refusé.", "error");

  const minimumTasks = integer(formData.get("minimumTasks"), 1, 12);
  const maximumTasks = integer(formData.get("maximumTasks"), 1, 12);
  const maximumCriticalTasks = integer(formData.get("maximumCriticalTasks"), 1, 12);
  const planLockTime = String(formData.get("planLockTime") ?? "").trim();
  const requiredFrom = String(formData.get("requiredFrom") ?? "").trim();
  if (minimumTasks === null || maximumTasks === null || maximumCriticalTasks === null || minimumTasks > maximumTasks || maximumCriticalTasks > maximumTasks) {
    go("Vérifie les limites : le minimum ne peut pas dépasser le maximum, et les priorités critiques doivent rester dans cette limite.", "error");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(planLockTime) || !/^\d{4}-\d{2}-\d{2}$/.test(requiredFrom)) go("L’heure de verrouillage ou la date d’application est invalide.", "error");

  const payload = {
    organization_id: membership.organization_id,
    enabled: checked(formData, "enabled"),
    minimum_tasks: minimumTasks,
    maximum_tasks: maximumTasks,
    maximum_critical_tasks: maximumCriticalTasks,
    plan_lock_time: planLockTime,
    required_from: requiredFrom,
    allow_plan_revision: checked(formData, "allowPlanRevision"),
    require_task_outcomes_for_report: checked(formData, "requireTaskOutcomesForReport"),
    require_due_time_for_high_priority: checked(formData, "requireDueTimeForHighPriority"),
    require_category_for_critical: checked(formData, "requireCategoryForCritical"),
  };
  const {error} = await admin.from("daily_execution_settings").upsert(payload, {onConflict: "organization_id"});
  if (error) go(`Enregistrement impossible : ${error.message}`, "error");
  await admin.from("performance_audit_log").insert({organization_id: membership.organization_id, actor_id: authData.user.id, entity_type: "daily_execution_settings", action: "advanced_priority_rules_updated", details: payload});
  revalidatePath("/dashboard/hr/priority-rules");
  revalidatePath("/dashboard/my-day");
  go("Règles avancées des priorités enregistrées.", "success");
}
