import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runJsonScript(script, ...args) {
  const output = execFileSync(process.execPath, [script, ...args], {
    cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(output);
}

test("unknown organization roles cannot become privileged roles", async () => {
  const p = await import("../src/lib/auth/permissions.ts");
  for (const candidate of [null, undefined, "", "superadmin", "Owner", "administrator"]) {
    assert.equal(p.normalizeOrganizationRole(candidate), "employee");
    assert.equal(p.hasOrganizationWideAccess(candidate), false);
    assert.equal(p.isPeopleAdmin(candidate), false);
    assert.equal(p.canManageFinance(candidate), false);
  }
});

test("organization-wide and HR authorizations remain deliberately different", async () => {
  const p = await import("../src/lib/auth/permissions.ts");
  for (const role of ["owner", "admin"]) {
    assert.equal(p.hasOrganizationWideAccess(role), true, role);
    assert.equal(p.canManageFinance(role), true, role);
    assert.equal(p.isPeopleAdmin(role), true, role);
  }
  assert.equal(p.isPeopleAdmin("hr"), true);
  assert.equal(p.canManageTeamAssignments("hr"), true);
  assert.equal(p.hasOrganizationWideAccess("hr"), false);
  assert.equal(p.canManageFinance("hr"), false);
  for (const role of ["manager", "employee"]) {
    assert.equal(p.isPeopleAdmin(role), false, role);
    assert.equal(p.canManageFinance(role), false, role);
  }
});

test("structural Golden baselines contain no regression errors", () => {
  const output = execFileSync(process.execPath, ["scripts/audit-architecture.mjs"], {
    cwd: root, encoding: "utf8",
  });
  const match = output.match(/^\{[\s\S]*?\n\}(?=\n)/);
  assert.ok(match, "architecture scanner must emit JSON report");
  const report = JSON.parse(match[0]);
  assert.equal(report.severityCounts.ERROR, 0, JSON.stringify(report.findings));
  assert.ok(report.metrics.dashboardPages >= 134);
  assert.ok(report.metrics.apiRoutes >= 40);
});

test("dependency map resolves local imports including root JSON manifests", () => {
  const report = runJsonScript("scripts/map-dependencies.mjs", "--unresolved");
  assert.equal(report.metrics.dashboardRoutes >= 134, true);
  assert.deepEqual(report.unresolvedDetails, []);
});

test("role-permission changes report HR, CRM and user-day risk", () => {
  const report = runJsonScript("scripts/map-dependencies.mjs", "--impact", "src/lib/auth/permissions.ts");
  const impact = report.impact;
  assert.ok(impact.existsInTrackedSource);
  assert.ok(impact.dashboardRoutesPotentiallyAffected.length >= 3);
  for (const route of ["/dashboard/my-day", "/dashboard/hr", "/dashboard/crm"]) {
    assert.ok(impact.dashboardRoutesPotentiallyAffected.includes(route), route);
  }
  assert.ok(impact.apiRoutesPotentiallyAffected.length > 0);
});

test("shared request proxy is treated as an application-wide risk", () => {
  const report = runJsonScript("scripts/map-dependencies.mjs", "--impact", "proxy.ts");
  assert.equal(report.impact.globalDashboardDependency, true);
  assert.equal(report.impact.dashboardRoutesPotentiallyAffected.length, report.metrics.dashboardRoutes);
  assert.equal(report.impact.apiRoutesPotentiallyAffected.length, report.metrics.apiRoutes);
});

test("HR and My Day schema dependencies are visible before release", () => {
  const hr = runJsonScript("scripts/map-dependencies.mjs", "--focus", "/dashboard/hr");
  const day = runJsonScript("scripts/map-dependencies.mjs", "--focus", "/dashboard/my-day");
  assert.ok(hr.routes.some(r => r.route === "/dashboard/hr" &&
    r.transitivelyReferencedTables.includes("performance_settings")));
  assert.ok(day.routes.some(r => r.route === "/dashboard/my-day" &&
    r.transitivelyReferencedTables.includes("daily_report_reopenings")));
});
