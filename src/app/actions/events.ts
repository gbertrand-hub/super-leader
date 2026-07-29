"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createNotification} from "@/lib/notifications/service";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";
import {createZoomMeeting, deleteZoomMeeting} from "@/lib/zoom/client";
import {assertZoomHostAvailability, resolveZoomHost, zoomAvailableForOrganization} from "@/lib/zoom/settings";

const eventAdminRoles = new Set(["owner", "admin", "hr"]);
const eventTypes = new Set(["conference", "masterclass", "training", "ceremony", "networking", "community", "other"]);
const eventStatuses = new Set(["draft", "planning", "open", "in_progress", "completed", "cancelled", "archived"]);
const memberStatuses = new Set(["assigned", "confirmed", "declined", "removed"]);
const taskPriorities = new Set(["low", "normal", "high", "critical"]);
const taskStatuses = new Set(["todo", "in_progress", "blocked", "done", "cancelled"]);
const scheduleTypes = new Set(["meeting", "session", "travel", "logistics", "rehearsal", "setup", "break", "other"]);
const scheduleStatuses = new Set(["planned", "confirmed", "completed", "cancelled"]);
const documentCategories = new Set(["contract", "quote", "invoice", "programme", "marketing", "travel", "hotel", "presentation", "photo_video", "report", "other"]);
const eventViews = new Set(["overview", "team", "tasks", "schedule", "budget", "documents", "report"]);

type Membership = {organization_id: string; role: string};
type EventRow = {id: string; organization_id: string; name: string; timezone: string; leader_id: string | null; status: string};
type EventMemberRow = {can_manage: boolean; status: string};
type TaskRow = {id: string; event_id: string; organization_id: string; assignee_id: string | null};

function first(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function clean(value: FormDataEntryValue | null, maxLength: number) {
  return first(value).slice(0, maxLength);
}

function nullable(value: FormDataEntryValue | null, maxLength: number) {
  return clean(value, maxLength) || null;
}

function numberValue(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(first(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integerValue(value: FormDataEntryValue | null, fallback = 0) {
  return Math.round(numberValue(value, fallback));
}

function normalizeUrl(value: FormDataEntryValue | null) {
  const raw = clean(value, 1000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function zonedLocalToIso(value: FormDataEntryValue | null, timeZone: string) {
  const raw = first(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  const targetUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let guess = targetUtc;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (let index = 0; index < 3; index += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const representedUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    guess += targetUtc - representedUtc;
  }

  const date = new Date(guess);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function eventCopy(locale: string) {
  return locale === "fr"
    ? {
        permission: "Tu n’as pas la permission d’effectuer cette action.",
        invalid: "Les informations de l’événement sont incomplètes ou invalides.",
        eventCreated: "Événement créé.",
        eventUpdated: "Événement mis à jour.",
        eventMissing: "Événement introuvable.",
        memberInvalid: "Le collaborateur sélectionné n’est pas actif dans cette organisation.",
        memberAssigned: "Collaborateur ajouté à l’équipe de mission.",
        memberRemoved: "Collaborateur retiré de l’équipe de mission.",
        taskCreated: "Tâche créée.",
        taskUpdated: "Tâche mise à jour.",
        scheduleCreated: "Activité ajoutée au planning de l’événement.",
        documentAdded: "Document ajouté.",
        reportSaved: "Rapport final enregistré.",
        saveFailed: "Enregistrement impossible : {message}",
      }
    : {
        permission: "You do not have permission to perform this action.",
        invalid: "The event information is incomplete or invalid.",
        eventCreated: "Event created.",
        eventUpdated: "Event updated.",
        eventMissing: "Event not found.",
        memberInvalid: "The selected colleague is not active in this organization.",
        memberAssigned: "Colleague added to the mission team.",
        memberRemoved: "Colleague removed from the mission team.",
        taskCreated: "Task created.",
        taskUpdated: "Task updated.",
        scheduleCreated: "Activity added to the event schedule.",
        documentAdded: "Document added.",
        reportSaved: "Final report saved.",
        saveFailed: "Unable to save: {message}",
      };
}

function message(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function safeEventView(value: string | null | undefined) {
  return value && eventViews.has(value) ? value : "overview";
}

function goEvent(text: string, kind: "success" | "error" = "success", eventId?: string, view?: string): never {
  const params = new URLSearchParams({[kind]: text});
  if (eventId) params.set("event", eventId);
  if (view) params.set("view", safeEventView(view));
  redirect(`/dashboard/events?${params.toString()}`);
}

async function context() {
  const {locale} = await getI18n();
  const copy = eventCopy(locale);
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (error) throw new Error(error.message);
  if (!membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "events");
  return {user: authData.user, membership, admin, copy};
}

async function eventContext(eventId: string) {
  const base = await context();
  const {data: event, error} = await base.admin
    .from("events")
    .select("id,organization_id,name,timezone,leader_id,status")
    .eq("id", eventId)
    .eq("organization_id", base.membership.organization_id)
    .maybeSingle<EventRow>();
  if (error) goEvent(message(base.copy.saveFailed, {message: error.message}), "error");
  if (!event) goEvent(base.copy.eventMissing, "error");

  let canManage = eventAdminRoles.has(base.membership.role) || event.leader_id === base.user.id;
  let canView = canManage;
  if (!canManage) {
    const {data: eventMember} = await base.admin
      .from("event_team_members")
      .select("can_manage,status")
      .eq("event_id", eventId)
      .eq("user_id", base.user.id)
      .in("status", ["assigned", "confirmed"])
      .maybeSingle<EventMemberRow>();
    canView = Boolean(eventMember);
    canManage = Boolean(eventMember?.can_manage);
  }

  if (!canView) goEvent(base.copy.permission, "error");
  return {...base, event, canManage};
}

async function activeOrganizationMember(admin: ReturnType<typeof createAdminClient>, organizationId: string, userId: string) {
  if (!userId) return false;
  const {data} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle<{user_id: string}>();
  return Boolean(data);
}

async function activeEventTeamMember(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  userId: string,
) {
  if (!userId) return false;
  const {data} = await admin
    .from("event_team_members")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .in("status", ["assigned", "confirmed"])
    .maybeSingle<{user_id: string}>();
  return Boolean(data);
}

async function logEvent(admin: ReturnType<typeof createAdminClient>, input: {
  organizationId: string;
  eventId: string;
  actorId: string;
  action: string;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
}) {
  const {error} = await admin.from("event_activity_log").insert({
    organization_id: input.organizationId,
    event_id: input.eventId,
    actor_id: input.actorId,
    action: input.action,
    target_user_id: input.targetUserId ?? null,
    details: input.details ?? {},
  });
  if (error) console.error("Event audit log failed", error);
}

function refreshEventViews() {
  revalidatePath("/dashboard/events");
  revalidatePath("/dashboard/my-day");
  revalidatePath("/dashboard/schedule");
  revalidatePath("/dashboard");
}

export async function createEventAction(formData: FormData) {
  const {user, membership, admin, copy} = await context();
  if (!eventAdminRoles.has(membership.role)) goEvent(copy.permission, "error");

  const name = clean(formData.get("name"), 180);
  const eventType = first(formData.get("eventType"));
  const status = first(formData.get("status"));
  const timezone = normalizeTimeZone(clean(formData.get("timezone"), 80));
  const startAt = zonedLocalToIso(formData.get("startAt"), timezone);
  const endAt = zonedLocalToIso(formData.get("endAt"), timezone);
  const leaderId = first(formData.get("leaderId"));
  if (name.length < 3 || !eventTypes.has(eventType) || !eventStatuses.has(status) || !startAt || !endAt || endAt <= startAt) {
    goEvent(copy.invalid, "error");
  }
  if (leaderId && !(await activeOrganizationMember(admin, membership.organization_id, leaderId))) {
    goEvent(copy.memberInvalid, "error");
  }

  const {data: event, error} = await admin.from("events").insert({
    organization_id: membership.organization_id,
    name,
    event_type: eventType,
    status,
    description: nullable(formData.get("description"), 4000),
    objectives: nullable(formData.get("objectives"), 4000),
    country: nullable(formData.get("country"), 120),
    city: nullable(formData.get("city"), 120),
    venue: nullable(formData.get("venue"), 240),
    timezone,
    start_at: startAt,
    end_at: endAt,
    expected_participants: Math.max(0, integerValue(formData.get("expectedParticipants"))),
    budget_amount: first(formData.get("budgetAmount")) ? Math.max(0, numberValue(formData.get("budgetAmount"))) : null,
    currency: clean(formData.get("currency"), 3).toUpperCase() || "USD",
    leader_id: leaderId || null,
    created_by: user.id,
  }).select("id").single<{id: string}>();

  if (error || !event) goEvent(message(copy.saveFailed, {message: error?.message ?? "Unknown error"}), "error");

  if (leaderId) {
    await admin.from("event_team_members").upsert({
      organization_id: membership.organization_id,
      event_id: event.id,
      user_id: leaderId,
      mission_role: localeRole(copy, "leader"),
      unit_name: localeRole(copy, "coordination"),
      can_manage: true,
      status: "confirmed",
      starts_at: startAt,
      ends_at: endAt,
      assigned_by: user.id,
    }, {onConflict: "event_id,user_id"});

    await createNotification({
      organizationId: membership.organization_id,
      userId: leaderId,
      actorId: user.id,
      category: "meetings",
      eventType: "event_lead_assigned",
      titleFr: "Nouvelle responsabilité événementielle",
      titleEn: "New event responsibility",
      bodyFr: `Tu as été désigné responsable de l’événement « ${name} ».`,
      bodyEn: `You have been appointed lead for the event “${name}”.`,
      actionUrl: `/dashboard/events?event=${event.id}`,
      requiresAction: true,
      dedupeKey: `event-lead:${event.id}:${leaderId}`,
      metadata: {event_id: event.id},
    });
  }

  await logEvent(admin, {organizationId: membership.organization_id, eventId: event.id, actorId: user.id, action: "event_created", targetUserId: leaderId || null, details: {name, event_type: eventType, start_at: startAt, end_at: endAt}});
  refreshEventViews();
  goEvent(copy.eventCreated, "success", event.id, "overview");
}

function localeRole(copy: ReturnType<typeof eventCopy>, role: "leader" | "coordination") {
  return copy.permission.startsWith("Tu")
    ? role === "leader" ? "Responsable de l’événement" : "Coordination générale"
    : role === "leader" ? "Event lead" : "General coordination";
}

export async function updateEventAction(formData: FormData) {
  const eventId = first(formData.get("eventId"));
  const returnView = safeEventView(first(formData.get("returnView")));
  if (!eventId) redirect("/dashboard/events");
  const {user, admin, event, canManage, copy} = await eventContext(eventId);
  if (!canManage) goEvent(copy.permission, "error", eventId, returnView);

  const name = clean(formData.get("name"), 180);
  const eventType = first(formData.get("eventType"));
  const status = first(formData.get("status"));
  const timezone = normalizeTimeZone(clean(formData.get("timezone"), 80) || event.timezone);
  const startAt = zonedLocalToIso(formData.get("startAt"), timezone);
  const endAt = zonedLocalToIso(formData.get("endAt"), timezone);
  const leaderId = first(formData.get("leaderId"));
  if (name.length < 3 || !eventTypes.has(eventType) || !eventStatuses.has(status) || !startAt || !endAt || endAt <= startAt) {
    goEvent(copy.invalid, "error", eventId, returnView);
  }
  if (leaderId && !(await activeOrganizationMember(admin, event.organization_id, leaderId))) {
    goEvent(copy.memberInvalid, "error", eventId, returnView);
  }

  const {error} = await admin.from("events").update({
    name,
    event_type: eventType,
    status,
    description: nullable(formData.get("description"), 4000),
    objectives: nullable(formData.get("objectives"), 4000),
    country: nullable(formData.get("country"), 120),
    city: nullable(formData.get("city"), 120),
    venue: nullable(formData.get("venue"), 240),
    timezone,
    start_at: startAt,
    end_at: endAt,
    expected_participants: Math.max(0, integerValue(formData.get("expectedParticipants"))),
    budget_amount: first(formData.get("budgetAmount")) ? Math.max(0, numberValue(formData.get("budgetAmount"))) : null,
    currency: clean(formData.get("currency"), 3).toUpperCase() || "USD",
    leader_id: leaderId || null,
    completed_at: status === "completed" ? new Date().toISOString() : null,
    archived_at: status === "archived" ? new Date().toISOString() : null,
  }).eq("id", eventId).eq("organization_id", event.organization_id);

  if (error) goEvent(message(copy.saveFailed, {message: error.message}), "error", eventId, returnView);

  if (event.leader_id && event.leader_id !== leaderId) {
    await admin.from("event_team_members").update({can_manage: false}).eq("event_id", eventId).eq("user_id", event.leader_id);
  }

  if (leaderId) {
    await admin.from("event_team_members").upsert({
      organization_id: event.organization_id,
      event_id: eventId,
      user_id: leaderId,
      mission_role: localeRole(copy, "leader"),
      unit_name: localeRole(copy, "coordination"),
      can_manage: true,
      status: "confirmed",
      starts_at: startAt,
      ends_at: endAt,
      assigned_by: user.id,
    }, {onConflict: "event_id,user_id"});

    if (leaderId !== event.leader_id) {
      await createNotification({
        organizationId: event.organization_id,
        userId: leaderId,
        actorId: user.id,
        category: "meetings",
        eventType: "event_lead_assigned",
        titleFr: "Nouvelle responsabilité événementielle",
        titleEn: "New event responsibility",
        bodyFr: `Tu as été désigné responsable de l’événement « ${name} ».`,
        bodyEn: `You have been appointed lead for the event “${name}”.`,
        actionUrl: `/dashboard/events?event=${eventId}`,
        requiresAction: true,
        dedupeKey: `event-lead:${eventId}:${leaderId}`,
        metadata: {event_id: eventId},
      });
    }
  }

  await logEvent(admin, {organizationId: event.organization_id, eventId, actorId: user.id, action: "event_updated", targetUserId: leaderId || null, details: {status, previous_leader_id: event.leader_id, leader_id: leaderId || null}});
  refreshEventViews();
  goEvent(copy.eventUpdated, "success", eventId, returnView);
}

export async function assignEventMemberAction(formData: FormData) {
  const eventId = first(formData.get("eventId"));
  const userId = first(formData.get("userId"));
  const {user, admin, event, canManage, copy} = await eventContext(eventId);
  if (!canManage) goEvent(copy.permission, "error", eventId);
  if (!(await activeOrganizationMember(admin, event.organization_id, userId))) goEvent(copy.memberInvalid, "error", eventId);

  const missionRole = clean(formData.get("missionRole"), 160) || (copy.permission.startsWith("Tu") ? "Membre" : "Member");
  const unitName = nullable(formData.get("unitName"), 160);
  const status = memberStatuses.has(first(formData.get("memberStatus"))) ? first(formData.get("memberStatus")) : "assigned";
  const canManageMember = formData.get("canManage") === "on";
  const {error} = await admin.from("event_team_members").upsert({
    organization_id: event.organization_id,
    event_id: eventId,
    user_id: userId,
    mission_role: missionRole,
    unit_name: unitName,
    responsibilities: nullable(formData.get("responsibilities"), 2000),
    can_manage: canManageMember,
    status,
    assigned_by: user.id,
  }, {onConflict: "event_id,user_id"});
  if (error) goEvent(message(copy.saveFailed, {message: error.message}), "error", eventId);

  await createNotification({
    organizationId: event.organization_id,
    userId,
    actorId: user.id,
    category: "meetings",
    eventType: "event_team_assignment",
    titleFr: "Nouvelle équipe de mission",
    titleEn: "New mission team",
    bodyFr: `Tu as été affecté à l’événement « ${event.name} » en tant que ${missionRole}.`,
    bodyEn: `You have been assigned to the event “${event.name}” as ${missionRole}.`,
    actionUrl: `/dashboard/events?event=${eventId}`,
    requiresAction: true,
    dedupeKey: `event-member:${eventId}:${userId}`,
    metadata: {event_id: eventId, mission_role: missionRole},
  });
  await logEvent(admin, {organizationId: event.organization_id, eventId, actorId: user.id, action: "member_assigned", targetUserId: userId, details: {mission_role: missionRole, unit_name: unitName, can_manage: canManageMember, status}});
  refreshEventViews();
  goEvent(copy.memberAssigned, "success", eventId, "team");
}

export async function removeEventMemberAction(formData: FormData) {
  const eventId = first(formData.get("eventId"));
  const userId = first(formData.get("userId"));
  const {user, admin, event, canManage, copy} = await eventContext(eventId);
  if (!canManage) goEvent(copy.permission, "error", eventId);
  if (userId === event.leader_id) goEvent(copy.permission, "error", eventId);

  const {error} = await admin.from("event_team_members").update({status: "removed", can_manage: false}).eq("event_id", eventId).eq("user_id", userId);
  if (error) goEvent(message(copy.saveFailed, {message: error.message}), "error", eventId);
  await logEvent(admin, {organizationId: event.organization_id, eventId, actorId: user.id, action: "member_removed", targetUserId: userId});
  refreshEventViews();
  goEvent(copy.memberRemoved, "success", eventId, "team");
}

export async function createEventTaskAction(formData: FormData) {
  const eventId = first(formData.get("eventId"));
  const {user, admin, event, canManage, copy} = await eventContext(eventId);
  if (!canManage) goEvent(copy.permission, "error", eventId);
  const title = clean(formData.get("title"), 200);
  const assigneeId = first(formData.get("assigneeId"));
  const priority = taskPriorities.has(first(formData.get("priority"))) ? first(formData.get("priority")) : "normal";
  const dueAt = first(formData.get("dueAt")) ? zonedLocalToIso(formData.get("dueAt"), event.timezone) : null;
  if (title.length < 2) goEvent(copy.invalid, "error", eventId);
  if (assigneeId && !(await activeOrganizationMember(admin, event.organization_id, assigneeId))) goEvent(copy.memberInvalid, "error", eventId);

  const {data: task, error} = await admin.from("event_tasks").insert({
    organization_id: event.organization_id,
    event_id: eventId,
    title,
    description: nullable(formData.get("description"), 3000),
    milestone: nullable(formData.get("milestone"), 160),
    assignee_id: assigneeId || null,
    priority,
    status: "todo",
    progress: 0,
    due_at: dueAt,
    budget_estimate: first(formData.get("budgetEstimate")) ? Math.max(0, numberValue(formData.get("budgetEstimate"))) : null,
    currency: clean(formData.get("currency"), 3).toUpperCase() || "USD",
    created_by: user.id,
  }).select("id").single<{id: string}>();
  if (error || !task) goEvent(message(copy.saveFailed, {message: error?.message ?? "Unknown error"}), "error", eventId);

  if (assigneeId) {
    await createNotification({
      organizationId: event.organization_id,
      userId: assigneeId,
      actorId: user.id,
      category: "meetings",
      eventType: "event_task_assigned",
      titleFr: "Nouvelle tâche événementielle",
      titleEn: "New event task",
      bodyFr: `La tâche « ${title} » t’a été attribuée pour ${event.name}.`,
      bodyEn: `The task “${title}” has been assigned to you for ${event.name}.`,
      actionUrl: `/dashboard/events?event=${eventId}`,
      requiresAction: true,
      dedupeKey: `event-task:${task.id}:${assigneeId}`,
      metadata: {event_id: eventId, task_id: task.id},
    });
  }
  await logEvent(admin, {organizationId: event.organization_id, eventId, actorId: user.id, action: "task_created", targetUserId: assigneeId || null, details: {task_id: task.id, title, priority, due_at: dueAt}});
  refreshEventViews();
  goEvent(copy.taskCreated, "success", eventId, "tasks");
}

export async function updateEventTaskAction(formData: FormData) {
  const taskId = first(formData.get("taskId"));
  const eventId = first(formData.get("eventId"));
  const base = await context();
  const {data: task, error: taskError} = await base.admin
    .from("event_tasks")
    .select("id,event_id,organization_id,assignee_id")
    .eq("id", taskId)
    .eq("organization_id", base.membership.organization_id)
    .maybeSingle<TaskRow>();
  if (taskError || !task || task.event_id !== eventId) {
    goEvent(base.copy.eventMissing, "error", eventId);
  }

  const eventBase = await eventContext(eventId);
  const selfAssignee = task.assignee_id === base.user.id;
  if (!eventBase.canManage && !selfAssignee) {
    goEvent(base.copy.permission, "error", eventId);
  }

  const status = taskStatuses.has(first(formData.get("status")))
    ? first(formData.get("status"))
    : "todo";
  const progress = Math.max(0, Math.min(100, integerValue(formData.get("progress"))));
  const updatePayload: Record<string, unknown> = {
    status,
    progress: status === "done" ? 100 : progress,
    notes: nullable(formData.get("notes"), 2000),
    proof_url: normalizeUrl(formData.get("proofUrl")),
    completed_at: status === "done" ? new Date().toISOString() : null,
  };

  let nextAssigneeId = task.assignee_id;
  let updatedTitle = "";
  const definitionSubmitted = eventBase.canManage && formData.has("title");

  if (definitionSubmitted) {
    updatedTitle = clean(formData.get("title"), 200);
    const assigneeId = first(formData.get("assigneeId"));
    const priority = taskPriorities.has(first(formData.get("priority")))
      ? first(formData.get("priority"))
      : "normal";
    const dueRaw = first(formData.get("dueAt"));
    const dueAt = dueRaw ? zonedLocalToIso(formData.get("dueAt"), eventBase.event.timezone) : null;

    if (updatedTitle.length < 2 || (dueRaw && !dueAt)) {
      goEvent(base.copy.invalid, "error", eventId);
    }
    if (assigneeId && !(await activeEventTeamMember(base.admin, eventId, assigneeId))) {
      goEvent(base.copy.memberInvalid, "error", eventId);
    }

    nextAssigneeId = assigneeId || null;
    updatePayload.title = updatedTitle;
    updatePayload.description = nullable(formData.get("description"), 3000);
    updatePayload.milestone = nullable(formData.get("milestone"), 160);
    updatePayload.assignee_id = nextAssigneeId;
    updatePayload.priority = priority;
    updatePayload.due_at = dueAt;
    updatePayload.budget_estimate = first(formData.get("budgetEstimate"))
      ? Math.max(0, numberValue(formData.get("budgetEstimate")))
      : null;
    updatePayload.currency = clean(formData.get("currency"), 3).toUpperCase() || "USD";
  }

  if (eventBase.canManage) {
    updatePayload.actual_cost = first(formData.get("actualCost"))
      ? Math.max(0, numberValue(formData.get("actualCost")))
      : null;
  }

  const {error} = await base.admin
    .from("event_tasks")
    .update(updatePayload)
    .eq("id", taskId)
    .eq("event_id", eventId);
  if (error) {
    goEvent(message(base.copy.saveFailed, {message: error.message}), "error", eventId);
  }

  if (definitionSubmitted && nextAssigneeId && nextAssigneeId !== task.assignee_id) {
    await createNotification({
      organizationId: task.organization_id,
      userId: nextAssigneeId,
      actorId: base.user.id,
      category: "meetings",
      eventType: "event_task_assigned",
      titleFr: "Nouvelle tâche événementielle",
      titleEn: "New event task",
      bodyFr: `La tâche « ${updatedTitle} » t’a été attribuée pour ${eventBase.event.name}.`,
      bodyEn: `The task “${updatedTitle}” has been assigned to you for ${eventBase.event.name}.`,
      actionUrl: `/dashboard/events?event=${eventId}`,
      requiresAction: true,
      dedupeKey: `event-task:${taskId}:${nextAssigneeId}`,
      metadata: {event_id: eventId, task_id: taskId},
    });
  }

  await logEvent(base.admin, {
    organizationId: task.organization_id,
    eventId,
    actorId: base.user.id,
    action: definitionSubmitted ? "task_definition_updated" : "task_progress_updated",
    targetUserId: nextAssigneeId,
    details: {
      task_id: taskId,
      status,
      progress: status === "done" ? 100 : progress,
      previous_assignee_id: task.assignee_id,
      assignee_id: nextAssigneeId,
    },
  });
  refreshEventViews();
  goEvent(base.copy.taskUpdated, "success", eventId, "tasks");
}

export async function createEventScheduleItemAction(formData: FormData) {
  const eventId = first(formData.get("eventId"));
  const {user, admin, event, canManage, copy} = await eventContext(eventId);
  if (!canManage) goEvent(copy.permission, "error", eventId);
  const title = clean(formData.get("title"), 200);
  const itemType = scheduleTypes.has(first(formData.get("itemType"))) ? first(formData.get("itemType")) : "session";
  const status = scheduleStatuses.has(first(formData.get("status"))) ? first(formData.get("status")) : "planned";
  const startAt = zonedLocalToIso(formData.get("startAt"), event.timezone);
  const endAt = zonedLocalToIso(formData.get("endAt"), event.timezone);
  const ownerId = first(formData.get("ownerId"));
  const requestedZoomHostId = clean(formData.get("zoomHostAccountId"), 100);
  const meetingDepartment = clean(formData.get("meetingDepartment"), 160);
  const createZoomRequested = formData.get("createZoom") === "on" && itemType === "meeting";
  if (title.length < 2 || !startAt || !endAt || endAt <= startAt) goEvent(copy.invalid, "error", eventId);
  if (ownerId && !(await activeOrganizationMember(admin, event.organization_id, ownerId))) goEvent(copy.memberInvalid, "error", eventId);

  let zoomMeeting: Awaited<ReturnType<typeof createZoomMeeting>> | null = null;
  let selectedZoomHost: Awaited<ReturnType<typeof resolveZoomHost>> = null;
  let performanceMeetingId: string | null = null;
  if (createZoomRequested) {
    await enforceOrganizationFeature(event.organization_id, "api_integrations");
    const zoom = await zoomAvailableForOrganization(admin, event.organization_id);
    if (!zoom.available) {
      goEvent("Zoom n’est pas encore configuré pour cette organisation.", "error", eventId, "schedule");
    }
    try {
      selectedZoomHost = await resolveZoomHost(admin, {
        organizationId: event.organization_id,
        hostAccountId: requestedZoomHostId || null,
        department: meetingDepartment || null,
        fallbackEmail: zoom.settings.default_host_email,
      });
      if (!selectedZoomHost) throw new Error("Aucun compte Zoom hôte actif n’est disponible.");
      await assertZoomHostAvailability(admin, {
        organizationId: event.organization_id,
        host: selectedZoomHost,
        startsAt: startAt,
        endsAt: endAt,
      });
      zoomMeeting = await createZoomMeeting({
        hostEmail: selectedZoomHost.email,
        topic: `${event.name} — ${title}`,
        startTime: startAt,
        durationMinutes: Math.max(15, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000)),
        timezone: event.timezone,
        agenda: nullable(formData.get("notes"), 2000),
      });
      const {data: performanceMeeting, error: meetingError} = await admin.from("performance_meetings").insert({
        organization_id: event.organization_id,
        title: `${event.name} — ${title}`,
        meeting_type: "company",
        mandatory: true,
        starts_at: startAt,
        ends_at: endAt,
        notes: nullable(formData.get("notes"), 2000),
        created_by: user.id,
        provider: "zoom",
        meeting_url: zoomMeeting.join_url,
        zoom_meeting_id: String(zoomMeeting.id),
        zoom_meeting_uuid: zoomMeeting.uuid,
        zoom_host_id: zoomMeeting.host_id || selectedZoomHost.zoom_user_id,
        zoom_host_email: zoomMeeting.host_email || selectedZoomHost.email,
        zoom_host_account_id: selectedZoomHost.id || null,
        zoom_department: meetingDepartment || selectedZoomHost.department || null,
        zoom_start_url: null,
        zoom_status: "scheduled",
        zoom_created_at: new Date().toISOString(),
        source_type: "event",
        source_id: eventId,
      }).select("id").single<{id: string}>();
      if (meetingError || !performanceMeeting) throw new Error(meetingError?.message || "Unable to create the Super Leader meeting.");
      performanceMeetingId = performanceMeeting.id;

      const {data: teamRows} = await admin
        .from("event_team_members")
        .select("user_id")
        .eq("event_id", eventId)
        .in("status", ["assigned", "confirmed"]);
      const participantIds = new Set<string>((teamRows || []).map((row) => String(row.user_id)));
      if (event.leader_id) participantIds.add(event.leader_id);
      if (ownerId) participantIds.add(ownerId);
      if (participantIds.size) {
        const {error: attendeeError} = await admin.from("performance_meeting_attendance").insert([...participantIds].map((participantId) => ({
          organization_id: event.organization_id,
          meeting_id: performanceMeeting.id,
          user_id: participantId,
          status: "invited",
        })));
        if (attendeeError) throw new Error(attendeeError.message);
      }
    } catch (error) {
      if (performanceMeetingId) await admin.from("performance_meetings").delete().eq("id", performanceMeetingId);
      if (zoomMeeting) await deleteZoomMeeting(String(zoomMeeting.id)).catch(() => undefined);
      goEvent(`Création Zoom impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`, "error", eventId, "schedule");
    }
  }

  const manualMeetingUrl = normalizeUrl(formData.get("meetingUrl"));
  const {data: scheduleItem, error} = await admin.from("event_schedule_items").insert({
    organization_id: event.organization_id,
    event_id: eventId,
    title,
    item_type: itemType,
    start_at: startAt,
    end_at: endAt,
    location: nullable(formData.get("location"), 240),
    meeting_url: zoomMeeting?.join_url || manualMeetingUrl,
    performance_meeting_id: performanceMeetingId,
    unit_name: nullable(formData.get("unitName"), 160),
    owner_id: ownerId || null,
    status,
    notes: nullable(formData.get("notes"), 2000),
    created_by: user.id,
  }).select("id").single<{id: string}>();
  if (error || !scheduleItem) {
    if (performanceMeetingId) await admin.from("performance_meetings").delete().eq("id", performanceMeetingId);
    if (zoomMeeting) await deleteZoomMeeting(String(zoomMeeting.id)).catch(() => undefined);
    goEvent(message(copy.saveFailed, {message: error?.message ?? "Unknown error"}), "error", eventId);
  }
  await logEvent(admin, {organizationId: event.organization_id, eventId, actorId: user.id, action: "schedule_item_created", targetUserId: ownerId || null, details: {schedule_item_id: scheduleItem.id, title, start_at: startAt, end_at: endAt, provider: zoomMeeting ? "zoom" : "manual", performance_meeting_id: performanceMeetingId, zoom_host_email: selectedZoomHost?.email || null, zoom_department: meetingDepartment || selectedZoomHost?.department || null}});
  refreshEventViews();
  goEvent(zoomMeeting ? "Activité et réunion Zoom ajoutées au planning." : copy.scheduleCreated, "success", eventId, "schedule");
}

export async function addEventDocumentAction(formData: FormData) {
  const eventId = first(formData.get("eventId"));
  const {user, admin, event, canManage, copy} = await eventContext(eventId);
  if (!canManage) goEvent(copy.permission, "error", eventId);
  const title = clean(formData.get("title"), 200);
  const category = documentCategories.has(first(formData.get("category"))) ? first(formData.get("category")) : "other";
  const documentUrl = normalizeUrl(formData.get("documentUrl"));
  if (title.length < 2 || !documentUrl) goEvent(copy.invalid, "error", eventId);
  const {error} = await admin.from("event_documents").insert({
    organization_id: event.organization_id,
    event_id: eventId,
    title,
    category,
    document_url: documentUrl,
    notes: nullable(formData.get("notes"), 1200),
    uploaded_by: user.id,
  });
  if (error) goEvent(message(copy.saveFailed, {message: error.message}), "error", eventId);
  await logEvent(admin, {organizationId: event.organization_id, eventId, actorId: user.id, action: "document_added", details: {title, category, document_url: documentUrl}});
  refreshEventViews();
  goEvent(copy.documentAdded, "success", eventId, "documents");
}

export async function saveEventClosureReportAction(formData: FormData) {
  const eventId = first(formData.get("eventId"));
  const {user, admin, event, canManage, copy} = await eventContext(eventId);
  if (!canManage) goEvent(copy.permission, "error", eventId);
  const currency = clean(formData.get("currency"), 3).toUpperCase() || "USD";
  const {error} = await admin.from("event_closure_reports").upsert({
    organization_id: event.organization_id,
    event_id: eventId,
    actual_participants: Math.max(0, integerValue(formData.get("actualParticipants"))),
    revenue_amount: first(formData.get("revenueAmount")) ? Math.max(0, numberValue(formData.get("revenueAmount"))) : null,
    expense_amount: first(formData.get("expenseAmount")) ? Math.max(0, numberValue(formData.get("expenseAmount"))) : null,
    currency,
    objectives_achieved: nullable(formData.get("objectivesAchieved"), 4000),
    highlights: nullable(formData.get("highlights"), 4000),
    incidents: nullable(formData.get("incidents"), 4000),
    lessons_learned: nullable(formData.get("lessonsLearned"), 4000),
    recommendations: nullable(formData.get("recommendations"), 4000),
    submitted_by: user.id,
    submitted_at: new Date().toISOString(),
  }, {onConflict: "event_id"});
  if (error) goEvent(message(copy.saveFailed, {message: error.message}), "error", eventId);
  await logEvent(admin, {organizationId: event.organization_id, eventId, actorId: user.id, action: "closure_report_saved", details: {actual_participants: Math.max(0, integerValue(formData.get("actualParticipants"))), currency}});
  refreshEventViews();
  goEvent(copy.reportSaved, "success", eventId, "report");
}
