"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string; is_active: boolean};
type TaskRow = {
  id: string;
  assignee_id: string;
  assigned_by: string;
  work_date: string;
  title: string;
  status: string;
};
type PersonalPriorityRow = {
  id: string;
  plan_id: string;
  user_id: string;
  work_date: string;
  title: string;
  expected_outcome: string;
  priority: string;
  due_time: string | null;
  category: string | null;
  progress_status: string;
  manager_controlled: boolean;
  manager_revision_count: number;
  manager_removed_at: string | null;
};

const leaderRoles = new Set(["owner", "admin", "executive", "hr", "manager"]);
const priorities = new Set(["low", "normal", "high", "critical"]);
const statuses = new Set(["todo", "in_progress", "completed", "blocked", "deferred", "cancelled"]);

function value(input: FormDataEntryValue | null) {
  return String(input ?? "").trim();
}

function clean(input: FormDataEntryValue | null, max: number) {
  return value(input).slice(0, max);
}

function validDate(input: FormDataEntryValue | null) {
  const raw = value(input);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function validTime(input: FormDataEntryValue | null) {
  const raw = value(input);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
}

function safeReturnTo(input: FormDataEntryValue | null, fallback = "/dashboard/team-tasks") {
  const raw = value(input);
  return raw.startsWith("/dashboard/") ? raw : fallback;
}

function redirectMessage(returnTo: string, message: string, kind: "success" | "error" = "success"): never {
  const url = new URL(returnTo, "http://super-leader.local");
  url.searchParams.set(kind, message);
  redirect(`${url.pathname}?${url.searchParams.toString()}${url.hash || ""}`);
}

async function context(requireLeader = false) {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id,role,is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (membershipError || !membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "performance");
  if (requireLeader && !leaderRoles.has(membership.role)) redirect("/dashboard/my-day");
  return {user: authData.user, membership, admin};
}

async function audit(admin: ReturnType<typeof createAdminClient>, input: {
  organizationId: string;
  actorId: string;
  subjectUserId: string;
  entityId: string;
  action: string;
  details?: Record<string, unknown>;
}) {
  const {error} = await admin.from("performance_audit_log").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    subject_user_id: input.subjectUserId,
    entity_type: "team_delegated_task",
    entity_id: input.entityId,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Team task audit failed", error.message);
}

async function assertInScope(admin: ReturnType<typeof createAdminClient>, membership: Membership, actorId: string, targetUserId: string) {
  const visible = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId,
    role: membership.role,
  });
  return visible.includes(targetUserId);
}

function revalidatePriorityViews() {
  revalidatePath("/dashboard/team-tasks");
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/hr/daily-priorities");
  revalidatePath("/dashboard/performance");
}

async function loadEditablePersonalPriority(admin: ReturnType<typeof createAdminClient>, membership: Membership, actorId: string, taskId: string, returnTo: string) {
  const {data: task, error} = await admin.from("daily_work_tasks")
    .select("id,plan_id,user_id,work_date,title,expected_outcome,priority,due_time,category,progress_status,manager_controlled,manager_revision_count,manager_removed_at")
    .eq("organization_id", membership.organization_id)
    .eq("id", taskId)
    .maybeSingle<PersonalPriorityRow>();
  if (error || !task) redirectMessage(returnTo, "Priorité introuvable.", "error");
  if (!(await assertInScope(admin, membership, actorId, task.user_id))) {
    redirectMessage(returnTo, "Cette priorité est hors de ton périmètre de supervision.", "error");
  }
  if (["completed", "cancelled"].includes(task.progress_status) || task.manager_removed_at) {
    redirectMessage(returnTo, "Cette priorité est déjà terminée ou retirée et ne peut plus être modifiée.", "error");
  }
  const [{data: report}, {data: attendance}] = await Promise.all([
    admin.from("daily_reports").select("id").eq("organization_id", membership.organization_id).eq("user_id", task.user_id).eq("report_date", task.work_date).maybeSingle<{id: string}>(),
    admin.from("attendance_records").select("clock_out_at").eq("organization_id", membership.organization_id).eq("user_id", task.user_id).eq("work_date", task.work_date).maybeSingle<{clock_out_at: string | null}>(),
  ]);
  if (report?.id || attendance?.clock_out_at) {
    redirectMessage(returnTo, "La journée ou le rapport est déjà clôturé. Cette priorité ne peut plus être modifiée.", "error");
  }
  return task;
}

export async function assignTeamTaskAction(formData: FormData) {
  const {user, membership, admin} = await context(true);
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const assigneeId = value(formData.get("assigneeId"));
  const workDate = validDate(formData.get("workDate"));
  const title = clean(formData.get("title"), 240);
  const expectedOutcome = clean(formData.get("expectedOutcome"), 1200);
  const instructions = clean(formData.get("instructions"), 3000);
  const priorityRaw = value(formData.get("priority"));
  const priority = priorities.has(priorityRaw) ? priorityRaw : "normal";
  const dueTime = validTime(formData.get("dueTime"));

  if (!assigneeId || !workDate || title.length < 3 || expectedOutcome.length < 3) {
    redirectMessage(returnTo, "Renseigne le collaborateur, la date, la tâche et le résultat attendu.", "error");
  }
  if (!(await assertInScope(admin, membership, user.id, assigneeId))) {
    redirectMessage(returnTo, "Ce collaborateur ne fait pas partie de ton périmètre de supervision.", "error");
  }

  const sourceType = membership.role === "hr" ? "hr" : membership.role === "executive" ? "executive" : ["owner", "admin"].includes(membership.role) ? "admin" : "manager";
  const {data: task, error} = await admin.from("team_delegated_tasks").insert({
    organization_id: membership.organization_id,
    assignee_id: assigneeId,
    assigned_by: user.id,
    work_date: workDate,
    title,
    expected_outcome: expectedOutcome,
    instructions: instructions || null,
    priority,
    due_time: dueTime,
    status: "todo",
    source_type: sourceType,
    source_label: membership.role === "manager" ? "Manager" : membership.role.toUpperCase(),
  }).select("id").single<{id: string}>();

  if (error || !task) redirectMessage(returnTo, error?.message || "Impossible d’affecter la tâche.", "error");

  await admin.from("notifications").insert({
    organization_id: membership.organization_id,
    user_id: assigneeId,
    actor_id: user.id,
    category: "performance",
    event_type: "team_task_assigned",
    priority: priority === "critical" ? "urgent" : priority === "high" ? "warning" : "info",
    title_fr: "Nouvelle tâche affectée",
    title_en: "New assigned task",
    body_fr: `${title} · Résultat attendu : ${expectedOutcome}${dueTime ? ` · Échéance ${dueTime.slice(0, 5)}` : ""}`,
    body_en: `${title} · Expected outcome: ${expectedOutcome}${dueTime ? ` · Due ${dueTime.slice(0, 5)}` : ""}`,
    action_url: "/dashboard/my-day#manager-tasks",
    requires_action: true,
    dedupe_key: `team-task:${task.id}`,
    metadata: {task_id: task.id, work_date: workDate, priority},
  });

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: assigneeId,
    entityId: task.id,
    action: "task_assigned",
    details: {work_date: workDate, title, expected_outcome: expectedOutcome, priority, due_time: dueTime, source_type: sourceType},
  });

  revalidatePath("/dashboard/team-tasks");
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/hr/daily-priorities");
  redirectMessage(returnTo, "Tâche affectée au collaborateur et notification envoyée.");
}

export async function updateDelegatedTaskStatusAction(formData: FormData) {
  const {user, membership, admin} = await context(false);
  const returnTo = safeReturnTo(formData.get("returnTo"), "/dashboard/my-day#manager-tasks");
  const taskId = value(formData.get("taskId"));
  const statusRaw = value(formData.get("status"));
  const note = clean(formData.get("statusNote"), 2000);
  if (!taskId || !statuses.has(statusRaw) || statusRaw === "cancelled") {
    redirectMessage(returnTo, "Statut de tâche invalide.", "error");
  }
  if (statusRaw === "blocked" && note.length < 3) {
    redirectMessage(returnTo, "Indique la raison du blocage.", "error");
  }

  const {data: task, error} = await admin.from("team_delegated_tasks")
    .select("id,assignee_id,assigned_by,work_date,title,status")
    .eq("organization_id", membership.organization_id)
    .eq("id", taskId)
    .eq("assignee_id", user.id)
    .maybeSingle<TaskRow>();
  if (error || !task) redirectMessage(returnTo, "Tâche introuvable ou non autorisée.", "error");

  const {data: attendance} = await admin.from("attendance_records")
    .select("clock_out_at")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("work_date", task.work_date)
    .maybeSingle<{clock_out_at: string | null}>();
  if (attendance?.clock_out_at) redirectMessage(returnTo, "La journée est clôturée. Cette tâche ne peut plus être modifiée.", "error");

  const now = new Date().toISOString();
  const {error: updateError} = await admin.from("team_delegated_tasks").update({
    status: statusRaw,
    status_note: note || null,
    acknowledged_at: now,
    completed_at: statusRaw === "completed" ? now : null,
  }).eq("id", task.id).eq("assignee_id", user.id);
  if (updateError) redirectMessage(returnTo, updateError.message, "error");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: user.id,
    entityId: task.id,
    action: "task_status_updated",
    details: {previous_status: task.status, status: statusRaw, note: note || null, work_date: task.work_date},
  });

  if (["blocked", "completed"].includes(statusRaw) && task.assigned_by !== user.id) {
    await admin.from("notifications").insert({
      organization_id: membership.organization_id,
      user_id: task.assigned_by,
      actor_id: user.id,
      category: "performance",
      event_type: statusRaw === "blocked" ? "team_task_blocked" : "team_task_completed",
      priority: statusRaw === "blocked" ? "warning" : "success",
      title_fr: statusRaw === "blocked" ? "Tâche d’équipe bloquée" : "Tâche d’équipe terminée",
      title_en: statusRaw === "blocked" ? "Team task blocked" : "Team task completed",
      body_fr: `${task.title}${note ? ` · ${note}` : ""}`,
      body_en: `${task.title}${note ? ` · ${note}` : ""}`,
      action_url: `/dashboard/team-tasks?date=${task.work_date}&member=${user.id}`,
      requires_action: statusRaw === "blocked",
      dedupe_key: `team-task-status:${task.id}:${statusRaw}:${now}`,
      metadata: {task_id: task.id, work_date: task.work_date, status: statusRaw},
    });
  }

  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/team-tasks");
  redirectMessage(returnTo, "Statut de la tâche mis à jour.");
}

export async function updatePersonalPriorityByManagerAction(formData: FormData) {
  const {user, membership, admin} = await context(true);
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const taskId = value(formData.get("taskId"));
  const title = clean(formData.get("title"), 240);
  const expectedOutcome = clean(formData.get("expectedOutcome"), 1200);
  const category = clean(formData.get("category"), 120);
  const priorityRaw = value(formData.get("priority"));
  const priority = priorities.has(priorityRaw) ? priorityRaw : "normal";
  const dueTime = validTime(formData.get("dueTime"));
  const reason = clean(formData.get("reason"), 1000);

  if (!taskId || title.length < 3 || expectedOutcome.length < 3 || reason.length < 5) {
    redirectMessage(returnTo, "Renseigne la priorité, le résultat attendu et un motif de modification précis.", "error");
  }

  const task = await loadEditablePersonalPriority(admin, membership, user.id, taskId, returnTo);
  const previous = {
    title: task.title,
    expected_outcome: task.expected_outcome,
    priority: task.priority,
    due_time: task.due_time,
    category: task.category,
  };
  const next = {
    title,
    expected_outcome: expectedOutcome,
    priority,
    due_time: dueTime,
    category: category || null,
  };
  const changed = Object.keys(previous).some((key) => previous[key as keyof typeof previous] !== next[key as keyof typeof next]);
  if (!changed) redirectMessage(returnTo, "Aucune modification détectée.", "error");

  const now = new Date().toISOString();
  const {error: updateError} = await admin.from("daily_work_tasks").update({
    ...next,
    manager_controlled: true,
    manager_modified_by: user.id,
    manager_modified_at: now,
    manager_change_reason: reason,
    manager_revision_count: Number(task.manager_revision_count || 0) + 1,
  }).eq("id", task.id).eq("organization_id", membership.organization_id).eq("user_id", task.user_id);
  if (updateError) redirectMessage(returnTo, updateError.message, "error");

  await admin.from("notifications").insert({
    organization_id: membership.organization_id,
    user_id: task.user_id,
    actor_id: user.id,
    category: "performance",
    event_type: "daily_priority_manager_updated",
    priority: priority === "critical" ? "urgent" : priority === "high" ? "warning" : "info",
    title_fr: "Une priorité de ta journée a été ajustée",
    title_en: "A daily priority was adjusted",
    body_fr: `${title} · ${task.priority} → ${priority}${dueTime ? ` · Échéance ${dueTime.slice(0, 5)}` : ""} · Motif : ${reason}`,
    body_en: `${title} · ${task.priority} → ${priority}${dueTime ? ` · Due ${dueTime.slice(0, 5)}` : ""} · Reason: ${reason}`,
    action_url: "/dashboard/my-day#daily-priorities",
    requires_action: true,
    dedupe_key: `daily-priority-manager-update:${task.id}:${now}`,
    metadata: {task_id: task.id, work_date: task.work_date, previous, next, reason},
  });

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: task.user_id,
    entityId: task.id,
    action: "personal_priority_manager_updated",
    details: {work_date: task.work_date, previous, next, reason, manager_revision: Number(task.manager_revision_count || 0) + 1},
  });

  revalidatePriorityViews();
  redirectMessage(returnTo, "Priorité mise à jour, modification auditée et collaborateur informé.");
}

export async function removePersonalPriorityByManagerAction(formData: FormData) {
  const {user, membership, admin} = await context(true);
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const taskId = value(formData.get("taskId"));
  const reason = clean(formData.get("reason"), 1000);
  if (!taskId || reason.length < 5) {
    redirectMessage(returnTo, "Indique un motif précis pour retirer cette priorité de la journée.", "error");
  }

  const task = await loadEditablePersonalPriority(admin, membership, user.id, taskId, returnTo);
  const now = new Date().toISOString();
  const {error: updateError} = await admin.from("daily_work_tasks").update({
    progress_status: "cancelled",
    completed_at: null,
    manager_controlled: true,
    manager_modified_by: user.id,
    manager_modified_at: now,
    manager_change_reason: reason,
    manager_revision_count: Number(task.manager_revision_count || 0) + 1,
    manager_removed_by: user.id,
    manager_removed_at: now,
    manager_removed_reason: reason,
  }).eq("id", task.id).eq("organization_id", membership.organization_id).eq("user_id", task.user_id);
  if (updateError) redirectMessage(returnTo, updateError.message, "error");

  await admin.from("notifications").insert({
    organization_id: membership.organization_id,
    user_id: task.user_id,
    actor_id: user.id,
    category: "performance",
    event_type: "daily_priority_manager_removed",
    priority: "warning",
    title_fr: "Une priorité a été retirée de ta journée",
    title_en: "A priority was removed from your day",
    body_fr: `${task.title} · Motif : ${reason}`,
    body_en: `${task.title} · Reason: ${reason}`,
    action_url: "/dashboard/my-day#daily-priorities",
    requires_action: false,
    dedupe_key: `daily-priority-manager-remove:${task.id}:${now}`,
    metadata: {task_id: task.id, work_date: task.work_date, reason},
  });

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: task.user_id,
    entityId: task.id,
    action: "personal_priority_manager_removed",
    details: {work_date: task.work_date, title: task.title, reason, previous_status: task.progress_status},
  });

  revalidatePriorityViews();
  redirectMessage(returnTo, "Priorité retirée de la journée et collaborateur informé.");
}

export async function cancelDelegatedTaskAction(formData: FormData) {
  const {user, membership, admin} = await context(true);
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const taskId = value(formData.get("taskId"));
  const reason = clean(formData.get("reason"), 1000);
  if (!taskId) redirectMessage(returnTo, "Tâche introuvable.", "error");

  const {data: task, error} = await admin.from("team_delegated_tasks")
    .select("id,assignee_id,assigned_by,work_date,title,status")
    .eq("organization_id", membership.organization_id)
    .eq("id", taskId)
    .maybeSingle<TaskRow>();
  if (error || !task) redirectMessage(returnTo, "Tâche introuvable.", "error");
  if (!(await assertInScope(admin, membership, user.id, task.assignee_id))) {
    redirectMessage(returnTo, "Cette tâche est hors de ton périmètre de supervision.", "error");
  }
  if (task.status === "completed") redirectMessage(returnTo, "Une tâche terminée ne peut pas être annulée.", "error");

  const now = new Date().toISOString();
  const {error: updateError} = await admin.from("team_delegated_tasks").update({
    status: "cancelled",
    status_note: reason || "Annulée par le responsable",
    cancelled_at: now,
  }).eq("id", task.id);
  if (updateError) redirectMessage(returnTo, updateError.message, "error");

  await admin.from("notifications").insert({
    organization_id: membership.organization_id,
    user_id: task.assignee_id,
    actor_id: user.id,
    category: "performance",
    event_type: "team_task_cancelled",
    priority: "info",
    title_fr: "Tâche affectée annulée",
    title_en: "Assigned task cancelled",
    body_fr: `${task.title}${reason ? ` · Motif : ${reason}` : ""}`,
    body_en: `${task.title}${reason ? ` · Reason: ${reason}` : ""}`,
    action_url: "/dashboard/my-day#manager-tasks",
    requires_action: false,
    dedupe_key: `team-task-cancel:${task.id}`,
    metadata: {task_id: task.id, work_date: task.work_date},
  });

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    subjectUserId: task.assignee_id,
    entityId: task.id,
    action: "task_cancelled",
    details: {previous_status: task.status, reason: reason || null, work_date: task.work_date},
  });

  revalidatePath("/dashboard/team-tasks");
  revalidatePath("/dashboard/my-day");
  redirectMessage(returnTo, "Tâche annulée et collaborateur informé.");
}
