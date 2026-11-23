import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {recordFeedbackDeliveryEvent} from "@/lib/crm/feedback-events";
import {publicRequestUrl, verifyTwilioWebhook} from "@/lib/crm/webhook-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const form = new URLSearchParams(body);
  const signature = request.headers.get("x-twilio-signature");
  if (!verifyTwilioWebhook({url: publicRequestUrl(request), form, signature})) {
    return NextResponse.json({ok: false, error: "Invalid signature"}, {status: 403});
  }

  const messageId = form.get("MessageSid") || form.get("SmsSid");
  const status = form.get("MessageStatus") || form.get("SmsStatus") || "unknown";
  if (!messageId) return NextResponse.json({ok: true, ignored: true});

  const eventId = `${messageId}:${status}:${createHash("sha256").update(body).digest("hex").slice(0, 20)}`;
  await recordFeedbackDeliveryEvent({
    provider: "twilio",
    providerEventId: eventId,
    providerMessageId: messageId,
    eventType: "message.status",
    eventStatus: status,
    payload: Object.fromEntries(form.entries()),
    occurredAt: new Date().toISOString(),
  });

  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: {"Content-Type": "text/xml"},
  });
}
