import {createHmac, timingSafeEqual} from "node:crypto";

function clean(value: string | undefined) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "").trim();
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyResendWebhook(params: {
  payload: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}) {
  const secret = clean(process.env.RESEND_WEBHOOK_SECRET);
  if (!secret || !params.id || !params.timestamp || !params.signature) return false;

  const timestampNumber = Number(params.timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampNumber);
  if (ageSeconds > 300) return false;

  const keyValue = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(keyValue, "base64");
  } catch {
    return false;
  }

  const signedContent = `${params.id}.${params.timestamp}.${params.payload}`;
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");
  return params.signature
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean)
    .some((item) => {
      const [version, value] = item.split(",", 2);
      return version === "v1" && Boolean(value) && safeCompare(value, expected);
    });
}

export function publicRequestUrl(request: Request) {
  const current = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) current.host = forwardedHost;
  if (forwardedProto) current.protocol = `${forwardedProto}:`;
  return current.toString();
}

export function verifyTwilioWebhook(params: {
  url: string;
  form: URLSearchParams;
  signature: string | null;
}) {
  const authToken = clean(process.env.TWILIO_AUTH_TOKEN);
  if (!authToken || !params.signature) return false;

  const pairs = Array.from(params.form.entries()).sort(([a], [b]) => a.localeCompare(b));
  const data = pairs.reduce((result, [key, value]) => `${result}${key}${value}`, params.url);
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  return safeCompare(params.signature, expected);
}

export function verifyMetaWebhook(payload: string, signature: string | null) {
  const appSecret = clean(process.env.WHATSAPP_APP_SECRET);
  if (!appSecret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(payload).digest("hex")}`;
  return safeCompare(signature, expected);
}

export function verifyCronRequest(request: Request) {
  const secret = clean(process.env.CRON_SECRET);
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
