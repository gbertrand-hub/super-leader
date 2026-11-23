import {getSiteUrl} from "@/lib/supabase/env";

export type TemporaryAccessEmailInput = {
  to: string;
  fullName: string;
  temporaryPassword: string;
  expiresAt: string;
  locale: "fr" | "en";
  organizationName: string;
};

export type TemporaryAccessEmailResult = {
  sent: boolean;
  configurationMissing?: boolean;
  providerMessageId?: string;
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

export async function sendTemporaryAccessEmail(
  input: TemporaryAccessEmailInput,
): Promise<TemporaryAccessEmailResult> {
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

  const loginUrl = `${getSiteUrl()}/login`;
  const expiryLabel = new Intl.DateTimeFormat(
    input.locale === "fr" ? "fr-FR" : "en-GB",
    {dateStyle: "long", timeStyle: "short"},
  ).format(new Date(input.expiresAt));

  const isFrench = input.locale === "fr";
  const subject = isFrench
    ? "Votre accès temporaire à Super Leader"
    : "Your temporary Super Leader access";
  const greeting = isFrench
    ? `Bonjour ${input.fullName},`
    : `Hello ${input.fullName},`;
  const intro = isFrench
    ? `${input.organizationName} a activé votre compte Super Leader.`
    : `${input.organizationName} has activated your Super Leader account.`;
  const passwordLabel = isFrench
    ? "Mot de passe temporaire"
    : "Temporary password";
  const expiryText = isFrench
    ? `Ce mot de passe expire le ${expiryLabel}.`
    : `This password expires on ${expiryLabel}.`;
  const securityText = isFrench
    ? "Vous devrez créer votre propre mot de passe immédiatement après votre première connexion. Ne transférez pas ce message."
    : "You must create your own password immediately after your first sign-in. Do not forward this message.";
  const buttonLabel = isFrench ? "Se connecter" : "Sign in";

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
          `${passwordLabel}: ${input.temporaryPassword}`,
          expiryText,
          securityText,
          loginUrl,
        ].join("\n\n"),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:28px;color:#0f172a">
            <div style="display:inline-block;border-radius:999px;background:#fef3c7;padding:6px 11px;font-size:12px;font-weight:700;color:#92400e">SUPER LEADER</div>
            <h1 style="font-size:24px;line-height:1.25;margin:20px 0 10px">${escapeHtml(subject)}</h1>
            <p style="font-size:16px;line-height:1.65">${escapeHtml(greeting)}</p>
            <p style="font-size:16px;line-height:1.65;color:#334155">${escapeHtml(intro)}</p>
            <div style="margin:24px 0;border:1px solid #fde68a;background:#fffbeb;border-radius:14px;padding:18px">
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#92400e">${escapeHtml(passwordLabel)}</div>
              <div style="font-family:Consolas,monospace;font-size:24px;font-weight:800;letter-spacing:1px;margin-top:8px">${escapeHtml(input.temporaryPassword)}</div>
            </div>
            <p style="font-size:14px;line-height:1.6;color:#475569">${escapeHtml(expiryText)}</p>
            <p style="font-size:14px;line-height:1.6;color:#b91c1c;font-weight:700">${escapeHtml(securityText)}</p>
            <p style="margin:28px 0"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:700">${escapeHtml(buttonLabel)}</a></p>
          </div>
        `,
        tags: [{name: "category", value: "temporary_access"}],
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

    return {sent: true, providerMessageId: payload.id};
  } catch (error) {
    return {
      sent: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to send the temporary access email.",
    };
  }
}
