"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

type Membership = {
  organization_id: string;
  role: string;
  is_active: boolean;
};

function safeReturnTo(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return raw.startsWith("/dashboard/notifications")
    ? raw
    : "/dashboard/notifications";
}

function go(returnTo: string, message: string, kind: "success" | "error" = "success"): never {
  const separator = returnTo.includes("?") ? "&" : "?";
  redirect(`${returnTo}${separator}${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
  const {t} = await getI18n();
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error: membershipError} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (membershipError) {
    throw new Error(t("notifications.messages.loadFailed", {message: membershipError.message}));
  }
  if (!membership) redirect("/dashboard/company");

  return {user: authData.user, membership, admin, t};
}

async function audit(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    organizationId: string;
    notificationId?: string | null;
    actorId: string;
    userId: string;
    action: string;
    details?: Record<string, unknown>;
  },
) {
  const {error} = await admin.from("notification_audit_log").insert({
    organization_id: input.organizationId,
    notification_id: input.notificationId ?? null,
    actor_id: input.actorId,
    user_id: input.userId,
    action: input.action,
    details: input.details ?? {},
  });
  if (error) console.error("Notification audit failed", error);
}

export async function markNotificationReadAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const notificationId = String(formData.get("notificationId") ?? "").trim();
  const {user, membership, admin, t} = await getContext();
  if (!notificationId) go(returnTo, t("notifications.messages.invalidNotification"), "error");

  const {data, error} = await admin
    .from("notifications")
    .update({status: "read", read_at: new Date().toISOString()})
    .eq("id", notificationId)
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .neq("status", "archived")
    .select("id")
    .maybeSingle<{id: string}>();

  if (error || !data) {
    go(returnTo, t("notifications.messages.updateFailed", {message: error?.message ?? t("common.unknownError")}), "error");
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    notificationId,
    actorId: user.id,
    userId: user.id,
    action: "read",
  });
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/notifications");
  go(returnTo, t("notifications.messages.markedRead"));
}

export async function markAllNotificationsReadAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const {user, membership, admin, t} = await getContext();
  const now = new Date().toISOString();

  const {error} = await admin
    .from("notifications")
    .update({status: "read", read_at: now})
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .eq("status", "unread");

  if (error) go(returnTo, t("notifications.messages.updateFailed", {message: error.message}), "error");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    userId: user.id,
    action: "read_all",
  });
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/notifications");
  go(returnTo, t("notifications.messages.allMarkedRead"));
}

export async function archiveNotificationAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const notificationId = String(formData.get("notificationId") ?? "").trim();
  const {user, membership, admin, t} = await getContext();
  if (!notificationId) go(returnTo, t("notifications.messages.invalidNotification"), "error");

  const {data, error} = await admin
    .from("notifications")
    .update({status: "archived", archived_at: new Date().toISOString()})
    .eq("id", notificationId)
    .eq("organization_id", membership.organization_id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle<{id: string}>();

  if (error || !data) {
    go(returnTo, t("notifications.messages.updateFailed", {message: error?.message ?? t("common.unknownError")}), "error");
  }

  await audit(admin, {
    organizationId: membership.organization_id,
    notificationId,
    actorId: user.id,
    userId: user.id,
    action: "archived",
  });
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/notifications");
  go(returnTo, t("notifications.messages.archived"));
}

export async function updateNotificationPreferencesAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const {user, membership, admin, t} = await getContext();
  const frequencyRaw = String(formData.get("emailFrequency") ?? "daily");
  const emailFrequency = ["instant", "daily", "off"].includes(frequencyRaw)
    ? frequencyRaw
    : "daily";

  const localeRaw = String(formData.get("locale") ?? "fr");
  const payload = {
    organization_id: membership.organization_id,
    user_id: user.id,
    email_enabled: formData.get("emailEnabled") === "on" && emailFrequency !== "off",
    email_frequency: emailFrequency,
    locale: localeRaw === "en" ? "en" : "fr",
    report_reminders: formData.get("reportReminders") === "on",
    absence_updates: formData.get("absenceUpdates") === "on",
    meeting_reminders: formData.get("meetingReminders") === "on",
    sales_updates: formData.get("salesUpdates") === "on",
    collection_updates: formData.get("collectionUpdates") === "on",
    feedback_alerts: formData.get("feedbackAlerts") === "on",
    performance_updates: formData.get("performanceUpdates") === "on",
    crm_updates: formData.get("crmUpdates") === "on",
  };

  const {error} = await admin
    .from("notification_preferences")
    .upsert(payload, {onConflict: "organization_id,user_id"});

  if (error) go(returnTo, t("notifications.messages.preferencesFailed", {message: error.message}), "error");

  await audit(admin, {
    organizationId: membership.organization_id,
    actorId: user.id,
    userId: user.id,
    action: "preferences_updated",
    details: payload,
  });
  revalidatePath("/dashboard/notifications");
  go(returnTo, t("notifications.messages.preferencesSaved"));
}
