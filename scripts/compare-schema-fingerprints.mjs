#!/usr/bin/env node
/**
 * Offline schema fingerprint comparison. No network or database calls.
 * node scripts/compare-schema-fingerprints.mjs
 * node scripts/compare-schema-fingerprints.mjs --json
 * node scripts/compare-schema-fingerprints.mjs --require-match
 * node scripts/compare-schema-fingerprints.mjs <reference.json> <candidate.json>
 *
 * WARNING: MD5 is a compact drift fingerprint, not a cryptographic audit.
 * Snapshot completeness is limited to SQL query src in scripts/sql.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const json = args.includes("--json");
const requireMatch = args.includes("--require-match");
const files = args.filter(x => !x.startsWith("--"));
const root = process.cwd();
if (files.length !== 0 && files.length !== 2) {
  console.error("Usage: node scripts/compare-schema-fingerprints.mjs [<reference.json> <candidate.json>] [--json] [--require-match]");
  process.exit(2);
}
const names = files.length === 2 ? files :
  ["docs/schema-fingerprints/production-2026-11-24.json", "docs/schema-fingerprints/canton-qa-2026-11-24.json"];
const [reference, candidate] = names.map(n => JSON.parse(fs.readFileSync(path.resolve(root, n), "utf8")));
for (const file of [reference, candidate]) {
  if (file.schema !== "public" || !Array.isArray(file.tables) ||
      !Array.isArray(file.routines) || !Array.isArray(file.views) || !Array.isArray(file.extensions)) {
    console.error("Invalid or incomplete fingerprint snapshot; no comparison can be made.");
    process.exit(2);
  }
}
const listDiff = (key, identity, fields) => {
  const a = new Map(reference[key].map(x => [identity(x), x]));
  const b = new Map(candidate[key].map(x => [identity(x), x]));
  const missing = [...a.keys()].filter(n => !b.has(n)).sort();
  const extra = [...b.keys()].filter(n => !a.has(n)).sort();
  const changed = [...a.keys()].filter(n => b.has(n)).map(name => ({
    name, changedFields: fields.filter(field => JSON.stringify(a.get(name)[field]) !== JSON.stringify(b.get(name)[field])),
  })).filter(x => x.changedFields.length).sort((x,y) => x.name.localeCompare(y.name));
  return {referenceCount:a.size,candidateCount:b.size,commonCount:a.size-missing.length,
    missingCount:missing.length,extraCount:extra.length,changedCount:changed.length,
    missingSample:missing.slice(0,30),extraSample:extra.slice(0,30),changedSample:changed.slice(0,30)};
};
const tableFields=["relkind","rls","force_rls","grants_hash","columns_count","columns_hash",
  "constraints_count","constraints_hash","policies_count","policies_hash",
  "indexes_count","indexes_hash","triggers_count","triggers_hash"];
const report = {
  reference:{project:reference.project,captureDate:reference.captureDate,source:names[0]},
  candidate:{project:candidate.project,captureDate:candidate.captureDate,source:names[1]},
  tables:listDiff("tables",x=>x.name,tableFields),
  routines:listDiff("routines",x=>x.identity,["kind","security_definer","definition_hash","grants_hash"]),
  views:listDiff("views",x=>x.name,["definition_hash","grants_hash","options"]),
  extensions:listDiff("extensions",x=>x.name,["schema","version"]),
  limitations:"Snapshot metadata and hashes; not a schema restore, runtime RLS test, or proof of equivalent extension behavior.",
};
report.isStructurallyIdentical = ["tables","routines","views","extensions"].every(key =>
  report[key].missingCount === 0 && report[key].extraCount === 0 && report[key].changedCount === 0);
if (json) console.log(JSON.stringify(report,null,2));
else {
  console.log("SUPER LEADER — OFFLINE SCHEMA DRIFT COMPARISON");
  for (const key of ["tables","routines","views","extensions"]) {
    const r=report[key];
    console.log(key+": reference="+r.referenceCount+" candidate="+r.candidateCount+
      " missing="+r.missingCount+" extra="+r.extraCount+" changed="+r.changedCount);
    if (r.missingCount) console.log("  Missing examples: "+r.missingSample.slice(0,8).join(", "));
    if (r.changedCount) console.log("  Drift examples: "+r.changedSample.slice(0,8).map(x=>x.name+"("+x.changedFields.join(",")+")").join("; "));
  }
  console.log("STRUCTURALLY IDENTICAL: "+(report.isStructurallyIdentical?"YES":"NO"));
  console.log("No database queries or writes performed.");
}
if (requireMatch && !report.isStructurallyIdentical) process.exitCode=1;
