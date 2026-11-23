"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getCrmServerContext} from "@/lib/crm/server";

const needs = new Set(["unknown", "exploring", "clear", "urgent"]);
const timelines = new Set(["unknown", "within_30_days", "31_90_days", "91_180_days", "later"]);
const decisionRoles = new Set(["unknown", "decision_maker", "influencer", "representative"]);
const currencies = new Set(["USD", "EUR", "GBP", "XAF", "CAD"]);

function clean(input: FormDataEntryValue | null, max = 500) {
  const text = String(input ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/crm/scoring?${kind}=${encodeURIComponent(message)}`);
}

export async function updateProspectQualificationAction(formData: FormData) {
  const {admin, user, membership, visibleUserIds} = await getCrmServerContext();
  const prospectId = clean(formData.get("prospectId"), 80);
  const qualificationNeed = String(formData.get("qualificationNeed") ?? "unknown");
  const purchaseTimeline = String(formData.get("purchaseTimeline") ?? "unknown");
  const decisionRole = String(formData.get("decisionRole") ?? "unknown");
  const budgetConfirmed = formData.get("budgetConfirmed") === "on";
  const budgetRaw = String(formData.get("estimatedBudget") ?? "").trim().replace(",", ".");
  const estimatedBudget = budgetRaw ? Number(budgetRaw) : null;
  const currency = String(formData.get("budgetCurrency") ?? "USD").trim().toUpperCase();
  const productInterest = clean(formData.get("productInterest"), 240);

  if (!prospectId || !needs.has(qualificationNeed) || !timelines.has(purchaseTimeline) || !decisionRoles.has(decisionRole) || !currencies.has(currency)) {
    go("Qualification invalide.", "error");
  }
  if (estimatedBudget !== null && (!Number.isFinite(estimatedBudget) || estimatedBudget < 0)) {
    go("Le budget estimé est invalide.", "error");
  }

  const {data: prospect, error: prospectError} = await admin
    .from("crm_clients")
    .select("id,owner_id,follow_up_owner_id")
    .eq("organization_id", membership.organization_id)
    .eq("id", prospectId)
    .eq("status", "prospect")
    .maybeSingle<{id: string; owner_id: string | null; follow_up_owner_id: string | null}>();
  if (prospectError) go(prospectError.message, "error");
  if (!prospect) go("Prospect introuvable.", "error");

  const organizationWide = membership.role === "owner" || membership.role === "admin";
  const scoped = Boolean(
    (prospect.owner_id && visibleUserIds.includes(prospect.owner_id))
    || (prospect.follow_up_owner_id && visibleUserIds.includes(prospect.follow_up_owner_id)),
  );
  if (!organizationWide && !scoped) go("Tu n'as pas accès à ce prospect.", "error");

  const changes = {
    qualification_need: qualificationNeed,
    purchase_timeline: purchaseTimeline,
    decision_role: decisionRole,
    budget_confirmed: budgetConfirmed,
    estimated_budget: estimatedBudget,
    budget_currency: currency,
    product_interest: productInterest,
  };
  const {error} = await admin
    .from("crm_clients")
    .update(changes)
    .eq("organization_id", membership.organization_id)
    .eq("id", prospectId)
    .eq("status", "prospect");
  if (error) go(error.message, "error");

  await admin.from("crm_audit_log").insert({
    organization_id: membership.organization_id,
    actor_id: user.id,
    entity_type: "crm_lead",
    entity_id: prospectId,
    action: "lead_scoring_qualification_updated",
    details: {
      qualificationNeed,
      purchaseTimeline,
      decisionRole,
      budgetConfirmed,
      estimatedBudget,
      currency,
      productInterest,
      model: "SL-LEAD-V1",
    },
  });

  revalidatePath("/dashboard/crm/scoring");
  revalidatePath("/dashboard/crm/prospects");
  go("Qualification enregistrée et score recalculé.");
}
