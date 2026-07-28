"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { enforceOrganizationFeature } from "@/lib/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const categories = [
  "communication",
  "collaboration",
  "leadership",
  "fiabilite",
  "organisation",
  "qualite",
  "service_client",
  "innovation",
  "autre",
] as const;

type Category = (typeof categories)[number];

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/feedback?${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "core_feedback");
  return { user: data.user, membership };
}

export async function submitPeerFeedbackAction(formData: FormData) {
  const { t } = await getI18n();
  const { user, membership } = await getContext();
  const recipientId = String(formData.get("recipientId") ?? "");
  const category = String(formData.get("category") ?? "") as Category;
  const score = Number(formData.get("score") ?? 0);
  const strength = String(formData.get("strength") ?? "").trim();
  const improvement = String(formData.get("improvement") ?? "").trim();
  const isAnonymous = String(formData.get("isAnonymous") ?? "false") === "true";

  if (!recipientId || recipientId === user.id) {
    go(t("feedback.actionMessages.chooseOther"), "error");
  }
  if (!categories.includes(category)) {
    go(t("feedback.actionMessages.invalidCategory"), "error");
  }
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    go(t("feedback.actionMessages.invalidScore"), "error");
  }
  if (strength.length < 3 || strength.length > 1000) {
    go(t("feedback.actionMessages.invalidStrength"), "error");
  }
  if (improvement.length > 1000) {
    go(t("feedback.actionMessages.improvementTooLong"), "error");
  }

  const admin = createAdminClient();
  const { data: recipientMembership } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", recipientId)
    .eq("is_active", true)
    .maybeSingle();

  if (!recipientMembership) {
    go(t("feedback.actionMessages.outsideOrganisation"), "error");
  }

  const { error } = await admin.from("peer_feedback").insert({
    organization_id: membership.organization_id,
    sender_id: user.id,
    recipient_id: recipientId,
    category,
    score,
    strength,
    improvement: improvement || null,
    is_anonymous: isAnonymous,
  });

  if (error) {
    go(
      t("feedback.actionMessages.sendImpossible", { message: error.message }),
      "error",
    );
  }

  revalidatePath("/dashboard/feedback");
  revalidatePath("/dashboard");
  go(t("feedback.actionMessages.sent"));
}
