# Canton Visitor & Appointment Management — V4.10.132 (WIP)

Status: development branch only. **Vercel preview build READY for commit 41f5f3f, 2026-11-19. Canton schema applied only in isolated QA branch; SQL checks pass, full end-to-end tests remain; do not promote to production.**

## Features implemented in code
- Canton Visitor Center route: `/dashboard/canton-visitors` (signed-in members).
- Announced and scheduled visits, with optional phone or email, department, purpose, host.
- Two-step identity lookup in the Canton visitors table and matching existing CRM clients; avoids automatically turning non-commercial visitors into sales leads.
- Check-in/check-out, no-show, reschedule, follow-up-needed indicator.
- Submitted feedback form: `/canton-feedback?token=<visit-feedback-token>`, one response per completed visit.
- Daily summary and feedback ratings (for the most recent 150 visits); navigation in French and English.
- Unique-index defenses against exact duplicate appointments.

## Not ready for release
1. Verify production migration numbering, rollback and dependencies; use a disposable Supabase database before any production change.
2. Run `npm ci`, `npm run build`, then verify TypeScript errors and repair them.
3. Verify organization isolation, role access, that private direction appointments do not leak to unauthorized users; decide reception roles.
4. Add rate limiting and abuse protection to public feedback form, then privacy and retention policy.
5. Confirm the contact identity rules for shared phones/emails, multiple CRM matches and cross-department visits.
6. Verify secure date validation, daylight-saving edge cases for `America/Chicago`, and schedule conflicts.
7. Add appointment confirmation, consent capture, follow-up integration and WhatsApp API adaptation in subsequent versions.
8. Ensure pending visit and feedback counters are accurate beyond the 150-record UI limit.
9. Validate build with the actual Supabase schema in a staging project and test behavior on mobile.

## Acceptance scenarios
- New walk-in visitor: create announced visit, check in, check out.
- Existing Canton visitor: schedule again using their phone; one visitor record, multiple distinct appointments.
- Existing CRM contact: visit linked to their CRM ID, no duplicate CRM contact.
- Two teams enter same visit: second submission rejected as duplicate.
- Same person visits TCF and DIG: two distinct appointments supported.
- Schedule, reschedule and mark no-show; canceled/no-show appointment can be scheduled again.
- Feedback link opens only for completed visit, accepts once, second submission rejected.
- Ratings 1-2 or recontact requested appear in attention metric.
- Unauthorized users cannot view, modify or submit data on behalf of other organizations.
- English and French navigation; responsive mobile and desktop.
- Direct feedback form does not require Super Leader user account; account/session not exposed.
- **No WhatsApp messages until API integration and opt-in controls are ready.**

## QA notes
Migration file: `supabase/100_canton_visitor_v1.sql` (applied in isolated QA branch only, not production).
Existing CRM table verified in the Super Leader Supabase project: `public.crm_clients`.

## Build verification (2026-11-19)
- Deployment: `dpl_Eq2cQqMAifugfQvQvkS9mxdP8Pvi`
- Next.js compilation: passed. TypeScript: passed. Vercel preview: READY.
- Earlier builds failed type-checking at nullable identity and visit checks, corrected in branch.
- **Important:** preview can still show missing database table message until an isolated test database is set up and a migration applied. Database/schema functional QA remains blocked.

## Supabase isolated branch: created 2026-11-19 17:55 UTC
- Parent project: Super Leader `jjbuxrlvxnlnrjcorpwt` (production unchanged).
- QA branch ref: `xehstmnqljjhacjiukvc`, branch id `d79aa714-8bcf-4a24-9d17-f118afbcfa23`.
- Branch rate approved by owner: USD 0.01344 per hour. Target check / delete by **2026-11-22 17:55 UTC**, or earlier after acceptance. Deletion is NOT automatic.
- Supabase branch provisioning did **not** bring over the existing application tables; migration history on the parent project is not mirrored. To test only the Canton SQL schema, we applied a **QA-ONLY minimal foundation** for `organizations`, `crm_clients`, `organization_members` with no real user data. This branch is **not a working replica** of the full Super Leader app. Never merge the QA-only foundation to production.
- Applied branch migrations: `canton_stage_minimal_foundation_only`; `canton_visitors_appointments_feedback_v1`.
- Verified 3 Canton tables exist and have RLS enabled. The advisor reports INFO `rls_enabled_no_policy` for 6 QA-only tables: deliberate deny-all with no grants to anon/authenticated. Only server-side scoped service role operations currently access them.
- SQL transactional fixtures: fake organization, visitor, appointment and feedback; confirmed protection against duplicate appointments, cross-organization visitor association, rating outside 1–5, and second feedback for one visit. Test fixture writes rolled back; zero visitors, appointments and feedback remain in the QA branch.
- **Not yet tested:** full Super Leader app login or navigation, data flows through server actions, role-scoped security, live CRM data compatibility, WhatsApp, mobile feedback. Preview Vercel is currently NOT connected to this QA branch. Do not point the general app preview at it because the foundation is intentionally incomplete.
- To obtain genuine end-to-end tests without production data, restore a sanitized full schema into the QA branch or create a separate dedicated preview with an appropriate test-auth environment and a matching schema. Do not clone real customers.

## Reception permission implementation — 2026-11-19
- Explicit `canton_reception_staff` table, keyed by organization and authenticated user, installed in isolated QA branch with RLS and no anon/authenticated grants.
- Owner/admin can assign and revoke reception access from Canton Visitor Center, selecting active organization members.
- Reception-designated staff can see/check in/check out standard DIG/TCF visits announced by other employees. Confidential direction visits remain hidden from reception/non-admin roles. Manager and HR can see standard visits; ordinary employees see only their own non-direction visits.
- Reception can check-in or check-out others' standard appointments but cannot independently reschedule, mark no-show, or designate follow-up unless they are also the creator/manager. Further role-matrix testing is required before production.
- SQL access check: `anon` and `authenticated` cannot SELECT `canton_reception_staff` directly.
- Current latest Vercel preview commit `a1744b5` was still building when checked; previous preview build `41f5f3f` was READY. Do not declare new changes validated without their build result.
- **Explicit QA limitation**: current Supabase branch has only minimal scaffold, so real Super Leader UI/auth end-to-end tests are not yet possible. Do not merge the test scaffold.

## Two QR codes implementation — 2026-11-19
- Arrival QR: site-scoped generic URL `/canton-checkin?site=<site-id>`. Visitor supplies name, contact and department. **This only creates a pending intake request**, NOT an automatic approved check-in or CRM lead. Assigned receptionist approves or rejects after checking identity; approval makes the visitor/appointment and marks arrived.
- Feedback QR: generic public URL `/canton-feedback-qr`. Reception gives the 16-character random visit code displayed after checkout. The feedback form accepts one score per completed visit, within 30 days of checkout. This prevents a QR poster from exposing another visitor's feedback token.
- Staff dashboard has two QR poster displays and a pending approval queue; administrators can add a site. QR images are currently provided by a third-party QR renderer **only for generic public-form URLs**; do not embed visitor PII or private feedback tokens in QR URLs.
- Database migration `102_canton_qr_register_feedback.sql` added to branch `xehstmnqljjhacjiukvc`; atomic approval function migration `103_canton_qr_atomic_approval.sql` applied to stage and restricted to service_role. SQL QA passed: approval creates visit, links intake, duplicate approval rejected; test rows rolled back.
- **Runtime prerequisite:** set a strong random `CANTON_INTAKE_RATE_SECRET` in the server-only environment before enabling public visitor intake. Never use NEXT_PUBLIC_ prefix. No secret set by these changes. A missing secret prevents submissions by design.
- **Remaining QA:** public form automation protection/WAF, role authorization integration tests, sanitized full app schema and auth, mobile QR scan tests, public QR image-provider reliability, QR site lifecycle/disable, timezone behavior and staff training. The existing Vercel preview is not connected to a complete test database; do not print or use these posters in Canton yet.

## QA update — QR matching & feedback protection (2026-11-19)
- SQL migration `104_canton_qr_reuse_scheduled_visit.sql` applied **to isolated branch only**: if a visitor already has exactly one scheduled appointment today with the corresponding department, QR check-in reuses that appointment instead of creating a duplicate. More than one same-day match requires staff manual review.
- Transactional SQL checks passed on test branch: (1) single scheduled appointment reused with check-in and no duplicate; (2) multiple scheduled matches rejected without altering pending QR request. All generated fixtures rolled back.
- SQL migration `105_canton_feedback_attempts.sql` applied **to isolated branch only**: private attempt log for per-IP QR feedback throttling. Public feedback form now rejects after 10 attempts within one hour; a server-only `CANTON_INTAKE_RATE_SECRET` is required, and **has not been configured by these commits**.
- Vercel preview for commit `0c2a969`: deployment `dpl_61QX5g8R7zfuwakP32qh73hLFmVw` reached **READY**; compile/typecheck passed. This does not constitute mobile/browser E2E acceptance.
- **Release gate:** need safe complete preview auth/database, rate-limiter concurrency and WAF review, UX mobile scan test, staff role matrix test and privacy policy. Do not merge QA scaffold or publish the public QR codes.

## Post-visit accountability (2026-11-19)
- Migration `106_canton_followup_handoff.sql` installed in **isolated QA branch only**. Adds follow-up owner, due date, next-action note, status and completion timestamp. No production database changes.
- Managers/admins can assign follow-up to an active member of the same organization, set a due date and mark an open follow-up completed. The Canton control center displays an 'open follow-ups' KPI and assignment panel. Existing CRM task automation is not connected; this is Canton-specific handoff tracking.
- Transactional QA passed: follow-up opened/completed and inconsistent completed state rejected; fixtures rolled back and 0 appointments remain.
- Vercel preview for code commit `8a34ff4` reached **READY** (`dpl_CpEbcrXCgFmhBSUu2pi236F8rRDt`) after TypeScript/JSX fixes. Still not an end-to-end acceptance test.
- Before release: full preview DB/auth compatibility, receptionist vs owner vs manager role test, follow-up task owner notification, privacy/data retention, date/time timezone accuracy, and no schema drift.

## REAL-TEST READINESS CHECK — 2026-11-19
- Desktop and phone visual simulation was confirmed by the product owner; **this is UX sign-off only, not production acceptance**.
- Verified current GitHub Vercel preview had production/preview Supabase environment variables scoped generically (values intentionally NOT decrypted). **Do not connect production database to live Canton test routes.**
- Supabase branch `xehstmnqljjhacjiukvc` contains all 7 Canton tables and migrations through follow-up handoff. However Supabase branch listing shows **MIGRATIONS_FAILED**, despite successful direct SQL tests. It also lacks the complete Super Leader authentication/application schema.
- Added fail-closed gate on all Canton server actions and public Canton forms. Activation requires ALL of: `VERCEL_ENV=preview`, `CANTON_VISITOR_ENABLE_LIVE=true`, `CANTON_TEST_DATABASE_READY=true`, and `NEXT_PUBLIC_SUPABASE_URL` hostname equal to `xehstmnqljjhacjiukvc.supabase.co`.
- A branch-specific preview environment must have **matching staging values** for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and private `CANTON_INTAKE_RATE_SECRET`, sourced securely from Supabase staging settings. Do not paste any secret into a chat, issue or repository.
- First reconstruct the sanitized full Super Leader schema and create test accounts (one admin, one manager, one commercial, one receptionist) against the same staging Supabase auth. Never copy actual client records or credential material.
- Verify who can approve QR, read visitor identities, assign owner, and submit feedback; confirm Vercel preview privacy and public form rate limits. **Only after all checks**, turn on the gate for the specific branch preview.
- Latest available functional verification is SQL transaction-based only: scheduled visit -> QR intake -> check-in -> checkout -> low rating -> handoff -> completed, with fixtures rolled back and counts at zero.
- QA cost branch: USD 0.01344/hour while it exists; review and delete after acceptance (owner reminder 2026-11-22). No automatic deletion.
