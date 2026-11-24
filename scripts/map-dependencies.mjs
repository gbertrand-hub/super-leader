#!/usr/bin/env node
/**
 * Super Leader A2 — Static dependency map (read-only).
 * No database/network access, no file writes, no secrets read.
 *
 * Usage:
 *   node scripts/map-dependencies.mjs
 *   node scripts/map-dependencies.mjs --focus /dashboard/hr
 *   node scripts/map-dependencies.mjs --json
 *   node scripts/map-dependencies.mjs --impact src/lib/auth/permissions.ts
 *   node scripts/map-dependencies.mjs --unresolved
 *
 * Limitations: heuristic import and Supabase-call analysis. Runtime calls,
 * code generation, SQL in template strings, server actions invoked indirectly,
 * RLS, and actual permissions cannot be proven by this scanner.
 */
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const args = process.argv.slice(2);
const focus = args.includes("--focus") ? args[args.indexOf("--focus") + 1] : "";
const impactedFile = args.includes("--impact") ? args[args.indexOf("--impact") + 1] : "";
const listUnresolved = args.includes("--unresolved");
if (args.includes("--focus") && (!focus || focus.startsWith("--"))) {
  console.error("Usage: --focus /dashboard/hr");
  process.exit(2);
}
if (args.includes("--impact") && (!impactedFile || impactedFile.startsWith("--"))) {
  console.error("Usage: --impact src/lib/auth/permissions.ts");
  process.exit(2);
}
const asJson = args.includes("--json") || Boolean(focus) || Boolean(impactedFile) || listUnresolved;
const extensions = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
const toPosix = p => p.split(path.sep).join("/");
const canonical = p => toPosix(path.relative(cwd, p));
const known = new Set();
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", ".patch-backups"].includes(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() && /\.[jt]sx?$/.test(entry.name)) known.add(canonical(absolute));
  }
}
walk(path.join(cwd, "src"));
const code = new Map();
// The graph covers imported code only; layout/proxy are treated separately below.

const importPattern = /(?:^|\n)\s*(?:import|export)\s+(?:(?!\b(?:import|export)\s)[\s\S]){0,1400}?\bfrom\s*["']([^"']+)["']/g;
const sideEffectImportPattern = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const fromPattern = /\.from\s*\(\s*["']([a-zA-Z_][\w.]*)["']\s*\)/g;
const rpcPattern = /\.rpc\s*\(\s*["']([a-zA-Z_][\w.]*)["']\s*[,)]/g;
const runtimeTablePattern = /\.from\s*\(\s*(?!["'])[a-zA-Z_$]/g;
const authSignals = {
  authUser: /auth\.(?:getUser|getClaims|getSession)\s*\(/,
  membership: /\borganization_members\b|\bgetActiveOrganizationMembership\b/,
  roleRules: /\b(?:hasRole|canUseCommercialModules|normalizeOrganizationRole|roleCanOpenPath|getVisibleUserIds|canVerifySalesForFinance|canAccessAcademyFinanceControl|isPeopleAdmin)\b/,
  planFeatures: /\b(?:enforceOrganizationFeature|hasSubscriptionFeature|getOrganizationEntitlements|featureKey)\b/,
  siteAccess: /\b(?:visitor_site_staff|canton_reception_staff|assertCantonLive|cantonLiveEnabled)\b/,
};
function extractMatches(source, pattern) {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].map(x => x[1]);
}
function resolveLocal(from, spec) {
  let absolute;
  if (spec.startsWith("@/")) absolute = path.resolve(cwd, "src", spec.slice(2));
  else if (spec.startsWith(".")) absolute = path.resolve(cwd, path.dirname(from), spec);
  else return null;
  const relative = canonical(absolute);
  const candidates = [relative, ...extensions.map(ext => relative + ext)];
  return candidates.find(p => known.has(p)) || null;
}
function inspect(file) {
  if (code.has(file)) return code.get(file);
  const source = fs.readFileSync(path.join(cwd, file), "utf8");
  const specs = [...new Set([
    ...extractMatches(source, importPattern),
    ...extractMatches(source, sideEffectImportPattern),
    ...extractMatches(source, dynamicImportPattern),
  ])];
  const deps = [...new Set(specs.map(spec => resolveLocal(file, spec)).filter(Boolean))].sort();
  const unresolved = specs.filter(spec =>
    (spec.startsWith("@/") || spec.startsWith(".")) && !resolveLocal(file, spec)
  );
  const result = {
    imports: deps,
    unresolved,
    tables: [...new Set(extractMatches(source, fromPattern))].sort(),
    rpcs: [...new Set(extractMatches(source, rpcPattern))].sort(),
    dynamicTableCalls: [...source.matchAll(runtimeTablePattern)].length,
    auth: Object.fromEntries(Object.entries(authSignals).map(([k, re]) => [k, re.test(source)])),
  };
  code.set(file, result);
  return result;
}
const pageFiles = [...known].filter(p => p.startsWith("src/app/dashboard/") && p.endsWith("/page.tsx")).sort();
const apiFiles = [...known].filter(p => p.startsWith("src/app/api/") && p.endsWith("/route.ts")).sort();
const pageRoute = p => "/dashboard" + p.slice("src/app/dashboard".length, -"/page.tsx".length);
function reach(start) {
  const visited = new Set();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const imp of inspect(current).imports) if (!visited.has(imp)) stack.push(imp);
  }
  return visited;
}
const routes = [];
const dependents = new Map();
for (const file of pageFiles) {
  const reachable = reach(file);
  const tableNames = new Set(), rpcNames = new Set(), actionFiles = new Set(), componentFiles = new Set();
  const auth = Object.fromEntries(Object.keys(authSignals).map(k => [k, false]));
  const unresolved = new Set();
  let dynamicTableCalls = 0;
  for (const dep of reachable) {
    const item = inspect(dep);
    item.tables.forEach(t => tableNames.add(t));
    item.rpcs.forEach(r => rpcNames.add(r));
    item.unresolved.forEach(u => unresolved.add(u));
    dynamicTableCalls += item.dynamicTableCalls;
    Object.keys(auth).forEach(k => { if (item.auth[k]) auth[k] = true; });
    if (dep.startsWith("src/app/actions/")) actionFiles.add(dep);
    if (dep.startsWith("src/components/")) componentFiles.add(dep);
    if (!dependents.has(dep)) dependents.set(dep, new Set());
    dependents.get(dep).add(pageRoute(file));
  }
  routes.push({
    route: pageRoute(file), entry: file,
    directlyReferencedTables: inspect(file).tables,
    transitivelyReferencedTables: [...tableNames].sort(),
    transitivelyReferencedRpcs: [...rpcNames].sort(),
    actionFiles: [...actionFiles].sort(),
    componentFiles: [...componentFiles].sort(),
    authSignals: auth,
    unresolvedLocalImports: [...unresolved].sort(),
    dynamicTableCalls,
    reachableSourceFiles: reachable.size,
  });
}
// Routes inherit app-level and dashboard-level layout imports even though
// those imports do not appear in individual page source files. The proxy runs
// ahead of protected requests; its effect is global to dashboard routes.
const globalEntryFiles = ["src/app/layout.tsx", "src/app/dashboard/layout.tsx"].filter(file => known.has(file));
const globalReach = new Set();
for (const file of globalEntryFiles) {
  for (const dependency of reach(file)) globalReach.add(dependency);
}
const unresolvedDetails = routes
  .filter(row => row.unresolvedLocalImports.length)
  .map(row => ({ route: row.route, unresolvedImports: row.unresolvedLocalImports }));

let impact = null;
if (impactedFile) {
  const normalized = toPosix(path.normalize(impactedFile.replaceAll("\\", "/"))).replace(/^\.\//, "");
  const isProxy = normalized === "proxy.ts" || normalized === "src/proxy.ts";
  const isGlobal = isProxy || globalReach.has(normalized);
  const pageImpacts = isGlobal
    ? routes.map(row => row.route)
    : [...(dependents.get(normalized) || [])].sort();
  // API route imports are scanned separately: page import graphs do not
  // automatically capture calls made over HTTP.
  const apiImpacts = apiFiles.filter(file => {
    if (isProxy) return true;
    return reach(file).has(normalized);
  }).map(file => "/" + file.slice("src/app/".length, -"/route.ts".length));
  impact = {
    file: normalized,
    existsInTrackedSource: known.has(normalized) || isProxy,
    globalDashboardDependency: isGlobal,
    dashboardRoutesPotentiallyAffected: pageImpacts,
    apiRoutesPotentiallyAffected: apiImpacts,
    limitations: "Static imports only; dynamic imports, background jobs, server action entrypoints and remote API calls may require additional manual review.",
  };
}
const mostShared = [...dependents.entries()]
  .map(([file, pages]) => ({ file, pageCount: pages.size }))
  .filter(x => x.pageCount > 1 && !x.file.includes("/supabase/"))
  .sort((a, b) => b.pageCount - a.pageCount || a.file.localeCompare(b.file))
  .slice(0, 25);
const report = {
  analysis: "static import graph; potential dependencies, not proven runtime execution or authorization",
  reference: "Current local worktree; compare with Golden before release",
  metrics: {
    dashboardRoutes: routes.length,
    apiRoutes: apiFiles.length,
    analysedSourceFiles: code.size,
    routesWithUnresolvedLocalImports: routes.filter(x => x.unresolvedLocalImports.length).length,
    routesWithDynamicTableCalls: routes.filter(x => x.dynamicTableCalls > 0).length,
  },
  sharedFiles: mostShared,
  ...(impact ? { impact } : {}),
  ...(listUnresolved ? { unresolvedDetails } : {}),
  routes: focus ? routes.filter(r => r.route === focus || r.route.startsWith(focus + "/")) : (impact || listUnresolved ? [] : routes),
};
if (focus && !report.routes.length) {
  console.error("No route found for: " + focus);
  process.exitCode = 2;
}
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("SUPER LEADER A2 — STATIC DEPENDENCY MAP");
  console.log(JSON.stringify(report.metrics, null, 2));
  console.log("\nMost shared source files:");
  mostShared.slice(0, 15).forEach(x => console.log("  " + x.pageCount + " pages — " + x.file));
  console.log("\nCritical examples (direct + transitive table references):");
  for (const p of ["/dashboard/my-day", "/dashboard/hr", "/dashboard/crm", "/dashboard/finance", "/dashboard/academy/students/finance-control", "/dashboard/admin/identity-audit", "/dashboard/canton-visitors"]) {
    const row = routes.find(r => r.route === p);
    if (!row) continue;
    console.log("  " + p + " — " + row.transitivelyReferencedTables.length +
      " table references, " + row.actionFiles.length + " action files, " +
      row.unresolvedLocalImports.length + " unresolved imports");
  }
  if (unresolvedDetails.length) {
    console.log("\nRoutes to review for unresolved local imports:");
    for (const issue of unresolvedDetails) console.log("  " + issue.route + " — " + issue.unresolvedImports.join(", "));
  }
  console.log("\nLIMITATIONS: references are inferred; no Supabase/production calls are made.");
}
