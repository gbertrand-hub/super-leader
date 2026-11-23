"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { enforceOrganizationFeature } from "@/lib/billing/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const badges = [
  "leadership",
  "teamwork",
  "service",
  "innovation",
  "reliability",
  "communication",
  "courage",
  "excellence",
] as const;

const visibilities = ["private", "team"] as const;

type Badge = (typeof badges)[number];
type Visibility = (typeof visibilities)[number];

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/recognition?${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    go(
      t("recognition.actionMessages.organisationLoadImpossible", {
        message: membershipError.message,
      }),
      "error",
    );
  }

  if (!membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "recognition");

  return { user: authData.user, membership, admin, t };
}

export async function sendRecognitionAction(formData: FormData) {
  const { user, membership, admin, t } = await getContext();

  const recipientId = String(formData.get("recipientId") ?? "");
  const badge = String(formData.get("badge") ?? "") as Badge;
  const message = String(formData.get("message") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "private") as Visibility;

  if (!recipientId || recipientId === user.id) {
    go(t("recognition.actionMessages.chooseOther"), "error");
  }

  if (!badges.includes(badge)) {
    go(t("recognition.actionMessages.invalidBadge"), "error");
  }

  if (!visibilities.includes(visibility)) {
    go(t("recognition.actionMessages.invalidVisibility"), "error");
  }

  if (message.length < 3 || message.length > 600) {
    go(t("recognition.actionMessages.invalidMessage"), "error");
  }

  const { data: recipientMembership } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", membership.organization_id)
    .eq("user_id", recipientId)
    .eq("is_active", true)
    .maybeSingle();

  if (!recipientMembership) {
    go(t("recognition.actionMessages.outsideOrganisation"), "error");
  }

  const { error } = await admin.from("recognitions").insert({
    organization_id: membership.organization_id,
    sender_id: user.id,
    recipient_id: recipientId,
    badge,
    message,
    visibility,
  });

  if (error) {
    go(
      t("recognition.actionMessages.sendImpossible", { message: error.message }),
      "error",
    );
  }

  revalidatePath("/dashboard/recognition");
  revalidatePath("/dashboard");
  go(t("recognition.actionMessages.sent"));
}
