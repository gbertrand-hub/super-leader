import {NextResponse} from "next/server";
import {processFeedbackAutomation} from "@/lib/crm/feedback-automation";
import {verifyCronRequest} from "@/lib/crm/webhook-security";
import {recordBackgroundJobRun, recordTechnicalIncident, resolveTechnicalIncidentsBySource} from "@/lib/health/technical-monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ok: false, error: "Unauthorized"}, {status: 401});
  }

  const startedAt = Date.now();
  try {
    const result = await processFeedbackAutomation();
    await Promise.all([
      recordBackgroundJobRun({
      jobName: "feedback-automation",
      status: "success",
      startedAt,
      summary: `Processed ${result.processed}; sent ${result.sent}; skipped ${result.skipped}.`,
      metadata: {queued: result.queued, processed: result.processed, sent: result.sent, skipped: result.skipped},
      }),
      resolveTechnicalIncidentsBySource("cron.feedback-automation"),
    ]);
    return NextResponse.json({ok: true, ...result});
  } catch (error) {
    console.error("Feedback automation cron failed", error);
    await Promise.all([
      recordBackgroundJobRun({
        jobName: "feedback-automation",
        status: "failed",
        startedAt,
        summary: error,
      }),
      recordTechnicalIncident({
        source: "cron.feedback-automation",
        severity: "critical",
        title: "Feedback automation job failed",
        summary: error,
      }),
    ]);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Feedback automation failed.",
    }, {status: 500});
  }
}
