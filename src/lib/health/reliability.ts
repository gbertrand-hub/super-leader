import packageJson from "../../../package.json";
import versionManifest from "../../../VERSION.json";
import type {AccessContext} from "@/lib/auth/access-control";
import {PRIVATE_ATTACHMENTS_BUCKET} from "@/lib/storage/private-attachments";
import {createClient} from "@/lib/supabase/server";
import {getSupabasePublicConfig} from "@/lib/supabase/env";
import type {
  BackgroundJobRun,
  HealthCheck,
  HealthSnapshot,
  HealthStatus,
  TechnicalIncident,
} from "@/lib/health/types";

const EXPECTED_MIGRATION_NUMBER = 100;
const EXPECTED_MIGRATION_NAME = "100_health_reliability_center_v4_8_61";

function worstStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  return "healthy";
}

function check(input: HealthCheck): HealthCheck {
  return {...input, affectsOverall: input.affectsOverall ?? true};
}

function rows<T>(value: T[] | null | undefined): T[] {
  return value ?? [];
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function getHealthReliabilitySnapshot(context: AccessContext): Promise<HealthSnapshot> {
  const {admin, organizationId, user} = context;
  const checks: HealthCheck[] = [];
  const checkedAt = new Date().toISOString();

  const supabaseStarted = Date.now();
  let supabaseApiHealthy = false;
  try {
    const {url, publishableKey} = getSupabasePublicConfig();
    const response = await fetch(`${url}/auth/v1/health`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(7_000),
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        Accept: "application/json",
      },
    });
    supabaseApiHealthy = response.ok;
  } catch {
    supabaseApiHealthy = false;
  }
  checks.push(check({
    id: "supabase-connectivity",
    titleFr: "Connectivité Supabase",
    titleEn: "Supabase connectivity",
    status: supabaseApiHealthy ? "healthy" : "critical",
    summaryFr: supabaseApiHealthy
      ? "Le service Supabase répond depuis le serveur applicatif."
      : "Le serveur applicatif ne parvient pas à confirmer la disponibilité du service Supabase.",
    summaryEn: supabaseApiHealthy
      ? "The Supabase service responds from the application server."
      : "The application server cannot confirm Supabase service availability.",
    guidanceFr: "Vérifiez l'état du projet Supabase, le réseau sortant et la présence de la configuration serveur. N'affichez ni clé ni URL complète dans les rapports.",
    guidanceEn: "Check Supabase project status, outbound networking, and server configuration presence. Do not expose keys or full URLs in reports.",
    latencyMs: Date.now() - supabaseStarted,
  }));

  const dbStarted = Date.now();
  const databaseResult = await admin
    .from("organizations")
    .select("id", {count: "exact", head: true})
    .eq("id", organizationId);
  checks.push(check({
    id: "database",
    titleFr: "Base de données · PostgREST",
    titleEn: "Database · PostgREST",
    status: databaseResult.error ? "critical" : "healthy",
    summaryFr: databaseResult.error
      ? "La requête de contrôle vers la base Supabase n'a pas abouti."
      : "La base Supabase répond et l'organisation active est accessible.",
    summaryEn: databaseResult.error
      ? "The Supabase database probe did not complete successfully."
      : "The Supabase database responds and the active organization is accessible.",
    guidanceFr: "Vérifiez l'état du projet Supabase et la configuration serveur. Ne copiez aucune clé ni chaîne de connexion dans les tickets.",
    guidanceEn: "Check the Supabase project status and server configuration. Do not paste keys or connection strings into tickets.",
    latencyMs: Date.now() - dbStarted,
  }));

  const sessionClient = await createClient();
  const authStarted = Date.now();
  const authResult = await sessionClient.auth.getUser();
  const authHealthy = !authResult.error && authResult.data.user?.id === user.id;
  checks.push(check({
    id: "authentication",
    titleFr: "Authentification",
    titleEn: "Authentication",
    status: authHealthy ? "healthy" : "critical",
    summaryFr: authHealthy
      ? "La session serveur est valide et correspond à l'utilisateur connecté."
      : "La validation de la session serveur a échoué ou ne correspond pas à l'utilisateur attendu.",
    summaryEn: authHealthy
      ? "The server session is valid and matches the signed-in user."
      : "Server session validation failed or does not match the expected user.",
    guidanceFr: "Reconnectez l'utilisateur puis contrôlez les paramètres d'authentification Supabase si l'alerte persiste.",
    guidanceEn: "Sign the user in again, then review Supabase authentication settings if the alert persists.",
    latencyMs: Date.now() - authStarted,
  }));

  const isolationStarted = Date.now();
  const visibleMemberships = await sessionClient
    .from("organization_members")
    .select("organization_id,user_id,is_active")
    .eq("is_active", true);
  const visibleRows = rows(visibleMemberships.data as Array<{organization_id: string; user_id: string; is_active: boolean}> | null);
  const foreignTenantRows = visibleRows.filter((row) => row.organization_id !== organizationId);
  const userMembershipVisible = visibleRows.some((row) => row.user_id === user.id && row.organization_id === organizationId);
  const isolationHealthy = !visibleMemberships.error && userMembershipVisible && foreignTenantRows.length === 0;
  checks.push(check({
    id: "tenant-isolation",
    titleFr: "Isolation des organisations",
    titleEn: "Tenant isolation",
    status: isolationHealthy ? "healthy" : "critical",
    summaryFr: isolationHealthy
      ? "Le contrôle RLS ne retourne que les données de l'organisation active pour cette session."
      : "Le contrôle d'isolation n'a pas pu confirmer un périmètre strictement limité à l'organisation active.",
    summaryEn: isolationHealthy
      ? "The RLS probe only returns data belonging to the active organization for this session."
      : "The isolation probe could not confirm a scope strictly limited to the active organization.",
    guidanceFr: "Contrôlez les politiques RLS et les règles d'appartenance avant toute mise en production si ce statut devient critique.",
    guidanceEn: "Review RLS policies and membership rules before production if this becomes critical.",
    latencyMs: Date.now() - isolationStarted,
  }));

  const prismaInstalled = Boolean(
    (packageJson.dependencies as Record<string, string | undefined>)?.["@prisma/client"]
      || (packageJson.devDependencies as Record<string, string | undefined>)?.prisma,
  );
  const prismaConfigured = Boolean(process.env.DATABASE_URL);
  checks.push(check({
    id: "prisma",
    titleFr: "Prisma · transactions & pool",
    titleEn: "Prisma · transactions & pool",
    status: prismaInstalled && prismaConfigured ? "warning" : "warning",
    summaryFr: prismaInstalled && prismaConfigured
      ? "Prisma est détecté, mais ce build ne possède pas encore de sonde transaction/pool dédiée."
      : "Prisma n'est pas utilisé par cette version : Super Leader accède actuellement aux données via Supabase.",
    summaryEn: prismaInstalled && prismaConfigured
      ? "Prisma is detected, but this build does not yet include a dedicated transaction/pool probe."
      : "Prisma is not used by this version: Super Leader currently accesses data through Supabase.",
    guidanceFr: prismaInstalled && prismaConfigured
      ? "Ajoutez une sonde Prisma dédiée avant de considérer le pool comme vérifié."
      : "Aucune action requise tant que Prisma ne fait pas partie de l'architecture. Activez ce contrôle uniquement lors de son introduction.",
    guidanceEn: prismaInstalled && prismaConfigured
      ? "Add a dedicated Prisma probe before treating the pool as verified."
      : "No action is required while Prisma is not part of the architecture. Enable this probe when Prisma is introduced.",
    affectsOverall: false,
  }));

  const storageStarted = Date.now();
  const bucketResult = await admin.storage.listBuckets();
  const bucketExists = !bucketResult.error && rows(bucketResult.data).some((bucket) => bucket.name === PRIVATE_ATTACHMENTS_BUCKET);
  let storageReadable = false;
  if (bucketExists) {
    const listResult = await admin.storage.from(PRIVATE_ATTACHMENTS_BUCKET).list(organizationId, {limit: 1});
    storageReadable = !listResult.error;
  }
  const storageHealthy = bucketExists && storageReadable;
  checks.push(check({
    id: "document-storage",
    titleFr: "Stockage documentaire",
    titleEn: "Document storage",
    status: storageHealthy ? "healthy" : "critical",
    summaryFr: storageHealthy
      ? "Le stockage privé des documents est disponible et lisible pour l'organisation."
      : "Le bucket documentaire privé n'est pas disponible ou ne répond pas correctement.",
    summaryEn: storageHealthy
      ? "Private document storage is available and readable for the organization."
      : "The private document bucket is unavailable or not responding correctly.",
    guidanceFr: "Vérifiez le bucket privé et ses permissions côté Supabase Storage. Ne rendez pas le bucket public pour corriger cette alerte.",
    guidanceEn: "Check the private bucket and its Supabase Storage permissions. Do not make the bucket public to resolve this alert.",
    latencyMs: Date.now() - storageStarted,
  }));

  const schemaResult = await admin
    .from("system_schema_state")
    .select("app_version,migration_number,migration_name,applied_at")
    .eq("id", 1)
    .maybeSingle<{app_version: string; migration_number: number; migration_name: string; applied_at: string}>();
  const applicationVersion = String(packageJson.version ?? "unknown");
  const manifestVersion = String((versionManifest as {version?: string}).version ?? "unknown");
  const schemaAligned = !schemaResult.error
    && schemaResult.data?.migration_number === EXPECTED_MIGRATION_NUMBER
    && schemaResult.data?.migration_name === EXPECTED_MIGRATION_NAME
    && schemaResult.data?.app_version === applicationVersion
    && manifestVersion === applicationVersion;
  checks.push(check({
    id: "version-migrations",
    titleFr: "Version & migrations",
    titleEn: "Version & migrations",
    status: schemaAligned ? "healthy" : "critical",
    summaryFr: schemaAligned
      ? `Application ${applicationVersion} et migration ${EXPECTED_MIGRATION_NUMBER} alignées.`
      : "La version de l'application, le manifeste local et l'état des migrations ne sont pas alignés.",
    summaryEn: schemaAligned
      ? `Application ${applicationVersion} and migration ${EXPECTED_MIGRATION_NUMBER} are aligned.`
      : "The application version, local manifest, and migration state are not aligned.",
    guidanceFr: "Appliquez les migrations dans l'ordre et synchronisez package.json/VERSION.json. N'exécutez jamais une migration destructrice pour masquer un décalage.",
    guidanceEn: "Apply migrations in order and keep package.json/VERSION.json synchronized. Never run a destructive migration merely to hide a mismatch.",
    metric: schemaResult.data ? `DB ${schemaResult.data.migration_number} · App ${applicationVersion}` : `DB ? · App ${applicationVersion}`,
  }));

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const jobsResult = await admin
    .from("system_background_job_runs")
    .select("id,job_name,status,started_at,finished_at,duration_ms,error_summary,result_summary")
    .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
    .gte("started_at", twentyFourHoursAgo)
    .order("started_at", {ascending: false})
    .limit(20);
  const jobRows = rows(jobsResult.data as Array<Record<string, unknown>> | null);
  const failedJobs24h = jobRows.filter((row) => row.status === "failed").length;
  const warningJobs24h = jobRows.filter((row) => row.status === "warning").length;
  checks.push(check({
    id: "background-jobs",
    titleFr: "Tâches de fond",
    titleEn: "Background jobs",
    status: jobsResult.error ? "critical" : failedJobs24h > 0 ? "critical" : warningJobs24h > 0 ? "warning" : "healthy",
    summaryFr: jobsResult.error
      ? "Le journal des tâches de fond n'est pas disponible."
      : failedJobs24h > 0
        ? `${failedJobs24h} tâche(s) de fond ont échoué sur les dernières 24 h.`
        : warningJobs24h > 0
          ? `${warningJobs24h} tâche(s) de fond nécessitent une attention sur les dernières 24 h.`
          : "Aucun échec de tâche de fond enregistré sur les dernières 24 h.",
    summaryEn: jobsResult.error
      ? "The background-job journal is unavailable."
      : failedJobs24h > 0
        ? `${failedJobs24h} background job(s) failed in the last 24 hours.`
        : warningJobs24h > 0
          ? `${warningJobs24h} background job(s) need attention in the last 24 hours.`
          : "No background-job failures were recorded in the last 24 hours.",
    guidanceFr: "Consultez les exécutions récentes, corrigez la cause puis relancez le job concerné. Ne journalisez jamais de secret dans le motif d'échec.",
    guidanceEn: "Review recent runs, fix the cause, then rerun the affected job. Never log secrets in failure reasons.",
    metric: `${failedJobs24h} échec(s) · ${warningJobs24h} alerte(s)`,
  }));

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const incidentsResult = await admin
    .from("system_technical_incidents")
    .select("id,severity,source,title,summary,status,occurred_at,resolved_at")
    .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
    .gte("occurred_at", sevenDaysAgo)
    .order("occurred_at", {ascending: false})
    .limit(20);
  const incidentRows = rows(incidentsResult.data as Array<Record<string, unknown>> | null);
  const unresolved = incidentRows.filter((row) => row.status === "open");
  const openCritical = unresolved.filter((row) => row.severity === "critical").length;
  checks.push(check({
    id: "technical-incidents",
    titleFr: "Incidents techniques",
    titleEn: "Technical incidents",
    status: incidentsResult.error ? "critical" : openCritical > 0 ? "critical" : unresolved.length > 0 ? "warning" : "healthy",
    summaryFr: incidentsResult.error
      ? "Le journal des incidents techniques n'est pas disponible."
      : unresolved.length > 0
        ? `${unresolved.length} incident(s) technique(s) ouvert(s), dont ${openCritical} critique(s).`
        : "Aucun incident technique ouvert dans le journal récent.",
    summaryEn: incidentsResult.error
      ? "The technical-incident journal is unavailable."
      : unresolved.length > 0
        ? `${unresolved.length} technical incident(s) are open, including ${openCritical} critical.`
        : "No open technical incidents are present in the recent journal.",
    guidanceFr: "Traitez d'abord les incidents critiques, documentez la correction puis clôturez l'incident après vérification.",
    guidanceEn: "Address critical incidents first, document the fix, then resolve the incident after verification.",
    metric: `${unresolved.length} ouvert(s)`,
  }));

  const [landProductsResult, landOpportunitiesResult] = await Promise.all([
    admin.from("sales_products")
      .select("id,code,description,default_price,currency,is_active")
      .eq("organization_id", organizationId)
      .eq("sector", "land")
      .eq("is_active", true)
      .limit(1000),
    admin.from("crm_opportunities")
      .select("id,product_id,status,sector_details,value_amount,currency")
      .eq("organization_id", organizationId)
      .eq("sector", "land")
      .in("status", ["open", "on_hold"])
      .limit(1000),
  ]);
  const landProducts = rows(landProductsResult.data as Array<Record<string, unknown>> | null);
  const landOpportunities = rows(landOpportunitiesResult.data as Array<Record<string, unknown>> | null);
  const productIssues = landProducts.filter((row) => {
    const codeMissing = !String(row.code ?? "").trim();
    const descriptionMissing = !String(row.description ?? "").trim();
    const priceInvalid = numberValue(row.default_price) <= 0;
    const currencyInvalid = !/^[A-Z]{3}$/.test(String(row.currency ?? ""));
    return codeMissing || descriptionMissing || priceInvalid || currencyInvalid;
  }).length;
  const opportunityIssues = landOpportunities.filter((row) => {
    const details = objectValue(row.sector_details);
    const missingCoreDetails = !String(details.field_1 ?? "").trim()
      || !String(details.field_2 ?? "").trim()
      || !String(details.field_4 ?? "").trim();
    return !row.product_id || numberValue(row.value_amount) <= 0 || missingCoreDetails;
  }).length;
  const landQueryFailed = Boolean(landProductsResult.error || landOpportunitiesResult.error);
  const landIssueTotal = productIssues + opportunityIssues;
  checks.push(check({
    id: "land-data-quality",
    titleFr: "Qualité des données · Terrains",
    titleEn: "Land data quality",
    status: landQueryFailed ? "critical" : landIssueTotal > 0 ? "warning" : "healthy",
    summaryFr: landQueryFailed
      ? "Le contrôle qualité des données Terrains n'a pas pu être exécuté."
      : landIssueTotal > 0
        ? `${landIssueTotal} dossier(s) Terrain présentent des données essentielles incomplètes.`
        : "Les produits Terrain actifs et opportunités ouvertes contrôlés sont complets sur les champs essentiels.",
    summaryEn: landQueryFailed
      ? "The Land data-quality check could not be completed."
      : landIssueTotal > 0
        ? `${landIssueTotal} Land record(s) have incomplete essential data.`
        : "Checked active Land products and open opportunities are complete on essential fields.",
    guidanceFr: "Complétez en priorité le code, la description, le prix, la localisation, la superficie et la référence du lot. Ne corrigez pas automatiquement des données métier incertaines.",
    guidanceEn: "Prioritize code, description, price, location, surface area, and lot reference. Do not auto-correct uncertain business data.",
    metric: `${landProducts.length} produit(s) · ${landOpportunities.length} opportunité(s)`,
  }));

  const requiredStatuses = checks.filter((item) => item.affectsOverall !== false).map((item) => item.status);
  const overallStatus = worstStatus(requiredStatuses);

  const recentJobs: BackgroundJobRun[] = jobRows.slice(0, 10).map((row) => ({
    id: String(row.id),
    jobName: String(row.job_name),
    status: row.status === "failed" ? "failed" : row.status === "warning" ? "warning" : "success",
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : numberValue(row.duration_ms),
    summary: row.error_summary ? String(row.error_summary) : row.result_summary ? String(row.result_summary) : null,
  }));

  const recentIncidents: TechnicalIncident[] = incidentRows.slice(0, 10).map((row) => ({
    id: String(row.id),
    severity: row.severity === "critical" ? "critical" : row.severity === "warning" ? "warning" : "healthy",
    source: String(row.source),
    title: String(row.title),
    summary: row.summary ? String(row.summary) : null,
    status: row.status === "resolved" ? "resolved" : "open",
    occurredAt: String(row.occurred_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  }));

  return {
    checkedAt,
    overallStatus,
    checks,
    failedJobs24h,
    warningJobs24h,
    recentJobs,
    openIncidents: unresolved.length,
    recentIncidents,
    land: {
      activeProducts: landProducts.length,
      productIssues,
      openOpportunities: landOpportunities.length,
      opportunityIssues,
    },
    applicationVersion,
    manifestVersion,
    schemaMigration: schemaResult.data?.migration_name ?? null,
  };
}
