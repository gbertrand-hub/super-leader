"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getZoomMeeting, getZoomUser, listPastMeetingParticipants} from "@/lib/zoom/client";
import {syncZoomParticipantsToAttendance} from "@/lib/zoom/attendance";
import {getZoomRuntimeStatus} from "@/lib/zoom/config";
import {getOrganizationZoomSettings} from "@/lib/zoom/settings";

const adminRoles = new Set(["owner", "admin"]);
const leaderRoles = new Set(["owner", "admin", "hr", "manager"]);

type Membership = {organization_id: string; role: string};
type MeetingRow = {
  id: string;
  organization_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  created_by: string;
  zoom_meeting_id: string | null;
  zoom_meeting_uuid: string | null;
  zoom_status: string;
};

function clean(value: FormDataEntryValue | null, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function go(message: string, kind: "success" | "error" = "success", target = "integrations"): never {
  const path = target === "performance" ? "/dashboard/performance?view=meetings" : "/dashboard/integrations";
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${kind}=${encodeURIComponent(message)}`);
}

async function context() {
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
  if (error || !membership) redirect("/dashboard");
  return {user: authData.user, membership, admin};
}

async function audit(admin: ReturnType<typeof createAdminClient>, input: {
  organizationId: string;
  actorId: string;
  entityId?: string | null;
  action: string;
  details?: Record<string, unknown>;
}) {
  const {error} = await admin.from("performance_audit_log").insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    entity_type: "zoom_integration",
    entity_id: input.entityId || null,
    action: input.action,
    details: input.details || {},
  });
  if (error) console.error("Zoom audit failed", error);
}

export async function saveZoomSettingsAction(formData: FormData) {
  const {user, membership, admin} = await context();
  if (!adminRoles.has(membership.role)) go("Accès refusé.", "error");
  await enforceOrganizationFeature(membership.organization_id, "api_integrations");
  const defaultHostEmail = clean(formData.get("defaultHostEmail"), 320).toLowerCase();
  const enabled = formData.get("enabled") === "on";
  const lateGraceMinutes = Math.max(0, Math.min(120, Number(formData.get("lateGraceMinutes") || 5)));
  const minimumAttendancePercent = Math.max(1, Math.min(100, Number(formData.get("minimumAttendancePercent") || 50)));
  if (enabled && !defaultHostEmail.includes("@")) go("Indique une adresse Zoom hôte valide.", "error");
  if (enabled && !getZoomRuntimeStatus().configured) go("Les identifiants Zoom ne sont pas encore configurés dans l’environnement.", "error");

  const {error} = await admin.from("organization_zoom_settings").upsert({
    organization_id: membership.organization_id,
    enabled,
    default_host_email: defaultHostEmail || null,
    auto_create_meetings: formData.get("autoCreateMeetings") === "on",
    auto_sync_attendance: formData.get("autoSyncAttendance") === "on",
    late_grace_minutes: Math.round(lateGraceMinutes),
    minimum_attendance_percent: Math.round(minimumAttendancePercent),
    created_by: user.id,
    updated_by: user.id,
  }, {onConflict: "organization_id"});
  if (error) go(`Enregistrement impossible : ${error.message}`, "error");
  await audit(admin, {organizationId: membership.organization_id, actorId: user.id, action: "zoom_settings_saved", details: {enabled, default_host_email: defaultHostEmail || null}});
  revalidatePath("/dashboard/integrations");
  go("Configuration Zoom enregistrée.");
}

export async function testZoomConnectionAction(_formData: FormData) {
  const {user, membership, admin} = await context();
  if (!adminRoles.has(membership.role)) go("Accès refusé.", "error");
  await enforceOrganizationFeature(membership.organization_id, "api_integrations");
  const settings = await getOrganizationZoomSettings(admin, membership.organization_id);
  if (!settings.default_host_email) go("Configure d’abord l’adresse Zoom hôte.", "error");
  try {
    const zoomUser = await getZoomUser(settings.default_host_email);
    await audit(admin, {organizationId: membership.organization_id, actorId: user.id, action: "zoom_connection_tested", details: {host_email: zoomUser.email}});
    go(`Connexion Zoom réussie pour ${zoomUser.email}.`);
  } catch (error) {
    go(`Connexion Zoom impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`, "error");
  }
}

async function loadMeeting(admin: ReturnType<typeof createAdminClient>, organizationId: string, meetingId: string) {
  const {data, error} = await admin
    .from("performance_meetings")
    .select("id,organization_id,title,starts_at,ends_at,created_by,zoom_meeting_id,zoom_meeting_uuid,zoom_status")
    .eq("id", meetingId)
    .eq("organization_id", organizationId)
    .maybeSingle<MeetingRow>();
  if (error || !data) throw new Error(error?.message || "Réunion introuvable.");
  return data;
}

export async function startZoomMeetingAction(formData: FormData) {
  const {user, membership, admin} = await context();
  if (!leaderRoles.has(membership.role)) go("Accès refusé.", "error", "performance");
  await enforceOrganizationFeature(membership.organization_id, "api_integrations");
  const meeting = await loadMeeting(admin, membership.organization_id, clean(formData.get("meetingId"), 100));
  if (!["owner", "admin", "hr"].includes(membership.role) && meeting.created_by !== user.id) go("Seul l’hôte ou un administrateur peut démarrer cette réunion.", "error", "performance");
  if (!meeting.zoom_meeting_id) go("Cette réunion n’est pas reliée à Zoom.", "error", "performance");
  try {
    const zoomMeeting = await getZoomMeeting(meeting.zoom_meeting_id);
    if (!zoomMeeting.start_url) go("Zoom n’a pas retourné de lien hôte.", "error", "performance");
    await admin.from("performance_meetings").update({zoom_status: zoomMeeting.status || "scheduled"}).eq("id", meeting.id);
    await audit(admin, {organizationId: membership.organization_id, actorId: user.id, entityId: meeting.id, action: "zoom_meeting_started_link_requested"});
    redirect(zoomMeeting.start_url);
  } catch (error) {
    go(`Impossible d’ouvrir la réunion Zoom : ${error instanceof Error ? error.message : "erreur inconnue"}`, "error", "performance");
  }
}

export async function syncZoomAttendanceAction(formData: FormData) {
  const {user, membership, admin} = await context();
  if (!leaderRoles.has(membership.role)) go("Accès refusé.", "error", "performance");
  await enforceOrganizationFeature(membership.organization_id, "api_integrations");
  const meeting = await loadMeeting(admin, membership.organization_id, clean(formData.get("meetingId"), 100));
  if (!meeting.zoom_meeting_id) go("Cette réunion n’est pas reliée à Zoom.", "error", "performance");
  const settings = await getOrganizationZoomSettings(admin, membership.organization_id);
  try {
    const participants = await listPastMeetingParticipants(meeting.zoom_meeting_uuid || meeting.zoom_meeting_id);
    const result = await syncZoomParticipantsToAttendance({
      admin,
      organizationId: membership.organization_id,
      performanceMeetingId: meeting.id,
      zoomMeetingId: meeting.zoom_meeting_id,
      zoomMeetingUuid: meeting.zoom_meeting_uuid,
      meetingStartsAt: meeting.starts_at,
      meetingEndsAt: meeting.ends_at,
      participants,
      lateGraceMinutes: settings.late_grace_minutes,
      minimumAttendancePercent: settings.minimum_attendance_percent,
      source: "zoom_report",
    });
    await admin.from("performance_meetings").update({
      zoom_last_synced_at: new Date().toISOString(),
      zoom_sync_error: null,
      zoom_status: "ended",
    }).eq("id", meeting.id);
    await audit(admin, {organizationId: membership.organization_id, actorId: user.id, entityId: meeting.id, action: "zoom_attendance_synced", details: result});
    revalidatePath("/dashboard/performance");
    revalidatePath("/dashboard/my-day");
    go(`Présence Zoom synchronisée : ${result.updated} collaborateur(s) mis à jour.`, "success", "performance");
  } catch (error) {
    const message = error instanceof Error ? error.message : "erreur inconnue";
    await admin.from("performance_meetings").update({zoom_last_synced_at: new Date().toISOString(), zoom_sync_error: message}).eq("id", meeting.id);
    go(`Synchronisation Zoom impossible : ${message}`, "error", "performance");
  }
}
