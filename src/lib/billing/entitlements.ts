import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const SUBSCRIPTION_FEATURE_KEYS = [
  "core_feedback",
  "recognition",
  "teams",
  "performance",
  "academy",
  "growth",
  "crm_sales",
  "feedback_automation",
  "reports_advanced",
  "custom_branding",
  "api_integrations",
  "priority_support",
] as const;

export type SubscriptionFeatureKey = (typeof SUBSCRIPTION_FEATURE_KEYS)[number];

export type OrganizationEntitlements = {
  subscriptionId: string | null;
  planId: string | null;
  planCode: string;
  planName: string;
  status: string;
  billingInterval: string | null;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  enabledFeatures: SubscriptionFeatureKey[];
  featureLimits: Record<string, number | null>;
  databaseReady: boolean;
};

type CurrentSubscriptionRow = {
  id: string;
  plan_id: string;
  status: string;
  billing_interval: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  cancel_at_period_end: boolean;
  subscription_plans:
    | { id: string; code: string; name: string }
    | { id: string; code: string; name: string }[]
    | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function legacyEntitlements(): OrganizationEntitlements {
  return {
    subscriptionId: null,
    planId: null,
    planCode: "legacy_fallback",
    planName: "Accès actuel",
    status: "active",
    billingInterval: null,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false,
    enabledFeatures: [...SUBSCRIPTION_FEATURE_KEYS],
    featureLimits: { max_members: null },
    databaseReady: false,
  };
}

export async function getOrganizationEntitlements(
  organizationId: string,
): Promise<OrganizationEntitlements> {
  if (!organizationId) return legacyEntitlements();

  try {
    const admin = createAdminClient();
    const { data: subscription, error: subscriptionError } = await admin
      .from("organization_subscriptions")
      .select(
        "id,plan_id,status,billing_interval,trial_ends_at,current_period_ends_at,cancel_at_period_end,subscription_plans(id,code,name)",
      )
      .eq("organization_id", organizationId)
      .in("status", [
        "draft",
        "trialing",
        "active",
        "past_due",
        "scheduled_cancel",
        "suspended",
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<CurrentSubscriptionRow>();

    if (subscriptionError) {
      if (
        subscriptionError.code === "42P01" ||
        subscriptionError.message.toLowerCase().includes("organization_subscriptions")
      ) {
        return legacyEntitlements();
      }
      throw new Error(subscriptionError.message);
    }

    if (!subscription) return legacyEntitlements();

    const plan = firstRelation(subscription.subscription_plans);
    const [{ data: planFeatures, error: featureError }, { data: overrides, error: overrideError }] =
      await Promise.all([
        admin
          .from("subscription_plan_features")
          .select("feature_key,enabled,limit_value")
          .eq("plan_id", subscription.plan_id),
        admin
          .from("organization_feature_overrides")
          .select("feature_key,enabled,limit_value")
          .eq("organization_id", organizationId),
      ]);

    if (featureError) throw new Error(featureError.message);
    if (overrideError) throw new Error(overrideError.message);

    const enabled = new Set<SubscriptionFeatureKey>();
    const limits: Record<string, number | null> = {};
    const now = Date.now();
    const trialValid =
      subscription.status !== "trialing" ||
      !subscription.trial_ends_at ||
      new Date(subscription.trial_ends_at).getTime() >= now;
    const periodValid =
      !subscription.current_period_ends_at ||
      new Date(subscription.current_period_ends_at).getTime() >= now ||
      subscription.status === "past_due";
    const accessActive =
      ["trialing", "active", "past_due", "scheduled_cancel"].includes(subscription.status) &&
      trialValid &&
      periodValid;

    for (const feature of planFeatures ?? []) {
      const key = String(feature.feature_key);
      if (
        accessActive &&
        feature.enabled &&
        SUBSCRIPTION_FEATURE_KEYS.includes(key as SubscriptionFeatureKey)
      ) {
        enabled.add(key as SubscriptionFeatureKey);
      }
      limits[key] =
        feature.limit_value === null || feature.limit_value === undefined
          ? null
          : Number(feature.limit_value);
    }

    for (const override of overrides ?? []) {
      const key = String(override.feature_key);
      if (override.enabled !== null && override.enabled !== undefined) {
        if (
          accessActive &&
          override.enabled &&
          SUBSCRIPTION_FEATURE_KEYS.includes(key as SubscriptionFeatureKey)
        ) {
          enabled.add(key as SubscriptionFeatureKey);
        } else {
          enabled.delete(key as SubscriptionFeatureKey);
        }
      }
      if (override.limit_value !== null && override.limit_value !== undefined) {
        limits[key] = Number(override.limit_value);
      }
    }

    return {
      subscriptionId: subscription.id,
      planId: subscription.plan_id,
      planCode: plan?.code ?? "unknown",
      planName: plan?.name ?? "Plan",
      status: subscription.status,
      billingInterval: subscription.billing_interval,
      trialEndsAt: subscription.trial_ends_at,
      currentPeriodEndsAt: subscription.current_period_ends_at,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      enabledFeatures: [...enabled],
      featureLimits: limits,
      databaseReady: true,
    };
  } catch (error) {
    console.error("Subscription entitlements unavailable", error);
    return legacyEntitlements();
  }
}

export function hasSubscriptionFeature(
  entitlements: OrganizationEntitlements,
  feature: SubscriptionFeatureKey,
): boolean {
  return entitlements.enabledFeatures.includes(feature);
}

export async function assertOrganizationCanAddMember(
  organizationId: string,
): Promise<{ allowed: boolean; current: number; limit: number | null }> {
  const entitlements = await getOrganizationEntitlements(organizationId);
  const rawLimit = entitlements.featureLimits.max_members;
  const limit = typeof rawLimit === "number" ? rawLimit : null;

  if (limit === null) return { allowed: true, current: 0, limit: null };

  const admin = createAdminClient();
  const [{ count: memberCount, error: memberError }, { count: invitationCount, error: invitationError }] =
    await Promise.all([
      admin
        .from("organization_members")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("is_active", true),
      admin
        .from("organization_invitations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "pending"),
    ]);

  if (memberError) throw new Error(memberError.message);
  if (invitationError) throw new Error(invitationError.message);
  const current = (memberCount ?? 0) + (invitationCount ?? 0);
  return { allowed: current < limit, current, limit };
}

export async function enforceOrganizationFeature(
  organizationId: string,
  feature: SubscriptionFeatureKey,
): Promise<void> {
  const entitlements = await getOrganizationEntitlements(organizationId);
  if (!hasSubscriptionFeature(entitlements, feature)) {
    const params = new URLSearchParams({ upgrade: feature });
    redirect(`/dashboard/subscription?${params.toString()}`);
  }
}

export async function requireFeatureForCurrentOrganization(
  feature: SubscriptionFeatureKey,
): Promise<void> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ organization_id: string }>();

  if (!membership) redirect("/dashboard");
  await enforceOrganizationFeature(membership.organization_id, feature);
}
