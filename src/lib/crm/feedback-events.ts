import {createAdminClient} from "@/lib/supabase/admin";

export type DeliveryProvider = "resend" | "twilio" | "meta" | "manual" | "web";

const statusRank: Record<string, number> = {
  ready: 0,
  pending: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  completed: 5,
};

export function normalizeProviderStatus(provider: DeliveryProvider, status: string) {
  const normalized = status.toLowerCase();
  if (provider === "resend") {
    if (normalized === "email.scheduled") return "pending";
    if (["email.sent", "email.delivery_delayed"].includes(normalized)) return "sent";
    if (normalized === "email.delivered") return "delivered";
    if (["email.opened", "email.clicked"].includes(normalized)) return "opened";
    if (["email.bounced", "email.failed", "email.complained", "email.suppressed"].includes(normalized)) return "failed";
  }
  if (provider === "twilio") {
    if (["queued", "accepted", "scheduled", "sending"].includes(normalized)) return "pending";
    if (normalized === "sent") return "sent";
    if (normalized === "delivered") return "delivered";
    if (normalized === "read") return "opened";
    if (["undelivered", "failed", "canceled"].includes(normalized)) return "failed";
  }
  if (provider === "meta") {
    if (["accepted", "sent"].includes(normalized)) return "sent";
    if (normalized === "delivered") return "delivered";
    if (normalized === "read") return "opened";
    if (["failed", "deleted"].includes(normalized)) return "failed";
  }
  return normalized;
}

export async function recordOutboundFeedbackDelivery(params: {
  organizationId: string;
  requestId: string;
  provider: DeliveryProvider;
  providerMessageId?: string | null;
  deliveryKind: "initial" | "reminder" | "manual";
  status?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (!params.providerMessageId) return null;
  const admin = createAdminClient();
  const {data, error} = await admin
    .from("crm_feedback_delivery_messages")
    .upsert({
      organization_id: params.organizationId,
      request_id: params.requestId,
      provider: params.provider,
      provider_message_id: params.providerMessageId,
      delivery_kind: params.deliveryKind,
      status: params.status || "sent",
      metadata: params.metadata ?? {},
    }, {onConflict: "provider,provider_message_id"})
    .select("id")
    .single<{id: string}>();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function recordFeedbackDeliveryEvent(params: {
  provider: DeliveryProvider;
  providerEventId: string;
  providerMessageId: string;
  eventType: string;
  eventStatus?: string | null;
  payload: Record<string, unknown>;
  occurredAt?: string | null;
}) {
  const admin = createAdminClient();
  const {data: deliveryMessage} = await admin
    .from("crm_feedback_delivery_messages")
    .select("id, request_id, organization_id, status")
    .eq("provider", params.provider)
    .eq("provider_message_id", params.providerMessageId)
    .maybeSingle<{id: string; request_id: string; organization_id: string; status: string}>();

  let requestId = deliveryMessage?.request_id ?? null;
  let organizationId = deliveryMessage?.organization_id ?? null;
  if (!requestId) {
    const {data: legacyRequest} = await admin
      .from("crm_feedback_requests")
      .select("id, organization_id")
      .eq("provider_message_id", params.providerMessageId)
      .maybeSingle<{id: string; organization_id: string}>();
    requestId = legacyRequest?.id ?? null;
    organizationId = legacyRequest?.organization_id ?? null;
  }
  if (!requestId || !organizationId) return {matched: false, inserted: false};

  const {data: request} = await admin
    .from("crm_feedback_requests")
    .select("id, organization_id, status, opened_at, completed_at")
    .eq("id", requestId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      status: string;
      opened_at: string | null;
      completed_at: string | null;
    }>();
  if (!request) return {matched: false, inserted: false};

  const {error: insertError} = await admin.from("crm_feedback_delivery_events").insert({
    organization_id: organizationId,
    request_id: requestId,
    delivery_message_id: deliveryMessage?.id ?? null,
    provider: params.provider,
    provider_event_id: params.providerEventId,
    provider_message_id: params.providerMessageId,
    event_type: params.eventType,
    event_status: params.eventStatus ?? null,
    payload: params.payload,
    occurred_at: params.occurredAt ?? null,
  });

  if (insertError?.code === "23505") return {matched: true, inserted: false};
  if (insertError) throw new Error(insertError.message);

  const mapped = normalizeProviderStatus(params.provider, params.eventStatus || params.eventType);
  if (deliveryMessage) {
    await admin.from("crm_feedback_delivery_messages").update({
      status: mapped,
      last_event_at: params.occurredAt ?? new Date().toISOString(),
    }).eq("id", deliveryMessage.id);
  }

  if (["completed", "cancelled", "expired"].includes(request.status)) {
    return {matched: true, inserted: true};
  }

  let isLatestDelivery = true;
  if (deliveryMessage) {
    const {data: latestDelivery} = await admin
      .from("crm_feedback_delivery_messages")
      .select("id")
      .eq("request_id", request.id)
      .order("sent_at", {ascending: false})
      .limit(1)
      .maybeSingle<{id: string}>();
    isLatestDelivery = latestDelivery?.id === deliveryMessage.id;
  }

  const currentRank = statusRank[request.status] ?? -1;
  const mappedRank = statusRank[mapped] ?? -1;
  const update: Record<string, unknown> = {
    last_provider_status: params.eventStatus || params.eventType,
    last_delivery_at: new Date().toISOString(),
  };

  if (mapped === "failed") {
    if (isLatestDelivery && currentRank < statusRank.delivered) {
      update.status = "failed";
      update.delivery_error = JSON.stringify(params.payload).slice(0, 2000);
    }
  } else if (mappedRank > currentRank) {
    update.status = mapped;
    update.delivery_error = null;
    if (mapped === "opened" && !request.opened_at) update.opened_at = new Date().toISOString();
  }

  await admin.from("crm_feedback_requests").update(update).eq("id", request.id);
  return {matched: true, inserted: true};
}
