"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {canManageProducts} from "@/lib/auth/permissions";
import {getCrmServerContext} from "@/lib/crm/server";

const destinations = new Set(["real_estate", "academy", "livestock_operations", "collections", "other"]);

function value(formData: FormData, key: string, max = 120) {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function slug(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/crm/catalog?${kind}=${encodeURIComponent(message)}`);
}

async function writeAudit(
  admin: Awaited<ReturnType<typeof getCrmServerContext>>["admin"],
  organizationId: string,
  actorId: string,
  entityId: string | null,
  action: string,
  details: Record<string, unknown>,
) {
  await admin.from("crm_audit_log").insert({
    organization_id: organizationId,
    actor_id: actorId,
    entity_type: "crm_sector",
    entity_id: entityId,
    action,
    details,
  });
}

export async function createCrmSectorAction(formData: FormData) {
  const {admin, user, membership, sectorSchemaReady} = await getCrmServerContext();
  if (!canManageProducts(membership.role)) go("Accès refusé.", "error");
  if (!sectorSchemaReady) go("Exécute d'abord la migration 121_dynamic_crm_sectors_v4_8_79.sql.", "error");

  const nameFr = value(formData, "nameFr");
  const nameEn = value(formData, "nameEn") || nameFr;
  const requestedCode = value(formData, "code", 40);
  const code = slug(requestedCode || nameEn || nameFr);
  const fulfillmentDestination = value(formData, "fulfillmentDestination", 40) || "other";

  if (nameFr.length < 2 || nameEn.length < 2 || code.length < 2 || !destinations.has(fulfillmentDestination)) {
    go("Vérifie le nom, le code et la destination opérationnelle du secteur.", "error");
  }

  const {data, error} = await admin
    .from("crm_sectors")
    .insert({
      organization_id: membership.organization_id,
      code,
      name_fr: nameFr,
      name_en: nameEn,
      fulfillment_destination: fulfillmentDestination,
      is_active: true,
      is_system: false,
      sort_order: 100,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !data) {
    const duplicate = error?.code === "23505";
    go(duplicate ? "Ce secteur existe déjà." : error?.message || "Impossible de créer le secteur.", "error");
  }

  await writeAudit(admin, membership.organization_id, user.id, data.id, "sector_created", {code, nameFr, nameEn, fulfillmentDestination});
  revalidatePath("/dashboard/crm/catalog");
  revalidatePath("/dashboard/crm/pipeline");
  revalidatePath("/dashboard/crm/prospects");
  revalidatePath("/dashboard/crm/analytics");
  go("Secteur créé. Son pipeline commercial standard a été généré automatiquement.");
}

export async function updateCrmSectorAction(formData: FormData) {
  const {admin, user, membership, sectorSchemaReady} = await getCrmServerContext();
  if (!canManageProducts(membership.role)) go("Accès refusé.", "error");
  if (!sectorSchemaReady) go("Migration CRM secteurs requise.", "error");

  const sectorId = value(formData, "sectorId", 80);
  const nameFr = value(formData, "nameFr");
  const nameEn = value(formData, "nameEn") || nameFr;
  const fulfillmentDestination = value(formData, "fulfillmentDestination", 40) || "other";
  if (!sectorId || nameFr.length < 2 || nameEn.length < 2 || !destinations.has(fulfillmentDestination)) {
    go("Données du secteur invalides.", "error");
  }

  const {data: existing} = await admin
    .from("crm_sectors")
    .select("id, code")
    .eq("organization_id", membership.organization_id)
    .eq("id", sectorId)
    .maybeSingle<{id: string; code: string}>();
  if (!existing) go("Secteur introuvable.", "error");

  const {error} = await admin
    .from("crm_sectors")
    .update({name_fr: nameFr, name_en: nameEn, fulfillment_destination: fulfillmentDestination, updated_by: user.id})
    .eq("organization_id", membership.organization_id)
    .eq("id", sectorId);
  if (error) go(error.message, "error");

  await writeAudit(admin, membership.organization_id, user.id, sectorId, "sector_updated", {code: existing.code, nameFr, nameEn, fulfillmentDestination});
  revalidatePath("/dashboard/crm/catalog");
  revalidatePath("/dashboard/crm/pipeline");
  revalidatePath("/dashboard/crm/prospects");
  revalidatePath("/dashboard/crm/analytics");
  go("Secteur mis à jour.");
}

export async function toggleCrmSectorAction(formData: FormData) {
  const {admin, user, membership, sectorSchemaReady} = await getCrmServerContext();
  if (!canManageProducts(membership.role)) go("Accès refusé.", "error");
  if (!sectorSchemaReady) go("Migration CRM secteurs requise.", "error");

  const sectorId = value(formData, "sectorId", 80);
  const nextActive = value(formData, "isActive", 10) === "true";
  const {data: sector} = await admin
    .from("crm_sectors")
    .select("id, code, is_active")
    .eq("organization_id", membership.organization_id)
    .eq("id", sectorId)
    .maybeSingle<{id: string; code: string; is_active: boolean}>();
  if (!sector) go("Secteur introuvable.", "error");

  if (!nextActive) {
    const [products, opportunities] = await Promise.all([
      admin.from("sales_products").select("id", {head: true, count: "exact"}).eq("organization_id", membership.organization_id).eq("sector", sector.code).eq("is_active", true),
      admin.from("crm_opportunities").select("id", {head: true, count: "exact"}).eq("organization_id", membership.organization_id).eq("sector", sector.code).in("status", ["open", "on_hold"]),
    ]);
    if ((products.count ?? 0) > 0 || (opportunities.count ?? 0) > 0) {
      go("Impossible de désactiver ce secteur : il contient encore des produits actifs ou des opportunités ouvertes.", "error");
    }
  }

  const {error} = await admin
    .from("crm_sectors")
    .update({is_active: nextActive, updated_by: user.id})
    .eq("organization_id", membership.organization_id)
    .eq("id", sectorId);
  if (error) go(error.message, "error");

  await writeAudit(admin, membership.organization_id, user.id, sectorId, nextActive ? "sector_activated" : "sector_deactivated", {code: sector.code});
  revalidatePath("/dashboard/crm/catalog");
  revalidatePath("/dashboard/crm/pipeline");
  revalidatePath("/dashboard/crm/prospects");
  revalidatePath("/dashboard/crm/analytics");
  go(nextActive ? "Secteur activé." : "Secteur désactivé.");
}
