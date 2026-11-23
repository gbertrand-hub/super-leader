"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {dailyExecutionCopy} from "@/i18n/daily-execution";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {getI18n} from "@/i18n/server";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";

type Membership = {organization_id: string; role: string; is_active: boolean};
type ExecutionSettings = {
  enabled: boolean;
  minimum_tasks: number;
  maximum_tasks: number;
  required_from: string;
  allow_plan_revision: boolean;
  plan_lock_time: string;
  maximum_critical_tasks: number;
  require_due_time_for_high_priority: boolean;
  require_category_for_critical: boolean;
};
type PlanRow = {id: string; status: string; revision_count: number};
type ManagerControlledTaskRow = {
  id: string;
  position: number;
  title: string;
  expected_outcome: string;
  priority: string;
  due_time: string | null;
  category: string | null;
  manager_controlled: boolean;
  manager_removed_at: string | null;
};
type PriorityReopeningRow = {id: string; expires_at: string; status: string; reason: string; reason_code: string};

const priorities = new Set(["low", "normal", "high", "critical"]);
const progressStatuses = new Set(["todo", "in_progress", "completed", "partial", "blocked", "deferred", "cancelled"]);

function first(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function clean(value: FormDataEntryValue | null, max: number) {
  return first(value).slice(0, max);
}

function dateValue(value: FormDataEntryValue | null) {
  const raw = first(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function timeValue(value: FormDataEntryValue | null) {
  const raw = first(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
}

function redirectMyDay(message: string, kind: "success" | "error" = "success", extra?: Record<string, string>) : never {
  const params = new URLSearchParams({[kind]: message, ...(extra ?? {})});
  redirect(`/dashboard/my-day?${params.toString()}`);
}

function zonedDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function context() {
  const {locale} = await getI18n();
  const c = dailyExecutionCopy(locale);
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");
  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (!membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "performance");
  return {user: authData.user, membership, admin, c};
}

async function executionSettings(admin: ReturnType<typeof createAdminClient>, organizationId: string, c: ReturnType<typeof dailyExecutionCopy>) {
  const {data, error} = await admin
    .from("daily_execution_settings")
    .select("enabled, minimum_tasks, maximum_tasks, required_from, allow_plan_revision, plan_lock_time, maximum_critical_tasks, require_due_time_for_high_priority, require_category_for_critical")
    .eq("organization_id", organizationId)
    .maybeSingle<ExecutionSettings>();
  if (error) redirectMyDay(c.messages.migration, "error");
  return data ?? {enabled: true, minimum_tasks: 6, maximum_tasks: 12, required_from: new Date().toISOString().slice(0, 10), allow_plan_revision: true, plan_lock_time: "10:00", maximum_critical_tasks: 2, require_due_time_for_high_priority: false, require_category_for_critical: false};
}

function zonedTime(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {timeZone: normalizeTimeZone(timezone), hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(date);
}

function safeReturnTo(value: FormDataEntryValue | null) {
  const raw = first(value);
  return raw.startsWith("/dashboard/") ? raw : "/dashboard/hr/daily-priorities";
}

function redirectPriorityGovernance(returnTo: string, message: string, kind: "success" | "error" = "success"): never {
  const url = new URL(returnTo, "http://super-leader.local");
  url.searchParams.set(kind, message);
  redirect(`${url.pathname}?${url.searchParams.toString()}#reopen-priorities`);
}

function durationMinutesValue(value: FormDataEntryValue | null) {
  const amount = Number(first(value));
  return Number.isInteger(amount) && amount >= 15 && amount <= 480 ? amount : 60;
}

async function activePriorityReopening(admin: ReturnType<typeof createAdminClient>, organizationId: string, userId: string, workDate: string) {
  const {data, error} = await admin
    .from("daily_priority_reopenings")
    .select("id, expires_at, status, reason, reason_code")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("work_date", workDate)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<PriorityReopeningRow>();
  if (error && !["42P01", "PGRST205"].includes(error.code)) throw new Error(error.message);
  return data ?? null;
}

async function canGovernPriorityUser(admin: ReturnType<typeof createAdminClient>, membership: Membership, actorId: string, targetUserId: string) {
  if (!["owner", "admin", "executive", "hr", "manager"].includes(membership.role)) return false;
  const visible = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId,
    role: membership.role,
  });
  return visible.includes(targetUserId);
}

async function notifyPriorityReopening(admin: ReturnType<typeof createAdminClient>, input: {
  organizationId: string;
  targetUserId: string;
  actorId: string;
  workDate: string;
  expiresAt: string;
  reason: string;
}) {
  const expiresLabel = new Intl.DateTimeFormat("fr-FR", {dateStyle: "medium", timeStyle: "short"}).format(new Date(input.expiresAt));
  const expiresLabelEn = new Intl.DateTimeFormat("en-GB", {dateStyle: "medium", timeStyle: "short"}).format(new Date(input.expiresAt));
  const {error} = await admin.from("notifications").insert({
    organization_id: input.organizationId,
    user_id: input.targetUserId,
    actor_id: input.actorId,
    category: "performance",
    event_type: "daily_priorities_reopened",
    priority: "warning",
    title_fr: "Priorités du jour rouvertes",
    title_en: "Daily priorities reopened",
    body_fr: `Tes priorités du ${input.workDate} sont rouvertes jusqu’au ${expiresLabel}. Motif : ${input.reason}`,
    body_en: `Your priorities for ${input.workDate} are reopened until ${expiresLabelEn}. Reason: ${input.reason}`,
    action_url: "/dashboard/my-day?plan=required#daily-priorities",
    requires_action: true,
    dedupe_key: `daily-priority-reopen:${input.targetUserId}:${input.workDate}:${input.expiresAt}`,
    metadata: {work_date: input.workDate, expires_at: input.expiresAt, reason: input.reason},
  });
  if (error) console.error("Daily priority reopening notification failed", error);
}

async function userTimezone(admin: ReturnType<typeof createAdminClient>, organizationId: string, userId: string) {
  const [{data: schedule}, {data: settings}] = await Promise.all([
    admin.from("member_work_schedules").select("timezone").eq("organization_id", organizationId).eq("user_id", userId).eq("is_active", true).maybeSingle<{timezone: string}>(),
    admin.from("performance_settings").select("timezone").eq("organization_id", organizationId).maybeSingle<{timezone: string}>(),
  ]);
  return normalizeTimeZone(schedule?.timezone || settings?.timezone || "UTC");
}

async function audit(admin: ReturnType<typeof createAdminClient>, input: {
  organizationId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  details?: Record<string, unknown>;
}) {
  const {error} = await admin.from("performance_audit_log").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    subject_user_id: input.actorId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Daily execution audit failed", error);
}

export async function saveDailyWorkPlanAction(formData: FormData) {
  const {user, membership, admin, c} = await context();
  const settings = await executionSettings(admin, membership.organization_id, c);
  const workDate = dateValue(formData.get("workDate"));
  const timezone = await userTimezone(admin, membership.organization_id, user.id);
  const today = zonedDate(new Date(), timezone);
  if (!workDate || workDate !== today) redirectMyDay(c.messages.todayOnly, "error", {plan: "required"});
  const lockTime = String(settings.plan_lock_time || "10:00").slice(0, 5);
  const priorityReopening = await activePriorityReopening(admin, membership.organization_id, user.id, workDate);
  if (zonedTime(new Date(), timezone) > lockTime && !priorityReopening) {
    redirectMyDay(`Le plan quotidien est verrouillé après ${lockTime}. Contacte ton superviseur pour une réouverture exceptionnelle.`, "error", {plan: "required"});
  }

  const {data: attendance} = await admin
    .from("attendance_records")
    .select("id, clock_in_at, clock_out_at")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("work_date", workDate)
    .maybeSingle<{id: string; clock_in_at: string | null; clock_out_at: string | null}>();
  if (!attendance?.clock_in_at) redirectMyDay(c.messages.clockInFirst, "error", {plan: "required"});
  if (attendance.clock_out_at) redirectMyDay(c.messages.dayClosed, "error");

  const {data: report} = await admin
    .from("daily_reports")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("report_date", workDate)
    .maybeSingle<{id: string}>();
  if (report) redirectMyDay(c.messages.reportLocked, "error");

  const maximum = Math.min(12, Math.max(Number(settings.maximum_tasks || 12), Number(settings.minimum_tasks || 6)));
  const rows: Array<{
    position: number;
    title: string;
    expected_outcome: string;
    priority: string;
    due_time: string | null;
    category: string | null;
  }> = [];
  for (let position = 1; position <= maximum; position += 1) {
    const title = clean(formData.get(`taskTitle${position}`), 240);
    const expectedOutcome = clean(formData.get(`taskExpected${position}`), 1200);
    const category = clean(formData.get(`taskCategory${position}`), 120);
    const priorityValue = first(formData.get(`taskPriority${position}`));
    const dueTime = timeValue(formData.get(`taskDue${position}`));
    if (!title && !expectedOutcome && !category && !dueTime) continue;
    if (title.length < 3 || expectedOutcome.length < 3) redirectMyDay(c.messages.incompleteTask(position), "error", {plan: "required"});
    const normalizedPriority = priorities.has(priorityValue) ? priorityValue : "normal";
    if (settings.require_due_time_for_high_priority && ["high", "critical"].includes(normalizedPriority) && !dueTime) {
      redirectMyDay(`Ajoute une heure cible à la priorité ${position} car elle est importante ou critique.`, "error", {plan: "required"});
    }
    if (settings.require_category_for_critical && normalizedPriority === "critical" && !category) {
      redirectMyDay(`Ajoute une catégorie à la priorité critique ${position}.`, "error", {plan: "required"});
    }
    rows.push({
      position,
      title,
      expected_outcome: expectedOutcome,
      priority: normalizedPriority,
      due_time: dueTime,
      category: category || null,
    });
  }

  const minimum = Math.max(1, Number(settings.minimum_tasks || 6));
  if (rows.length < minimum) redirectMyDay(c.messages.minimum(minimum), "error", {plan: "required"});
  const criticalCount = rows.filter((row) => row.priority === "critical").length;
  const maximumCritical = Math.max(1, Number(settings.maximum_critical_tasks || 2));
  if (criticalCount > maximumCritical) {
    redirectMyDay(`Maximum ${maximumCritical} priorité${maximumCritical > 1 ? "s" : ""} critique${maximumCritical > 1 ? "s" : ""} par jour.`, "error", {plan: "required"});
  }

  const {data: existingPlan, error: existingPlanError} = await admin
    .from("daily_work_plans")
    .select("id, status, revision_count")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("work_date", workDate)
    .maybeSingle<PlanRow>();
  if (existingPlanError) redirectMyDay(c.messages.migration, "error");
  if (existingPlan?.status === "completed") redirectMyDay(c.messages.reportLocked, "error");
  if (existingPlan && settings.allow_plan_revision === false) redirectMyDay(c.messages.reportLocked, "error");

  const now = new Date().toISOString();
  const planPayload = {
    organization_id: membership.organization_id,
    user_id: user.id,
    work_date: workDate,
    attendance_id: attendance.id,
    status: "submitted",
    minimum_tasks_snapshot: minimum,
    submitted_at: existingPlan ? undefined : now,
    revision_count: Number(existingPlan?.revision_count ?? 0) + 1,
    created_by: user.id,
    updated_by: user.id,
  };

  const planResult = existingPlan
    ? await admin.from("daily_work_plans").update({
        attendance_id: attendance.id,
        status: "submitted",
        minimum_tasks_snapshot: minimum,
        revision_count: Number(existingPlan.revision_count ?? 0) + 1,
        updated_by: user.id,
      }).eq("id", existingPlan.id).select("id").single<{id: string}>()
    : await admin.from("daily_work_plans").insert(planPayload).select("id").single<{id: string}>();
  if (planResult.error || !planResult.data) redirectMyDay(planResult.error?.message || c.messages.migration, "error");
  const planId = planResult.data.id;

  // v4.10.11: an employee may revise their plan, but cannot silently undo a manager adjustment.
  // Manager-controlled fields are authoritative until a manager changes them again.
  const {data: governedTaskData, error: governedTaskError} = await admin.from("daily_work_tasks")
    .select("id,position,title,expected_outcome,priority,due_time,category,manager_controlled,manager_removed_at")
    .eq("plan_id", planId);
  if (governedTaskError) redirectMyDay(governedTaskError.message, "error", {plan: "required"});
  const governedByPosition = new Map(
    ((governedTaskData ?? []) as ManagerControlledTaskRow[])
      .filter((task) => task.manager_controlled)
      .map((task) => [Number(task.position), task]),
  );

  const taskPayload = rows.map((row) => {
    const governed = governedByPosition.get(row.position);
    return {
      ...(governed ? {
        position: row.position,
        title: governed.title,
        expected_outcome: governed.expected_outcome,
        priority: governed.priority,
        due_time: governed.due_time,
        category: governed.category,
      } : row),
      plan_id: planId,
      organization_id: membership.organization_id,
      user_id: user.id,
      work_date: workDate,
    };
  });
  const {error: taskError} = await admin.from("daily_work_tasks").upsert(taskPayload, {onConflict: "plan_id,position"});
  if (taskError) redirectMyDay(taskError.message, "error", {plan: "required"});

  const {data: existingTasks} = await admin.from("daily_work_tasks").select("id,position,manager_controlled").eq("plan_id", planId);
  const kept = new Set(rows.map((row) => row.position));
  const removedIds = (existingTasks ?? [])
    .filter((row) => !kept.has(Number(row.position)) && !Boolean(row.manager_controlled))
    .map((row) => row.id);
  if (removedIds.length) await admin.from("daily_work_tasks").delete().in("id", removedIds);

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "daily_work_plan",
    entityId: planId,
    action: existingPlan ? "plan_revised" : "plan_submitted",
    details: {
      work_date: workDate,
      task_count: rows.length,
      revision_count: Number(existingPlan?.revision_count ?? 0) + 1,
      tasks: rows.map((row) => ({
        position: row.position,
        title: row.title,
        expected_outcome: row.expected_outcome,
        priority: row.priority,
        due_time: row.due_time,
        category: row.category,
      })),
    },
  });
  if (priorityReopening) {
    const usedAt = new Date().toISOString();
    await admin.from("daily_priority_reopenings").update({
      status: "used",
      used_at: usedAt,
      closed_at: usedAt,
      updated_at: usedAt,
    }).eq("id", priorityReopening.id).eq("status", "active");
    await audit(admin, {
      organizationId: membership.organization_id,
      actorId: user.id,
      entityType: "daily_priority_reopening",
      entityId: priorityReopening.id,
      action: "reopening_used",
      details: {work_date: workDate, plan_id: planId},
    });
  }

  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/hr/daily-priorities");
  revalidatePath("/dashboard/hr");
  revalidatePath("/dashboard");
  redirectMyDay(priorityReopening ? "Priorités soumises. La réouverture exceptionnelle est maintenant fermée." : c.messages.saved, "success", {plan: "saved"});
}

export async function updateDailyWorkTaskStatusAction(formData: FormData) {
  const {user, membership, admin, c} = await context();
  const taskId = first(formData.get("taskId"));
  const status = first(formData.get("status"));
  if (!taskId || !progressStatuses.has(status)) redirectMyDay(c.messages.invalidTask, "error");

  const {data: task, error} = await admin
    .from("daily_work_tasks")
    .select("id, plan_id, work_date, progress_status, manager_controlled, manager_removed_at")
    .eq("id", taskId)
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .maybeSingle<{id: string; plan_id: string; work_date: string; progress_status: string; manager_controlled: boolean; manager_removed_at: string | null}>();
  if (error || !task) redirectMyDay(c.messages.invalidTask, "error");
  if (task.manager_removed_at) redirectMyDay("Cette priorité a été retirée de ta journée par ton responsable.", "error");
  if (task.manager_controlled && status === "cancelled") redirectMyDay("Une priorité ajustée par ton responsable ne peut pas être annulée par le collaborateur. Signale plutôt un blocage ou demande une clarification.", "error");

  const {data: plan} = await admin
    .from("daily_work_plans")
    .select("status")
    .eq("id", task.plan_id)
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .maybeSingle<{status: string}>();
  if (!plan || plan.status === "completed") redirectMyDay(c.messages.invalidTask, "error");

  const {error: updateError} = await admin.from("daily_work_tasks").update({
    progress_status: status,
    completed_at: status === "completed" ? new Date().toISOString() : null,
  }).eq("id", task.id).eq("user_id", user.id);
  if (updateError) redirectMyDay(updateError.message, "error");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "daily_work_task",
    entityId: task.id,
    action: "status_updated",
    details: {work_date: task.work_date, previous_status: task.progress_status, status},
  });
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/performance");
  redirectMyDay(c.messages.statusSaved, "success");
}


export async function reopenDailyPrioritiesAction(formData: FormData) {
  const {user, membership, admin, c} = await context();
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const targetUserId = first(formData.get("userId"));
  const workDate = dateValue(formData.get("workDate"));
  const reasonCode = clean(formData.get("reasonCode"), 40) || "other";
  const reason = clean(formData.get("reason"), 500);
  const durationMinutes = durationMinutesValue(formData.get("durationMinutes"));

  if (!targetUserId || !workDate || reason.length < 5) {
    redirectPriorityGovernance(returnTo, "Indique le collaborateur, la date et un motif précis.", "error");
  }
  if (!(await canGovernPriorityUser(admin, membership, user.id, targetUserId))) {
    redirectPriorityGovernance(returnTo, "Tu n’es pas autorisé à gérer les priorités de ce collaborateur.", "error");
  }

  const settings = await executionSettings(admin, membership.organization_id, c);
  const timezone = await userTimezone(admin, membership.organization_id, targetUserId);
  const targetToday = zonedDate(new Date(), timezone);
  if (workDate !== targetToday) {
    redirectPriorityGovernance(returnTo, "La réouverture des priorités est limitée à la journée de travail en cours.", "error");
  }
  const lockTime = String(settings.plan_lock_time || "10:00").slice(0, 5);
  if (zonedTime(new Date(), timezone) <= lockTime) {
    redirectPriorityGovernance(returnTo, `La saisie est encore ouverte jusqu’à ${lockTime}. Aucune réouverture n’est nécessaire.`, "error");
  }

  const [{data: report}, {data: plan}, {data: profile}] = await Promise.all([
    admin.from("daily_reports").select("id").eq("organization_id", membership.organization_id).eq("user_id", targetUserId).eq("report_date", workDate).maybeSingle<{id: string}>(),
    admin.from("daily_work_plans").select("id,status").eq("organization_id", membership.organization_id).eq("user_id", targetUserId).eq("work_date", workDate).maybeSingle<{id: string;status: string}>(),
    admin.from("profiles").select("full_name,email").eq("id", targetUserId).maybeSingle<{full_name: string | null;email: string | null}>(),
  ]);
  if (report) redirectPriorityGovernance(returnTo, "Le rapport journalier existe déjà : les priorités de cette journée ne peuvent plus être modifiées.", "error");
  if (plan?.status === "completed") redirectPriorityGovernance(returnTo, "Cette journée est déjà clôturée.", "error");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);
  const nowIso = now.toISOString();

  await admin.from("daily_priority_reopenings").update({
    status: "revoked",
    revoked_by: user.id,
    revoked_at: nowIso,
    closed_at: nowIso,
    updated_at: nowIso,
  }).eq("organization_id", membership.organization_id).eq("user_id", targetUserId).eq("work_date", workDate).eq("status", "active");

  const {data: reopening, error} = await admin.from("daily_priority_reopenings").insert({
    organization_id: membership.organization_id,
    user_id: targetUserId,
    work_date: workDate,
    reason_code: reasonCode,
    reason,
    duration_minutes: durationMinutes,
    expires_at: expiresAt.toISOString(),
    reopened_by: user.id,
    status: "active",
  }).select("id").single<{id: string}>();
  if (error || !reopening) redirectPriorityGovernance(returnTo, error?.message || "Réouverture impossible.", "error");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "daily_priority_reopening",
    entityId: reopening.id,
    action: "priorities_reopened",
    details: {subject_user_id: targetUserId, work_date: workDate, reason_code: reasonCode, reason, duration_minutes: durationMinutes, expires_at: expiresAt.toISOString()},
  });
  await notifyPriorityReopening(admin, {
    organizationId: membership.organization_id,
    targetUserId,
    actorId: user.id,
    workDate,
    expiresAt: expiresAt.toISOString(),
    reason,
  });

  revalidatePath("/dashboard/hr/daily-priorities");
  revalidatePath("/dashboard/hr");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/my-day");
  const name = profile?.full_name?.trim() || profile?.email || "Le collaborateur";
  redirectPriorityGovernance(returnTo, `${name} peut de nouveau soumettre ses priorités pendant ${durationMinutes} minutes.`);
}

export async function revokeDailyPrioritiesReopeningAction(formData: FormData) {
  const {user, membership, admin} = await context();
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const reopeningId = first(formData.get("reopeningId"));
  if (!reopeningId) redirectPriorityGovernance(returnTo, "Réouverture introuvable.", "error");

  const {data: reopening, error} = await admin.from("daily_priority_reopenings")
    .select("id,user_id,work_date,status")
    .eq("id", reopeningId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string;user_id: string;work_date: string;status: string}>();
  if (error || !reopening || reopening.status !== "active") redirectPriorityGovernance(returnTo, "Cette réouverture n’est plus active.", "error");
  if (!(await canGovernPriorityUser(admin, membership, user.id, reopening.user_id))) {
    redirectPriorityGovernance(returnTo, "Tu n’es pas autorisé à fermer cette réouverture.", "error");
  }

  const now = new Date().toISOString();
  const {error: updateError} = await admin.from("daily_priority_reopenings").update({
    status: "revoked",
    revoked_by: user.id,
    revoked_at: now,
    closed_at: now,
    updated_at: now,
  }).eq("id", reopening.id).eq("status", "active");
  if (updateError) redirectPriorityGovernance(returnTo, updateError.message, "error");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "daily_priority_reopening",
    entityId: reopening.id,
    action: "reopening_revoked",
    details: {subject_user_id: reopening.user_id, work_date: reopening.work_date},
  });
  revalidatePath("/dashboard/hr/daily-priorities");
  revalidatePath("/dashboard/hr");
  revalidatePath("/dashboard");
  redirectPriorityGovernance(returnTo, "Réouverture fermée.");
}
