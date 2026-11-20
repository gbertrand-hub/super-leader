# Visitor & Appointment Management - Production Release Manifest

## Target
- Vercel project: super-leader
- Production app: https://app.ileadglobal.org
- Supabase production project: jjbuxrlvxnlnrjcorpwt
- Production organization: iLEAD Global
- organization_id: 7681043d-2ce8-47e7-bb93-6dacef906875
- Primary site: Canton HQ
- Address: 3540 Van Zandt County Road 2410, Canton, Texas 75103, United States
- Timezone: America/Chicago

## Release principle
Fail closed. Do not enable the module in production until:
1. production schema has been installed and verified;
2. Canton HQ seed exists;
3. server-only grants/functions are hardened;
4. production environment variables are present;
5. staged production smoke test passes;
6. explicit release approval flag is enabled.

## Migration sequence

### Apply
100_canton_visitor_v1.sql
101_canton_reception_staff.sql
102_canton_qr_register_feedback.sql
103_canton_qr_atomic_approval.sql
104_canton_qr_reuse_scheduled_visit.sql
105_canton_feedback_attempts.sql
106_canton_followup_handoff.sql
107_canton_low_score_followup.sql
108_canton_qr_match_purpose.sql
110_canton_qr_midnight_match_window.sql
111_canton_anonymous_feedback.sql
112_canton_feedback_find_visit.sql
113_canton_feedback_invitation_outbox.sql
114_canton_feedback_language.sql
117_canton_site_directions.sql
118_canton_follow_up_outcomes.sql
120_canton_next_actions.sql
121_canton_next_action_unique_open.sql
123_canton_production_readiness_v4_10_132.sql
124_visitor_sites_multisite_foundation.sql

Then run:
125_canton_production_bootstrap.sql

### Do NOT apply directly
109_canton_qa_backend_grants.sql
114_canton_outbox_dry_run.sql
115_canton_feedback_dry_run_processor.sql
116_canton_email_claim_ack.sql
119_canton_follow_up_outcome_integrity.sql
122_canton_qa_email_one_shot.sql

Reason: these files are QA/stage specific or contain the QA organization id. Production-specific grants and delivery state should be applied separately after review.

## Production seed

After migration 124:

insert into public.visitor_sites
 (organization_id,code,name,city,country_code,timezone,street_address,is_hq,is_active)
values
 ('7681043d-2ce8-47e7-bb93-6dacef906875'::uuid,
  'CANTON_HQ','Canton HQ','Canton','US','America/Chicago',
  '3540 Van Zandt County Road 2410, Canton, Texas 75103, United States',
  true,true)
on conflict(organization_id,code) do update set
 name=excluded.name,
 city=excluded.city,
 country_code=excluded.country_code,
 timezone=excluded.timezone,
 street_address=excluded.street_address,
 is_hq=true,
 is_active=true,
 updated_at=now();

Do not seed Yaounde/Kinshasa until their addresses and local operational owners are confirmed.

## Production environment variables

Required for activation:
- CANTON_VISITOR_ENABLE_LIVE=true
- CANTON_PRODUCTION_DATABASE_READY=true
- CANTON_PRODUCTION_RELEASE_APPROVED=false initially
- CANTON_INTAKE_RATE_SECRET=<new production-only random secret>

Existing production Supabase values must point to:
- NEXT_PUBLIC_SUPABASE_URL=https://jjbuxrlvxnlnrjcorpwt.supabase.co
- production publishable key
- production service role key (server only)

QA-only variables must not be reused as production controls:
- CANTON_TEST_DATABASE_READY
- CANTON_QA_EMAIL_TEST_ENABLED
- CANTON_QA_EMAIL_RECIPIENT
- CANTON_QA_WHATSAPP_RECIPIENT

## Pre-release checks

1. Backup / recovery point for production database.
2. Confirm CRM tables exist:
   - crm_clients
   - crm_interactions
   - crm_follow_up_tasks
3. Confirm no canton_* or visitor_* tables exist before first install.
4. Apply migrations in a controlled window.
5. Seed Canton HQ.
6. Verify RLS is enabled on Canton/Visitor tables.
7. Verify anon/authenticated have no direct table grants.
8. Verify sensitive Canton RPCs are not executable by anon/authenticated.
9. Verify service_role has required server-only grants.
10. Run Supabase security advisors.
11. Configure production Vercel variables with RELEASE_APPROVED=false.
12. Build staged production deployment without assigning app.ileadglobal.org.
13. Smoke test with a real production admin account.
14. Set CANTON_PRODUCTION_DATABASE_READY=true only after DB checks pass.
15. Set CANTON_PRODUCTION_RELEASE_APPROVED=true only after final approval.
16. Promote tested production build.

## Smoke test

- Admin can open Visitor & Appointment Management.
- Canton HQ is the default/primary site.
- Create a test visitor and appointment.
- CRM referral links to existing CRM client without duplicate.
- Reception: scheduled -> arrived -> in_progress -> completed.
- QR/public check-in does not expose private visitor data.
- Feedback matches exactly one completed visit.
- Feedback remains separate from internal Hot/Warm/Cold.
- Feedback creates CRM interaction.
- Commercial debrief creates CRM interaction/task.
- SLA/follow-up permissions are correct.
- Non-admin/local roles cannot access unauthorized site data.

## Rollback

If application issue only:
1. Set CANTON_PRODUCTION_RELEASE_APPROVED=false.
2. Module immediately becomes fail-closed.
3. Roll back Vercel deployment if needed.

If database issue:
1. Disable release flag first.
2. Do not drop Canton tables while writes are possible.
3. Restore from production recovery point if the migration caused data/schema damage.
4. Because Canton tables are additive and CRM tables are not replaced, prefer forward-fix over destructive rollback when possible.

## GO criteria

GO only when:
- staged production build is READY;
- migrations complete without errors;
- Canton HQ seed verified;
- CRM bridge verified;
- security checks pass;
- release flag remains controllable;
- smoke test passes.

Until then: NO-GO.
