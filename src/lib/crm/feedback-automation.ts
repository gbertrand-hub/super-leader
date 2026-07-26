import {randomUUID} from "node:crypto";
import {sendFeedbackByChannel, type FeedbackChannel, type FeedbackLocale} from "@/lib/crm/feedback-delivery";
import {recordOutboundFeedbackDelivery} from "@/lib/crm/feedback-events";
import {createAdminClient} from "@/lib/supabase/admin";

type AutomationSettings = {
  organization_id: string;
  auto_send_email: boolean;
  auto_send_sms: boolean;
  auto_send_whatsapp: boolean;
  reminders_enabled: boolean;
  first_reminder_hours: number;
  reminder_interval_hours: number;
  max_reminders: number;
};

type RequestRow = {
  id: string;
  organization_id: string;
  client_id: string;
  employee_id: string;
  public_token: string;
  channel: FeedbackChannel;
  locale: FeedbackLocale;
  recipient: string | null;
  message: string;
  status: string;
  sent_at: string | null;
  expires_at: string;
  delivery_attempts: number;
  reminder_count: number;
};

type Context = {
  clientName: string;
  organizationName: string;
  employeeName: string;
  settings: AutomationSettings;
};

function channelEnabled(settings: AutomationSettings, channel: FeedbackChannel) {
  if (channel === "email") return settings.auto_send_email;
  if (channel === "sms") return settings.auto_send_sms;
  if (channel === "whatsapp") return settings.auto_send_whatsapp;
  return false;
}

function nextReminderAt(settings: AutomationSettings, reminderCount: number, now = Date.now()) {
  if (!settings.reminders_enabled || settings.max_reminders <= reminderCount) return null;
  const hours = reminderCount === 0 ? settings.first_reminder_hours : settings.reminder_interval_hours;
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
}

async function loadContext(request: RequestRow): Promise<Context | null> {
  const admin = createAdminClient();
  const [settingsResult, clientResult, orgResult, employeeResult] = await Promise.all([
    admin
      .from("crm_settings")
      .select("organization_id, auto_send_email, auto_send_sms, auto_send_whatsapp, reminders_enabled, first_reminder_hours, reminder_interval_hours, max_reminders")
      .eq("organization_id", request.organization_id)
      .maybeSingle<AutomationSettings>(),
    admin
      .from("crm_clients")
      .select("full_name, do_not_contact, feedback_opt_in")
      .eq("id", request.client_id)
      .maybeSingle<{full_name: string; do_not_contact: boolean; feedback_opt_in: boolean}>(),
    admin.from("organizations").select("name").eq("id", request.organization_id).maybeSingle<{name: string}>(),
    admin.from("profiles").select("full_name, email").eq("id", request.employee_id).maybeSingle<{full_name: string | null; email: string | null}>(),
  ]);

  const error = settingsResult.error || clientResult.error || orgResult.error || employeeResult.error;
  if (error) throw new Error(error.message);
  if (!settingsResult.data || !clientResult.data || clientResult.data.do_not_contact || !clientResult.data.feedback_opt_in) return null;

  return {
    clientName: clientResult.data.full_name,
    organizationName: orgResult.data?.name?.trim() || "Super Leader",
    employeeName: employeeResult.data?.full_name?.trim() || employeeResult.data?.email || "Super Leader",
    settings: settingsResult.data,
  };
}

async function claimRequest(requestId: string) {
  const admin = createAdminClient();
  const token = randomUUID();
  const {data, error} = await admin
    .from("crm_feedback_requests")
    .update({processing_at: new Date().toISOString(), processing_token: token})
    .eq("id", requestId)
    .is("processing_at", null)
    .select("id")
    .maybeSingle<{id: string}>();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function releaseRequest(requestId: string, update: Record<string, unknown>) {
  const admin = createAdminClient();
  const {error} = await admin
    .from("crm_feedback_requests")
    .update({...update, processing_at: null, processing_token: null})
    .eq("id", requestId);
  if (error) throw new Error(error.message);
}

async function dispatch(request: RequestRow, isReminder: boolean) {
  const claimed = await claimRequest(request.id);
  if (!claimed) return {processed: false, sent: false, skipped: true};

  const admin = createAdminClient();
  try {
    const context = await loadContext(request);
    if (!context) {
      await releaseRequest(request.id, {
        status: "cancelled",
        scheduled_send_at: null,
        next_reminder_at: null,
        last_provider_status: "cancelled_by_contact_preferences",
      });
      return {processed: true, sent: false, skipped: true};
    }

    if (!channelEnabled(context.settings, request.channel)) {
      await releaseRequest(request.id, {
        status: isReminder ? request.status : "ready",
        scheduled_send_at: null,
        next_reminder_at: null,
        last_provider_status: "automatic_channel_disabled",
      });
      return {processed: true, sent: false, skipped: true};
    }

    const delivery = await sendFeedbackByChannel({
      channel: request.channel,
      recipient: request.recipient,
      clientName: context.clientName,
      organizationName: context.organizationName,
      employeeName: context.employeeName,
      token: request.public_token,
      locale: request.locale,
      message: request.message,
      isReminder,
    });

    const now = new Date().toISOString();
    if (!delivery.sent) {
      const attempts = request.delivery_attempts + 1;
      const retryAt = attempts < 3 ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
      await releaseRequest(request.id, {
        status: isReminder ? request.status : delivery.configurationMissing ? "ready" : "failed",
        delivery_provider: delivery.provider,
        delivery_error: delivery.error ?? null,
        delivery_attempts: attempts,
        last_delivery_at: now,
        last_provider_status: delivery.providerStatus ?? "failed",
        scheduled_send_at: isReminder ? null : retryAt,
        next_reminder_at: isReminder ? retryAt : null,
        provider_metadata: delivery.providerMetadata ?? {},
      });
      return {processed: true, sent: false, skipped: false};
    }

    const reminderCount = isReminder ? request.reminder_count + 1 : request.reminder_count;
    const aggregateStatus = isReminder && ["delivered", "opened"].includes(request.status)
      ? request.status
      : "sent";

    await releaseRequest(request.id, {
      status: aggregateStatus,
      sent_at: request.sent_at ?? now,
      delivery_provider: delivery.provider,
      provider_message_id: delivery.providerMessageId ?? null,
      delivery_error: null,
      delivery_attempts: request.delivery_attempts + 1,
      reminder_count: reminderCount,
      last_delivery_at: now,
      last_provider_status: delivery.providerStatus ?? "sent",
      next_reminder_at: nextReminderAt(context.settings, reminderCount),
      scheduled_send_at: null,
      provider_metadata: delivery.providerMetadata ?? {},
    });

    await recordOutboundFeedbackDelivery({
      organizationId: request.organization_id,
      requestId: request.id,
      provider: delivery.provider,
      providerMessageId: delivery.providerMessageId,
      deliveryKind: isReminder ? "reminder" : "initial",
      status: delivery.providerStatus,
      metadata: delivery.providerMetadata,
    });

    await admin.from("crm_audit_log").insert({
      organization_id: request.organization_id,
      actor_id: null,
      entity_type: "feedback_request",
      entity_id: request.id,
      action: isReminder ? "feedback_reminder_sent" : "feedback_request_automatically_sent",
      details: {channel: request.channel, provider: delivery.provider, reminderCount},
    });

    return {processed: true, sent: true, skipped: false};
  } catch (error) {
    await admin
      .from("crm_feedback_requests")
      .update({processing_at: null, processing_token: null})
      .eq("id", request.id);
    throw error;
  }
}

export async function processFeedbackAutomation(options?: {organizationId?: string; limit?: number}) {
  const admin = createAdminClient();
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const now = new Date().toISOString();
  const staleProcessing = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  await admin
    .from("crm_feedback_requests")
    .update({processing_at: null, processing_token: null})
    .lt("processing_at", staleProcessing);

  await admin
    .from("crm_feedback_requests")
    .update({status: "expired", next_reminder_at: null, scheduled_send_at: null, processing_at: null, processing_token: null})
    .lt("expires_at", now)
    .not("status", "in", "(completed,cancelled,expired)");

  let initialQuery = admin
    .from("crm_feedback_requests")
    .select("id, organization_id, client_id, employee_id, public_token, channel, locale, recipient, message, status, sent_at, expires_at, delivery_attempts, reminder_count")
    .in("status", ["ready", "pending", "failed"])
    .lte("scheduled_send_at", now)
    .gt("expires_at", now)
    .is("processing_at", null)
    .order("scheduled_send_at", {ascending: true, nullsFirst: true})
    .limit(limit);
  if (options?.organizationId) initialQuery = initialQuery.eq("organization_id", options.organizationId);

  let reminderQuery = admin
    .from("crm_feedback_requests")
    .select("id, organization_id, client_id, employee_id, public_token, channel, locale, recipient, message, status, sent_at, expires_at, delivery_attempts, reminder_count")
    .in("status", ["sent", "delivered", "opened"])
    .lte("next_reminder_at", now)
    .gt("expires_at", now)
    .is("processing_at", null)
    .order("next_reminder_at", {ascending: true})
    .limit(limit);
  if (options?.organizationId) reminderQuery = reminderQuery.eq("organization_id", options.organizationId);

  const [{data: initialData, error: initialError}, {data: reminderData, error: reminderError}] = await Promise.all([
    initialQuery,
    reminderQuery,
  ]);
  if (initialError || reminderError) throw new Error(initialError?.message || reminderError?.message || "Unable to load feedback automation queue.");

  const initial = (initialData ?? []) as RequestRow[];
  const reminders = (reminderData ?? []) as RequestRow[];
  let processed = 0;
  let sent = 0;
  let skipped = 0;

  for (const request of initial) {
    const result = await dispatch(request, false);
    if (result.processed) processed += 1;
    if (result.sent) sent += 1;
    if (result.skipped) skipped += 1;
  }
  for (const request of reminders) {
    const result = await dispatch(request, true);
    if (result.processed) processed += 1;
    if (result.sent) sent += 1;
    if (result.skipped) skipped += 1;
  }

  return {
    queued: initial.length + reminders.length,
    processed,
    sent,
    skipped,
    initial: initial.length,
    reminders: reminders.length,
  };
}
