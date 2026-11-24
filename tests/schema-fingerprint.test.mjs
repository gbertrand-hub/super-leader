import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prod = "docs/schema-fingerprints/production-2026-11-24.json";
const canton = "docs/schema-fingerprints/canton-qa-2026-11-24.json";
function compare(a,b) {
  const raw=execFileSync(process.execPath,["scripts/compare-schema-fingerprints.mjs",a,b,"--json"],{cwd:root,encoding:"utf8",maxBuffer:10485760});
  return JSON.parse(raw);
}
test("schema comparator accepts an identical snapshot",()=>{
  const result=compare(prod,prod);
  assert.equal(result.isStructurallyIdentical,true);
  assert.equal(result.tables.missingCount,0);
  assert.equal(result.routines.changedCount,0);
});
test("Canton QA is known to be incomplete versus Golden production schema",()=>{
  const r=compare(prod,canton);
  assert.equal(r.isStructurallyIdentical,false);
  assert.equal(r.tables.referenceCount,315);
  assert.equal(r.tables.candidateCount,23);
  assert.equal(r.tables.missingCount,292);
  assert.equal(r.tables.extraCount,0);
  assert.ok(r.tables.changedCount>0);
  assert.ok(r.routines.missingCount>0);
  assert.equal(r.views.referenceCount,1);
  assert.equal(r.views.candidateCount,0);
});
test("schema comparator detects reverse missing/extra direction",()=>{
  const r=compare(canton,prod);
  assert.equal(r.tables.missingCount,0);
  assert.equal(r.tables.extraCount,292);
  assert.equal(r.isStructurallyIdentical,false);
});
