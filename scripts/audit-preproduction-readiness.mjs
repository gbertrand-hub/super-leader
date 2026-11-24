#!/usr/bin/env node
/**
 * Super Leader B2: offline preproduction readiness against a dated metadata snapshot.
 * Does not connect to Supabase or modify any data.
 *
 * node scripts/audit-preproduction-readiness.mjs
 * node scripts/audit-preproduction-readiness.mjs --json
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const baselinePath = path.join(root, "docs/preproduction-schema-metadata-baseline-v4-10-141.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const migrationsFolder = path.join(root, "supabase/migrations");
const tracked = fs.existsSync(migrationsFolder)
  ? fs.readdirSync(migrationsFolder).filter(name => /^\d{14}_.+\.sql$/.test(name)).sort()
  : [];
const versions = tracked.map(name => name.replace(/\.sql$/, ""));
const prod = baseline.production.migrationVersions;
const documentedOnlyInDb = prod.filter(version => !versions.includes(version));
const documentedOnlyInRepo = versions.filter(version => !prod.includes(version));
const report = {
  report: "Super Leader preproduction schema readiness",
  baselineDate: baseline.capturedOn,
  source: "dated metadata snapshot, NOT a live Supabase inspection",
  checks: {
    productionPublicTables: baseline.production.publicTables,
    cantonQaPublicTables: baseline.cantonQa.publicTables,
    productionMigrationHistory: prod.length,
    trackedTimestampedMigrations: versions.length,
    productionRecordedMigrationsMissingFromRepo: documentedOnlyInDb,
    trackedMigrationsNotRecordedInSnapshot: documentedOnlyInRepo,
    cantonQaBranchStatusAtCapture: baseline.cantonQa.supabaseBranchStatus,
    publicRlsTablesWithoutExplicitPolicies: baseline.production.publicTablesWithoutExplicitPolicies,
    publicSecurityDefinersCallableByAnon: baseline.production.securityDefinerCallableByAnon,
    publicSecurityDefinersCallableByAnonNonTrigger: baseline.production.securityDefinerCallableByAnonNonTrigger,
  },
  gates: {
    safeForAutomaticSchemaReplay: false,
    preproductionIntegratedTestsReady: false,
    reason: "No verified schema-only reproducible restore yet. Migration histories differ and existing Canton QA has an incomplete schema.",
  },
  explanations: [
    "Missing migration files do not establish which DDL changes are missing from the current database.",
    "An RLS-enabled table with no explicit policy can deny access; this is a review signal, not a confirmed leak.",
    "EXECUTE permission on a SECURITY DEFINER function does not by itself demonstrate exploitability; review functions individually, starting with non-trigger functions.",
    "This audit does not probe production, invoke RPCs or access customer records.",
  ],
};
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log("SUPER LEADER B2 — PREPRODUCTION READINESS (OFFLINE)");
  console.log(JSON.stringify(report.checks, null, 2));
  console.log("\nGATES: NOT READY FOR AUTOMATED SCHEMA REPLAY / INTEGRATION TESTS");
  console.log(report.gates.reason);
  console.log("No changes made.");
}
