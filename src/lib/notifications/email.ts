import {getSiteUrl} from "@/lib/supabase/env";

export type NotificationEmailInput = {
  to: string;
  locale: "fr" | "en";
  titleFr: string;
  titleEn: string;
  bodyFr: string;
  bodyEn: string;
  actionUrl?: string | null;
  priority: string;
  organizationName: string;
};

export type NotificationEmailResult = {
  sent: boolean;
  providerMessageId?: string;
  configurationMissing?: boolean;
  error?: string;
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

function absoluteActionUrl(actionUrl?: string | null) {
  if (!actionUrl) return null;
  if (/^https?:\/\//i.test(actionUrl)) return actionUrl;
  return `${getSiteUrl()}${actionUrl.startsWith("/") ? actionUrl : `/${actionUrl}`}`;
}

export async function sendNotificationEmail(
  input: NotificationEmailInput,
): Promise<NotificationEmailResult> {
  const apiKey = clean(process.env.RESEND_API_KEY);
  const fromEmail = clean(process.env.NOTIFICATION_FROM_EMAIL) || clean(process.env.FEEDBACK_FROM_EMAIL);
  const fromName = clean(process.env.NOTIFICATION_FROM_NAME) || "Super Leader";

  if (!apiKey || !fromEmail) {
    return {
      sent: false,
      configurationMissing: true,
      error: "RESEND_API_KEY or NOTIFICATION_FROM_EMAIL is missing.",
    };
  }

  const isFrench = input.locale === "fr";
  const title = isFrench ? input.titleFr : input.titleEn;
  const body = isFrench ? input.bodyFr : input.bodyEn;
  const actionUrl = absoluteActionUrl(input.actionUrl);
  const actionLabel = isFrench ? "Ouvrir dans Super Leader" : "Open in Super Leader";
  const footer = isFrench
    ? `Notification envoyée par ${input.organizationName}.`
    : `Notification sent by ${input.organizationName}.`;

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
        subject: title,
        text: [title, body, actionUrl, footer].filter(Boolean).join("\n\n"),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;color:#0f172a">
            <div style="display:inline-block;border-radius:999px;background:${input.priority === "urgent" ? "#fee2e2" : "#eef2ff"};padding:6px 11px;font-size:12px;font-weight:700;color:${input.priority === "urgent" ? "#b91c1c" : "#4338ca"}">
              SUPER LEADER
            </div>
            <h1 style="font-size:24px;line-height:1.25;margin:20px 0 10px">${escapeHtml(title)}</h1>
            <p style="font-size:16px;line-height:1.65;color:#334155">${escapeHtml(body)}</p>
            ${actionUrl ? `<p style="margin:28px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:700">${escapeHtml(actionLabel)}</a></p>` : ""}
            <p style="font-size:12px;color:#64748b;margin-top:28px">${escapeHtml(footer)}</p>
          </div>
        `,
        tags: [
          {name: "category", value: "operational_notification"},
          {name: "priority", value: input.priority || "info"},
        ],
      }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!response.ok || !payload.id) {
      return {
        sent: false,
        error: payload.message || payload.name || `Resend returned HTTP ${response.status}.`,
      };
    }

    return {sent: true, providerMessageId: payload.id};
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : "Unable to send notification email.",
    };
  }
}
