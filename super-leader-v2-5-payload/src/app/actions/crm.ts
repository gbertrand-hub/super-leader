"use server";

import {randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getI18n} from "@/i18n/server";
import {buildFeedbackMessage, getFeedbackProviderConfiguration, getFeedbackUrl, sendFeedbackByChannel} from "@/lib/crm/feedback-delivery";
import {recordOutboundFeedbackDelivery} from "@/lib/crm/feedback-events";
import {COMMERCIAL_MANAGER_ROLES, canUseCommercialModules} from "@/lib/auth/permissions";
import {getVisibleUserIds} from "@/lib/auth/scope";
import {enforceOrganizationFeature} from "@/lib/billing/entitlements";
import {createAdminClient} from "@/lib/supabase/admin";
import {createClient} from "@/lib/supabase/server";

const leaderRoles = COMMERCIAL_MANAGER_ROLES;
const adminRoles = new Set(["owner", "admin"]);
const currencies = new Set(["USD", "EUR", "GBP", "XAF", "CAD"]);
const clientStatuses = new Set(["prospect", "active", "inactive", "closed"]);
const feedbackChannels = new Set(["email", "whatsapp", "sms", "web"]);
const interactionChannels = new Set(["phone", "whatsapp", "email", "sms", "meeting", "video", "web_chat", "other"]);
const interactionTypes = new Set(["sales", "support", "collection", "training", "complaint", "information", "other"]);
const interactionOutcomes = new Set(["resolved", "follow_up", "payment_promise", "no_answer", "escalated", "other"]);
const taskPriorities = new Set(["low", "normal", "high", "urgent"]);
const taskStatuses = new Set(["todo", "in_progress", "completed", "overdue", "cancelled"]);
const contractStatuses = new Set(["preparation", "awaiting_signature", "active", "payment_in_progress", "paid", "suspended", "cancelled", "terminated"]);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Membership = {
  organization_id: string;
  role: string;
  is_active: boolean;
};

type ClientRow = {
  id: string;
  organization_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  preferred_language: "fr" | "en";
  preferred_feedback_channel: string;
  feedback_opt_in: boolean;
  do_not_contact: boolean;
  owner_id: string | null;
  follow_up_owner_id: string | null;
};

type SettingsRow = {
  organization_id: string;
  default_feedback_channel: string;
  feedback_cooldown_days: number;
  feedback_expiry_days: number;
  low_score_threshold: number;
  auto_send_email: boolean;
  auto_send_sms: boolean;
  auto_send_whatsapp: boolean;
  auto_request_feedback: boolean;
  auto_request_delay_minutes: number;
  auto_request_outcomes: string[];
  reminders_enabled: boolean;
  first_reminder_hours: number;
  reminder_interval_hours: number;
  max_reminders: number;
  fallback_channel: string;
  feedback_message_fr: string;
  feedback_message_en: string;
};

type MemberProfile = {
  full_name: string | null;
  email: string | null;
};

type FeedbackRequestResult = {
  created: boolean;
  token?: string;
  url?: string;
  sent?: boolean;
  message: string;
};

function cleanText(value: FormDataEntryValue | null, maxLength = 5000) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function requiredText(value: FormDataEntryValue | null, maxLength = 5000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeEmail(value: FormDataEntryValue | null) {
  const email = String(value ?? "").trim().toLowerCase();
  return email || null;
}

function normalizePhone(value: FormDataEntryValue | null) {
  const phone = String(value ?? "").trim().replace(/[^\d+]/g, "");
  return phone || null;
}

function normalizeDate(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeDateTime(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseMoney(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return 0;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : Number.NaN;
}

function parseInteger(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function normalizeReturnTo(formData: FormData) {
  const raw = String(formData.get("returnTo") ?? "/dashboard/crm").trim();
  return raw.startsWith("/dashboard/crm") ? raw : "/dashboard/crm";
}

function go(returnTo: string, message: string, kind: "success" | "error" = "success"): never {
  const separator = returnTo.includes("?") ? "&" : "?";
  redirect(`${returnTo}${separator}${kind}=${encodeURIComponent(message)}`);
}

function makeReference(prefix: string) {
  return `${prefix}-${new Date().getUTCFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

async function getContext() {
  const {t, locale} = await getI18n();
  const supabase = await createClient();
  const {data: authData, error: authError} = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/login");

  const admin = createAdminClient();
  const {data: membership, error} = await admin
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<Membership>();

  if (error) throw new Error(error.message);
  if (!membership) redirect("/dashboard/company");
  await enforceOrganizationFeature(membership.organization_id, "crm_sales");
  if (!canUseCommercialModules(membership.role)) redirect("/dashboard/performance?error=access-denied");

  const visibleUserIds = await getVisibleUserIds({
    admin,
    organizationId: membership.organization_id,
    actorId: authData.user.id,
    role: membership.role,
  });

  return {user: authData.user, membership, admin, t, locale, visibleUserIds};
}

async function ensureActiveMember(organizationId: string, userId: string | null, admin: ReturnType<typeof createAdminClient>) {
  if (!userId) return true;
  const {data} = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}

async function getClient(clientId: string, organizationId: string, admin: ReturnType<typeof createAdminClient>) {
  return admin
    .from("crm_clients")
    .select("id, organization_id, full_name, email, phone, whatsapp_phone, preferred_language, preferred_feedback_channel, feedback_opt_in, do_not_contact, owner_id, follow_up_owner_id")
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .maybeSingle<ClientRow>();
}

function canAccessClient(role: string, userId: string, client: ClientRow, visibleUserIds: string[]) {
  if (role === "owner" || role === "admin") return true;
  if (role === "manager") {
    return Boolean(
      (client.owner_id && visibleUserIds.includes(client.owner_id))
      || (client.follow_up_owner_id && visibleUserIds.includes(client.follow_up_owner_id)),
    );
  }
  return client.owner_id === userId || client.follow_up_owner_id === userId;
}

function isScopedMember(userId: string | null, visibleUserIds: string[]) {
  return !userId || visibleUserIds.includes(userId);
}

async function getSettings(organizationId: string, userId: string, admin: ReturnType<typeof createAdminClient>): Promise<SettingsRow> {
  const {data, error} = await admin
    .from("crm_settings")
    .select("organization_id, default_feedback_channel, feedback_cooldown_days, feedback_expiry_days, low_score_threshold, auto_send_email, auto_send_sms, auto_send_whatsapp, auto_request_feedback, auto_request_delay_minutes, auto_request_outcomes, reminders_enabled, first_reminder_hours, reminder_interval_hours, max_reminders, fallback_channel, feedback_message_fr, feedback_message_en")
    .eq("organization_id", organizationId)
    .maybeSingle<SettingsRow>();

  if (error) throw new Error(error.message);
  if (data) return data;

  const defaults: SettingsRow = {
    organization_id: organizationId,
    default_feedback_channel: "email",
    feedback_cooldown_days: 7,
    feedback_expiry_days: 14,
    low_score_threshold: 2,
    auto_send_email: false,
    auto_send_sms: false,
    auto_send_whatsapp: false,
    auto_request_feedback: false,
    auto_request_delay_minutes: 0,
    auto_request_outcomes: ["resolved", "follow_up", "payment_promise", "escalated", "other"],
    reminders_enabled: true,
    first_reminder_hours: 24,
    reminder_interval_hours: 48,
    max_reminders: 2,
    fallback_channel: "web",
    feedback_message_fr: "Merci pour votre échange avec notre équipe. Votre avis nous aide à mieux vous servir.",
    feedback_message_en: "Thank you for speaking with our team. Your feedback helps us serve you better.",
  };

  const {data: inserted, error: insertError} = await admin
    .from("crm_settings")
    .insert({...defaults, created_by: userId, updated_by: userId})
    .select("organization_id, default_feedback_channel, feedback_cooldown_days, feedback_expiry_days, low_score_threshold, auto_send_email, auto_send_sms, auto_send_whatsapp, auto_request_feedback, auto_request_delay_minutes, auto_request_outcomes, reminders_enabled, first_reminder_hours, reminder_interval_hours, max_reminders, fallback_channel, feedback_message_fr, feedback_message_en")
    .single<SettingsRow>();

  if (insertError || !inserted) throw new Error(insertError?.message ?? "Unable to create CRM settings.");
  return inserted;
}

function isAutoChannelEnabled(settings: SettingsRow, channel: string) {
  if (channel === "email") return settings.auto_send_email;
  if (channel === "sms") return settings.auto_send_sms;
  if (channel === "whatsapp") return settings.auto_send_whatsapp;
  return false;
}

function getNextReminderAt(settings: SettingsRow, reminderCount = 0) {
  if (!settings.reminders_enabled || settings.max_reminders <= reminderCount) return null;
  const hours = reminderCount === 0 ? settings.first_reminder_hours : settings.reminder_interval_hours;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function getOrganizationName(organizationId: string, admin: ReturnType<typeof createAdminClient>) {
  const {data} = await admin.from("organizations").select("name").eq("id", organizationId).maybeSingle<{name: string}>();
  return data?.name?.trim() || "Super Leader";
}

async function getMemberName(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const {data} = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle<MemberProfile>();
  return data?.full_name?.trim() || data?.email || "Super Leader";
}

async function audit(params: {
  organizationId: string;
  actorId: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  details?: Record<string, unknown>;
  admin: ReturnType<typeof createAdminClient>;
}) {
  await params.admin.from("crm_audit_log").insert({
    organization_id: params.organizationId,
    actor_id: params.actorId,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    action: params.action,
    details: params.details ?? {},
  });
}

async function createFeedbackRequestForClient(params: {
  client: ClientRow;
  employeeId: string;
  contractId?: string | null;
  interactionId?: string | null;
  requestedChannel?: string | null;
  organizationId: string;
  createdBy: string;
  force?: boolean;
  automated?: boolean;
  admin: ReturnType<typeof createAdminClient>;
  t: (key: string, values?: Record<string, string | number>) => string;
}): Promise<FeedbackRequestResult> {
  const {client, admin, t} = params;
  if (!client.feedback_opt_in || client.do_not_contact) {
    return {created: false, message: t("crm.messages.feedbackConsentMissing")};
  }

  const settings = await getSettings(params.organizationId, params.createdBy, admin);
  let channel = feedbackChannels.has(params.requestedChannel ?? "")
    ? String(params.requestedChannel)
    : feedbackChannels.has(client.preferred_feedback_channel)
      ? client.preferred_feedback_channel
      : settings.default_feedback_channel;

  let recipient = channel === "email"
    ? client.email
    : channel === "whatsapp"
      ? client.whatsapp_phone || client.phone
      : channel === "sms"
        ? client.phone
        : null;

  const providerConfiguration = getFeedbackProviderConfiguration();
  const configured = channel === "email"
    ? providerConfiguration.email
    : channel === "sms"
      ? providerConfiguration.sms
      : channel === "whatsapp"
        ? providerConfiguration.whatsapp
        : true;
  if (channel !== "web" && isAutoChannelEnabled(settings, channel) && !configured) {
    if (settings.fallback_channel === "email" && settings.auto_send_email && providerConfiguration.email && client.email) {
      channel = "email";
      recipient = client.email;
    } else if (settings.fallback_channel === "web") {
      channel = "web";
      recipient = null;
    }
  }

  if (channel !== "web" && !recipient) {
    return {created: false, message: t("crm.messages.feedbackRecipientMissing")};
  }

  if (!params.force && settings.feedback_cooldown_days > 0) {
    const since = new Date(Date.now() - settings.feedback_cooldown_days * 86400000).toISOString();
    const {data: recent} = await admin
      .from("crm_feedback_requests")
      .select("id")
      .eq("organization_id", params.organizationId)
      .eq("client_id", client.id)
      .gte("created_at", since)
      .not("status", "in", "(cancelled,expired,failed)")
      .limit(1);
    if ((recent ?? []).length) {
      return {
        created: false,
        message: t("crm.messages.feedbackCooldown", {days: settings.feedback_cooldown_days}),
      };
    }
  }

  const locale = client.preferred_language === "en" ? "en" : "fr";
  const message = locale === "en" ? settings.feedback_message_en : settings.feedback_message_fr;
  const expiresAt = new Date(Date.now() + settings.feedback_expiry_days * 86400000).toISOString();
  const scheduledSendAt = new Date(Date.now() + settings.auto_request_delay_minutes * 60 * 1000).toISOString();
  const shouldAutoSend = isAutoChannelEnabled(settings, channel);

  const {data: request, error} = await admin
    .from("crm_feedback_requests")
    .insert({
      organization_id: params.organizationId,
      client_id: client.id,
      contract_id: params.contractId ?? null,
      interaction_id: params.interactionId ?? null,
      employee_id: params.employeeId,
      channel,
      locale,
      recipient,
      message,
      status: shouldAutoSend && settings.auto_request_delay_minutes > 0 ? "pending" : "ready",
      expires_at: expiresAt,
      automated: params.automated ?? false,
      scheduled_send_at: shouldAutoSend ? scheduledSendAt : null,
      idempotency_key: params.interactionId ? `interaction:${params.interactionId}` : null,
      created_by: params.createdBy,
    })
    .select("id, public_token")
    .single<{id: string; public_token: string}>();

  if (error || !request) {
    return {
      created: false,
      message: t("crm.messages.feedbackCreateFailed", {message: error?.message ?? t("common.unknownError")}),
    };
  }

  const organizationName = await getOrganizationName(params.organizationId, admin);
  const employeeName = await getMemberName(params.employeeId, admin);
  let sent = false;

  if (shouldAutoSend && settings.auto_request_delay_minutes === 0 && recipient) {
    const delivery = await sendFeedbackByChannel({
      channel: channel as "email" | "whatsapp" | "sms" | "web",
      recipient,
      clientName: client.full_name,
      organizationName,
      employeeName,
      token: request.public_token,
      locale,
      message,
    });

    if (delivery.sent) {
      sent = true;
      await admin
        .from("crm_feedback_requests")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          delivery_provider: delivery.provider,
          provider_message_id: delivery.providerMessageId ?? null,
          delivery_error: null,
          delivery_attempts: 1,
          last_delivery_at: new Date().toISOString(),
          last_provider_status: delivery.providerStatus ?? "sent",
          next_reminder_at: getNextReminderAt(settings),
          scheduled_send_at: null,
          provider_metadata: delivery.providerMetadata ?? {},
        })
        .eq("id", request.id);
      await recordOutboundFeedbackDelivery({
        organizationId: params.organizationId,
        requestId: request.id,
        provider: delivery.provider,
        providerMessageId: delivery.providerMessageId,
        deliveryKind: "initial",
        status: delivery.providerStatus,
        metadata: delivery.providerMetadata,
      });
    } else {
      await admin
        .from("crm_feedback_requests")
        .update({
          status: delivery.configurationMissing ? "ready" : "failed",
          delivery_provider: delivery.provider,
          delivery_error: delivery.error ?? null,
          delivery_attempts: 1,
          last_delivery_at: new Date().toISOString(),
          last_provider_status: delivery.providerStatus ?? "failed",
          provider_metadata: delivery.providerMetadata ?? {},
        })
        .eq("id", request.id);
    }
  }

  await audit({
    organizationId: params.organizationId,
    actorId: params.createdBy,
    entityType: "feedback_request",
    entityId: request.id,
    action: sent ? "feedback_request_sent" : "feedback_request_created",
    details: {clientId: client.id, channel, interactionId: params.interactionId ?? null},
    admin,
  });

  return {
    created: true,
    token: request.public_token,
    url: getFeedbackUrl(request.public_token),
    sent,
    message: sent ? t("crm.messages.feedbackSent") : t("crm.messages.feedbackReady"),
  };
}

export async function createCrmClientAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  const fullName = requiredText(formData.get("fullName"), 200);
  const email = normalizeEmail(formData.get("email"));
  const phone = normalizePhone(formData.get("phone"));
  const whatsappPhone = normalizePhone(formData.get("whatsappPhone"));
  const preferredLanguage = String(formData.get("preferredLanguage") ?? "fr") === "en" ? "en" : "fr";
  const preferredFeedbackChannel = String(formData.get("preferredFeedbackChannel") ?? "email");
  const requestedOwnerId = String(formData.get("ownerId") ?? "").trim() || null;
  const requestedFollowUpOwnerId = String(formData.get("followUpOwnerId") ?? "").trim() || null;
  const ownerId = membership.role === "manager"
    ? requestedOwnerId || user.id
    : leaderRoles.has(membership.role)
      ? requestedOwnerId
      : user.id;
  const followUpOwnerId = membership.role === "manager"
    ? requestedFollowUpOwnerId || user.id
    : leaderRoles.has(membership.role)
      ? requestedFollowUpOwnerId
      : user.id;
  const status = String(formData.get("status") ?? "active");

  if (fullName.length < 2) go(returnTo, t("crm.messages.clientNameRequired"), "error");
  if (email && !emailPattern.test(email)) go(returnTo, t("crm.messages.invalidEmail"), "error");
  if (!feedbackChannels.has(preferredFeedbackChannel)) go(returnTo, t("crm.messages.invalidFeedbackChannel"), "error");
  if (!clientStatuses.has(status)) go(returnTo, t("crm.messages.invalidClientStatus"), "error");
  if (!(await ensureActiveMember(membership.organization_id, ownerId, admin)) || !(await ensureActiveMember(membership.organization_id, followUpOwnerId, admin))) {
    go(returnTo, t("crm.messages.memberNotActive"), "error");
  }
  if (!isScopedMember(ownerId, visibleUserIds) || !isScopedMember(followUpOwnerId, visibleUserIds)) {
    go(returnTo, t("crm.messages.employeePermissionDenied"), "error");
  }

  if (email || phone) {
    let duplicateQuery = admin.from("crm_clients").select("id").eq("organization_id", membership.organization_id);
    duplicateQuery = email ? duplicateQuery.eq("email", email) : duplicateQuery.eq("phone", phone);
    const {data: duplicate} = await duplicateQuery.limit(1);
    if ((duplicate ?? []).length) go(returnTo, t("crm.messages.clientAlreadyExists"), "error");
  }

  const feedbackOptIn = formData.get("feedbackOptIn") === "on";
  const marketingOptIn = formData.get("marketingOptIn") === "on";
  const {data: client, error} = await admin
    .from("crm_clients")
    .insert({
      organization_id: membership.organization_id,
      reference: makeReference("CL"),
      full_name: fullName,
      email,
      phone,
      whatsapp_phone: whatsappPhone,
      country: cleanText(formData.get("country"), 120),
      city: cleanText(formData.get("city"), 120),
      company_name: cleanText(formData.get("companyName"), 200),
      preferred_language: preferredLanguage,
      preferred_feedback_channel: preferredFeedbackChannel,
      feedback_opt_in: feedbackOptIn,
      marketing_opt_in: marketingOptIn,
      do_not_contact: false,
      consent_recorded_at: feedbackOptIn || marketingOptIn ? new Date().toISOString() : null,
      owner_id: ownerId,
      follow_up_owner_id: followUpOwnerId,
      source: "manual",
      status,
      notes: cleanText(formData.get("notes"), 5000),
      created_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !client) go(returnTo, t("crm.messages.clientCreateFailed", {message: error?.message ?? t("common.unknownError")}), "error");

  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "client", entityId: client.id, action: "client_created", admin});
  revalidatePath("/dashboard/crm");
  go(`/dashboard/crm/${client.id}`, t("crm.messages.clientCreated"));
}

export async function updateCrmClientAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  const clientId = String(formData.get("clientId") ?? "").trim();
  const {data: client} = await getClient(clientId, membership.organization_id, admin);
  if (!client) go(returnTo, t("crm.messages.clientNotFound"), "error");
  if (!canAccessClient(membership.role, user.id, client, visibleUserIds)) go(returnTo, t("crm.messages.clientPermissionDenied"), "error");

  const email = normalizeEmail(formData.get("email"));
  const preferredFeedbackChannel = String(formData.get("preferredFeedbackChannel") ?? client.preferred_feedback_channel);
  const status = String(formData.get("status") ?? "active");
  const requestedOwnerId = String(formData.get("ownerId") ?? "").trim() || null;
  const requestedFollowUpOwnerId = String(formData.get("followUpOwnerId") ?? "").trim() || null;
  const ownerId = membership.role === "employee"
    ? user.id
    : membership.role === "manager"
      ? requestedOwnerId || client.owner_id || user.id
      : leaderRoles.has(membership.role)
        ? requestedOwnerId
        : client.owner_id || user.id;
  const followUpOwnerId = membership.role === "employee"
    ? user.id
    : membership.role === "manager"
      ? requestedFollowUpOwnerId || client.follow_up_owner_id || user.id
      : leaderRoles.has(membership.role)
        ? requestedFollowUpOwnerId
        : client.follow_up_owner_id || user.id;
  if (email && !emailPattern.test(email)) go(returnTo, t("crm.messages.invalidEmail"), "error");
  if (!feedbackChannels.has(preferredFeedbackChannel) || !clientStatuses.has(status)) go(returnTo, t("crm.messages.invalidClientData"), "error");
  if (!(await ensureActiveMember(membership.organization_id, ownerId, admin)) || !(await ensureActiveMember(membership.organization_id, followUpOwnerId, admin))) {
    go(returnTo, t("crm.messages.memberNotActive"), "error");
  }
  if (!isScopedMember(ownerId, visibleUserIds) || !isScopedMember(followUpOwnerId, visibleUserIds)) {
    go(returnTo, t("crm.messages.employeePermissionDenied"), "error");
  }

  const feedbackOptIn = formData.get("feedbackOptIn") === "on";
  const marketingOptIn = formData.get("marketingOptIn") === "on";
  const doNotContact = formData.get("doNotContact") === "on";
  const {error} = await admin
    .from("crm_clients")
    .update({
      full_name: requiredText(formData.get("fullName"), 200) || client.full_name,
      email,
      phone: normalizePhone(formData.get("phone")),
      whatsapp_phone: normalizePhone(formData.get("whatsappPhone")),
      country: cleanText(formData.get("country"), 120),
      city: cleanText(formData.get("city"), 120),
      company_name: cleanText(formData.get("companyName"), 200),
      preferred_language: String(formData.get("preferredLanguage") ?? "fr") === "en" ? "en" : "fr",
      preferred_feedback_channel: preferredFeedbackChannel,
      feedback_opt_in: feedbackOptIn,
      marketing_opt_in: marketingOptIn,
      do_not_contact: doNotContact,
      consent_recorded_at: feedbackOptIn || marketingOptIn ? new Date().toISOString() : client.feedback_opt_in ? new Date().toISOString() : null,
      owner_id: ownerId,
      follow_up_owner_id: followUpOwnerId,
      status,
      notes: cleanText(formData.get("notes"), 5000),
    })
    .eq("id", clientId)
    .eq("organization_id", membership.organization_id);

  if (error) go(returnTo, t("crm.messages.clientUpdateFailed", {message: error.message}), "error");
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "client", entityId: clientId, action: "client_updated", admin});
  revalidatePath("/dashboard/crm");
  revalidatePath(`/dashboard/crm/${clientId}`);
  go(returnTo, t("crm.messages.clientUpdated"));
}

export async function importApprovedSalesToCrmAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  if (!leaderRoles.has(membership.role)) go(returnTo, t("crm.messages.importPermissionDenied"), "error");

  let salesQuery = admin
    .from("sales_records")
    .select("id, seller_id, product_name, customer_name, customer_email, customer_phone, total_amount, currency, workflow_status, payment_status, collection_owner_id, collection_status, sale_date, crm_client_id, crm_contract_id")
    .eq("organization_id", membership.organization_id)
    .eq("workflow_status", "approved");

  if (membership.role === "manager") {
    salesQuery = salesQuery.or(`seller_id.in.(${visibleUserIds.join(",")}),collection_owner_id.in.(${visibleUserIds.join(",")})`);
  }

  const {data: sales, error: salesError} = await salesQuery.order("sale_date", {ascending: true});

  if (salesError) go(returnTo, t("crm.messages.importFailed", {message: salesError.message}), "error");

  let clientsCreated = 0;
  let contractsCreated = 0;

  for (const sale of sales ?? []) {
    let clientId = sale.crm_client_id as string | null;
    if (!clientId) {
      const email = String(sale.customer_email ?? "").trim().toLowerCase() || null;
      const phone = String(sale.customer_phone ?? "").trim() || null;
      let existing: {id: string} | null = null;

      if (email) {
        const {data} = await admin.from("crm_clients").select("id").eq("organization_id", membership.organization_id).eq("email", email).limit(1).maybeSingle<{id: string}>();
        existing = data;
      } else if (phone) {
        const {data} = await admin.from("crm_clients").select("id").eq("organization_id", membership.organization_id).eq("phone", phone).limit(1).maybeSingle<{id: string}>();
        existing = data;
      }

      if (existing) {
        clientId = existing.id;
      } else {
        const {data: created, error} = await admin
          .from("crm_clients")
          .insert({
            organization_id: membership.organization_id,
            reference: makeReference("CL"),
            full_name: sale.customer_name,
            email,
            phone,
            preferred_language: "fr",
            preferred_feedback_channel: email ? "email" : phone ? "whatsapp" : "web",
            feedback_opt_in: false,
            consent_recorded_at: null,
            owner_id: sale.seller_id,
            follow_up_owner_id: sale.collection_owner_id,
            source: "sale_import",
            status: "active",
            created_by: user.id,
          })
          .select("id")
          .single<{id: string}>();
        if (error || !created) continue;
        clientId = created.id;
        clientsCreated += 1;
      }
    }

    if (!clientId) continue;
    let contractId = sale.crm_contract_id as string | null;
    if (!contractId) {
      const contractStatus = sale.payment_status === "paid" ? "paid" : "payment_in_progress";
      const {data: contract, error} = await admin
        .from("crm_contracts")
        .upsert({
          organization_id: membership.organization_id,
          client_id: clientId,
          sale_id: sale.id,
          contract_number: `SALE-${new Date(sale.sale_date).getUTCFullYear()}-${String(sale.id).replaceAll("-", "").slice(0, 8).toUpperCase()}`,
          title: sale.product_name,
          product_name: sale.product_name,
          total_amount: sale.total_amount,
          currency: sale.currency,
          status: contractStatus,
          start_date: sale.sale_date,
          seller_id: sale.seller_id,
          collection_owner_id: sale.collection_owner_id,
          created_by: user.id,
        }, {onConflict: "sale_id"})
        .select("id")
        .single<{id: string}>();
      if (!error && contract) {
        contractId = contract.id;
        contractsCreated += 1;
      }
    }

    await admin
      .from("sales_records")
      .update({crm_client_id: clientId, crm_contract_id: contractId})
      .eq("id", sale.id)
      .eq("organization_id", membership.organization_id);
  }

  await audit({
    organizationId: membership.organization_id,
    actorId: user.id,
    entityType: "crm_import",
    action: "approved_sales_imported",
    details: {clientsCreated, contractsCreated},
    admin,
  });
  revalidatePath("/dashboard/crm");
  go(returnTo, t("crm.messages.importCompleted", {clients: clientsCreated, contracts: contractsCreated}));
}

export async function createCrmContractAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  const clientId = String(formData.get("clientId") ?? "").trim();
  const {data: client} = await getClient(clientId, membership.organization_id, admin);
  if (!client) go(returnTo, t("crm.messages.clientNotFound"), "error");
  if (!canAccessClient(membership.role, user.id, client, visibleUserIds)) go(returnTo, t("crm.messages.clientPermissionDenied"), "error");

  const title = requiredText(formData.get("title"), 220);
  const amount = parseMoney(formData.get("totalAmount"));
  const currency = String(formData.get("currency") ?? "USD").trim().toUpperCase();
  const status = String(formData.get("status") ?? "preparation");
  const requestedSellerId = String(formData.get("sellerId") ?? "").trim() || null;
  const requestedCollectionOwnerId = String(formData.get("collectionOwnerId") ?? "").trim() || null;
  const sellerId = membership.role === "employee" ? user.id : requestedSellerId;
  const collectionOwnerId = membership.role === "employee" ? user.id : requestedCollectionOwnerId;
  const signedAt = normalizeDate(formData.get("signedAt"));
  const startDate = normalizeDate(formData.get("startDate"));
  const expectedEndDate = normalizeDate(formData.get("expectedEndDate"));

  if (title.length < 2 || !Number.isFinite(amount) || amount < 0 || !currencies.has(currency) || !contractStatuses.has(status)) {
    go(returnTo, t("crm.messages.invalidContractData"), "error");
  }
  if (signedAt === "" || startDate === "" || expectedEndDate === "") go(returnTo, t("crm.messages.invalidDate"), "error");
  if (!(await ensureActiveMember(membership.organization_id, sellerId, admin)) || !(await ensureActiveMember(membership.organization_id, collectionOwnerId, admin))) {
    go(returnTo, t("crm.messages.memberNotActive"), "error");
  }
  if (!isScopedMember(sellerId, visibleUserIds) || !isScopedMember(collectionOwnerId, visibleUserIds)) {
    go(returnTo, t("crm.messages.employeePermissionDenied"), "error");
  }

  const {data: contract, error} = await admin
    .from("crm_contracts")
    .insert({
      organization_id: membership.organization_id,
      client_id: clientId,
      contract_number: makeReference("CTR"),
      title,
      product_name: cleanText(formData.get("productName"), 220),
      total_amount: amount,
      currency,
      status,
      signed_at: signedAt,
      start_date: startDate,
      expected_end_date: expectedEndDate,
      seller_id: sellerId,
      collection_owner_id: collectionOwnerId,
      document_url: cleanText(formData.get("documentUrl"), 1000),
      notes: cleanText(formData.get("notes"), 5000),
      created_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !contract) go(returnTo, t("crm.messages.contractCreateFailed", {message: error?.message ?? t("common.unknownError")}), "error");
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "contract", entityId: contract.id, action: "contract_created", details: {clientId}, admin});
  revalidatePath("/dashboard/crm");
  revalidatePath(`/dashboard/crm/${clientId}`);
  go(returnTo, t("crm.messages.contractCreated"));
}

export async function createCrmInteractionAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  const clientId = String(formData.get("clientId") ?? "").trim();
  const contractId = String(formData.get("contractId") ?? "").trim() || null;
  const employeeId = String(formData.get("employeeId") ?? user.id).trim() || user.id;
  const channel = String(formData.get("channel") ?? "phone");
  const direction = String(formData.get("direction") ?? "outbound") === "inbound" ? "inbound" : "outbound";
  const interactionType = String(formData.get("interactionType") ?? "support");
  const outcome = String(formData.get("outcome") ?? "resolved");
  const summary = requiredText(formData.get("summary"), 5000);
  const occurredAtInput = normalizeDateTime(formData.get("occurredAt"));
  const occurredAt = occurredAtInput === null ? new Date().toISOString() : occurredAtInput;
  const nextFollowUpAt = normalizeDateTime(formData.get("nextFollowUpAt"));
  const durationMinutes = parseInteger(formData.get("durationMinutes"));
  const manualRequestFeedback = formData.get("requestFeedback") === "on";
  const feedbackChannel = String(formData.get("feedbackChannel") ?? "").trim() || null;

  const {data: client} = await getClient(clientId, membership.organization_id, admin);
  if (!client) go(returnTo, t("crm.messages.clientNotFound"), "error");
  if (!canAccessClient(membership.role, user.id, client, visibleUserIds)) go(returnTo, t("crm.messages.clientPermissionDenied"), "error");
  if (!(await ensureActiveMember(membership.organization_id, employeeId, admin))) go(returnTo, t("crm.messages.memberNotActive"), "error");
  if (!visibleUserIds.includes(employeeId)) go(returnTo, t("crm.messages.employeePermissionDenied"), "error");
  if (!interactionChannels.has(channel) || !interactionTypes.has(interactionType) || !interactionOutcomes.has(outcome) || !summary) {
    go(returnTo, t("crm.messages.invalidInteractionData"), "error");
  }
  if (occurredAt === "" || nextFollowUpAt === "" || (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440))) {
    go(returnTo, t("crm.messages.invalidInteractionData"), "error");
  }

  const interactionSettings = await getSettings(membership.organization_id, user.id, admin);
  const autoRequestFeedback = interactionSettings.auto_request_feedback
    && interactionSettings.auto_request_outcomes.includes(outcome)
    && outcome !== "no_answer";
  const requestFeedback = manualRequestFeedback || autoRequestFeedback;

  if (contractId) {
    const {data: contract} = await admin.from("crm_contracts").select("id").eq("id", contractId).eq("client_id", clientId).eq("organization_id", membership.organization_id).maybeSingle();
    if (!contract) go(returnTo, t("crm.messages.contractNotFound"), "error");
  }

  const {data: interaction, error} = await admin
    .from("crm_interactions")
    .insert({
      organization_id: membership.organization_id,
      client_id: clientId,
      contract_id: contractId,
      employee_id: employeeId,
      channel,
      direction,
      interaction_type: interactionType,
      outcome,
      summary,
      occurred_at: occurredAt,
      duration_minutes: durationMinutes,
      next_follow_up_at: nextFollowUpAt,
      feedback_requested: requestFeedback,
      created_by: user.id,
    })
    .select("id")
    .single<{id: string}>();

  if (error || !interaction) go(returnTo, t("crm.messages.interactionCreateFailed", {message: error?.message ?? t("common.unknownError")}), "error");

  if (nextFollowUpAt) {
    await admin.from("crm_follow_up_tasks").insert({
      organization_id: membership.organization_id,
      client_id: clientId,
      contract_id: contractId,
      interaction_id: interaction.id,
      assigned_to: client.follow_up_owner_id || employeeId,
      title: t("crm.autoFollowUpTask", {client: client.full_name}),
      description: summary,
      due_at: nextFollowUpAt,
      priority: outcome === "escalated" || interactionType === "complaint" ? "urgent" : "normal",
      status: "todo",
      created_by: user.id,
    });
  }

  let resultMessage = t("crm.messages.interactionCreated");
  if (requestFeedback) {
    const feedbackResult = await createFeedbackRequestForClient({
      client,
      employeeId,
      contractId,
      interactionId: interaction.id,
      requestedChannel: feedbackChannel,
      organizationId: membership.organization_id,
      createdBy: user.id,
      automated: autoRequestFeedback && !manualRequestFeedback,
      admin,
      t,
    });
    resultMessage = `${resultMessage} ${feedbackResult.message}`;
  }

  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "interaction", entityId: interaction.id, action: "interaction_created", details: {clientId, requestFeedback}, admin});
  revalidatePath("/dashboard/crm");
  revalidatePath(`/dashboard/crm/${clientId}`);
  go(returnTo, resultMessage);
}

export async function createCrmTaskAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  const clientId = String(formData.get("clientId") ?? "").trim();
  const {data: client} = await getClient(clientId, membership.organization_id, admin);
  if (!client) go(returnTo, t("crm.messages.clientNotFound"), "error");
  if (!canAccessClient(membership.role, user.id, client, visibleUserIds)) go(returnTo, t("crm.messages.clientPermissionDenied"), "error");

  const title = requiredText(formData.get("title"), 240);
  const assignedTo = String(formData.get("assignedTo") ?? "").trim() || null;
  const priority = String(formData.get("priority") ?? "normal");
  const dueAt = normalizeDateTime(formData.get("dueAt"));
  if (!title || !taskPriorities.has(priority) || dueAt === "") go(returnTo, t("crm.messages.invalidTaskData"), "error");
  if (!(await ensureActiveMember(membership.organization_id, assignedTo, admin))) go(returnTo, t("crm.messages.memberNotActive"), "error");
  if (!isScopedMember(assignedTo, visibleUserIds)) go(returnTo, t("crm.messages.employeePermissionDenied"), "error");

  const {data: task, error} = await admin
    .from("crm_follow_up_tasks")
    .insert({
      organization_id: membership.organization_id,
      client_id: clientId,
      contract_id: String(formData.get("contractId") ?? "").trim() || null,
      assigned_to: assignedTo,
      title,
      description: cleanText(formData.get("description"), 5000),
      due_at: dueAt,
      priority,
      status: "todo",
      created_by: user.id,
    })
    .select("id")
    .single<{id: string}>();
  if (error || !task) go(returnTo, t("crm.messages.taskCreateFailed", {message: error?.message ?? t("common.unknownError")}), "error");

  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "task", entityId: task.id, action: "task_created", details: {clientId}, admin});
  revalidatePath("/dashboard/crm");
  revalidatePath(`/dashboard/crm/${clientId}`);
  go(returnTo, t("crm.messages.taskCreated"));
}

export async function updateCrmTaskStatusAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  const taskId = String(formData.get("taskId") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  if (!taskStatuses.has(status)) go(returnTo, t("crm.messages.invalidTaskStatus"), "error");

  const {data: task} = await admin
    .from("crm_follow_up_tasks")
    .select("id, client_id, assigned_to, created_by")
    .eq("id", taskId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{id: string; client_id: string; assigned_to: string | null; created_by: string}>();
  if (!task) go(returnTo, t("crm.messages.taskNotFound"), "error");
  const {data: taskClient} = await getClient(task.client_id, membership.organization_id, admin);
  const taskWithinScope = membership.role === "owner" || membership.role === "admin"
    || (membership.role === "manager"
      && ((task.assigned_to && visibleUserIds.includes(task.assigned_to))
        || visibleUserIds.includes(task.created_by)))
    || (membership.role === "employee" && task.assigned_to === user.id);
  const canUpdateTask = Boolean(
    taskClient
    && canAccessClient(membership.role, user.id, taskClient, visibleUserIds)
    && taskWithinScope,
  );
  if (!canUpdateTask) go(returnTo, t("crm.messages.taskPermissionDenied"), "error");

  const {error} = await admin
    .from("crm_follow_up_tasks")
    .update({status, completed_at: status === "completed" ? new Date().toISOString() : null})
    .eq("id", taskId)
    .eq("organization_id", membership.organization_id);
  if (error) go(returnTo, t("crm.messages.taskUpdateFailed", {message: error.message}), "error");

  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "task", entityId: taskId, action: "task_status_updated", details: {status}, admin});
  revalidatePath("/dashboard/crm");
  revalidatePath(`/dashboard/crm/${task.client_id}`);
  go(returnTo, t("crm.messages.taskUpdated"));
}

export async function createCustomerFeedbackRequestAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  const clientId = String(formData.get("clientId") ?? "").trim();
  const employeeId = String(formData.get("employeeId") ?? user.id).trim() || user.id;
  const {data: client} = await getClient(clientId, membership.organization_id, admin);
  if (!client) go(returnTo, t("crm.messages.clientNotFound"), "error");
  if (!canAccessClient(membership.role, user.id, client, visibleUserIds)) go(returnTo, t("crm.messages.clientPermissionDenied"), "error");
  if (!(await ensureActiveMember(membership.organization_id, employeeId, admin))) go(returnTo, t("crm.messages.memberNotActive"), "error");
  if (!visibleUserIds.includes(employeeId)) go(returnTo, t("crm.messages.employeePermissionDenied"), "error");

  const result = await createFeedbackRequestForClient({
    client,
    employeeId,
    contractId: String(formData.get("contractId") ?? "").trim() || null,
    requestedChannel: String(formData.get("feedbackChannel") ?? "").trim() || null,
    organizationId: membership.organization_id,
    createdBy: user.id,
    force: formData.get("force") === "on" && leaderRoles.has(membership.role),
    admin,
    t,
  });
  revalidatePath("/dashboard/crm");
  revalidatePath(`/dashboard/crm/${clientId}`);
  go(returnTo, result.message, result.created ? "success" : "error");
}

export async function sendCustomerFeedbackRequestAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  const requestId = String(formData.get("requestId") ?? "").trim();
  const {data: request} = await admin
    .from("crm_feedback_requests")
    .select("id, client_id, employee_id, public_token, channel, locale, recipient, message, status")
    .eq("id", requestId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle<{
      id: string;
      client_id: string;
      employee_id: string;
      public_token: string;
      channel: string;
      locale: "fr" | "en";
      recipient: string | null;
      message: string;
      status: string;
    }>();
  if (!request) go(returnTo, t("crm.messages.feedbackRequestNotFound"), "error");
  if (["completed", "cancelled", "expired"].includes(request.status)) go(returnTo, t("crm.messages.feedbackCannotSend"), "error");

  const {data: client} = await getClient(request.client_id, membership.organization_id, admin);
  if (!client || !canAccessClient(membership.role, user.id, client, visibleUserIds)) go(returnTo, t("crm.messages.clientPermissionDenied"), "error");
  if (!visibleUserIds.includes(request.employee_id)) go(returnTo, t("crm.messages.employeePermissionDenied"), "error");

  if (request.channel !== "web" && request.recipient) {
    const delivery = await sendFeedbackByChannel({
      channel: request.channel as "email" | "whatsapp" | "sms" | "web",
      recipient: request.recipient,
      clientName: client.full_name,
      organizationName: await getOrganizationName(membership.organization_id, admin),
      employeeName: await getMemberName(request.employee_id, admin),
      token: request.public_token,
      locale: request.locale,
      message: request.message,
    });
    if (!delivery.sent) {
      await admin.from("crm_feedback_requests").update({
        status: delivery.configurationMissing ? "ready" : "failed",
        delivery_provider: delivery.provider,
        delivery_error: delivery.error ?? null,
        delivery_attempts: 1,
        last_delivery_at: new Date().toISOString(),
        last_provider_status: delivery.providerStatus ?? "failed",
        provider_metadata: delivery.providerMetadata ?? {},
      }).eq("id", request.id);
      go(returnTo, delivery.configurationMissing ? t("crm.messages.providerNotConfigured") : t("crm.messages.feedbackSendFailed", {message: delivery.error ?? t("common.unknownError")}), "error");
    }
    const settings = await getSettings(membership.organization_id, user.id, admin);
    await admin.from("crm_feedback_requests").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      delivery_provider: delivery.provider,
      provider_message_id: delivery.providerMessageId ?? null,
      delivery_error: null,
      delivery_attempts: 1,
      last_delivery_at: new Date().toISOString(),
      last_provider_status: delivery.providerStatus ?? "sent",
      next_reminder_at: getNextReminderAt(settings),
      scheduled_send_at: null,
      provider_metadata: delivery.providerMetadata ?? {},
    }).eq("id", request.id);
    await recordOutboundFeedbackDelivery({
      organizationId: membership.organization_id,
      requestId: request.id,
      provider: delivery.provider,
      providerMessageId: delivery.providerMessageId,
      deliveryKind: "initial",
      status: delivery.providerStatus,
      metadata: delivery.providerMetadata,
    });
  } else {
    await admin.from("crm_feedback_requests").update({status: "sent", sent_at: new Date().toISOString(), delivery_provider: "manual", delivery_error: null, last_delivery_at: new Date().toISOString(), last_provider_status: "manual"}).eq("id", request.id);
  }

  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "feedback_request", entityId: request.id, action: "feedback_request_sent", details: {channel: request.channel}, admin});
  revalidatePath("/dashboard/crm");
  revalidatePath(`/dashboard/crm/${request.client_id}`);
  go(returnTo, t("crm.messages.feedbackSent"));
}

export async function updateCrmSettingsAction(formData: FormData) {
  const {user, membership, admin, t} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  if (!adminRoles.has(membership.role)) go(returnTo, t("crm.messages.settingsPermissionDenied"), "error");

  const defaultFeedbackChannel = String(formData.get("defaultFeedbackChannel") ?? "email");
  const cooldownDays = parseInteger(formData.get("feedbackCooldownDays"));
  const expiryDays = parseInteger(formData.get("feedbackExpiryDays"));
  const threshold = parseInteger(formData.get("lowScoreThreshold"));
  if (!feedbackChannels.has(defaultFeedbackChannel) || cooldownDays === null || expiryDays === null || threshold === null || !Number.isInteger(cooldownDays) || !Number.isInteger(expiryDays) || !Number.isInteger(threshold) || cooldownDays < 0 || cooldownDays > 365 || expiryDays < 1 || expiryDays > 90 || threshold < 1 || threshold > 5) {
    go(returnTo, t("crm.messages.invalidSettings"), "error");
  }

  const {error} = await admin.from("crm_settings").upsert({
    organization_id: membership.organization_id,
    default_feedback_channel: defaultFeedbackChannel,
    feedback_cooldown_days: cooldownDays,
    feedback_expiry_days: expiryDays,
    low_score_threshold: threshold,
    auto_send_email: formData.get("autoSendEmail") === "on",
    feedback_message_fr: requiredText(formData.get("feedbackMessageFr"), 2000),
    feedback_message_en: requiredText(formData.get("feedbackMessageEn"), 2000),
    created_by: user.id,
    updated_by: user.id,
  }, {onConflict: "organization_id"});

  if (error) go(returnTo, t("crm.messages.settingsUpdateFailed", {message: error.message}), "error");
  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "crm_settings", action: "crm_settings_updated", admin});
  revalidatePath("/dashboard/crm");
  go(returnTo, t("crm.messages.settingsUpdated"));
}

export async function resolveCustomerFeedbackAction(formData: FormData) {
  const {user, membership, admin, t, visibleUserIds} = await getContext();
  const returnTo = normalizeReturnTo(formData);
  if (!leaderRoles.has(membership.role)) go(returnTo, t("crm.messages.feedbackResolutionPermissionDenied"), "error");

  const responseId = String(formData.get("responseId") ?? "").trim();
  const status = String(formData.get("resolutionStatus") ?? "");
  const assignedTo = String(formData.get("assignedTo") ?? "").trim() || null;
  if (!["open", "in_progress", "resolved", "not_required"].includes(status)) go(returnTo, t("crm.messages.invalidResolutionStatus"), "error");
  if (!(await ensureActiveMember(membership.organization_id, assignedTo, admin))) go(returnTo, t("crm.messages.memberNotActive"), "error");
  if (!isScopedMember(assignedTo, visibleUserIds)) go(returnTo, t("crm.messages.employeePermissionDenied"), "error");

  const {data: response} = await admin.from("crm_feedback_responses").select("id, client_id, employee_id").eq("id", responseId).eq("organization_id", membership.organization_id).maybeSingle<{id: string; client_id: string; employee_id: string}>();
  if (!response) go(returnTo, t("crm.messages.feedbackResponseNotFound"), "error");
  if (!visibleUserIds.includes(response.employee_id)) go(returnTo, t("crm.messages.employeePermissionDenied"), "error");
  const {data: responseClient} = await getClient(response.client_id, membership.organization_id, admin);
  if (!responseClient || !canAccessClient(membership.role, user.id, responseClient, visibleUserIds)) {
    go(returnTo, t("crm.messages.clientPermissionDenied"), "error");
  }

  const {error} = await admin.from("crm_feedback_responses").update({
    resolution_status: status,
    resolution_assigned_to: assignedTo,
    resolution_notes: cleanText(formData.get("resolutionNotes"), 5000),
    resolved_at: status === "resolved" ? new Date().toISOString() : null,
  }).eq("id", responseId);
  if (error) go(returnTo, t("crm.messages.feedbackResolutionFailed", {message: error.message}), "error");

  await audit({organizationId: membership.organization_id, actorId: user.id, entityType: "feedback_response", entityId: responseId, action: "feedback_resolution_updated", details: {status, assignedTo}, admin});
  revalidatePath("/dashboard/crm");
  revalidatePath(`/dashboard/crm/${response.client_id}`);
  go(returnTo, t("crm.messages.feedbackResolutionUpdated"));
}

export async function getFeedbackShareContent(params: {
  token: string;
  locale: "fr" | "en";
  clientName: string;
  organizationName: string;
  employeeName: string;
  message: string;
}) {
  return buildFeedbackMessage(params);
}
