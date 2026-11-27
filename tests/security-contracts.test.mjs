import test from "node:test";
import assert from "node:assert/strict";
import * as permissions from "../src/lib/auth/permissions.ts";
import {readTemporaryAccessState} from "../src/lib/auth/temporary-access.ts";
import {normalizeTimeZone} from "../src/lib/timezone.ts";
import {cantonLiveEnabled, cantonProductionEnabled, cantonUiPreviewEnabled, assertCantonLive} from "../src/lib/canton/feature-gate.ts";
import {canVerifySalesForFinance, canManageSensitiveFinanceData} from "../src/lib/auth/sensitive-finance-access.ts";
import {getFinanceCustomerAccountAccess} from "../src/lib/auth/finance-customer-account-access.ts";

const ORG = "synthetic-org", USER = "synthetic-user";
function fakeDb(data = {}) {
  const calls = [];
  return {calls, from(table) {
    const filters = [];
    const query = {
      select(value) {filters.push(["select", value]); return query;},
      eq(key, value) {filters.push([key, value]); return query;},
      maybeSingle() {
        calls.push({table, filters: [...filters]});
        return Promise.resolve(data[table] ?? {data: null, error: null});
      },
      then(resolve, reject) {
        calls.push({table, filters: [...filters]});
        return Promise.resolve(data[table] ?? {data: [], error: null}).then(resolve, reject);
      },
    };
    return query;
  }};
}
function assertOrgFilters(db) {
  for (const call of db.calls) {
    assert.ok(call.filters.some(([key, value]) =>
      (key === "organization_id" || key === "teams.organization_id") && value === ORG),
      "Missing organization scope on " + call.table);
  }
}
async function withEnv(values, fn) {
  const keys = ["VERCEL_ENV", "NEXT_PUBLIC_SUPABASE_URL", "VERCEL_GIT_COMMIT_REF", "CANTON_VISITOR_ENABLE_LIVE",
    "CANTON_TEST_DATABASE_READY", "CANTON_PRODUCTION_DATABASE_READY", "CANTON_PRODUCTION_RELEASE_APPROVED",
    "CANTON_LOCAL_UI_PREVIEW"];
  const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, values);
    await fn();
  } finally {
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}

test("role management boundaries remain explicit", () => {
  assert.equal(permissions.canManageTeamStructure("hr"), false);
  assert.equal(permissions.canManageTeamAssignments("hr"), true);
  assert.equal(permissions.canManageTeamMembers("manager"), true);
  assert.equal(permissions.canManageTeamMembers("employee"), false);
  assert.equal(permissions.canBeAssignedTeamManager("executive"), true);
  assert.equal(permissions.canManageCommercialData("manager"), true);
  assert.equal(permissions.canManageCommercialData("employee"), false);
  assert.equal(permissions.canManageFinance("executive"), false);
  assert.equal(permissions.canManageProducts("manager"), false);
});

test("temporary password expiry boundary is deterministic", () => {
  const deadline = Date.parse("2026-11-24T17:00:00Z");
  const meta = {must_change_password: true, temporary_password_expires_at: "2026-11-24T17:00:00Z"};
  assert.equal(readTemporaryAccessState(meta, deadline - 1).expired, false);
  assert.equal(readTemporaryAccessState(meta, deadline).expired, true);
  assert.equal(readTemporaryAccessState({...meta, must_change_password: false}, deadline + 1).expired, false);
  assert.equal(readTemporaryAccessState(null, deadline).mustChangePassword, false);
});

test("global time zone aliases and fallback are preserved", () => {
  assert.equal(normalizeTimeZone("Dallas"), "America/Chicago");
  assert.equal(normalizeTimeZone("cameroun"), "Africa/Douala");
  assert.equal(normalizeTimeZone("Invalid/Timezone", "Europe/Paris"), "Europe/Paris");
  assert.equal(normalizeTimeZone("", "Invalid/Timezone"), "Europe/Dublin");
});

test("Canton production requires target database and three independent approvals", async () => {
  const base = {VERCEL_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://jjbuxrlvxnlnrjcorpwt.supabase.co",
    CANTON_VISITOR_ENABLE_LIVE: "true",
    CANTON_PRODUCTION_DATABASE_READY: "true",
    CANTON_PRODUCTION_RELEASE_APPROVED: "true"};
  await withEnv({}, () => {assert.equal(cantonLiveEnabled(), false); assert.throws(assertCantonLive);});
  for (const key of ["CANTON_VISITOR_ENABLE_LIVE", "CANTON_PRODUCTION_DATABASE_READY", "CANTON_PRODUCTION_RELEASE_APPROVED"]) {
    await withEnv({...base, [key]: "false"}, () => assert.equal(cantonLiveEnabled(), false, key));
  }
  await withEnv({...base, NEXT_PUBLIC_SUPABASE_URL: "https://xehstmnqljjhacjiukvc.supabase.co"},
    () => assert.equal(cantonProductionEnabled(), false));
  await withEnv(base, () => {assert.equal(cantonLiveEnabled(), true); assert.doesNotThrow(assertCantonLive);});
});

test("Canton QA cannot be activated by unrelated branches or UI-only preview", async () => {
  const qa = {VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://xehstmnqljjhacjiukvc.supabase.co",
    VERCEL_GIT_COMMIT_REF: "feature/canton-visitor-v4-10-132",
    CANTON_VISITOR_ENABLE_LIVE: "true", CANTON_TEST_DATABASE_READY: "true"};
  await withEnv({...qa, VERCEL_GIT_COMMIT_REF: "feature/other"},
    () => assert.equal(cantonLiveEnabled(), false));
  await withEnv(qa, () => assert.equal(cantonLiveEnabled(), true));
  await withEnv({...qa, VERCEL_GIT_COMMIT_REF: "qa/canton-v4-10-141-integration"},
    () => assert.equal(cantonLiveEnabled(), true));
  await withEnv({...qa, VERCEL_GIT_COMMIT_REF: "qa/canton-v4-10-141-integration-evil"},
    () => assert.equal(cantonLiveEnabled(), false));
  await withEnv({CANTON_LOCAL_UI_PREVIEW: "true"}, () => {
    assert.equal(cantonUiPreviewEnabled(), true);
    assert.equal(cantonLiveEnabled(), false);
    assert.throws(assertCantonLive);
  });
});

test("sales finance verification checks scoped teams and denies query errors", async () => {
  const owner = fakeDb();
  assert.equal(await canVerifySalesForFinance(owner, ORG, USER, "owner"), true);
  assert.equal(owner.calls.length, 0);
  const finance = fakeDb({teams: {data: [{department: " Finances "}], error: null}});
  assert.equal(await canVerifySalesForFinance(finance, ORG, USER, "manager"), true);
  assertOrgFilters(finance);
  const sales = fakeDb({teams: {data: [{department: "sales"}], error: null}});
  assert.equal(await canVerifySalesForFinance(sales, ORG, USER, "manager"), false);
  const error = fakeDb({teams: {data: null, error: {message: "unavailable"}}});
  assert.equal(await canVerifySalesForFinance(error, ORG, USER, "manager"), false);
});

test("sensitive finance access denies unrelated employees and failed lookups", async () => {
  assert.equal(await canManageSensitiveFinanceData(fakeDb(), ORG, USER, "hr"), true);
  assert.equal(await canManageSensitiveFinanceData(fakeDb(), ORG, USER, "employee"), false);
  const managerFinance = fakeDb({teams: {data: [{department: "finance"}], error: null}});
  assert.equal(await canManageSensitiveFinanceData(managerFinance, ORG, USER, "manager"), true);
  assertOrgFilters(managerFinance);
  const error = fakeDb({teams: {data: null, error: {message: "unavailable"}}});
  assert.equal(await canManageSensitiveFinanceData(error, ORG, USER, "manager"), false);
});

test("customer finance selected-users mode respects explicit user list", async () => {
  const settings = {data: {customer_account_access_mode: "selected_users", customer_account_user_ids: ["synthetic-user-2"]}, error: null};
  const db = fakeDb({finance_settings: settings});
  assert.deepEqual(await getFinanceCustomerAccountAccess(db, ORG, USER, "employee"),
    {allowed: false, mode: "selected_users"});
  assertOrgFilters(db);
  const user2 = fakeDb({finance_settings: settings});
  assert.deepEqual(await getFinanceCustomerAccountAccess(user2, ORG, "synthetic-user-2", "employee"),
    {allowed: true, mode: "selected_users"});
  const exec = fakeDb();
  assert.deepEqual(await getFinanceCustomerAccountAccess(exec, ORG, USER, "executive"),
    {allowed: true, mode: "leadership"});
  assert.equal(exec.calls.length, 0);
});

test("customer finance team mode uses organization-scoped team membership", async () => {
  const db = fakeDb({
    finance_settings: {data: null, error: null},
    teams: {data: [], error: null},
    team_members: {data: [{teams: {department: "finance"}}], error: null},
  });
  assert.deepEqual(await getFinanceCustomerAccountAccess(db, ORG, USER, "employee"),
    {allowed: true, mode: "finance_team"});
  assertOrgFilters(db);
  const denied = fakeDb();
  assert.deepEqual(await getFinanceCustomerAccountAccess(denied, ORG, USER, "employee"),
    {allowed: false, mode: "finance_team"});
});
