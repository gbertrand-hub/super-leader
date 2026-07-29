import type {SupabaseClient} from "@supabase/supabase-js";
import {getZoomRuntimeStatus} from "@/lib/zoom/config";

export type OrganizationZoomSettings = {
  organization_id: string;
  enabled: boolean;
  default_host_email: string | null;
  auto_create_meetings: boolean;
  auto_sync_attendance: boolean;
  late_grace_minutes: number;
  minimum_attendance_percent: number;
};

export type OrganizationZoomHost = {
  id: string;
  organization_id: string;
  zoom_user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  department: string | null;
  department_key: string;
  zoom_user_type: number | null;
  zoom_status: string;
  is_active: boolean;
  is_department_default: boolean;
  allow_concurrent_meetings: boolean;
  last_synced_at: string | null;
};

const missingTableCodes = new Set(["42P01", "PGRST205"]);

export function normalizeZoomDepartment(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function zoomDepartmentKey(value: string | null | undefined) {
  return normalizeZoomDepartment(value).toLocaleLowerCase();
}

export async function getOrganizationZoomSettings(admin: SupabaseClient, organizationId: string) {
  const defaults: OrganizationZoomSettings = {
    organization_id: organizationId,
    enabled: false,
    default_host_email: null,
    auto_create_meetings: false,
    auto_sync_attendance: true,
    late_grace_minutes: 5,
    minimum_attendance_percent: 50,
  };
  const {data, error} = await admin
    .from("organization_zoom_settings")
    .select("organization_id,enabled,default_host_email,auto_create_meetings,auto_sync_attendance,late_grace_minutes,minimum_attendance_percent")
    .eq("organization_id", organizationId)
    .maybeSingle<OrganizationZoomSettings>();
  if (error && !missingTableCodes.has(error.code)) throw new Error(error.message);
  return data || defaults;
}

export async function getOrganizationZoomHosts(
  admin: SupabaseClient,
  organizationId: string,
  options: {activeOnly?: boolean} = {},
): Promise<OrganizationZoomHost[]> {
  let query = admin
    .from("organization_zoom_hosts")
    .select("id,organization_id,zoom_user_id,email,first_name,last_name,display_name,department,department_key,zoom_user_type,zoom_status,is_active,is_department_default,allow_concurrent_meetings,last_synced_at")
    .eq("organization_id", organizationId)
    .order("department", {ascending: true, nullsFirst: false})
    .order("display_name", {ascending: true, nullsFirst: false})
    .order("email", {ascending: true});
  if (options.activeOnly) query = query.eq("is_active", true).eq("zoom_status", "active");
  const {data, error} = await query;
  if (error && missingTableCodes.has(error.code)) return [];
  if (error) throw new Error(error.message);
  return (data || []) as OrganizationZoomHost[];
}

export async function resolveZoomHost(admin: SupabaseClient, input: {
  organizationId: string;
  hostAccountId?: string | null;
  department?: string | null;
  fallbackEmail?: string | null;
}): Promise<OrganizationZoomHost | null> {
  const hosts = await getOrganizationZoomHosts(admin, input.organizationId, {activeOnly: true});
  if (input.hostAccountId) {
    const selected = hosts.find((host) => host.id === input.hostAccountId);
    if (!selected) throw new Error("Le compte Zoom sélectionné est inactif ou n’appartient pas à cette organisation.");
    return selected;
  }

  const departmentKey = zoomDepartmentKey(input.department);
  if (departmentKey) {
    const departmentHosts = hosts.filter((host) => host.department_key === departmentKey);
    const departmentDefault = departmentHosts.find((host) => host.is_department_default);
    if (departmentDefault) return departmentDefault;
    if (departmentHosts[0]) return departmentHosts[0];
  }

  const fallback = String(input.fallbackEmail || "").trim().toLocaleLowerCase();
  if (fallback) {
    const matching = hosts.find((host) => host.email.toLocaleLowerCase() === fallback);
    if (matching) return matching;
    return {
      id: "",
      organization_id: input.organizationId,
      zoom_user_id: "",
      email: fallback,
      first_name: null,
      last_name: null,
      display_name: fallback,
      department: null,
      department_key: "",
      zoom_user_type: null,
      zoom_status: "active",
      is_active: true,
      is_department_default: false,
      allow_concurrent_meetings: false,
      last_synced_at: null,
    };
  }

  return hosts.find((host) => host.is_department_default) ?? hosts[0] ?? null;
}

export async function assertZoomHostAvailability(admin: SupabaseClient, input: {
  organizationId: string;
  host: OrganizationZoomHost;
  startsAt: string;
  endsAt: string;
}) {
  if (input.host.allow_concurrent_meetings) return;
  const {data, error} = await admin
    .from("performance_meetings")
    .select("id,title,starts_at,ends_at,zoom_status")
    .eq("organization_id", input.organizationId)
    .eq("provider", "zoom")
    .ilike("zoom_host_email", input.host.email)
    .neq("zoom_status", "cancelled")
    .lt("starts_at", input.endsAt)
    .order("starts_at", {ascending: true})
    .limit(100);
  if (error) throw new Error(error.message);

  const requestedStart = new Date(input.startsAt).getTime();
  const conflict = (data || []).find((meeting) => {
    const existingStart = new Date(String(meeting.starts_at)).getTime();
    const existingEnd = meeting.ends_at
      ? new Date(String(meeting.ends_at)).getTime()
      : existingStart + 60 * 60 * 1000;
    return existingEnd > requestedStart;
  });
  if (conflict) {
    throw new Error(`Le compte Zoom ${input.host.email} est déjà utilisé par « ${conflict.title} » sur ce créneau.`);
  }
}

export async function zoomAvailableForOrganization(admin: SupabaseClient, organizationId: string) {
  const [settings, runtime, hosts] = await Promise.all([
    getOrganizationZoomSettings(admin, organizationId),
    Promise.resolve(getZoomRuntimeStatus()),
    getOrganizationZoomHosts(admin, organizationId, {activeOnly: true}),
  ]);
  const hasHost = hosts.length > 0 || Boolean(settings.default_host_email);
  return {settings, runtime, hosts, available: settings.enabled && runtime.configured && hasHost};
}
