function clean(value: string | undefined) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "").trim();
}

export type ZoomRuntimeStatus = {
  configured: boolean;
  accountIdPresent: boolean;
  clientIdPresent: boolean;
  clientSecretPresent: boolean;
  webhookSecretPresent: boolean;
};

export function getZoomRuntimeStatus(): ZoomRuntimeStatus {
  const accountIdPresent = Boolean(clean(process.env.ZOOM_ACCOUNT_ID));
  const clientIdPresent = Boolean(clean(process.env.ZOOM_CLIENT_ID));
  const clientSecretPresent = Boolean(clean(process.env.ZOOM_CLIENT_SECRET));
  const webhookSecretPresent = Boolean(clean(process.env.ZOOM_WEBHOOK_SECRET_TOKEN));
  return {
    configured: accountIdPresent && clientIdPresent && clientSecretPresent,
    accountIdPresent,
    clientIdPresent,
    clientSecretPresent,
    webhookSecretPresent,
  };
}

export function getZoomCredentials() {
  const accountId = clean(process.env.ZOOM_ACCOUNT_ID);
  const clientId = clean(process.env.ZOOM_CLIENT_ID);
  const clientSecret = clean(process.env.ZOOM_CLIENT_SECRET);
  if (!accountId || !clientId || !clientSecret) {
    throw new Error("Zoom configuration missing: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID or ZOOM_CLIENT_SECRET.");
  }
  return {accountId, clientId, clientSecret};
}

export function getZoomWebhookSecret() {
  const secret = clean(process.env.ZOOM_WEBHOOK_SECRET_TOKEN);
  if (!secret) throw new Error("ZOOM_WEBHOOK_SECRET_TOKEN is missing.");
  return secret;
}
