import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const page = read('src/app/dashboard/canton-visitors/page.tsx');
const actions = read('src/app/actions/canton-visitors.ts');
const qr = read('src/app/actions/canton-qr.ts');
const recovery = read('src/app/actions/canton-next-action-recovery.ts');
function body(name) {
  const start = actions.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `missing function: ${name}`);
  const end = actions.indexOf('export async function ', start + 25);
  return actions.slice(start, end < 0 ? actions.length : end);
}

test('unassigned users cannot inherit Canton HQ simply by viewing the page', () => {
  assert.match(page, /!isSenior\s*&&\s*!selectedSiteId/);
  assert.doesNotMatch(page, /visitorSites\?\.\[0\]\?\.id\s*\|\|\s*hqSite\?\.id/);
});

test('office-scoped reception can use existing local reception tab', () => {
  assert.match(page, /access_role\s*===\s*"reception"\)\) isReception=true/);
  assert.match(actions, /access_role","reception"/);
});

test('QR intake records are fetched for visible reception-point IDs only', () => {
  assert.match(page, /qrSitesQuery=qrSitesQuery\.eq\("visitor_site_id",selectedSiteId\)/);
  assert.match(page, /\.in\("site_id",visibleQrSiteIds\)/);
  assert.match(page, /visibleQrSiteIds\.length>0/);
});

test('site manager assignment menus cannot show other-office members', () => {
  assert.match(page, /const assignableMembers=isSenior\?\(members\|\|\[\]\):\(members\|\|\[\]\)\.filter\(m=>selectedSiteHostIds\.has\(m\.user_id\)\)/);
  assert.equal((page.match(/\{assignableMembers\.map\(m=><option/g) || []).length, 3);
});

test('eight operational write actions check the appointment site, not just organization membership', () => {
  for (const name of ['qualifyCantonLegacyProspect','saveCantonVisitDebrief','assignCantonFollowUp',
    'completeCantonFollowUp','createCantonNextAction','completeCantonNextAction',
    'createCantonSlaRecovery','completeCantonSlaRecovery']) {
    const s = body(name);
    assert.match(s, /await requireVisitorSiteAccess\(ctx,(visit|row)!?\.site_id\)/, `${name} needs site guard`);
    assert.match(s, /\.eq\("organization_id",org\)/, `${name} needs org filter`);
  }
});

test('reassignment checks both actor site and target site unless admin', () => {
  const s=body('reassignCantonNextAction');
  assert.match(s,/await requireVisitorSiteAccess\(ctx,visit\.site_id\)/);
  assert.match(s,/\.eq\("site_id",visit\.site_id\)\.eq\("user_id",ownerId\)/);
});

test('an active org manager cannot approve a QR request belonging to another visitor office', () => {
  const s=qr.slice(qr.indexOf('export async function reviewCantonQrIntake('),qr.indexOf('export async function submitCantonQrFeedback('));
  assert.match(s,/\.select\("id,site_id,status/);
  assert.match(s,/\.eq\("id",request\.site_id\)\.eq\("organization_id",org\)/);
  assert.match(s,/qrSite!?\.visitor_site_id/);
  assert.match(s,/This QR request belongs to another office/);
  assert.ok(s.indexOf('This QR request belongs to another office') < s.indexOf('canton_approve_qr_intake'));
});

test('QA-wide invitation simulator is limited to admins, and SLA dates use actual digits',()=>{
  assert.match(body('simulateCantonFeedbackInvitations'),/if\(!seniorRoles\.has\(role\)\)fail\("Administrator permission required/);
  assert.match(body('createCantonSlaRecovery'),/!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//);
});

test('recovery keeps site-scoped manager checks and original SLA history', () => {
  assert.match(recovery, /if \(manager && !senior\)/);
  assert.match(recovery, /otherSiteRole|anyStaff/);
  assert.match(recovery, /Historical SLA remains anchored to the original visit/);
});
