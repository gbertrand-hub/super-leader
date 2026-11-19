# Canton Visitor & Appointment Management — V4.10.132 (WIP)

Status: development branch only. **Not deployed, not build-tested, do not apply to production.**

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
