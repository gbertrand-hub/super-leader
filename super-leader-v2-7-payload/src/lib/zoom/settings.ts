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
  if (error && !["42P01", "PGRST205"].includes(error.code)) throw new Error(error.message);
  return data || defaults;
}

export async function zoomAvailableForOrganization(admin: SupabaseClient, organizationId: string) {
  const [settings, runtime] = await Promise.all([
    getOrganizationZoomSettings(admin, organizationId),
    Promise.resolve(getZoomRuntimeStatus()),
  ]);
  return {settings, runtime, available: settings.enabled && runtime.configured && Boolean(settings.default_host_email)};
}
