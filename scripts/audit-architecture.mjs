#!/usr/bin/env node
/**
 * Super Leader: read-only architecture checks.
 *
 * Usage:
 *   node scripts/audit-architecture.mjs
 *   node scripts/audit-architecture.mjs --strict
 *
 * No network access; no database requests; no file modifications.
 * Tests structure, not authorization, business correctness or runtime behavior.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const findings = [];
const found = (severity, code, message, details = undefined) =>
  findings.push({ severity, code, message, ...(details === undefined ? {} : { details }) });
const exists = relative => fs.existsSync(path.join(root, relative));
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
function walk(dir, collected = []) {
  if (!fs.existsSync(dir)) return collected;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, item.name);
    if (item.isDirectory() && !["node_modules", ".next", ".git"].includes(item.name)) walk(absolute, collected);
    else if (item.isFile()) collected.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return collected;
}

const all = walk(root);
const pages = all.filter(p => p.startsWith("src/app/dashboard/") && p.endsWith("/page.tsx"));
const api = all.filter(p => p.startsWith("src/app/api/") && p.endsWith("/route.ts"));
const actions = all.filter(p => p.startsWith("src/app/actions/") && p.endsWith(".ts"));
const tests = all.filter(p => p.includes("/__tests__/") || p.startsWith("tests/") || /\.(test|spec)\.[jt]sx?$/.test(p));
const workflowFiles = all.filter(p => p.startsWith(".github/workflows/"));
const sql = all.filter(p => p.endsWith(".sql"));
const relativeToRoute = file => "/dashboard" + file.slice("src/app/dashboard".length, -"/page.tsx".length);
const routes = new Set(pages.map(relativeToRoute));
const requiredRoutes = [
  "/dashboard", "/dashboard/my-day", "/dashboard/hr", "/dashboard/crm",
  "/dashboard/finance", "/dashboard/academy",
  "/dashboard/academy/students/finance-control", "/dashboard/admin/identity-audit",
  "/dashboard/canton-visitors",
];
for (const route of requiredRoutes) {
  if (!routes.has(route)) found("ERROR", "CRITICAL_ROUTE_MISSING", `Route critique absente : ${route}`);
}
if (pages.length < 134) found("ERROR", "ROUTE_COUNT_BELOW_GOLDEN", `Pages dashboard : ${pages.length} < 134 (Golden)`);
if (!exists("proxy.ts") && !exists("src/proxy.ts")) found("ERROR", "AUTH_PROXY_MISSING", "Aucun proxy Next.js détecté");
if (!exists("src/lib/navigation/dashboard-menu.ts")) found("ERROR", "MENU_REGISTRY_MISSING", "Registre de navigation introuvable");

if (exists("src/lib/navigation/dashboard-menu.ts")) {
  const menu = read("src/lib/navigation/dashboard-menu.ts");
  const hrefs = [...menu.matchAll(/href:\s*["'](\/dashboard[^"']+)["']/g)].map(m => m[1]);
  const isRegisteredRoute = target => [...routes].some(route => {
    if (target === route) return true;
    if (!route.includes("[")) return false;
    const source = route.split("/").map(segment =>
      /^\[[^/]+\]$/.test(segment) ? "[^/]+" : segment.replace(/[^a-zA-Z0-9_-]/g, "\\$&")
    ).join("/");
    return new RegExp("^" + source + "$").test(target);
  });
  const absentTargets = [...new Set(hrefs.map(h => h.split("?")[0]))].filter(h => !isRegisteredRoute(h));
  if (absentTargets.length) found("WARN", "MENU_LINKS_TO_REVIEW", "Liens de menu sans page directe (possibles alias)", absentTargets);
}

const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts || {};
if (!scripts.test) found("WARN", "NO_TEST_SCRIPT", "Aucune commande npm test déclarée.");
if (!scripts["typecheck"]) found("WARN", "NO_TYPECHECK_SCRIPT", "Aucune commande typecheck standardisée.");
if (!workflowFiles.length) found("WARN", "NO_CI_WORKFLOW", "Aucun workflow CI versionné.");
if (!tests.length) found("WARN", "NO_RECOGNIZED_TESTS", "Aucun test .test/.spec conventionnel trouvé.");
if (exists("next.config.ts") && /ignoreBuildErrors:\s*true/.test(read("next.config.ts")))
  found("WARN", "BUILD_SKIPS_TYPES", "Next.js ignore les erreurs TypeScript pendant le build.");
const floating = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter(([, value]) => value === "latest" || value === "*" || value === "next")
  .map(([name, value]) => `${name}@${value}`);
if (floating.length) found("WARN", "FLOATING_PACKAGE_VERSIONS", "Versions non épinglées dans package.json.", floating);
if (sql.length && !all.some(p => p.startsWith("supabase/migrations/")))
  found("WARN", "UNTRACKED_SCHEMA_HISTORY", "Scripts SQL présents, mais aucun dossier supabase/migrations détecté.");

const report = {
  reportVersion: 1, reference: "Golden V4.10.138 (structural floor, not a test)",
  metrics: { dashboardPages: pages.length, apiRoutes: api.length, serverActionFiles: actions.length,
    sqlFiles: sql.length, recognizedTests: tests.length, ciWorkflows: workflowFiles.length },
  severityCounts: {
    ERROR: findings.filter(x => x.severity === "ERROR").length,
    WARN: findings.filter(x => x.severity === "WARN").length,
  },
  findings,
  limitations: "Local static inspection only; does not test RLS, authorization, external services, DB schema compatibility, or page execution.",
};
console.log(JSON.stringify(report, null, 2));
if (report.severityCounts.ERROR || (strict && report.severityCounts.WARN)) process.exitCode = 1;
