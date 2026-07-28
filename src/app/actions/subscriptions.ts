"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getBillingContext } from "@/lib/billing/context";
import { SUBSCRIPTION_FEATURE_KEYS } from "@/lib/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function numberOrNull(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function go(message: string, kind: "success" | "error" = "success"): never {
  const params = new URLSearchParams({ [kind]: message });
  redirect(`/dashboard/subscription?${params.toString()}`);
}

async function requirePlatformBilling() {
  const context = await getBillingContext(["owner", "admin"]);
  if (!context.isPlatformWorkspace) redirect("/dashboard/subscription");
  return context;
}

async function logSubscriptionEvent(input: {
  organizationId: string;
  subscriptionId?: string | null;
  actorId: string;
  eventType: string;
  details?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("subscription_events").insert({
    organization_id: input.organizationId,
    subscription_id: input.subscriptionId ?? null,
    actor_id: input.actorId,
    event_type: input.eventType,
    details: input.details ?? {},
  });
  if (error) console.error("Subscription audit failed", error);
}

function addPeriod(start: Date, interval: string): Date | null {
  const result = new Date(start);
  if (interval === "monthly") {
    result.setUTCMonth(result.getUTCMonth() + 1);
    return result;
  }
  if (interval === "annual") {
    result.setUTCFullYear(result.getUTCFullYear() + 1);
    return result;
  }
  return null;
}

export async function createPlanAction(formData: FormData) {
  const context = await requirePlatformBilling();
  const code = text(formData, "code").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const name = text(formData, "name");
  const description = text(formData, "description");
  if (!code || !name) go("Le code et le nom du plan sont obligatoires.", "error");

  const admin = createAdminClient();
  const { data: plan, error } = await admin
    .from("subscription_plans")
    .insert({
      code,
      name,
      description: description || null,
      status: "draft",
      is_public: false,
      pricing_mode: "fixed",
      currency: "USD",
      default_trial_days: 14,
      sort_order: 100,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) go(`Création impossible : ${error.message}`, "error");

  await admin.from("subscription_plan_features").insert(
    SUBSCRIPTION_FEATURE_KEYS.map((featureKey) => ({
      plan_id: plan.id,
      feature_key: featureKey,
      enabled: ["core_feedback", "recognition", "teams", "performance"].includes(featureKey),
    })),
  );

  await logSubscriptionEvent({
    organizationId: context.organizationId,
    actorId: context.userId,
    eventType: "plan_created",
    details: { plan_id: plan.id, code, name },
  });
  revalidatePath("/dashboard/subscription");
  go("Plan créé en brouillon.");
}

export async function updatePlanAction(formData: FormData) {
  const context = await requirePlatformBilling();
  const planId = text(formData, "planId");
  const name = text(formData, "name");
  const description = text(formData, "description");
  const status = text(formData, "status");
  const pricingMode = text(formData, "pricingMode");
  const currency = (text(formData, "currency") || "USD").toUpperCase();
  const monthlyPrice = numberOrNull(text(formData, "monthlyPrice"));
  const annualPrice = numberOrNull(text(formData, "annualPrice"));
  const trialDays = Math.min(365, Math.max(0, integer(text(formData, "trialDays"), 14)));
  const maxMembers = numberOrNull(text(formData, "maxMembers"));
  const enabledFeatures = new Set(formData.getAll("features").map(String));

  if (!planId || !name) go("Plan invalide.", "error");
  if (!["draft", "active", "archived"].includes(status)) go("Statut invalide.", "error");
  if (!["fixed", "custom", "free"].includes(pricingMode)) go("Mode tarifaire invalide.", "error");
  if (currency.length !== 3) go("La devise doit contenir trois lettres.", "error");

  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("subscription_plans")
    .select("code,is_internal")
    .eq("id", planId)
    .maybeSingle<{ code: string; is_internal: boolean }>();
  if (!plan) go("Plan introuvable.", "error");
  if (plan.is_internal && plan.code === "legacy_full_access") {
    go("Le plan historique protégé ne peut pas être modifié depuis cet écran.", "error");
  }

  const { error } = await admin
    .from("subscription_plans")
    .update({
      name,
      description: description || null,
      status,
      is_public: formData.get("isPublic") === "on",
      pricing_mode: pricingMode,
      currency,
      monthly_price: pricingMode === "fixed" ? monthlyPrice : pricingMode === "free" ? 0 : null,
      annual_price: pricingMode === "fixed" ? annualPrice : pricingMode === "free" ? 0 : null,
      default_trial_days: trialDays,
    })
    .eq("id", planId);
  if (error) go(`Mise à jour impossible : ${error.message}`, "error");

  const featureRows = [
    ...SUBSCRIPTION_FEATURE_KEYS.map((featureKey) => ({
      plan_id: planId,
      feature_key: featureKey,
      enabled: enabledFeatures.has(featureKey),
      limit_value: null as number | null,
      updated_at: new Date().toISOString(),
    })),
    {
      plan_id: planId,
      feature_key: "max_members",
      enabled: true,
      limit_value: maxMembers === null ? null : Math.max(0, Math.trunc(maxMembers)),
      updated_at: new Date().toISOString(),
    },
  ];
  const { error: featuresError } = await admin
    .from("subscription_plan_features")
    .upsert(featureRows, { onConflict: "plan_id,feature_key" });
  if (featuresError) go(`Fonctionnalités non enregistrées : ${featuresError.message}`, "error");

  await logSubscriptionEvent({
    organizationId: context.organizationId,
    actorId: context.userId,
    eventType: "plan_updated",
    details: { plan_id: planId, status, pricing_mode: pricingMode },
  });
  revalidatePath("/dashboard/subscription");
  revalidatePath("/dashboard", "layout");
  go("Plan et fonctionnalités enregistrés.");
}

export async function assignSubscriptionAction(formData: FormData) {
  const context = await requirePlatformBilling();
  const organizationId = text(formData, "organizationId");
  const planId = text(formData, "planId");
  const status = text(formData, "status");
  const interval = text(formData, "billingInterval") || "monthly";
  const trialDays = Math.min(365, Math.max(0, integer(text(formData, "trialDays"), 14)));
  if (!organizationId || !planId) go("Organisation et plan obligatoires.", "error");
  if (!["trialing", "active", "draft"].includes(status)) go("Statut initial invalide.", "error");
  if (!["monthly", "annual", "custom"].includes(interval)) go("Période invalide.", "error");

  const admin = createAdminClient();
  const [{ data: organization }, { data: plan }] = await Promise.all([
    admin.from("organizations").select("id,name").eq("id", organizationId).maybeSingle<{ id: string; name: string }>(),
    admin.from("subscription_plans").select("id,name,currency,default_trial_days").eq("id", planId).maybeSingle<{ id: string; name: string; currency: string; default_trial_days: number }>(),
  ]);
  if (!organization || !plan) go("Organisation ou plan introuvable.", "error");

  const now = new Date();
  const periodEnd = addPeriod(now, interval);
  const effectiveTrialDays = trialDays || plan.default_trial_days || 0;
  const trialEnd = status === "trialing"
    ? new Date(now.getTime() + effectiveTrialDays * 86400000)
    : null;

  await admin
    .from("organization_subscriptions")
    .update({ status: "canceled", canceled_at: now.toISOString(), cancel_at_period_end: false })
    .eq("organization_id", organizationId)
    .in("status", ["draft", "trialing", "active", "past_due", "scheduled_cancel", "suspended"]);

  const { data: subscription, error } = await admin
    .from("organization_subscriptions")
    .insert({
      organization_id: organizationId,
      plan_id: planId,
      status,
      billing_interval: interval,
      currency: plan.currency,
      provider: process.env.SUPER_LEADER_BILLING_MODE === "test" ? "test" : "manual",
      trial_started_at: status === "trialing" ? now.toISOString() : null,
      trial_ends_at: trialEnd?.toISOString() ?? null,
      current_period_started_at: now.toISOString(),
      current_period_ends_at: periodEnd?.toISOString() ?? null,
      created_by: context.userId,
      metadata: { assigned_manually: true },
    })
    .select("id")
    .single<{ id: string }>();
  if (error) go(`Attribution impossible : ${error.message}`, "error");

  await logSubscriptionEvent({
    organizationId,
    subscriptionId: subscription.id,
    actorId: context.userId,
    eventType: "subscription_assigned",
    details: { plan_id: planId, status, billing_interval: interval },
  });
  revalidatePath("/dashboard/subscription");
  revalidatePath("/dashboard", "layout");
  go(`${plan.name} a été attribué à ${organization.name}.`);
}

export async function scheduleSubscriptionCancellationAction(formData: FormData) {
  const context = await getBillingContext(["owner", "admin"]);
  const requestedOrganizationId = text(formData, "organizationId") || context.organizationId;
  if (!context.isPlatformWorkspace && requestedOrganizationId !== context.organizationId) {
    go("Action non autorisée.", "error");
  }

  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("organization_subscriptions")
    .select("id,status")
    .eq("organization_id", requestedOrganizationId)
    .in("status", ["trialing", "active", "past_due", "scheduled_cancel"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string }>();
  if (!subscription) go("Aucun abonnement actif à annuler.", "error");

  const { error } = await admin
    .from("organization_subscriptions")
    .update({ status: "scheduled_cancel", cancel_at_period_end: true })
    .eq("id", subscription.id);
  if (error) go(`Annulation impossible : ${error.message}`, "error");

  await logSubscriptionEvent({
    organizationId: requestedOrganizationId,
    subscriptionId: subscription.id,
    actorId: context.userId,
    eventType: "cancellation_scheduled",
  });
  revalidatePath("/dashboard/subscription");
  go("L’annulation est programmée pour la fin de la période en cours.");
}

export async function resumeSubscriptionAction(formData: FormData) {
  const context = await getBillingContext(["owner", "admin"]);
  const requestedOrganizationId = text(formData, "organizationId") || context.organizationId;
  if (!context.isPlatformWorkspace && requestedOrganizationId !== context.organizationId) {
    go("Action non autorisée.", "error");
  }
  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("organization_subscriptions")
    .select("id")
    .eq("organization_id", requestedOrganizationId)
    .eq("status", "scheduled_cancel")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!subscription) go("Aucune annulation programmée.", "error");

  const { error } = await admin
    .from("organization_subscriptions")
    .update({ status: "active", cancel_at_period_end: false, canceled_at: null })
    .eq("id", subscription.id);
  if (error) go(`Réactivation impossible : ${error.message}`, "error");
  await logSubscriptionEvent({
    organizationId: requestedOrganizationId,
    subscriptionId: subscription.id,
    actorId: context.userId,
    eventType: "cancellation_reversed",
  });
  revalidatePath("/dashboard/subscription");
  go("L’abonnement reste actif.");
}

export async function suspendSubscriptionAction(formData: FormData) {
  const context = await requirePlatformBilling();
  const organizationId = text(formData, "organizationId");
  const reason = text(formData, "reason");
  const suspend = text(formData, "suspend") !== "false";
  if (!organizationId) go("Organisation invalide.", "error");
  if (suspend && reason.length < 5) go("Ajoute un motif de suspension.", "error");

  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("organization_subscriptions")
    .select("id,status")
    .eq("organization_id", organizationId)
    .in("status", suspend ? ["trialing", "active", "past_due", "scheduled_cancel"] : ["suspended"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string }>();
  if (!subscription) go("Abonnement introuvable.", "error");

  const { error } = await admin
    .from("organization_subscriptions")
    .update(
      suspend
        ? { status: "suspended", suspended_at: new Date().toISOString(), suspension_reason: reason }
        : { status: "active", suspended_at: null, suspension_reason: null },
    )
    .eq("id", subscription.id);
  if (error) go(`Mise à jour impossible : ${error.message}`, "error");

  await logSubscriptionEvent({
    organizationId,
    subscriptionId: subscription.id,
    actorId: context.userId,
    eventType: suspend ? "subscription_suspended" : "subscription_reactivated",
    details: suspend ? { reason } : {},
  });
  revalidatePath("/dashboard/subscription");
  go(suspend ? "Abonnement suspendu." : "Abonnement réactivé.");
}

export async function createCouponAction(formData: FormData) {
  const context = await requirePlatformBilling();
  const code = text(formData, "code").toUpperCase().replace(/[^A-Z0-9_-]+/g, "");
  const name = text(formData, "name");
  const discountType = text(formData, "discountType");
  const discountValue = numberOrNull(text(formData, "discountValue"));
  const maxRedemptions = numberOrNull(text(formData, "maxRedemptions"));
  const validUntil = text(formData, "validUntil");
  const planId = text(formData, "planId");
  if (!code || !name || discountValue === null || discountValue <= 0) {
    go("Code, nom et réduction valides sont obligatoires.", "error");
  }
  if (!["percent", "fixed"].includes(discountType)) go("Type de réduction invalide.", "error");

  const admin = createAdminClient();
  const { error } = await admin.from("subscription_coupons").insert({
    code,
    name,
    discount_type: discountType,
    discount_percent: discountType === "percent" ? discountValue : null,
    discount_amount: discountType === "fixed" ? discountValue : null,
    currency: discountType === "fixed" ? (text(formData, "currency") || "USD").toUpperCase() : null,
    applies_to_plan_id: planId || null,
    max_redemptions: maxRedemptions === null ? null : Math.max(1, Math.trunc(maxRedemptions)),
    valid_until: validUntil ? new Date(`${validUntil}T23:59:59Z`).toISOString() : null,
    created_by: context.userId,
  });
  if (error) go(`Coupon impossible : ${error.message}`, "error");
  await logSubscriptionEvent({
    organizationId: context.organizationId,
    actorId: context.userId,
    eventType: "coupon_created",
    details: { code },
  });
  revalidatePath("/dashboard/subscription");
  go("Coupon créé.");
}

export async function toggleCouponAction(formData: FormData) {
  await requirePlatformBilling();
  const couponId = text(formData, "couponId");
  const active = text(formData, "active") === "true";
  const admin = createAdminClient();
  const { error } = await admin.from("subscription_coupons").update({ is_active: active }).eq("id", couponId);
  if (error) go(`Coupon non modifié : ${error.message}`, "error");
  revalidatePath("/dashboard/subscription");
  go(active ? "Coupon activé." : "Coupon désactivé.");
}

export async function createManualInvoiceAction(formData: FormData) {
  const context = await requirePlatformBilling();
  const organizationId = text(formData, "organizationId");
  const total = numberOrNull(text(formData, "total"));
  const currency = (text(formData, "currency") || "USD").toUpperCase();
  const dueDate = text(formData, "dueDate");
  const notes = text(formData, "notes");
  if (!organizationId || total === null || total < 0) go("Organisation et montant valides obligatoires.", "error");

  const admin = createAdminClient();
  const { data: currentSubscription } = await admin
    .from("organization_subscriptions")
    .select("id")
    .eq("organization_id", organizationId)
    .in("status", ["trialing", "active", "past_due", "scheduled_cancel", "suspended"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  const invoiceNumber = `SL-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const { error } = await admin.from("subscription_invoices").insert({
    organization_id: organizationId,
    subscription_id: currentSubscription?.id ?? null,
    invoice_number: invoiceNumber,
    status: "open",
    currency,
    subtotal: total,
    total,
    due_at: dueDate ? new Date(`${dueDate}T23:59:59Z`).toISOString() : null,
    notes: notes || null,
    created_by: context.userId,
  });
  if (error) go(`Facture impossible : ${error.message}`, "error");
  await logSubscriptionEvent({
    organizationId,
    subscriptionId: currentSubscription?.id ?? null,
    actorId: context.userId,
    eventType: "manual_invoice_created",
    details: { invoice_number: invoiceNumber, total, currency },
  });
  revalidatePath("/dashboard/subscription");
  go(`Facture ${invoiceNumber} créée en mode manuel.`);
}

export async function updateInvoiceStatusAction(formData: FormData) {
  const context = await requirePlatformBilling();
  const invoiceId = text(formData, "invoiceId");
  const status = text(formData, "status");
  if (!["draft", "open", "paid", "void", "uncollectible"].includes(status)) {
    go("Statut de facture invalide.", "error");
  }
  const admin = createAdminClient();
  const { data: invoice, error } = await admin
    .from("subscription_invoices")
    .update({
      status,
      paid_at: status === "paid" ? new Date().toISOString() : null,
    })
    .eq("id", invoiceId)
    .select("organization_id,subscription_id,total,currency")
    .single<{ organization_id: string; subscription_id: string | null; total: number; currency: string }>();
  if (error) go(`Facture non modifiée : ${error.message}`, "error");
  if (status === "paid") {
    await admin.from("subscription_invoices").update({ amount_paid: invoice.total }).eq("id", invoiceId);
  }
  await logSubscriptionEvent({
    organizationId: invoice.organization_id,
    subscriptionId: invoice.subscription_id,
    actorId: context.userId,
    eventType: `invoice_${status}`,
    details: { invoice_id: invoiceId },
  });
  revalidatePath("/dashboard/subscription");
  go("Statut de facture mis à jour.");
}
