export type HealthStatus = "healthy" | "warning" | "critical";

export type HealthCheck = {
  id: string;
  titleFr: string;
  titleEn: string;
  status: HealthStatus;
  summaryFr: string;
  summaryEn: string;
  guidanceFr: string;
  guidanceEn: string;
  metric?: string;
  latencyMs?: number;
  affectsOverall?: boolean;
};

export type BackgroundJobRun = {
  id: string;
  jobName: string;
  status: "success" | "warning" | "failed";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  summary: string | null;
};

export type TechnicalIncident = {
  id: string;
  severity: HealthStatus;
  source: string;
  title: string;
  summary: string | null;
  status: "open" | "resolved";
  occurredAt: string;
  resolvedAt: string | null;
};

export type LandDataQuality = {
  activeProducts: number;
  productIssues: number;
  openOpportunities: number;
  opportunityIssues: number;
};

export type HealthSnapshot = {
  checkedAt: string;
  overallStatus: HealthStatus;
  checks: HealthCheck[];
  failedJobs24h: number;
  warningJobs24h: number;
  recentJobs: BackgroundJobRun[];
  openIncidents: number;
  recentIncidents: TechnicalIncident[];
  land: LandDataQuality;
  applicationVersion: string;
  manifestVersion: string;
  schemaMigration: string | null;
};
