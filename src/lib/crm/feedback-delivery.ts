import {getSiteUrl} from "@/lib/supabase/env";

type Locale = "fr" | "en";

type FeedbackEmailInput = {
  to: string;
  clientName: string;
  organizationName: string;
  employeeName: string;
  token: string;
  locale: Locale;
  message: string;
};

type DeliveryResult = {
  sent: boolean;
  provider: "resend" | "manual";
  providerMessageId?: string;
  error?: string;
  configurationMissing?: boolean;
};

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
}: Omit<FeedbackEmailInput, "to">) {
  const url = getFeedbackUrl(token);
  const greeting = locale === "fr" ? `Bonjour ${clientName},` : `Hello ${clientName},`;
  const prompt = locale === "fr"
    ? `Comment evaluez-vous votre echange avec ${employeeName} ?`
    : `How would you rate your interaction with ${employeeName}?`;
  const action = locale === "fr" ? "Donner mon avis" : "Share my feedback";
  const footer = locale === "fr"
    ? `Cette demande a ete envoyee par ${organizationName}.`
    : `This request was sent by ${organizationName}.`;

  return {
    url,
    subject: locale === "fr"
      ? `Votre avis compte - ${organizationName}`
      : `Your feedback matters - ${organizationName}`,
    text: `${greeting}\n\n${message}\n\n${prompt}\n${url}\n\n${footer}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;color:#0f172a">
        <p style="font-size:16px">${escapeHtml(greeting)}</p>
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

    return {sent: true, provider: "resend", providerMessageId: payload.id};
  } catch (error) {
    return {
      sent: false,
      provider: "resend",
      error: error instanceof Error ? error.message : "Unable to send feedback email.",
    };
  }
}
