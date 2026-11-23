import {NextResponse} from "next/server";
import {recordFeedbackDeliveryEvent} from "@/lib/crm/feedback-events";
import {verifyResendWebhook} from "@/lib/crm/webhook-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    [key: string]: unknown;
  };
};

export async function POST(request: Request) {
  const payload = await request.text();
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");

  if (!verifyResendWebhook({payload, id, timestamp, signature})) {
    return NextResponse.json({ok: false, error: "Invalid signature"}, {status: 400});
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(payload) as ResendEvent;
  } catch {
    return NextResponse.json({ok: false, error: "Invalid JSON"}, {status: 400});
  }

  const messageId = event.data?.email_id;
  if (!id || !event.type || !messageId) return NextResponse.json({ok: true, ignored: true});

  await recordFeedbackDeliveryEvent({
    provider: "resend",
    providerEventId: id,
    providerMessageId: messageId,
    eventType: event.type,
    eventStatus: event.type,
    payload: event as Record<string, unknown>,
    occurredAt: event.created_at ?? null,
  });

  return NextResponse.json({ok: true});
}
