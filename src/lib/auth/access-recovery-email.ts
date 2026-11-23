import { getSiteUrl } from "@/lib/supabase/env";

export type AccessRecoveryEmailInput = {
  to: string;
  fullName: string;
  recoveryLink: string;
  locale: "fr" | "en";
  organizationName: string;
};

export type AccessRecoveryEmailResult = {
  sent: boolean;
  configurationMissing?: boolean;
  providerMessageId?: string;
  error?: string;
};

function clean(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendAccessRecoveryEmail(
  input: AccessRecoveryEmailInput,
): Promise<AccessRecoveryEmailResult> {
  const apiKey = clean(process.env.RESEND_API_KEY);
  const fromEmail =
    clean(process.env.TEMPORARY_ACCESS_FROM_EMAIL) ||
    clean(process.env.NOTIFICATION_FROM_EMAIL) ||
    clean(process.env.FEEDBACK_FROM_EMAIL);
  const fromName =
    clean(process.env.TEMPORARY_ACCESS_FROM_NAME) ||
    clean(process.env.NOTIFICATION_FROM_NAME) ||
    "Super Leader";

  if (!apiKey || !fromEmail) {
    return {
      sent: false,
      configurationMissing: true,
      error:
        "RESEND_API_KEY and TEMPORARY_ACCESS_FROM_EMAIL or NOTIFICATION_FROM_EMAIL are required.",
    };
  }

  const isFrench = input.locale === "fr";
  const subject = isFrench
    ? "Réinitialisez votre accès à Super Leader"
    : "Reset your Super Leader access";
  const greeting = isFrench
    ? `Bonjour ${input.fullName},`
    : `Hello ${input.fullName},`;
  const intro = isFrench
    ? `${input.organizationName} vous a envoyé un lien sécurisé pour choisir un nouveau mot de passe.`
    : `${input.organizationName} sent you a secure link to choose a new password.`;
  const securityText = isFrench
    ? "Ce lien est personnel et temporaire. Ne le transférez pas. Si vous n’attendiez pas ce message, contactez votre administrateur."
    : "This link is personal and temporary. Do not forward it. If you were not expecting this message, contact your administrator.";
  const buttonLabel = isFrench
    ? "Choisir un nouveau mot de passe"
    : "Choose a new password";
  const loginUrl = `${getSiteUrl()}/login`;

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
        subject,
        text: [
          greeting,
          intro,
          input.recoveryLink,
          securityText,
          `Connexion permanente : ${loginUrl}`,
        ].join("\n\n"),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;color:#0f172a">
            <div style="display:inline-block;border-radius:999px;background:#fef3c7;padding:6px 11px;font-size:12px;font-weight:700;color:#92400e">SUPER LEADER</div>
            <h1 style="font-size:24px;line-height:1.25;margin:20px 0 10px">${escapeHtml(subject)}</h1>
            <p style="font-size:16px;line-height:1.65">${escapeHtml(greeting)}</p>
            <p style="font-size:16px;line-height:1.65;color:#334155">${escapeHtml(intro)}</p>
            <p style="margin:28px 0"><a href="${escapeHtml(input.recoveryLink)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:700">${escapeHtml(buttonLabel)}</a></p>
            <p style="font-size:14px;line-height:1.6;color:#b91c1c;font-weight:700">${escapeHtml(securityText)}</p>
            <p style="font-size:12px;line-height:1.6;color:#64748b;word-break:break-all">${escapeHtml(input.recoveryLink)}</p>
          </div>
        `,
        tags: [{ name: "category", value: "access_recovery" }],
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
        error:
          payload.message ||
          payload.name ||
          `Resend returned HTTP ${response.status}.`,
      };
    }

    return { sent: true, providerMessageId: payload.id };
  } catch (error) {
    return {
      sent: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to send the access recovery email.",
    };
  }
}
