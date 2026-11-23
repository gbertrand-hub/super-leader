import "server-only";

import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {getCrmPipelineText} from "@/i18n/crm-pipeline";
import {canManageCommercialData, canManageProducts, canUseCommercialModules} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {CRM_SECTORS, type CrmSectorOption} from "@/lib/crm/pipeline";
import {createClient} from "@/lib/supabase/server";

type Membership = {organization_id: string; role: string};
type MemberRow = {user_id: string; role: string};
type ProfileRow = {id: string; full_name: string | null; email: string | null};
type SectorRow = {
  id: string;
  code: string;
  name_fr: string;
  name_en: string;
  fulfillment_destination: CrmSectorOption["fulfillmentDestination"];
  is_active: boolean;
  is_system: boolean;
  sort_order: number;
};

function fallbackSectorOptions(): CrmSectorOption[] {
  const labels: Record<string, [string, string, CrmSectorOption["fulfillmentDestination"], number]> = {
    house: ["Maisons", "Houses", "real_estate", 10],
    land: ["Terrains", "Land", "real_estate", 20],
    training: ["Formations", "Training", "academy", 30],
    livestock: ["Élevage", "Livestock", "livestock_operations", 40],
    vip: ["Super Leader VIP", "Super Leader VIP", "other", 50],
  };
  return CRM_SECTORS.map((code) => ({
    code,
    nameFr: labels[code]?.[0] ?? code,
    nameEn: labels[code]?.[1] ?? code,
    fulfillmentDestination: labels[code]?.[2] ?? "other",
    isActive: true,
    isSystem: true,
    sortOrder: labels[code]?.[3] ?? 100,
  }));
}


export async function getCrmServerContext(options?: {leadersOnly?: boolean}) {
  const {locale} = await getI18n();
  const copy = getCrmPipelineText(locale);
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
  await enforceOrganizationFeature(membership.organization_id, "crm_sales");
  if (!canUseCommercialModules(membership.role)) redirect("/dashboard/performance?error=access-denied");
  if (options?.leadersOnly && !canManageCommercialData(membership.role)) redirect("/dashboard/crm/pipeline?error=access-denied");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });

  const {data: membersData, error: membersError} = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", membership.organization_id)
    .eq("is_active", true)
    .in("user_id", visibleUserIds);
  if (membersError) throw new Error(membersError.message);
  const members = (membersData ?? []) as MemberRow[];
  const memberIds = members.map((member) => member.user_id);
  const {data: profilesData, error: profilesError} = memberIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", memberIds)
    : {data: [] as ProfileRow[], error: null};
  if (profilesError) throw new Error(profilesError.message);
  const profileById = new Map(((profilesData ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));
  const memberOptions = members
    .map((member) => ({
      id: member.user_id,
      role: member.role,
      name: profileById.get(member.user_id)?.full_name?.trim() || profileById.get(member.user_id)?.email || "Member",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const {data: sectorData, error: sectorError} = await admin
    .from("crm_sectors")
    .select("id, code, name_fr, name_en, fulfillment_destination, is_active, is_system, sort_order")
    .eq("organization_id", membership.organization_id)
    .order("sort_order")
    .order("name_fr");
  const sectorSchemaReady = !sectorError;
  const sectorOptions: CrmSectorOption[] = sectorSchemaReady
    ? ((sectorData ?? []) as SectorRow[]).map((sector) => ({
        id: sector.id,
        code: sector.code,
        nameFr: sector.name_fr,
        nameEn: sector.name_en,
        fulfillmentDestination: sector.fulfillment_destination,
        isActive: sector.is_active,
        isSystem: sector.is_system,
        sortOrder: sector.sort_order,
      }))
    : fallbackSectorOptions();
  const activeSectorOptions = sectorOptions.filter((sector) => sector.isActive);

  return {
    admin,
    user: authData.user,
    membership,
    visibleUserIds,
    locale,
    copy,
    memberOptions,
    memberName: (id: string | null) => memberOptions.find((member) => member.id === id)?.name || copy.owner,
    canManage: canManageCommercialData(membership.role),
    canManageProducts: canManageProducts(membership.role),
    sectorOptions,
    activeSectorOptions,
    sectorSchemaReady,
  };
}
