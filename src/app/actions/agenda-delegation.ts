"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {normalizeTimeZone} from "@/lib/timezone";

type Membership = {organization_id: string; role: string};
type DelegationRow = {
  id: string;
  principal_user_id: string;
  delegate_user_id: string;
  access_level: "availability" | "manage" | "executive";
  can_view_private_details: boolean;
  expires_on: string | null;
  is_active: boolean;
};
type AppointmentRow = {
  id: string;
  owner_user_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  timezone: string;
  title: string;
  location: string | null;
  meeting_link: string | null;
  attendees: string | null;
  notes: string | null;
  visibility: "normal" | "private";
  status: "scheduled" | "cancelled";
  created_by: string;
};

const levels = new Set(["availability", "manage", "executive"]);
const editableLevels = new Set(["manage", "executive"]);

function text(value: FormDataEntryValue | null, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function dateValue(value: FormDataEntryValue | null) {
  const raw = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : raw;
}

function monthValue(value: FormDataEntryValue | null) {
  const raw = text(value, 7);
  return /^\d{4}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 7);
}

function timeValue(value: FormDataEntryValue | null) {
  const raw = text(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : "";
}

function cleanUrl(value: FormDataEntryValue | null) {
  const raw = text(value, 700);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!new Set(["https:", "http:"]).has(parsed.protocol)) return null;
    return parsed.toString().slice(0, 700);
  } catch {
    return null;
  }
}

function isExpired(expiresOn: string | null) {
  return Boolean(expiresOn && expiresOn < new Date().toISOString().slice(0, 10));
}

function go(message: string, kind: "success" | "error", month: string, owner = "", appointment = ""): never {
  const params = new URLSearchParams({month, [kind]: message});
  if (owner) params.set("agendaOwner", owner);
  if (appointment) params.set("appointment", appointment);
  redirect(`/dashboard/schedule?${params.toString()}#agenda-delegation-center`);
}

async function getContext() {
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();
  if (error) throw new Error(error.message);
  if (!membership) redirect("/dashboard/company");
  return {user: authData.user, membership, admin};
}

async function activeMember(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  userId: string,
) {
  const {data} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle<{user_id: string}>();
  return Boolean(data);
}

async function getDelegation(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  principalUserId: string,
  delegateUserId: string,
) {
  const {data} = await admin
    .from("schedule_delegations")
    .select("id, principal_user_id, delegate_user_id, access_level, can_view_private_details, expires_on, is_active")
    .eq("organization_id", organizationId)
    .eq("principal_user_id", principalUserId)
    .eq("delegate_user_id", delegateUserId)
    .eq("is_active", true)
    .maybeSingle<DelegationRow>();
  if (!data || isExpired(data.expires_on)) return null;
  return data;
}

async function audit(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    organizationId: string;
    actorId: string;
    principalUserId: string;
    delegateUserId?: string | null;
    appointmentId?: string | null;
    delegationId?: string | null;
    action: string;
    details?: Record<string, unknown>;
  },
) {
  const {error} = await admin.from("schedule_delegation_audit_log").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    principal_user_id: input.principalUserId,
    delegate_user_id: input.delegateUserId ?? null,
    appointment_id: input.appointmentId ?? null,
    delegation_id: input.delegationId ?? null,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Agenda delegation audit failed", error);
}

async function notify(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    organizationId: string;
    userId: string;
    actorId: string;
    eventType: string;
    titleFr: string;
    titleEn: string;
    bodyFr: string;
    bodyEn: string;
    dedupeKey: string;
    metadata?: Record<string, unknown>;
  },
) {
  const {error} = await admin.from("notifications").insert({
    organization_id: input.organizationId,
    user_id: input.userId,
    actor_id: input.actorId,
    category: "system",
    event_type: input.eventType,
    priority: "info",
    title_fr: input.titleFr,
    title_en: input.titleEn,
    body_fr: input.bodyFr,
    body_en: input.bodyEn,
    action_url: "/dashboard/schedule#agenda-delegation-center",
    requires_action: false,
    status: "unread",
    email_requested: false,
    email_status: "skipped",
    dedupe_key: input.dedupeKey,
    metadata: input.metadata ?? {},
  });
  if (error && error.code !== "23505") console.error("Agenda notification failed", error);
}

function revalidateAgenda() {
  revalidatePath("/dashboard/schedule");
  revalidatePath("/dashboard/my-day");
}

export async function saveScheduleDelegationAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const month = monthValue(formData.get("month"));
  const delegateUserId = text(formData.get("delegateUserId"), 80);
  const accessLevel = text(formData.get("accessLevel"), 30);
  const expiresOn = dateValue(formData.get("expiresOn")) || null;
  const canViewPrivateDetails = formData.get("canViewPrivateDetails") === "on";

  if (!delegateUserId || delegateUserId === user.id || !levels.has(accessLevel)) {
    go("Délégation invalide.", "error", month);
  }
  if (!(await activeMember(admin, membership.organization_id, delegateUserId))) {
    go("Le collaborateur sélectionné n'est pas un membre actif de cette organisation.", "error", month);
  }
  if (expiresOn && expiresOn < new Date().toISOString().slice(0, 10)) {
    go("La date d'expiration doit être aujourd'hui ou dans le futur.", "error", month);
  }

  const {data: existing} = await admin
    .from("schedule_delegations")
    .select("id, access_level, can_view_private_details, expires_on, is_active")
    .eq("organization_id", membership.organization_id)
    .eq("principal_user_id", user.id)
    .eq("delegate_user_id", delegateUserId)
    .maybeSingle<{id: string; access_level: string; can_view_private_details: boolean; expires_on: string | null; is_active: boolean}>();

  const payload = {
    organization_id: membership.organization_id,
    principal_user_id: user.id,
    delegate_user_id: delegateUserId,
    access_level: accessLevel,
    can_view_private_details: editableLevels.has(accessLevel) ? canViewPrivateDetails : false,
    expires_on: expiresOn,
    is_active: true,
    revoked_at: null,
    revoked_by: null,
    updated_by: user.id,
  };

  let delegationId = existing?.id ?? "";
  if (existing) {
    const {data, error} = await admin
      .from("schedule_delegations")
      .update(payload)
      .eq("id", existing.id)
      .eq("organization_id", membership.organization_id)
      .select("id")
      .single<{id: string}>();
    if (error) go(`Impossible d'enregistrer la délégation : ${error.message}`, "error", month);
    delegationId = data.id;
  } else {
    const {data, error} = await admin
      .from("schedule_delegations")
      .insert({...payload, created_by: user.id})
      .select("id")
      .single<{id: string}>();
    if (error) go(`Impossible d'enregistrer la délégation : ${error.message}`, "error", month);
    delegationId = data.id;
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    principalUserId: user.id,
    delegateUserId,
    delegationId,
    action: existing ? "delegation_updated" : "delegation_created",
    details: {
      accessLevel,
      canViewPrivateDetails: editableLevels.has(accessLevel) ? canViewPrivateDetails : false,
      expiresOn,
      previous: existing ?? null,
    },
  });

  await notify(admin, {
    organizationId: membership.organization_id,
    userId: delegateUserId,
    actorId: user.id,
    eventType: existing ? "agenda_delegation_updated" : "agenda_delegation_assigned",
    titleFr: "Accès délégué à un agenda",
    titleEn: "Delegated calendar access",
    bodyFr: "Un responsable vous a confié un accès délégué à son agenda dans Super Leader.",
    bodyEn: "A leader has delegated access to their calendar to you in Super Leader.",
    dedupeKey: `agenda-delegation:${delegationId}:${Date.now()}`,
    metadata: {delegationId, principalUserId: user.id, accessLevel},
  });

  revalidateAgenda();
  go("Délégation d'agenda enregistrée.", "success", month);
}

export async function revokeScheduleDelegationAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const month = monthValue(formData.get("month"));
  const delegationId = text(formData.get("delegationId"), 80);

  const {data: delegation} = await admin
    .from("schedule_delegations")
    .select("id, principal_user_id, delegate_user_id")
    .eq("id", delegationId)
    .eq("organization_id", membership.organization_id)
    .eq("principal_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle<{id: string; principal_user_id: string; delegate_user_id: string}>();
  if (!delegation) go("Délégation introuvable ou non autorisée.", "error", month);

  const {error} = await admin
    .from("schedule_delegations")
    .update({is_active: false, revoked_at: new Date().toISOString(), revoked_by: user.id, updated_by: user.id})
    .eq("id", delegation.id);
  if (error) go(`Impossible de retirer la délégation : ${error.message}`, "error", month);

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    principalUserId: user.id,
    delegateUserId: delegation.delegate_user_id,
    delegationId: delegation.id,
    action: "delegation_revoked",
  });

  await notify(admin, {
    organizationId: membership.organization_id,
    userId: delegation.delegate_user_id,
    actorId: user.id,
    eventType: "agenda_delegation_revoked",
    titleFr: "Délégation d'agenda retirée",
    titleEn: "Calendar delegation removed",
    bodyFr: "Votre accès délégué à cet agenda a été retiré.",
    bodyEn: "Your delegated access to this calendar has been removed.",
    dedupeKey: `agenda-delegation-revoked:${delegation.id}:${Date.now()}`,
    metadata: {delegationId: delegation.id, principalUserId: user.id},
  });

  revalidateAgenda();
  go("Délégation retirée.", "success", month);
}

export async function savePersonalAgendaAppointmentAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const month = monthValue(formData.get("month"));
  const ownerUserId = text(formData.get("ownerUserId"), 80) || user.id;
  const appointmentId = text(formData.get("appointmentId"), 80);
  const workDate = dateValue(formData.get("workDate"));
  const startTime = timeValue(formData.get("startTime"));
  const endTime = timeValue(formData.get("endTime"));
  const timezone = normalizeTimeZone(text(formData.get("timezone"), 80));
  const title = text(formData.get("title"), 180);
  const location = text(formData.get("location"), 240) || null;
  const meetingLinkRaw = text(formData.get("meetingLink"), 700);
  const meetingLink = meetingLinkRaw ? cleanUrl(formData.get("meetingLink")) : null;
  const attendees = text(formData.get("attendees"), 1200) || null;
  const notes = text(formData.get("notes"), 3000) || null;
  const visibility = formData.get("private") === "on" ? "private" : "normal";

  if (!workDate || !startTime || !endTime || endTime <= startTime || !title) {
    go("Renseignez une date, un titre et des heures valides.", "error", month, ownerUserId, appointmentId);
  }
  if (meetingLinkRaw && !meetingLink) {
    go("Le lien de réunion doit commencer par http:// ou https://.", "error", month, ownerUserId, appointmentId);
  }
  if (!(await activeMember(admin, membership.organization_id, ownerUserId))) {
    go("Le propriétaire de l'agenda n'est pas un membre actif.", "error", month);
  }

  const delegation = ownerUserId === user.id
    ? null
    : await getDelegation(admin, membership.organization_id, ownerUserId, user.id);
  if (ownerUserId !== user.id && (!delegation || !editableLevels.has(delegation.access_level))) {
    go("Vous n'avez pas le droit de modifier cet agenda.", "error", month, ownerUserId);
  }
  if (visibility === "private" && ownerUserId !== user.id && !delegation?.can_view_private_details) {
    go("Le propriétaire n'a pas autorisé la gestion des détails privés.", "error", month, ownerUserId);
  }

  let existing: AppointmentRow | null = null;
  if (appointmentId) {
    const {data} = await admin
      .from("personal_agenda_appointments")
      .select("id, owner_user_id, work_date, start_time, end_time, timezone, title, location, meeting_link, attendees, notes, visibility, status, created_by")
      .eq("id", appointmentId)
      .eq("organization_id", membership.organization_id)
      .eq("owner_user_id", ownerUserId)
      .maybeSingle<AppointmentRow>();
    existing = data ?? null;
    if (!existing || existing.status === "cancelled") {
      go("Rendez-vous introuvable.", "error", month, ownerUserId);
    }
    if (existing.visibility === "private" && ownerUserId !== user.id && !delegation?.can_view_private_details) {
      go("Ce rendez-vous privé ne peut pas être modifié avec votre niveau d'accès.", "error", month, ownerUserId);
    }
  }

  const payload = {
    organization_id: membership.organization_id,
    owner_user_id: ownerUserId,
    work_date: workDate,
    start_time: startTime,
    end_time: endTime,
    timezone,
    title,
    location,
    meeting_link: meetingLink,
    attendees,
    notes,
    visibility,
    source: ownerUserId === user.id ? "self" : "delegate",
    updated_by: user.id,
  };

  let savedId = appointmentId;
  if (existing) {
    const {data, error} = await admin
      .from("personal_agenda_appointments")
      .update(payload)
      .eq("id", existing.id)
      .eq("organization_id", membership.organization_id)
      .select("id")
      .single<{id: string}>();
    if (error) go(`Impossible de modifier le rendez-vous : ${error.message}`, "error", month, ownerUserId, appointmentId);
    savedId = data.id;
  } else {
    const {data, error} = await admin
      .from("personal_agenda_appointments")
      .insert({...payload, status: "scheduled", created_by: user.id})
      .select("id")
      .single<{id: string}>();
    if (error) go(`Impossible de créer le rendez-vous : ${error.message}`, "error", month, ownerUserId);
    savedId = data.id;
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    principalUserId: ownerUserId,
    delegateUserId: ownerUserId === user.id ? null : user.id,
    appointmentId: savedId,
    delegationId: delegation?.id ?? null,
    action: existing ? "appointment_updated" : "appointment_created",
    details: {
      workDate,
      startTime,
      endTime,
      visibility,
      title: visibility === "private" ? "[private]" : title,
      previous: existing ? {
        workDate: existing.work_date,
        startTime: existing.start_time,
        endTime: existing.end_time,
        visibility: existing.visibility,
      } : null,
    },
  });

  if (ownerUserId !== user.id) {
    await notify(admin, {
      organizationId: membership.organization_id,
      userId: ownerUserId,
      actorId: user.id,
      eventType: existing ? "agenda_appointment_updated_by_delegate" : "agenda_appointment_created_by_delegate",
      titleFr: existing ? "Votre agenda a été modifié" : "Nouveau rendez-vous dans votre agenda",
      titleEn: existing ? "Your calendar was updated" : "New appointment in your calendar",
      bodyFr: `${existing ? "Un rendez-vous a été modifié" : "Un rendez-vous a été planifié"} pour le ${workDate} de ${startTime} à ${endTime} par votre assistant(e) délégué(e).`,
      bodyEn: `${existing ? "An appointment was updated" : "An appointment was scheduled"} for ${workDate} from ${startTime} to ${endTime} by your delegated assistant.`,
      dedupeKey: `agenda-appointment:${savedId}:${existing ? "updated" : "created"}:${Date.now()}`,
      metadata: {appointmentId: savedId, workDate, startTime, endTime, delegateUserId: user.id},
    });
  }

  revalidateAgenda();
  go(existing ? "Rendez-vous modifié." : "Rendez-vous ajouté à l'agenda.", "success", month, ownerUserId);
}

export async function cancelPersonalAgendaAppointmentAction(formData: FormData) {
  const {user, membership, admin} = await getContext();
  const month = monthValue(formData.get("month"));
  const ownerUserId = text(formData.get("ownerUserId"), 80) || user.id;
  const appointmentId = text(formData.get("appointmentId"), 80);
  const reason = text(formData.get("reason"), 500) || "Annulé depuis Super Leader";

  const {data: appointment} = await admin
    .from("personal_agenda_appointments")
    .select("id, owner_user_id, work_date, start_time, end_time, title, visibility, status")
    .eq("id", appointmentId)
    .eq("organization_id", membership.organization_id)
    .eq("owner_user_id", ownerUserId)
    .maybeSingle<{id: string; owner_user_id: string; work_date: string; start_time: string; end_time: string; title: string; visibility: string; status: string}>();
  if (!appointment || appointment.status === "cancelled") {
    go("Rendez-vous introuvable.", "error", month, ownerUserId);
  }

  const delegation = ownerUserId === user.id
    ? null
    : await getDelegation(admin, membership.organization_id, ownerUserId, user.id);
  const canCancel = ownerUserId === user.id || delegation?.access_level === "executive";
  if (!canCancel) {
    go("Seul le propriétaire ou un assistant exécutif peut annuler ce rendez-vous.", "error", month, ownerUserId);
  }
  if (appointment.visibility === "private" && ownerUserId !== user.id && !delegation?.can_view_private_details) {
    go("Ce rendez-vous privé ne peut pas être annulé avec votre niveau d'accès.", "error", month, ownerUserId);
  }

  const {error} = await admin
    .from("personal_agenda_appointments")
    .update({status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: user.id, cancellation_reason: reason, updated_by: user.id})
    .eq("id", appointment.id);
  if (error) go(`Impossible d'annuler le rendez-vous : ${error.message}`, "error", month, ownerUserId);

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    principalUserId: ownerUserId,
    delegateUserId: ownerUserId === user.id ? null : user.id,
    appointmentId: appointment.id,
    delegationId: delegation?.id ?? null,
    action: "appointment_cancelled",
    details: {reason, workDate: appointment.work_date, startTime: appointment.start_time, endTime: appointment.end_time},
  });

  if (ownerUserId !== user.id) {
    await notify(admin, {
      organizationId: membership.organization_id,
      userId: ownerUserId,
      actorId: user.id,
      eventType: "agenda_appointment_cancelled_by_delegate",
      titleFr: "Un rendez-vous a été annulé",
      titleEn: "An appointment was cancelled",
      bodyFr: `Votre assistant(e) délégué(e) a annulé un rendez-vous du ${appointment.work_date} (${appointment.start_time.slice(0, 5)}-${appointment.end_time.slice(0, 5)}).`,
      bodyEn: `Your delegated assistant cancelled an appointment on ${appointment.work_date} (${appointment.start_time.slice(0, 5)}-${appointment.end_time.slice(0, 5)}).`,
      dedupeKey: `agenda-appointment:${appointment.id}:cancelled:${Date.now()}`,
      metadata: {appointmentId: appointment.id, reason},
    });
  }

  revalidateAgenda();
  go("Rendez-vous annulé.", "success", month, ownerUserId);
}
