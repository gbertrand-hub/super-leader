import {NextResponse} from "next/server";
import {recordFeedbackDeliveryEvent} from "@/lib/crm/feedback-events";
import {verifyMetaWebhook} from "@/lib/crm/webhook-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: string | undefined) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "").trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === clean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)) {
    return new NextResponse(challenge || "", {status: 200});
  }
  return new NextResponse("Forbidden", {status: 403});
}

type MetaStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: unknown[];
  recipient_id?: string;
};

type MetaPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: MetaStatus[];
      };
    }>;
  }>;
};

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyMetaWebhook(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ok: false, error: "Invalid signature"}, {status: 403});
  }

  let payload: MetaPayload;
  try {
    payload = JSON.parse(raw) as MetaPayload;
  } catch {
    return NextResponse.json({ok: false, error: "Invalid JSON"}, {status: 400});
  }

  const statuses = payload.entry?.flatMap((entry) =>
    entry.changes?.flatMap((change) => change.value?.statuses ?? []) ?? [],
  ) ?? [];

  for (const status of statuses) {
    if (!status.id || !status.status) continue;
    await recordFeedbackDeliveryEvent({
      provider: "meta",
      providerEventId: `${status.id}:${status.status}:${status.timestamp || Date.now()}`,
      providerMessageId: status.id,
      eventType: "message.status",
      eventStatus: status.status,
      payload: status as Record<string, unknown>,
      occurredAt: status.timestamp
        ? new Date(Number(status.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
    });
  }

  return NextResponse.json({ok: true});
}
