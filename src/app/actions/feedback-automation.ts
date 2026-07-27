"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {processFeedbackAutomation} from "@/lib/crm/feedback-automation";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const adminRoles = new Set(["owner", "admin"]);
const allowedOutcomes = new Set(["resolved", "follow_up", "payment_promise", "escalated", "other"]);

function toInteger(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function go(message: string, kind: "success" | "error" = "success"): never {
  redirect(`/dashboard/feedback-automation?${kind}=${encodeURIComponent(message)}`);
}

async function getContext() {
  const {t} = await getI18n();
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership} = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{organization_id: string; role: string}>();
  if (!membership) redirect("/dashboard/company");
  return {user: authData.user, membership, admin, t};
}

export async function updateFeedbackAutomationSettingsAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  if (!adminRoles.has(membership.role)) go(t("feedbackAutomation.messages.permissionDenied"), "error");

  const delayMinutes = toInteger(formData.get("autoRequestDelayMinutes"));
  const firstReminderHours = toInteger(formData.get("firstReminderHours"));
  const reminderIntervalHours = toInteger(formData.get("reminderIntervalHours"));
  const maxReminders = toInteger(formData.get("maxReminders"));
  const fallbackChannel = String(formData.get("fallbackChannel") ?? "web");
  const outcomes = formData.getAll("autoRequestOutcomes").map(String).filter((item) => allowedOutcomes.has(item));

  if (
    !Number.isInteger(delayMinutes) || delayMinutes < 0 || delayMinutes > 1440
    || !Number.isInteger(firstReminderHours) || firstReminderHours < 1 || firstReminderHours > 720
    || !Number.isInteger(reminderIntervalHours) || reminderIntervalHours < 1 || reminderIntervalHours > 720
    || !Number.isInteger(maxReminders) || maxReminders < 0 || maxReminders > 5
    || !["email", "web", "none"].includes(fallbackChannel)
    || outcomes.length === 0
  ) {
    go(t("feedbackAutomation.messages.invalidSettings"), "error");
  }

  const {data: existing, error: loadError} = await admin
    .from("crm_settings")
    .select("organization_id")
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{organization_id: string}>();
  if (loadError) go(t("feedbackAutomation.messages.saveFailed", {message: loadError.message}), "error");

  if (!existing) {
    const {error} = await admin.from("crm_settings").insert({
      organization_id: membership.organization_id,
      created_by: user.id,
      updated_by: user.id,
      auto_request_feedback: formData.get("autoRequestFeedback") === "on",
      auto_request_delay_minutes: delayMinutes,
      auto_request_outcomes: outcomes,
      auto_send_email: formData.get("autoSendEmail") === "on",
      auto_send_sms: formData.get("autoSendSms") === "on",
      auto_send_whatsapp: formData.get("autoSendWhatsapp") === "on",
      reminders_enabled: formData.get("remindersEnabled") === "on",
      first_reminder_hours: firstReminderHours,
      reminder_interval_hours: reminderIntervalHours,
      max_reminders: maxReminders,
      fallback_channel: fallbackChannel,
    });
    if (error) go(t("feedbackAutomation.messages.saveFailed", {message: error.message}), "error");
  } else {
    const {error} = await admin.from("crm_settings").update({
      auto_request_feedback: formData.get("autoRequestFeedback") === "on",
      auto_request_delay_minutes: delayMinutes,
      auto_request_outcomes: outcomes,
      auto_send_email: formData.get("autoSendEmail") === "on",
      auto_send_sms: formData.get("autoSendSms") === "on",
      auto_send_whatsapp: formData.get("autoSendWhatsapp") === "on",
      reminders_enabled: formData.get("remindersEnabled") === "on",
      first_reminder_hours: firstReminderHours,
      reminder_interval_hours: reminderIntervalHours,
      max_reminders: maxReminders,
      fallback_channel: fallbackChannel,
      updated_by: user.id,
    }).eq("organization_id", membership.organization_id);
    if (error) go(t("feedbackAutomation.messages.saveFailed", {message: error.message}), "error");
  }

  await admin.from("crm_audit_log").insert({
    organization_id: membership.organization_id,
    actor_id: user.id,
    entity_type: "crm_settings",
    action: "feedback_automation_settings_updated",
    details: {outcomes, delayMinutes, maxReminders},
  });
  revalidatePath("/dashboard/feedback-automation");
  revalidatePath("/dashboard/crm");
  go(t("feedbackAutomation.messages.saved"));
}

export async function runFeedbackAutomationNowAction() {
  const {user, membership, admin, t} = await getContext();
  if (!adminRoles.has(membership.role)) go(t("feedbackAutomation.messages.permissionDenied"), "error");

  try {
    const result = await processFeedbackAutomation({organizationId: membership.organization_id, limit: 50});
    await admin.from("crm_audit_log").insert({
      organization_id: membership.organization_id,
      actor_id: user.id,
      entity_type: "feedback_automation",
      action: "feedback_automation_manually_run",
      details: result,
    });
    revalidatePath("/dashboard/feedback-automation");
    revalidatePath("/dashboard/crm");
    go(t("feedbackAutomation.messages.runCompleted", {sent: result.sent, queued: result.queued}));
  } catch (error) {
    go(t("feedbackAutomation.messages.runFailed", {message: error instanceof Error ? error.message : t("common.unknownError")}), "error");
  }
}
