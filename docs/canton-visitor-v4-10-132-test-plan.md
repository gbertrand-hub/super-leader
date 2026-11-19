# Canton Visitor & Appointment Management — V4.10.132 (WIP)

Status: development branch only. **Vercel preview build READY for commit 41f5f3f, 2026-11-19. Schema not applied; no functional acceptance tests; do not promote to production.**

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
Migration file currently: `supabase/100_canton_visitor_v1.sql` (provisional filename; not applied).
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
