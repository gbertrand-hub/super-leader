"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageCommercialData } from "@/lib/auth/permissions";
import { type CrmSector } from "@/lib/crm/pipeline";
import { getCrmServerContext } from "@/lib/crm/server";

const currencies = new Set(["USD", "EUR", "GBP", "XAF", "CAD"]);

function date(value: FormDataEntryValue | null) {
  const result = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : "";
}

function number(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function go(
  message: string,
  kind: "success" | "error" = "success",
  formData?: FormData,
): never {
  const params = new URLSearchParams({ [kind]: message });
  if (kind === "error" && formData) {
    for (const field of [
      "periodStart",
      "periodEnd",
      "ownerId",
      "teamId",
      "sector",
      "productId",
      "currency",
      "targetAmount",
      "targetCount",
      "notes",
    ]) {
      const value = String(formData.get(field) ?? "");
      if (value) params.set(`target_${field}`, value);
    }
  }
  redirect(`/dashboard/crm/analytics?${params.toString()}`);
}

export async function saveCrmSalesTargetAction(formData: FormData) {
  const { admin, user, membership, visibleUserIds, activeSectorOptions } = await getCrmServerContext(
    { leadersOnly: true },
  );
  if (!canManageCommercialData(membership.role)) go("Accès refusé.", "error");

  const periodStart = date(formData.get("periodStart"));
  const periodEnd = date(formData.get("periodEnd"));
  const ownerId = String(formData.get("ownerId") ?? "").trim() || null;
  const teamId = String(formData.get("teamId") ?? "").trim() || null;
  const productId = String(formData.get("productId") ?? "").trim() || null;
  const sectorValue = String(formData.get("sector") ?? "").trim();
  const sector = sectorValue ? (sectorValue as CrmSector) : null;
  const currency = String(formData.get("currency") ?? "USD").toUpperCase();
  const targetAmount = number(formData.get("targetAmount"));
  const targetCount = Math.trunc(number(formData.get("targetCount")));
  const notes =
    String(formData.get("notes") ?? "")
      .trim()
      .slice(0, 1000) || null;

  if (
    !periodStart ||
    !periodEnd ||
    periodEnd < periodStart ||
    (ownerId && teamId) ||
    (ownerId && !visibleUserIds.includes(ownerId)) ||
    (sector && !activeSectorOptions.some((item) => item.code === sector)) ||
    !currencies.has(currency) ||
    !Number.isFinite(targetAmount) ||
    targetAmount < 0 ||
    !Number.isFinite(targetCount) ||
    targetCount < 0
  )
    go(
      periodStart && periodEnd && periodEnd < periodStart
        ? "La date de fin doit être postérieure ou égale à la date de début."
        : ownerId && teamId
          ? "Choisissez soit un commercial, soit une équipe, mais pas les deux."
          : "Vérifiez les champs obligatoires de l’objectif.",
      "error",
      formData,
    );

  if (teamId) {
    const { data: team } = await admin
      .from("teams")
      .select("id")
      .eq("id", teamId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle();
    if (!team) go("Équipe invalide.", "error", formData);
  }
  if (productId) {
    const { data: product } = await admin
      .from("sales_products")
      .select("id")
      .eq("id", productId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle();
    if (!product) go("Produit invalide.", "error", formData);
  }

  let existing = admin
    .from("crm_sales_targets")
    .select("id")
    .eq("organization_id", membership.organization_id)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .eq("currency", currency);
  existing = ownerId
    ? existing.eq("owner_id", ownerId)
    : existing.is("owner_id", null);
  existing = teamId
    ? existing.eq("team_id", teamId)
    : existing.is("team_id", null);
  existing = productId
    ? existing.eq("product_id", productId)
    : existing.is("product_id", null);
  existing = sector
    ? existing.eq("sector", sector)
    : existing.is("sector", null);
  const { data: current, error: findError } = await existing.maybeSingle<{
    id: string;
  }>();
  if (findError) go(findError.message, "error", formData);

  const values = {
    target_amount: targetAmount,
    target_count: targetCount,
    notes,
    updated_by: user.id,
  };
  const result = current
    ? await admin.from("crm_sales_targets").update(values).eq("id", current.id)
    : await admin.from("crm_sales_targets").insert({
        organization_id: membership.organization_id,
        period_start: periodStart,
        period_end: periodEnd,
        owner_id: ownerId,
        team_id: teamId,
        product_id: productId,
        sector,
        currency,
        ...values,
        created_by: user.id,
      });
  if (result.error) go(result.error.message, "error", formData);

  await admin.from("crm_audit_log").insert({
    organization_id: membership.organization_id,
    actor_id: user.id,
    entity_type: "crm_sales_target",
    entity_id: current?.id ?? null,
    action: current ? "target_updated" : "target_created",
    details: {
      periodStart,
      periodEnd,
      ownerId,
      teamId,
      productId,
      sector,
      currency,
      targetAmount,
      targetCount,
    },
  });
  revalidatePath("/dashboard/crm/analytics");
  go(current ? "Objectif mis à jour." : "Objectif créé.");
}
