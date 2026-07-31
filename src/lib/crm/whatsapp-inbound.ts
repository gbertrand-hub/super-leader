import {createAdminClient} from "@/lib/supabase/admin";

export type MetaContact = {
  wa_id?: string;
  profile?: {
    name?: string;
  };
};

export type MetaInboundMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: {
    body?: string;
  };
  button?: {
    text?: string;
    payload?: string;
  };
  interactive?: {
    type?: string;
    button_reply?: {
      id?: string;
      title?: string;
    };
    list_reply?: {
      id?: string;
      title?: string;
      description?: string;
    };
  };
  image?: {
    id?: string;
    caption?: string;
  };
  document?: {
    id?: string;
    filename?: string;
    caption?: string;
  };
  audio?: {
    id?: string;
  };
  video?: {
    id?: string;
    caption?: string;
  };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  context?: {
    id?: string;
  };
};

type FeedbackRequestRow = {
  id: string;
  organization_id: string;
  client_id: string;
  employee_id: string;
  recipient: string | null;
  status: string;
  created_at: string;
};

type ClientRow = {
  id: string;
  organization_id: string;
  owner_id: string | null;
  follow_up_owner_id: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
};

function digits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function occurredAt(timestamp: string | undefined) {
  const seconds = Number(timestamp);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return new Date().toISOString();
  }

  return new Date(seconds * 1000).toISOString();
}

function messageSummary(message: MetaInboundMessage) {
  if (message.text?.body?.trim()) {
    return message.text.body.trim();
  }

  if (message.button?.text?.trim()) {
    return message.button.text.trim();
  }

  if (message.interactive?.button_reply?.title?.trim()) {
    return message.interactive.button_reply.title.trim();
  }

  if (message.interactive?.list_reply?.title?.trim()) {
    const description =
      message.interactive.list_reply.description?.trim();

    return description
      ? `${message.interactive.list_reply.title.trim()} — ${description}`
      : message.interactive.list_reply.title.trim();
  }

  if (message.image?.caption?.trim()) {
    return message.image.caption.trim();
  }

  if (message.video?.caption?.trim()) {
    return message.video.caption.trim();
  }

  if (message.document?.caption?.trim()) {
    return message.document.caption.trim();
  }

  if (message.document?.filename?.trim()) {
    return `Document WhatsApp : ${message.document.filename.trim()}`;
  }

  if (message.location) {
    const label =
      message.location.name ||
      message.location.address ||
      `${message.location.latitude ?? ""}, ${message.location.longitude ?? ""}`;

    return `Localisation WhatsApp : ${label}`;
  }

  return `[Message WhatsApp ${message.type || "inconnu"}]`;
}

export async function recordMetaInboundMessage(params: {
  message: MetaInboundMessage;
  contacts?: MetaContact[];
  phoneNumberId?: string;
  payload: Record<string, unknown>;
}) {
  const messageId = String(params.message.id ?? "").trim();
  const fromPhone = digits(params.message.from);

  if (!messageId || !fromPhone) {
    return {
      accepted: false,
      duplicate: false,
      reason: "missing_message_id_or_sender",
    };
  }

  const admin = createAdminClient();
  const messageType = String(params.message.type || "unknown");
  const summary = messageSummary(params.message).slice(0, 5000);
  const messageOccurredAt = occurredAt(params.message.timestamp);

  const contact = (params.contacts ?? []).find(
    (item) => digits(item.wa_id) === fromPhone,
  );

  const {data: inbound, error: insertError} = await admin
    .from("crm_whatsapp_inbound_messages")
    .insert({
      provider: "meta",
      provider_message_id: messageId,
      phone_number_id: params.phoneNumberId || null,
      from_phone: fromPhone,
      profile_name: contact?.profile?.name?.trim() || null,
      message_type: messageType,
      message_text: summary,
      processing_status: "received",
      payload: params.payload,
      occurred_at: messageOccurredAt,
    })
    .select("id")
    .single<{id: string}>();

  if (insertError?.code === "23505") {
    return {
      accepted: true,
      duplicate: true,
    };
  }

  if (insertError || !inbound) {
    throw new Error(
      insertError?.message || "Unable to store inbound WhatsApp message.",
    );
  }

  try {
    const {data: requests, error: requestError} = await admin
      .from("crm_feedback_requests")
      .select(
        "id, organization_id, client_id, employee_id, recipient, status, created_at",
      )
      .eq("channel", "whatsapp")
      .in("status", [
        "ready",
        "pending",
        "sent",
        "delivered",
        "opened",
        "failed",
      ])
      .order("created_at", {ascending: false})
      .limit(250);

    if (requestError) {
      throw new Error(requestError.message);
    }

    const matchingRequest = (
      (requests ?? []) as FeedbackRequestRow[]
    ).find((request) => digits(request.recipient) === fromPhone);

    let organizationId = matchingRequest?.organization_id ?? null;
    let clientId = matchingRequest?.client_id ?? null;
    let employeeId = matchingRequest?.employee_id ?? null;
    let feedbackRequestId = matchingRequest?.id ?? null;

    if (!clientId) {
      const {data: clients, error: clientsError} = await admin
        .from("crm_clients")
        .select(
          "id, organization_id, owner_id, follow_up_owner_id, phone, whatsapp_phone",
        )
        .limit(2000);

      if (clientsError) {
        throw new Error(clientsError.message);
      }

      const matchingClients = (
        (clients ?? []) as ClientRow[]
      ).filter(
        (client) =>
          digits(client.whatsapp_phone) === fromPhone ||
          digits(client.phone) === fromPhone,
      );

      // Ne pas associer automatiquement si le même numéro
      // appartient à plusieurs clients.
      if (matchingClients.length === 1) {
        const client = matchingClients[0];

        organizationId = client.organization_id;
        clientId = client.id;
        employeeId =
          client.follow_up_owner_id ||
          client.owner_id ||
          null;
      }
    }

    let interactionId: string | null = null;

    if (organizationId && clientId && employeeId) {
      const {data: interaction, error: interactionError} = await admin
        .from("crm_interactions")
        .insert({
          organization_id: organizationId,
          client_id: clientId,
          employee_id: employeeId,
          channel: "whatsapp",
          direction: "inbound",
          interaction_type: "support",
          outcome: "follow_up",
          summary,
          occurred_at: messageOccurredAt,
          feedback_requested: false,
          created_by: employeeId,
        })
        .select("id")
        .single<{id: string}>();

      if (interactionError) {
        throw new Error(interactionError.message);
      }

      interactionId = interaction?.id ?? null;
    }

    const matched = Boolean(organizationId && clientId);

    const {error: updateError} = await admin
      .from("crm_whatsapp_inbound_messages")
      .update({
        organization_id: organizationId,
        client_id: clientId,
        feedback_request_id: feedbackRequestId,
        interaction_id: interactionId,
        processing_status: matched ? "matched" : "unmatched",
        processing_error: null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", inbound.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return {
      accepted: true,
      duplicate: false,
      matched,
      interactionCreated: Boolean(interactionId),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown inbound WhatsApp processing error.";

    await admin
      .from("crm_whatsapp_inbound_messages")
      .update({
        processing_status: "failed",
        processing_error: message.slice(0, 2000),
        processed_at: new Date().toISOString(),
      })
      .eq("id", inbound.id);

    throw error;
  }
}