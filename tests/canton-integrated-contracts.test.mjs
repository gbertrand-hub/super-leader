import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(path.join(root,name),'utf8');
const migrations = 'supabase/release-candidates/v4_10_141/';

test('consent migration preserves historical email and does not infer WhatsApp consent',()=>{
 const sql=read(migrations+'01_consent_timestamps.sql');
 assert.match(sql,/feedback_email_opt_in_at/);
 assert.match(sql,/feedback_whatsapp_opt_in_at/);
 assert.match(sql,/feedback_whatsapp_consent_phone/);
 assert.match(sql,/where feedback_email_opt_in = true/);
 assert.doesNotMatch(sql,/set feedback_whatsapp_opt_in\s*=\s*true/);
});
test('revoke trigger cancels pending and claimed invitations, not already sent',()=>{
 const sql=read(migrations+'01_consent_timestamps.sql');
 assert.match(sql,/canton_feedback_consent_revoke/);
 assert.match(sql,/status in \('pending','sending'\)/);
 assert.match(sql,/email_consent_revoked/);
 assert.match(sql,/whatsapp_consent_revoked/);
});
test('cross-channel index prevents an email and WhatsApp delivery lifecycle',()=>{
 const sql=read(migrations+'02_cross_channel_uniqueness.sql');
 assert.match(sql,/create unique index if not exists/);
 assert.match(sql,/canton_feedback_one_delivery_per_visit_idx/);
 assert.match(sql,/\('pending'|'pending',/);
 assert.match(sql,/'sent'/);
 assert.match(sql,/'failed'/);
});
test('scheduler defaults WhatsApp off and requires approved template readiness',()=>{
 const sql=read(migrations+'03_channel_scheduling.sql');
 assert.match(sql,/whatsapp_enabled boolean not null default false/);
 assert.match(sql,/whatsapp_template_ready boolean not null default false/);
 assert.match(sql,/if v_whatsapp_enabled and v_template_ready/);
 assert.match(sql,/feedback_whatsapp_consent_phone = v.phone/);
 assert.match(sql,/feedback_email_opt_in_at is not null/);
});
test('WhatsApp claim serializes by row and verifies current consent and template',()=>{
 const sql=read(migrations+'04_whatsapp_delivery_claim.sql');
 assert.match(sql,/for update of o skip locked/i);
 assert.match(sql,/feedback_whatsapp_consent_phone = v.phone/);
 assert.match(sql,/whatsapp_template_ready = true/);
 assert.match(sql,/canton_ack_whatsapp_feedback_invitation/);
 assert.match(sql,/revoke all on function[\s\S]*from public,anon,authenticated/);
});
test('new WhatsApp endpoint has production-only, secret-protected disabled-by-default access',()=>{
 const route=read('src/app/api/cron/canton-feedback-whatsapp/route.ts');
 const worker=read('src/lib/canton/production-whatsapp-delivery.ts');
 assert.match(route,/verifyCronRequest\(request\)/);
 assert.match(route,/process\.env\.VERCEL_ENV!=="production"/);
 assert.match(route,/process\.env\.CANTON_FEEDBACK_WHATSAPP_AUTOMATION_ENABLED!=="true"/);
 assert.match(worker,/cantonProductionEnabled\(\)/);
 assert.match(worker,/CANTON_WHATSAPP_META_TEMPLATE_APPROVED/);
 assert.match(worker,/CANTON_WHATSAPP_FEEDBACK_TEMPLATE_NAME/);
 assert.match(worker,/WHATSAPP_PHONE_NUMBER_ID/);
 assert.match(worker,/WHATSAPP_ACCESS_TOKEN/);
 assert.match(worker,/siteUrl !== "https:\/\/app\.ileadglobal\.org"/);
});
test('CRM WhatsApp inbound remains untouched and visitor module has separate delivery',()=>{
 const action=read('src/app/actions/canton-visitors.ts');
 assert.match(action,/revokeCantonVisitorFeedbackConsent/);
 assert.match(action,/seniorRoles\.has\(role\)/);
 assert.match(action,/feedback_whatsapp_consent_phone:null/);
 const ui=read('src/app/dashboard/canton-visitors/page.tsx');
 assert.match(ui,/name="feedbackWhatsAppConsent"/);
 assert.match(ui,/action=\{revokeCantonVisitorFeedbackConsent\}/);
});
