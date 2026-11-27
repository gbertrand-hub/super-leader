import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/app/dashboard/canton-visitors/page.tsx',import.meta.url),'utf8');
const action = readFileSync(new URL('../src/app/actions/canton-next-action-recovery.ts',import.meta.url),'utf8');

test('both locales offer recontact or reschedule instead of giving up',()=>{
 assert.match(page,/Recontacter ou reprogrammer/);
 assert.match(page,/Recontact or reschedule/);
 assert.doesNotMatch(page,/Action too late|Action trop tardive/);
});
test('a recover action never resets the original SLA clock',()=>{
 assert.match(action,/Historical SLA remains anchored/);
 assert.match(action,/update\(\{ due_date: proposedDate, action_text: proposedText \}\)/);
 assert.doesNotMatch(action,/\.update\(\{\s*(?:qualified_at|commercial_qualified_at)/);
});
test('reschedule action is permission-gated and optimistic-concurrency protected',()=>{
 assert.match(action,/assertCantonLive\(\)/);
 assert.match(action,/auth\.getUser\(\)/);
 assert.match(action,/organization_members/);
 assert.match(action,/visitor_site_staff/);
 assert.match(action,/\.eq\("status", "open"\)\.eq\("assigned_to", action.assigned_to\)/);
 assert.match(action,/\.eq\("due_date", action.due_date\)\.eq\("action_text", action.action_text\)/);
});
test('reschedule workflow has no external provider calls',()=>{
 assert.doesNotMatch(action,/fetch\s*\(|api\.resend|graph\.facebook|sendEmail|sendWhatsapp/i);
});
test('date-only SLA warnings are not expressed as confirmed late without time',()=>{
 assert.match(page,/Heure a confirmer|Heure à confirmer/);
 assert.match(page,/Time to confirm/);
});

test('date-only calculation distinguishes an unknown appointment hour from a definitely late date',()=>{
 const lateExpr=page.match(/const slaPlannedTooLate=([^;]+);/)?.[1];
 const timeExpr=page.match(/const slaTimeNeedsReview=([^;]+);/)?.[1];
 assert.ok(lateExpr&&timeExpr);
 const tooLate=new Function('deadlineLocalDay','action','slaLate',`return ${lateExpr};`);
 const timeUnknown=new Function('deadlineLocalDay','action','slaLate',`return ${timeExpr};`);
 const deadline='2026-11-28';
 assert.equal(tooLate(deadline,{due_date:'2026-11-27'},false),false);
 assert.equal(tooLate(deadline,{due_date:'2026-11-28'},false),false);
 assert.equal(timeUnknown(deadline,{due_date:'2026-11-28'},false),true);
 assert.equal(tooLate(deadline,{due_date:'2026-11-29'},false),true);
 assert.equal(tooLate(deadline,{due_date:'2026-11-29'},true),false);
});
