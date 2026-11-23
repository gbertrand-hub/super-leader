import {createAdminClient} from "@/lib/supabase/admin";

function safeTechnicalText(value: unknown, fallback: string) {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  const cleaned = raw
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[connection-redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[url-redacted]")
    .replace(/(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g, "[token-redacted]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[value-redacted]")
    .trim()
    .slice(0, 280);
  return cleaned || fallback;
}

export async function recordBackgroundJobRun(input: {
  jobName: string;
  status: "success" | "warning" | "failed";
  startedAt: number;
  summary?: unknown;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const admin = createAdminClient();
    const finishedAt = Date.now();
    await admin.from("system_background_job_runs").insert({
      organization_id: input.organizationId ?? null,
      job_name: input.jobName,
      status: input.status,
      started_at: new Date(input.startedAt).toISOString(),
      finished_at: new Date(finishedAt).toISOString(),
      duration_ms: Math.max(0, finishedAt - input.startedAt),
      error_summary: input.status === "failed" ? safeTechnicalText(input.summary, "Background job failed.") : null,
      result_summary: input.status !== "failed" ? safeTechnicalText(input.summary, "Background job completed.") : null,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    console.error("Technical monitoring: background job logging unavailable", error);
  }
}

export async function recordTechnicalIncident(input: {
  source: string;
  severity: "healthy" | "warning" | "critical";
  title: string;
  summary?: unknown;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (input.severity === "healthy") return;
  try {
    const admin = createAdminClient();
    const source = input.source.slice(0, 120);
    const title = input.title.slice(0, 180);
    const recentThreshold = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    let duplicateQuery = admin
      .from("system_technical_incidents")
      .select("id")
      .eq("source", source)
      .eq("title", title)
      .eq("status", "open")
      .gte("occurred_at", recentThreshold)
      .limit(1);
    duplicateQuery = input.organizationId
      ? duplicateQuery.eq("organization_id", input.organizationId)
      : duplicateQuery.is("organization_id", null);
    const {data: duplicate} = await duplicateQuery.maybeSingle<{id: string}>();
    if (duplicate) return;

    await admin.from("system_technical_incidents").insert({
      organization_id: input.organizationId ?? null,
      source,
      severity: input.severity,
      title,
      summary: safeTechnicalText(input.summary, "Technical incident detected."),
      status: "open",
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    console.error("Technical monitoring: incident logging unavailable", error);
  }
}

export async function resolveTechnicalIncidentsBySource(source: string) {
  try {
    const admin = createAdminClient();
    await admin
      .from("system_technical_incidents")
      .update({status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString()})
      .eq("source", source.slice(0, 120))
      .eq("status", "open");
  } catch (error) {
    console.error("Technical monitoring: incident resolution unavailable", error);
  }
}
