import { NextResponse } from "next/server";
import { processCantonProductionFeedbackEmails } from "@/lib/canton/production-feedback-delivery";
import { verifyCronRequest } from "@/lib/crm/webhook-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret || !verifyCronRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const enabled =
    process.env.VERCEL_ENV === "production" &&
    process.env.CANTON_FEEDBACK_EMAIL_AUTOMATION_ENABLED === "true";

  if (!enabled) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      message: "Canton email automation is disabled.",
    });
  }

  try {
    const result = await processCantonProductionFeedbackEmails(20);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Canton feedback email processor failed", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Canton feedback processing failed.",
      },
      { status: 500 }
    );
  }
}