"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getVipProgramSettings} from "@/lib/vip/settings";

const VIP_ROLES = new Set(["owner", "admin", "executive", "hr"]);
const VIP_SETTINGS_ROLES = new Set(["owner", "admin"]);
const VIP_OPERATIONS_ROLES = new Set(["owner", "admin", "hr"]);
const VIP_DECISION_ROLES = new Set(["owner", "admin", "executive"]);
const MEETING_STATUSES = new Set(["planning", "announced", "registration_open", "confirmed", "completed", "cancelled"]);
const INVITATION_STATUSES = new Set(["invited", "confirmed", "declined", "waitlisted", "attended", "absent", "cancelled"]);
const AGENDA_STATUSES = new Set(["planned", "confirmed", "completed", "cancelled"]);

function text(value: FormDataEntryValue | null, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function dateValue(value: FormDataEntryValue | null) {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return "";
  return Number.isNaN(new Date(`${result}T00:00:00Z`).getTime()) ? "" : result;
}

function timeValue(value: FormDataEntryValue | null) {
  const result = text(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(result) ? result : "";
}

function integerValue(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseInt(text(value, 12), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function go(message: string, kind: "success" | "error", meetingId?: string): never {
  const query = new URLSearchParams({[kind]: message});
  if (meetingId) query.set("meeting", meetingId);
  redirect(`/dashboard/vip/annual-meeting?${query.toString()}`);
}

async function getContext() {
  const {locale} = await getI18n();
  const translate = (frText: string, enText: string) => locale === "fr" ? frText : enText;
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string; is_active: boolean}>();

  if (error || !membership) redirect("/dashboard/company");
  if (!VIP_ROLES.has(membership.role)) redirect("/dashboard/my-day");
  return {user: authData.user, membership, admin, translate};
}

async function audit(input: {
  organizationId: string;
  entityType: "annual_meeting" | "meeting_invitation" | "meeting_agenda";
  entityId: string;
  actorId: string;
  action: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  details?: Record<string, unknown>;
  admin: ReturnType<typeof createAdminClient>;
}) {
  const {error} = await input.admin.from("vip_audit_log").insert({
    organization_id: input.organizationId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    actor_id: input.actorId,
    action: input.action,
    previous_status: input.previousStatus ?? null,
    new_status: input.newStatus ?? null,
    details: input.details ?? {},
  });
  if (error) console.error("VIP annual meeting audit failed", error);
}

async function getMeeting(input: {
  meetingId: string;
  organizationId: string;
  admin: ReturnType<typeof createAdminClient>;
}) {
  const {data, error} = await input.admin
    .from("vip_annual_meetings")
    .select("id,event_year,title,start_date,end_date,status")
    .eq("id", input.meetingId)
    .eq("organization_id", input.organizationId)
    .maybeSingle<{id: string; event_year: number; title: string; start_date: string; end_date: string; status: string}>();
  if (error) throw new Error(error.message);
  return data;
}

export async function createVipAnnualMeetingAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  if (!VIP_SETTINGS_ROLES.has(membership.role)) {
    go(translate("Seuls le Propriétaire et les Administrateurs peuvent créer la rencontre annuelle.", "Only the Owner and Administrators can create the annual gathering."), "error");
  }

  const eventYear = integerValue(formData.get("eventYear"));
  const title = text(formData.get("title"), 220);
  const hostCountry = text(formData.get("hostCountry"), 120);
  const hostCity = text(formData.get("hostCity"), 120);
  const startDate = dateValue(formData.get("startDate"));
  const endDateInput = dateValue(formData.get("endDate"));
  const registrationDeadline = dateValue(formData.get("registrationDeadline")) || null;
  const currentYear = new Date().getUTCFullYear();
  const settings = await getVipProgramSettings(admin, membership.organization_id);
  const calculatedEndDate = startDate ? (() => {
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Math.max(1, settings.annual_meeting_default_duration_days) - 1);
    return date.toISOString().slice(0, 10);
  })() : "";
  const endDate = endDateInput || calculatedEndDate;

  if (eventYear < currentYear - 1 || eventYear > currentYear + 10 || title.length < 3 || hostCountry.length < 2 || hostCity.length < 2 || !startDate || !endDate || endDate < startDate) {
    go(translate("Complète correctement l’année, le titre, le pays, la ville et les dates.", "Complete the year, title, country, city and dates correctly."), "error");
  }
  if (Number(startDate.slice(0, 4)) !== eventYear) {
    go(translate("L’année de la rencontre doit correspondre à l’année de la date de début.", "The gathering year must match the start date year."), "error");
  }
  if (registrationDeadline && registrationDeadline > startDate) {
    go(translate("La date limite d’inscription doit précéder la rencontre.", "The registration deadline must be before the gathering."), "error");
  }

  const {data: created, error} = await admin
    .from("vip_annual_meetings")
    .insert({
      organization_id: membership.organization_id,
      event_year: eventYear,
      title,
      theme: text(formData.get("theme"), 300) || null,
      host_country: hostCountry,
      host_city: hostCity,
      venue: text(formData.get("venue"), 300) || null,
      start_date: startDate,
      end_date: endDate,
      registration_deadline: registrationDeadline,
      status: "planning",
      description: text(formData.get("description"), 5000) || null,
      logistics_notes: text(formData.get("logisticsNotes"), 5000) || null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !created) {
    const duplicate = String(error?.code ?? "") === "23505";
    go(duplicate
      ? translate("Une rencontre VIP existe déjà pour cette année.", "A VIP gathering already exists for this year.")
      : translate("La rencontre n’a pas pu être créée : ", "The gathering could not be created: ") + (error?.message ?? "unknown error"), "error");
  }

  await audit({
    organizationId: membership.organization_id,
    entityType: "annual_meeting",
    entityId: created.id,
    actorId: user.id,
    action: "annual_meeting_created",
    newStatus: "planning",
    details: {eventYear, title, hostCountry, hostCity, startDate, endDate},
    admin,
  });

  revalidatePath("/dashboard/vip/annual-meeting");
  revalidatePath("/dashboard/vip");
  go(translate("Rencontre annuelle créée.", "Annual gathering created."), "success", created.id);
}

export async function updateVipAnnualMeetingAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  if (!VIP_SETTINGS_ROLES.has(membership.role)) {
    go(translate("Tu n’as pas l’autorisation de modifier la rencontre.", "You are not allowed to edit the gathering."), "error");
  }

  const meetingId = text(formData.get("meetingId"), 80);
  const meeting = await getMeeting({meetingId, organizationId: membership.organization_id, admin});
  if (!meeting) go(translate("Rencontre introuvable.", "Gathering not found."), "error");

  const title = text(formData.get("title"), 220);
  const hostCountry = text(formData.get("hostCountry"), 120);
  const hostCity = text(formData.get("hostCity"), 120);
  const startDate = dateValue(formData.get("startDate"));
  const endDate = dateValue(formData.get("endDate"));
  const registrationDeadline = dateValue(formData.get("registrationDeadline")) || null;

  if (title.length < 3 || hostCountry.length < 2 || hostCity.length < 2 || !startDate || !endDate || endDate < startDate || Number(startDate.slice(0, 4)) !== meeting.event_year) {
    go(translate("Vérifie le titre, le lieu et les dates de la rencontre.", "Check the gathering title, location and dates."), "error", meetingId);
  }
  if (registrationDeadline && registrationDeadline > startDate) {
    go(translate("La date limite d’inscription doit précéder la rencontre.", "The registration deadline must be before the gathering."), "error", meetingId);
  }

  const updates = {
    title,
    theme: text(formData.get("theme"), 300) || null,
    host_country: hostCountry,
    host_city: hostCity,
    venue: text(formData.get("venue"), 300) || null,
    start_date: startDate,
    end_date: endDate,
    registration_deadline: registrationDeadline,
    description: text(formData.get("description"), 5000) || null,
    logistics_notes: text(formData.get("logisticsNotes"), 5000) || null,
    updated_by: user.id,
  };

  const {error} = await admin
    .from("vip_annual_meetings")
    .update(updates)
    .eq("id", meetingId)
    .eq("organization_id", membership.organization_id);
  if (error) go(translate("La rencontre n’a pas pu être mise à jour : ", "The gathering could not be updated: ") + error.message, "error", meetingId);

  await audit({
    organizationId: membership.organization_id,
    entityType: "annual_meeting",
    entityId: meetingId,
    actorId: user.id,
    action: "annual_meeting_updated",
    details: {title, hostCountry, hostCity, startDate, endDate, registrationDeadline},
    admin,
  });

  revalidatePath("/dashboard/vip/annual-meeting");
  go(translate("Informations de la rencontre mises à jour.", "Gathering details updated."), "success", meetingId);
}

export async function updateVipAnnualMeetingStatusAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  if (!VIP_DECISION_ROLES.has(membership.role)) {
    go(translate("Tu n’as pas l’autorisation de modifier le statut.", "You are not allowed to change the status."), "error");
  }

  const meetingId = text(formData.get("meetingId"), 80);
  const nextStatus = text(formData.get("status"), 40);
  if (!MEETING_STATUSES.has(nextStatus)) go(translate("Statut invalide.", "Invalid status."), "error", meetingId);
  const meeting = await getMeeting({meetingId, organizationId: membership.organization_id, admin});
  if (!meeting) go(translate("Rencontre introuvable.", "Gathering not found."), "error");

  const {error} = await admin
    .from("vip_annual_meetings")
    .update({status: nextStatus, updated_by: user.id})
    .eq("id", meetingId)
    .eq("organization_id", membership.organization_id);
  if (error) go(translate("Le statut n’a pas pu être modifié : ", "The status could not be changed: ") + error.message, "error", meetingId);

  await audit({
    organizationId: membership.organization_id,
    entityType: "annual_meeting",
    entityId: meetingId,
    actorId: user.id,
    action: "annual_meeting_status_changed",
    previousStatus: meeting.status,
    newStatus: nextStatus,
    admin,
  });

  revalidatePath("/dashboard/vip/annual-meeting");
  go(translate("Statut de la rencontre mis à jour.", "Gathering status updated."), "success", meetingId);
}

export async function inviteVipAnnualMeetingMemberAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  if (!VIP_OPERATIONS_ROLES.has(membership.role)) {
    go(translate("Tu n’as pas l’autorisation d’envoyer des invitations.", "You are not allowed to send invitations."), "error");
  }

  const meetingId = text(formData.get("meetingId"), 80);
  const memberId = text(formData.get("memberId"), 80);
  const meeting = await getMeeting({meetingId, organizationId: membership.organization_id, admin});
  if (!meeting) go(translate("Rencontre introuvable.", "Gathering not found."), "error");

  const {data: member} = await admin
    .from("vip_members")
    .select("id,status,full_name")
    .eq("id", memberId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; status: string; full_name: string}>();
  if (!member || ["suspended", "withdrawn", "expired"].includes(member.status)) {
    go(translate("Le membre sélectionné n’est pas admissible à l’invitation.", "The selected member is not eligible for an invitation."), "error", meetingId);
  }

  const {data: created, error} = await admin
    .from("vip_annual_meeting_invitations")
    .insert({
      organization_id: membership.organization_id,
      meeting_id: meetingId,
      member_id: memberId,
      status: "invited",
      invited_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !created) {
    const duplicate = String(error?.code ?? "") === "23505";
    go(duplicate
      ? translate("Ce membre est déjà invité à cette rencontre.", "This member is already invited to this gathering.")
      : translate("L’invitation n’a pas pu être créée : ", "The invitation could not be created: ") + (error?.message ?? "unknown error"), "error", meetingId);
  }

  await audit({
    organizationId: membership.organization_id,
    entityType: "meeting_invitation",
    entityId: created.id,
    actorId: user.id,
    action: "annual_meeting_invitation_created",
    newStatus: "invited",
    details: {meetingId, memberId, memberName: member.full_name},
    admin,
  });

  revalidatePath("/dashboard/vip/annual-meeting");
  go(translate("Invitation ajoutée.", "Invitation added."), "success", meetingId);
}

export async function inviteAllVipAnnualMeetingMembersAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  if (!VIP_OPERATIONS_ROLES.has(membership.role)) {
    go(translate("Tu n’as pas l’autorisation d’envoyer des invitations.", "You are not allowed to send invitations."), "error");
  }

  const meetingId = text(formData.get("meetingId"), 80);
  const meeting = await getMeeting({meetingId, organizationId: membership.organization_id, admin});
  if (!meeting) go(translate("Rencontre introuvable.", "Gathering not found."), "error");

  const [membersResult, existingResult] = await Promise.all([
    admin
      .from("vip_members")
      .select("id")
      .eq("organization_id", membership.organization_id)
      .in("status", ["active", "honorary", "pending_renewal"]),
    admin
      .from("vip_annual_meeting_invitations")
      .select("member_id")
      .eq("meeting_id", meetingId)
      .eq("organization_id", membership.organization_id),
  ]);
  if (membersResult.error || existingResult.error) {
    go(translate("Impossible de préparer les invitations.", "Unable to prepare the invitations."), "error", meetingId);
  }

  const existing = new Set((existingResult.data ?? []).map((row: {member_id: string}) => String(row.member_id)));
  const rows = (membersResult.data ?? [])
    .filter((member: {id: string}) => !existing.has(String(member.id)))
    .map((member: {id: string}) => ({
      organization_id: membership.organization_id,
      meeting_id: meetingId,
      member_id: member.id,
      status: "invited",
      invited_by: user.id,
      updated_by: user.id,
    }));

  if (rows.length > 0) {
    const {error} = await admin.from("vip_annual_meeting_invitations").insert(rows);
    if (error) go(translate("L’invitation générale a échoué : ", "Bulk invitation failed: ") + error.message, "error", meetingId);
  }

  await audit({
    organizationId: membership.organization_id,
    entityType: "annual_meeting",
    entityId: meetingId,
    actorId: user.id,
    action: "annual_meeting_bulk_invited",
    details: {newInvitations: rows.length},
    admin,
  });

  revalidatePath("/dashboard/vip/annual-meeting");
  go(rows.length > 0
    ? translate(`${rows.length} nouvelle(s) invitation(s) créée(s).`, `${rows.length} new invitation(s) created.`)
    : translate("Tous les membres admissibles sont déjà invités.", "All eligible members are already invited."), "success", meetingId);
}

export async function updateVipAnnualMeetingInvitationAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  const invitationId = text(formData.get("invitationId"), 80);
  const status = text(formData.get("status"), 40);
  const guestCount = integerValue(formData.get("guestCount"));
  if (!INVITATION_STATUSES.has(status) || guestCount < 0 || guestCount > 5) {
    go(translate("Statut ou nombre d’accompagnants invalide.", "Invalid status or guest count."), "error");
  }

  const {data: invitation} = await admin
    .from("vip_annual_meeting_invitations")
    .select("id,meeting_id,status,responded_at,checked_in_at")
    .eq("id", invitationId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; meeting_id: string; status: string; responded_at: string | null; checked_in_at: string | null}>();
  if (!invitation) go(translate("Invitation introuvable.", "Invitation not found."), "error");

  const responseStatuses = new Set(["confirmed", "declined", "waitlisted"]);
  const updates = {
    status,
    guest_count: guestCount,
    visa_support_required: formData.get("visaSupportRequired") === "yes",
    travel_support_required: formData.get("travelSupportRequired") === "yes",
    dietary_requirements: text(formData.get("dietaryRequirements"), 2000) || null,
    accommodation_notes: text(formData.get("accommodationNotes"), 2000) || null,
    response_notes: text(formData.get("responseNotes"), 3000) || null,
    responded_at: responseStatuses.has(status) ? (invitation.responded_at ?? new Date().toISOString()) : invitation.responded_at,
    checked_in_at: status === "attended" ? (invitation.checked_in_at ?? new Date().toISOString()) : invitation.checked_in_at,
    updated_by: user.id,
  };

  const {error} = await admin
    .from("vip_annual_meeting_invitations")
    .update(updates)
    .eq("id", invitationId)
    .eq("organization_id", membership.organization_id);
  if (error) go(translate("L’invitation n’a pas pu être mise à jour : ", "The invitation could not be updated: ") + error.message, "error", invitation.meeting_id);

  await audit({
    organizationId: membership.organization_id,
    entityType: "meeting_invitation",
    entityId: invitationId,
    actorId: user.id,
    action: "annual_meeting_invitation_status_changed",
    previousStatus: invitation.status,
    newStatus: status,
    details: {guestCount, visaSupportRequired: updates.visa_support_required, travelSupportRequired: updates.travel_support_required},
    admin,
  });

  revalidatePath("/dashboard/vip/annual-meeting");
  go(translate("Invitation mise à jour.", "Invitation updated."), "success", invitation.meeting_id);
}

export async function saveVipAnnualMeetingAgendaItemAction(formData: FormData) {
  const {user, membership, admin, translate} = await getContext();
  if (!VIP_DECISION_ROLES.has(membership.role)) {
    go(translate("Tu n’as pas l’autorisation de modifier le programme.", "You are not allowed to edit the programme."), "error");
  }

  const meetingId = text(formData.get("meetingId"), 80);
  const agendaItemId = text(formData.get("agendaItemId"), 80);
  const meeting = await getMeeting({meetingId, organizationId: membership.organization_id, admin});
  if (!meeting) go(translate("Rencontre introuvable.", "Gathering not found."), "error");

  const title = text(formData.get("title"), 220);
  const sessionDate = dateValue(formData.get("sessionDate"));
  const startTime = timeValue(formData.get("startTime")) || null;
  const endTime = timeValue(formData.get("endTime")) || null;
  const status = text(formData.get("status"), 40) || "planned";
  const sortOrder = Math.max(0, integerValue(formData.get("sortOrder")));

  if (title.length < 3 || !sessionDate || sessionDate < meeting.start_date || sessionDate > meeting.end_date || !AGENDA_STATUSES.has(status) || (startTime && endTime && endTime <= startTime)) {
    go(translate("Vérifie le titre, la date, les heures et le statut de la session.", "Check the session title, date, times and status."), "error", meetingId);
  }

  const payload = {
    organization_id: membership.organization_id,
    meeting_id: meetingId,
    title,
    description: text(formData.get("description"), 3000) || null,
    session_date: sessionDate,
    start_time: startTime,
    end_time: endTime,
    speaker: text(formData.get("speaker"), 220) || null,
    location: text(formData.get("location"), 220) || null,
    sort_order: sortOrder,
    status,
    updated_by: user.id,
  };

  let entityId = agendaItemId;
  let action = "annual_meeting_agenda_updated";
  let previousStatus: string | null = null;

  if (agendaItemId) {
    const {data: current} = await admin
      .from("vip_annual_meeting_agenda_items")
      .select("id,status")
      .eq("id", agendaItemId)
      .eq("meeting_id", meetingId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle<{id: string; status: string}>();
    if (!current) go(translate("Session du programme introuvable.", "Programme session not found."), "error", meetingId);
    previousStatus = current.status;
    const {error} = await admin
      .from("vip_annual_meeting_agenda_items")
      .update(payload)
      .eq("id", agendaItemId)
      .eq("organization_id", membership.organization_id);
    if (error) go(translate("La session n’a pas pu être mise à jour : ", "The session could not be updated: ") + error.message, "error", meetingId);
  } else {
    const {data: created, error} = await admin
      .from("vip_annual_meeting_agenda_items")
      .insert({...payload, created_by: user.id})
      .select("id")
      .single<{id: string}>();
    if (error || !created) go(translate("La session n’a pas pu être ajoutée : ", "The session could not be added: ") + (error?.message ?? "unknown error"), "error", meetingId);
    entityId = created.id;
    action = "annual_meeting_agenda_created";
  }

  await audit({
    organizationId: membership.organization_id,
    entityType: "meeting_agenda",
    entityId,
    actorId: user.id,
    action,
    previousStatus,
    newStatus: status,
    details: {meetingId, title, sessionDate, startTime, endTime, speaker: payload.speaker, location: payload.location},
    admin,
  });

  revalidatePath("/dashboard/vip/annual-meeting");
  go(agendaItemId ? translate("Session mise à jour.", "Session updated.") : translate("Session ajoutée au programme.", "Session added to the programme."), "success", meetingId);
}
