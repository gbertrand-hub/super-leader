import {NextResponse} from "next/server";
import {processFeedbackAutomation} from "@/lib/crm/feedback-automation";
import {verifyCronRequest} from "@/lib/crm/webhook-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ok: false, error: "Unauthorized"}, {status: 401});
  }

  try {
    const result = await processFeedbackAutomation();
    return NextResponse.json({ok: true, ...result});
  } catch (error) {
    console.error("Feedback automation cron failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Feedback automation failed.",
    }, {status: 500});
  }
}
