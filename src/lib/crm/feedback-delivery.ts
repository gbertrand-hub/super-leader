import {getSiteUrl} from "@/lib/supabase/env";

export type FeedbackLocale = "fr" | "en";
export type FeedbackChannel = "email" | "whatsapp" | "sms" | "web";

export type FeedbackDeliveryInput = {
  channel: FeedbackChannel;
  recipient: string | null;
  clientName: string;
  organizationName: string;
  employeeName: string;
  token: string;
  locale: FeedbackLocale;
  message: string;
  isReminder?: boolean;
};

export type DeliveryResult = {
  sent: boolean;
  provider: "resend" | "twilio" | "meta" | "manual" | "web";
  providerMessageId?: string;
  providerStatus?: string;
  providerMetadata?: Record<string, unknown>;
  error?: string;
  configurationMissing?: boolean;
};

type FeedbackEmailInput = Omit<FeedbackDeliveryInput, "channel" | "recipient"> & {to: string};

function clean(value: string | undefined) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "").trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanPhone(value: string) {
  return value.trim().replace(/[^\d+]/g, "");
}

function normalizeWhatsAppRecipient(value: string) {
  return cleanPhone(value).replace(/^\+/, "");
}

export function getFeedbackUrl(token: string) {
  return `${getSiteUrl()}/feedback/customer/${encodeURIComponent(token)}`;
}

export function buildFeedbackMessage({
  locale,
  clientName,
  organizationName,
  employeeName,
  message,
  token,
  isReminder = false,
}: Omit<FeedbackEmailInput, "to">) {
  const url = getFeedbackUrl(token);
  const greeting = locale === "fr" ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const reminder = isReminder
    ? locale === "fr"
      ? "Petit rappel : votre avis nous serait très utile."
      : "A quick reminder: your feedback would be very helpful."
    : "";
  const prompt = locale === "fr"
    ? `Comment évaluez-vous votre échange avec ${employeeName} ?`
    : `How would you rate your interaction with ${employeeName}?`;
  const action = locale === "fr" ? "Donner mon avis" : "Share my feedback";
  const footer = locale === "fr"
    ? `Cette demande a été envoyée par ${organizationName}.`
    : `This request was sent by ${organizationName}.`;
  const subject = locale === "fr"
    ? `${isReminder ? "Rappel - " : ""}Votre avis compte - ${organizationName}`
    : `${isReminder ? "Reminder - " : ""}Your feedback matters - ${organizationName}`;
  const parts = [greeting, reminder, message, prompt, url, footer].filter(Boolean);

  return {
    url,
    subject,
    text: parts.join("\n\n"),
    smsText: [reminder, prompt, url].filter(Boolean).join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;color:#0f172a">
        <p style="font-size:16px">${escapeHtml(greeting)}</p>
        ${reminder ? `<p style="font-size:15px;font-weight:700;color:#4338ca">${escapeHtml(reminder)}</p>` : ""}
        <p style="font-size:16px;line-height:1.6">${escapeHtml(message)}</p>
        <p style="font-size:18px;font-weight:700">${escapeHtml(prompt)}</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(url)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:700">${escapeHtml(action)}</a>
        </p>
        <p style="font-size:13px;color:#64748b">${escapeHtml(footer)}</p>
      </div>
    `,
  };
}

export function getFeedbackProviderConfiguration() {
  const emailConfigured = Boolean(clean(process.env.RESEND_API_KEY) && clean(process.env.FEEDBACK_FROM_EMAIL));
  const smsConfigured = Boolean(
    clean(process.env.TWILIO_ACCOUNT_SID)
      && clean(process.env.TWILIO_AUTH_TOKEN)
      && (clean(process.env.TWILIO_MESSAGING_SERVICE_SID) || clean(process.env.TWILIO_FROM_NUMBER)),
  );
  const whatsappConfigured = Boolean(
    clean(process.env.WHATSAPP_ACCESS_TOKEN)
      && clean(process.env.WHATSAPP_PHONE_NUMBER_ID)
      && clean(process.env.WHATSAPP_GRAPH_VERSION)
      && clean(process.env.WHATSAPP_FEEDBACK_TEMPLATE_NAME),
  );

  return {
    email: emailConfigured,
    sms: smsConfigured,
    whatsapp: whatsappConfigured,
    web: true,
    resendWebhook: Boolean(clean(process.env.RESEND_WEBHOOK_SECRET)),
    twilioWebhook: Boolean(clean(process.env.TWILIO_AUTH_TOKEN)),
    whatsappWebhook: Boolean(clean(process.env.WHATSAPP_APP_SECRET) && clean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)),
    cron: Boolean(clean(process.env.CRON_SECRET)),
  };
}

export async function sendFeedbackEmail(input: FeedbackEmailInput): Promise<DeliveryResult> {
  const apiKey = clean(process.env.RESEND_API_KEY);
  const fromEmail = clean(process.env.FEEDBACK_FROM_EMAIL);
  const fromName = clean(process.env.FEEDBACK_FROM_NAME) || input.organizationName || "Super Leader";

  if (!apiKey || !fromEmail) {
    return {
      sent: false,
      provider: "manual",
      configurationMissing: true,
      error: "RESEND_API_KEY or FEEDBACK_FROM_EMAIL is missing.",
    };
  }

  const content = buildFeedbackMessage(input);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [input.to],
        subject: content.subject,
        html: content.html,
        text: content.text,
        tags: [
          {name: "category", value: "customer_feedback"},
          {name: "feedback_token", value: input.token},
        ],
      }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {id?: string; message?: string; name?: string};
    if (!response.ok || !payload.id) {
      return {
        sent: false,
        provider: "resend",
        error: payload.message || payload.name || `Resend returned HTTP ${response.status}.`,
      };
    }

    return {
      sent: true,
      provider: "resend",
      providerMessageId: payload.id,
      providerStatus: "sent",
    };
  } catch (error) {
    return {
      sent: false,
      provider: "resend",
      error: error instanceof Error ? error.message : "Unable to send feedback email.",
    };
  }
}

async function sendFeedbackSms(input: FeedbackDeliveryInput & {recipient: string}): Promise<DeliveryResult> {
  const accountSid = clean(process.env.TWILIO_ACCOUNT_SID);
  const authToken = clean(process.env.TWILIO_AUTH_TOKEN);
  const messagingServiceSid = clean(process.env.TWILIO_MESSAGING_SERVICE_SID);
  const fromNumber = clean(process.env.TWILIO_FROM_NUMBER);

  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    return {
      sent: false,
      provider: "manual",
      configurationMissing: true,
      error: "Twilio SMS configuration is missing.",
    };
  }

  const content = buildFeedbackMessage(input);
  const body = new URLSearchParams({
    To: cleanPhone(input.recipient),
    Body: content.smsText,
    StatusCallback: `${getSiteUrl()}/api/webhooks/twilio`,
  });
  if (messagingServiceSid) body.set("MessagingServiceSid", messagingServiceSid);
  else body.set("From", fromNumber);

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      message?: string;
      code?: number;
    };
    if (!response.ok || !payload.sid) {
      return {
        sent: false,
        provider: "twilio",
        error: payload.message || `Twilio returned HTTP ${response.status}.`,
        providerMetadata: payload.code ? {code: payload.code} : undefined,
      };
    }
    return {
      sent: true,
      provider: "twilio",
      providerMessageId: payload.sid,
      providerStatus: payload.status || "queued",
    };
  } catch (error) {
    return {
      sent: false,
      provider: "twilio",
      error: error instanceof Error ? error.message : "Unable to send feedback SMS.",
    };
  }
}

async function sendFeedbackWhatsApp(input: FeedbackDeliveryInput & {recipient: string}): Promise<DeliveryResult> {
  const accessToken = clean(process.env.WHATSAPP_ACCESS_TOKEN);
  const phoneNumberId = clean(process.env.WHATSAPP_PHONE_NUMBER_ID);
  const graphVersion = clean(process.env.WHATSAPP_GRAPH_VERSION);
  const templateName = clean(process.env.WHATSAPP_FEEDBACK_TEMPLATE_NAME);
  const languageCode = input.locale === "fr"
    ? clean(process.env.WHATSAPP_TEMPLATE_LANGUAGE_FR) || "fr"
    : clean(process.env.WHATSAPP_TEMPLATE_LANGUAGE_EN) || "en_US";

  if (!accessToken || !phoneNumberId || !graphVersion || !templateName) {
    return {
      sent: false,
      provider: "manual",
      configurationMissing: true,
      error: "WhatsApp Cloud API configuration is missing.",
    };
  }

  const body = {
    messaging_product: "whatsapp",
    to: normalizeWhatsAppRecipient(input.recipient),
    type: "template",
    template: {
      name: templateName,
      language: {code: languageCode},
      components: [
        {
          type: "body",
          parameters: [
            {type: "text", text: input.clientName},
            {type: "text", text: input.employeeName},
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{type: "text", text: input.token}],
        },
      ],
    },
  };

  try {
    const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      messages?: Array<{id?: string; message_status?: string}>;
      error?: {message?: string; type?: string; code?: number; error_subcode?: number};
    };
    const message = payload.messages?.[0];
    if (!response.ok || !message?.id) {
      return {
        sent: false,
        provider: "meta",
        error: payload.error?.message || `Meta returned HTTP ${response.status}.`,
        providerMetadata: payload.error ? {
          type: payload.error.type,
          code: payload.error.code,
          subcode: payload.error.error_subcode,
        } : undefined,
      };
    }
    return {
      sent: true,
      provider: "meta",
      providerMessageId: message.id,
      providerStatus: message.message_status || "accepted",
    };
  } catch (error) {
    return {
      sent: false,
      provider: "meta",
      error: error instanceof Error ? error.message : "Unable to send feedback WhatsApp message.",
    };
  }
}

export async function sendFeedbackByChannel(input: FeedbackDeliveryInput): Promise<DeliveryResult> {
  if (input.channel === "web") {
    return {
      sent: false,
      provider: "web",
      configurationMissing: false,
      providerStatus: "ready",
    };
  }
  if (!input.recipient) {
    return {
      sent: false,
      provider: "manual",
      error: "Recipient is missing.",
    };
  }
  if (input.channel === "email") {
    return sendFeedbackEmail({
      to: input.recipient,
      clientName: input.clientName,
      organizationName: input.organizationName,
      employeeName: input.employeeName,
      token: input.token,
      locale: input.locale,
      message: input.message,
      isReminder: input.isReminder,
    });
  }
  if (input.channel === "sms") {
    return sendFeedbackSms({...input, recipient: input.recipient});
  }
  return sendFeedbackWhatsApp({...input, recipient: input.recipient});
}
