import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {canEnrollInSchoolCohort} from "../src/lib/academy/cohort-compatibility.ts";

const school="coaches-school";
const activeProgram={school_id:school,status:"active"};
const staffLinkedCohort={school_id:school,program_id:"staff-program",status:"active"};

test("active school-wide 2026-2027 cohort accepts a different active curriculum program",()=>{
 assert.equal(canEnrollInSchoolCohort(school,activeProgram,staffLinkedCohort),true);
});
test("cohort linked to the same program remains valid",()=>{
 assert.equal(canEnrollInSchoolCohort(school,activeProgram,{...staffLinkedCohort,program_id:"curriculum-program"}),true);
});
test("a cohort belonging to another school cannot be selected",()=>{
 assert.equal(canEnrollInSchoolCohort(school,activeProgram,{...staffLinkedCohort,school_id:"different-school"}),false);
});
test("an inactive or archived program is denied",()=>{
 assert.equal(canEnrollInSchoolCohort(school,{...activeProgram,status:"archived"},staffLinkedCohort),false);
});
test("an archived cohort is denied",()=>{
 assert.equal(canEnrollInSchoolCohort(school,activeProgram,{...staffLinkedCohort,status:"archived"}),false);
});
test("missing choices are denied",()=>{
 assert.equal(canEnrollInSchoolCohort(school,null,staffLinkedCohort),false);
 assert.equal(canEnrollInSchoolCohort(school,activeProgram,null),false);
});
test("manual enrollment uses school-scoped validation and offers active choices",()=>{
 const action=readFileSync(new URL("../src/app/actions/academy-students-directory.ts",import.meta.url),"utf8");
 const page=readFileSync(new URL("../src/app/dashboard/academy/students/page.tsx",import.meta.url),"utf8");
 assert.match(action,/canEnrollInSchoolCohort\(schoolId, validProgram, validCohort\)/);
 assert.doesNotMatch(action,/validCohort\.program_id &&/);
 assert.match(page,/program\.status === "active"/);
 assert.match(page,/cohort\.status === "active"/);
});
test("Identity 360 displays correct French text without mojibake",()=>{
 const page=readFileSync(new URL("../src/app/dashboard/admin/identity-audit/[clientId]/page.tsx",import.meta.url),"utf8");
 assert.match(page,/DOSSIER 360° · IDENTITÉ UNIQUE/);
 assert.match(page,/Finance consolidée/);
 assert.match(page,/Téléphone/);
 assert.doesNotMatch(page,/[├┬ÔÇ]/);
});
