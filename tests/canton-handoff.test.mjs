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

test("Canton QR staff forms preserve the selected view and site", () => {
 const qr = read("src/app/actions/canton-qr.ts");
 assert.match(qr, /const safeStaffReturn=/);
 assert.match(qr, /params\.get\("view"\)!==view/);
 assert.match(qr, /site!=="all"&&!uuid\(site\)/);
 assert.match(qr, /const back=safeStaffReturn\(value\(f,"returnTo",500\),"admin"\)/);
 assert.match(qr, /const back=safeStaffReturn\(value\(f,"returnTo",500\),"reception"\)/);
 assert.match(qr, /success\(back,"QR request "/);
 assert.match(page, /action=\{reviewCantonQrIntake\}[^>]*><input type="hidden" name="returnTo" value=\{routeByView\.reception/);
 assert.match(page, /action=\{createCantonQrSite\}[^>]*><input type="hidden" name="returnTo" value=\{routeByView\.admin/);
 assert.match(page, /action=\{updateCantonQrSiteAddress\}[^>]*><input type="hidden" name="returnTo" value=\{routeByView\.admin/);
});

test("Canton isolated browser simulator covers tabs, site and reassignment without backend calls", () => {
 const sim=read("src/app/canton-demo/simulator.tsx");
 const route=read("src/app/canton-demo/page.tsx");
 assert.match(sim, /const \[view,setView\]=useState<View>\("dashboard"\)/);
 assert.match(sim, /const \[site,setSite\]=useState/);
 assert.match(sim, /const \[owner,setOwner\]=useState/);
 assert.match(sim, /const \[showQr,setShowQr\]=useState\(false\)/);
 assert.match(sim, /commercial:\["Suivi commercial","Commercial follow-up"\]/);
 assert.match(sim, /onClick=\{\(\)=>setPage\(p\)\}/);
 assert.match(sim, /setFollowupOpen\(false\)/);
 assert.match(sim, /SIMULATION LOCALE/);
 assert.doesNotMatch(sim, /createAdminClient|createClient\(|from\("@\/app\/actions|fetch\(/);
 assert.match(route, /process\.env\.NODE_ENV!=="development"/);
});

test("Canton demo requires explicit reassignment confirmation and records receipt timestamps", () => {
 const sim=read("src/app/canton-demo/simulator.tsx");
 assert.match(sim, /const \[selectedOwner,setSelectedOwner\]=useState/);
 assert.match(sim, /disabled=\{selectedOwner===owner\}/);
 assert.match(sim, /setOwner\(selectedOwner\)/);
 assert.match(sim, /const \[checkInAt,setCheckInAt\]=useState/);
 assert.match(sim, /const \[checkOutAt,setCheckOutAt\]=useState/);
 assert.match(sim, /setCheckInAt\(new Date\(\)\.toISOString\(\)\)/);
 assert.match(sim, /setCheckOutAt\(new Date\(\)\.toISOString\(\)\)/);
 assert.match(sim, /timeZone:"America\/Chicago"/);
});

test("Canton demo supports session-only scheduled appointments, walk-ins and deduplication", () => {
 const desk=read("src/components/canton/canton-demo-visits.tsx");
 const sim=read("src/app/canton-demo/simulator.tsx");
 assert.match(desk, /export function CantonDemoAppointmentDesk/);
 assert.match(desk, /export function CantonDemoReceptionQueue/);
 assert.match(desk, /mode==="walkin"\?"arrived":"scheduled"/);
 assert.match(desk, /const duplicate=here\.some/);
 assert.match(desk, /v\.status!=="completed"/);
 assert.match(desk, /digits\(v\.phone\)===digits\(phone\)/);
 assert.match(desk, /onChange\(v\.id,"pending"\)/);
 assert.match(desk, /onChange\(v\.id,"arrived"\)/);
 assert.match(desk, /onChange\(v\.id,"completed"\)/);
 assert.match(sim, /<CantonDemoAppointmentDesk/);
 assert.match(sim, /<CantonDemoReceptionQueue/);
 assert.match(sim, /setAdditionalVisits\(\[\]\)/);
 assert.doesNotMatch(desk, /createAdminClient|createClient\(|fetch\(|supabase|@\/app\/actions/);
});

test("Canton mock visitor entries persist in browser session only and reset removes them", () => {
 const sim=read("src/app/canton-demo/simulator.tsx");
 assert.match(sim, /const DEMO_VISITS_KEY=/);
 assert.match(sim, /function decodeSavedVisits\(raw:string\|null\):DemoVisit\[\]/);
 assert.match(sim, /\.filter\(validDemoVisit\)/);
 assert.match(sim, /window\.sessionStorage\.getItem\(DEMO_VISITS_KEY\)/);
 assert.match(sim, /if\(!demoStorageReady\)return/);
 assert.match(sim, /window\.sessionStorage\.setItem\(DEMO_VISITS_KEY/);
 assert.match(sim, /window\.sessionStorage\.removeItem\(DEMO_VISITS_KEY\)/);
 assert.doesNotMatch(sim, /window\.localStorage/);
});

test("Canton mock feedback is scoped to the selected completed visit and persists in session", () => {
 const sim=read("src/app/canton-demo/simulator.tsx");
 const desk=read("src/components/canton/canton-demo-visits.tsx");
 assert.match(desk, /feedbackRating\?:number\|null/);
 assert.match(desk, /onFeedback:\(id:string\)=>void/);
 assert.match(desk, /v\.status==="completed"/);
 assert.match(sim, /setFeedbackVisitId\(id\)/);
 assert.match(sim, /item\.id===v\.id&&item\.status==="completed"&&!item\.feedbackRating/);
 assert.match(sim, /feedbackRating:rating,feedbackComment:feedbackComment\.trim\(\)/);
 assert.match(sim, /JSON\.stringify\(additionalVisits\.slice\(0,100\)\)/);
});
test("Real Canton management integrates visit-linked feedback without permitting duplicate invitation controls", () => {
 const page=read("src/app/dashboard/canton-visitors/page.tsx");
 const start=page.indexOf('data-canton-live-feedback-review="true"');
 assert.ok(start>0,"Real Canton visit-linked feedback panel exists");
 assert.match(page, /\.select\("appointment_id,rating,contact_requested,submitted_at,comment"\)/);
 assert.match(page, /const feedbackByVisit=new Map/);
 assert.match(page, /data-canton-view="feedback" className=/);
 assert.match(page, /receivedFeedback\.length/);
 assert.match(page, /item\.appointment_id/);
 assert.match(page, /item\.comment&&/);
 assert.match(page, /item\.contact_requested&&/);
 assert.match(page, /\.find\(s=>s\.id===visit\.site_id\)/);
 assert.match(page, /!feedbackByVisit\.has\(x\.appointment_id\)/);
 assert.match(page, /\(isSenior\|\|isManager\)&&<section data-canton-view="feedback"/);
 const gate=read("src/lib/canton/feature-gate.ts");
 assert.match(gate, /process\.env\.CANTON_PRODUCTION_RELEASE_APPROVED === "true"/);
});
test("Canton visual simulation has a single visit-linked feedback workflow and no sticky overlapping tabs", () => {
 const sim=read("src/app/canton-demo/simulator.tsx");
 assert.doesNotMatch(sim, /Record feedback \(simulation\)|Enregistrer l'avis \(simulation\)/);
 assert.doesNotMatch(sim, /sticky top-0 z-10 overflow-x-auto/);
 assert.match(sim, /!additionalVisits\.some\(v=>v\.site===site&&v\.status==="completed"\)/);
});
test("Canton rollout remains fail-closed until target Supabase and release gates are configured", () => {
  const gate = read("src/lib/canton/feature-gate.ts");
  assert.match(gate, /export function assertCantonLive/);
  assert.match(gate, /CANTON_PRODUCTION_DATABASE_READY/);
  assert.match(gate, /CANTON_PRODUCTION_RELEASE_APPROVED/);
  assert.match(gate, /return cantonLiveEnabled\(\)/);
});
