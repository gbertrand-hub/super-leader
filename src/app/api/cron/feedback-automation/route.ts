import {NextResponse} from "next/server";
import {processFeedbackAutomation} from "@/lib/crm/feedback-automation";
import {verifyCronRequest} from "@/lib/crm/webhook-security";
import {processCantonProductionFeedbackEmails} from "@/lib/canton/production-feedback-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ok: false, error: "Unauthorized"}, {status: 401});
  }

  try {
    const [crm,canton] = await Promise.all([
      processFeedbackAutomation(),
      processCantonProductionFeedbackEmails(25),
    ]);
    return NextResponse.json({ok: true, crm, canton});
  } catch (error) {
    console.error("Feedback automation cron failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Feedback automation failed.",
    }, {status: 500});
  }
}
