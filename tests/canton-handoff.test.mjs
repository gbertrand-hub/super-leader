import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = filename => fs.readFileSync(path.join(root, filename), "utf8");
const actions = read("src/app/actions/canton-visitors.ts");
const page = read("src/app/dashboard/canton-visitors/page.tsx");

test("Canton next-action reassignment is role, organization, site and status scoped", () => {
  const start = actions.indexOf("export async function reassignCantonNextAction(");
  const end = actions.indexOf("export async function completeCantonNextAction(", start);
  assert.ok(start >= 0 && end > start, "Reassignment server action exists");
  const body = actions.slice(start, end);
  assert.match(body, /assertCantonLive\(\)/);
  assert.match(body, /\["owner","admin","manager"\]\.includes\(role\)/);
  assert.match(body, /\.eq\("organization_id",org\)/);
  assert.match(body, /\.eq\("is_active",true\)/);
  assert.match(body, /await requireVisitorSiteAccess\(ctx,visit\.site_id\)/);
  assert.match(body, /action\.status!=="open"/);
  assert.match(body, /visit\.status!=="completed"/);
  assert.match(body, /\["DIG","TCF"\]\.includes\(visit\.department\)/);
  assert.match(body, /\.eq\("status","open"\)/);
  assert.match(body, /\.eq\("assigned_to",action\.assigned_to\)/);
  assert.match(body, /\.is\("assigned_to",null\)/);
  assert.doesNotMatch(body, /\.from\("canton_appointments"\)\.update/);
  assert.doesNotMatch(body, /sendCantonQaFeedbackEmail|sendWhatsApp/);
});

test("Canton UI provides bilingual reassignment and validated completion", () => {
  assert.match(page, /action=\{reassignCantonNextAction\}/);
  assert.match(page, /fr\?"Réattribuer":"Reassign"/);
  assert.match(page, /fr\?"Responsable actuel":"Current owner"/);
  assert.match(page, /fr\?"Réattribuer le suivi":"Reassign follow-up"/);
  assert.match(page, /action=\{completeCantonFollowUp\}/);
  assert.match(page, /required minLength=\{5\} maxLength=\{1000\} rows=\{2\} name="resultNote"/);
  assert.match(page, /name="outcome" defaultValue=""/);
  assert.match(page, /href=\{card\.href\+"&site="\+encodeURIComponent\(selectedSiteId\)\}/);
  assert.match(page, /<details className="rounded-xl border bg-white">\s*<summary/);
});

test("Canton reception search retains selected view and site", () => {
  assert.match(page, /<form method="get" action="\/dashboard\/canton-visitors"[^>]*><input type="hidden" name="view" value="reception"\/><input type="hidden" name="site" value=\{selectedSiteId\}\/>/);
  assert.match(page, /href=\{routeByView\.reception\+"&site="\+encodeURIComponent\(selectedSiteId\)\}/);
  assert.match(page, /aria-current=\{activeView===item\.id\?"page":undefined\}/);
});

test("Canton rollout remains fail-closed until target Supabase and release gates are configured", () => {
  const gate = read("src/lib/canton/feature-gate.ts");
  assert.match(gate, /export function assertCantonLive/);
  assert.match(gate, /CANTON_PRODUCTION_DATABASE_READY/);
  assert.match(gate, /CANTON_PRODUCTION_RELEASE_APPROVED/);
  assert.match(gate, /return cantonLiveEnabled\(\)/);
});
