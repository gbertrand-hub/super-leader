"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";
import {getZoomMeeting, getZoomUser, listPastMeetingParticipants, listZoomUsers} from "@/lib/zoom/client";
import {syncZoomParticipantsToAttendance} from "@/lib/zoom/attendance";
import {getZoomRuntimeStatus} from "@/lib/zoom/config";
import {getOrganizationZoomSettings, normalizeZoomDepartment, zoomDepartmentKey} from "@/lib/zoom/settings";

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
type ZoomHostRow = {id: string; email: string; department: string | null};

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

  let zoomUserEmail = settings.default_host_email;
  let failure = "";
  try {
    const zoomUser = await getZoomUser(settings.default_host_email);
    zoomUserEmail = zoomUser.email;
    await audit(admin, {
      organizationId: membership.organization_id,
      actorId: user.id,
      action: "zoom_connection_tested",
      details: {host_email: zoomUser.email},
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : "erreur inconnue";
  }
  if (failure) go(`Connexion Zoom impossible : ${failure}`, "error");
  go(`Connexion Zoom réussie pour ${zoomUserEmail}.`);
}

export async function syncZoomHostsAction(_formData: FormData) {
  const {user, membership, admin} = await context();
  if (!adminRoles.has(membership.role)) go("Accès refusé.", "error");
  await enforceOrganizationFeature(membership.organization_id, "api_integrations");

  let synced = 0;
  let failure = "";
  try {
    const zoomUsers = await listZoomUsers();
    if (!zoomUsers.length) throw new Error("Aucun utilisateur Zoom actif n’a été retourné.");
    const now = new Date().toISOString();
    const rows = zoomUsers.map((zoomUser) => {
      const firstName = String(zoomUser.first_name || "").trim();
      const lastName = String(zoomUser.last_name || "").trim();
      return {
        organization_id: membership.organization_id,
        zoom_user_id: String(zoomUser.id),
        email: String(zoomUser.email || "").trim().toLowerCase(),
        first_name: firstName || null,
        last_name: lastName || null,
        display_name: String(zoomUser.display_name || `${firstName} ${lastName}`.trim() || zoomUser.email).trim(),
        zoom_user_type: Number.isFinite(Number(zoomUser.type)) ? Number(zoomUser.type) : null,
        zoom_status: String(zoomUser.status || "active"),
        last_synced_at: now,
        updated_by: user.id,
      };
    }).filter((row) => row.email.includes("@"));
    const {error} = await admin.from("organization_zoom_hosts").upsert(rows, {onConflict: "organization_id,zoom_user_id"});
    if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Exécute d’abord supabase/036_zoom_multi_hosts_v2_8.sql." : error.message);
    synced = rows.length;
    await audit(admin, {
      organizationId: membership.organization_id,
      actorId: user.id,
      action: "zoom_hosts_synced",
      details: {count: synced},
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : "erreur inconnue";
  }
  if (failure) go(`Synchronisation des comptes Zoom impossible : ${failure}`, "error");
  revalidatePath("/dashboard/integrations");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/events");
  go(`${synced} compte(s) Zoom actif(s) synchronisé(s).`);
}

export async function saveZoomHostAction(formData: FormData) {
  const {user, membership, admin} = await context();
  if (!adminRoles.has(membership.role)) go("Accès refusé.", "error");
  await enforceOrganizationFeature(membership.organization_id, "api_integrations");

  const hostId = clean(formData.get("hostId"), 100);
  const department = normalizeZoomDepartment(clean(formData.get("department"), 160));
  const departmentKey = zoomDepartmentKey(department);
  const isActive = formData.get("isActive") === "on";
  const departmentDefault = isActive && Boolean(departmentKey) && formData.get("isDepartmentDefault") === "on";
  const allowConcurrentMeetings = formData.get("allowConcurrentMeetings") === "on";
  const organizationDefault = isActive && formData.get("organizationDefault") === "on";

  const {data: host, error: hostError} = await admin
    .from("organization_zoom_hosts")
    .select("id,email,department")
    .eq("id", hostId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<ZoomHostRow>();
  if (hostError || !host) go(`Compte Zoom introuvable : ${hostError?.message || "identifiant invalide"}`, "error");

  if (departmentDefault) {
    const {error} = await admin.from("organization_zoom_hosts")
      .update({is_department_default: false, updated_by: user.id})
      .eq("organization_id", membership.organization_id)
      .eq("department_key", departmentKey)
      .neq("id", host.id);
    if (error) go(`Mise à jour du compte par défaut impossible : ${error.message}`, "error");
  }

  const {error} = await admin.from("organization_zoom_hosts").update({
    department: department || null,
    department_key: departmentKey,
    is_active: isActive,
    is_department_default: departmentDefault,
    allow_concurrent_meetings: allowConcurrentMeetings,
    updated_by: user.id,
  }).eq("id", host.id).eq("organization_id", membership.organization_id);
  if (error) go(`Enregistrement impossible : ${error.message}`, "error");

  if (organizationDefault) {
    const {error: settingsError} = await admin.from("organization_zoom_settings").upsert({
      organization_id: membership.organization_id,
      default_host_email: host.email,
      updated_by: user.id,
      created_by: user.id,
    }, {onConflict: "organization_id"});
    if (settingsError) go(`Le compte a été enregistré, mais le défaut général n’a pas été mis à jour : ${settingsError.message}`, "error");
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    entityId: host.id,
    action: "zoom_host_updated",
    details: {email: host.email, department: department || null, is_active: isActive, is_department_default: departmentDefault, allow_concurrent_meetings: allowConcurrentMeetings, organization_default: organizationDefault},
  });
  revalidatePath("/dashboard/integrations");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/events");
  go(`Compte Zoom ${host.email} enregistré.`);
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

  let startUrl = "";
  let failure = "";
  try {
    const zoomMeeting = await getZoomMeeting(meeting.zoom_meeting_id);
    startUrl = String(zoomMeeting.start_url || "");
    if (!startUrl) throw new Error("Zoom n’a pas retourné de lien hôte.");
    await admin.from("performance_meetings").update({zoom_status: zoomMeeting.status || "scheduled"}).eq("id", meeting.id);
    await audit(admin, {organizationId: membership.organization_id, actorId: user.id, entityId: meeting.id, action: "zoom_meeting_started_link_requested"});
  } catch (error) {
    failure = error instanceof Error ? error.message : "erreur inconnue";
  }
  if (failure) go(`Impossible d’ouvrir la réunion Zoom : ${failure}`, "error", "performance");
  redirect(startUrl);
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
