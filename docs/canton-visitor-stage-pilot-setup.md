# Canton V4.10.132 — isolated employee-pilot enablement

**Status (2026-11-19): not yet enabled.** No production release. Visual simulation already accepted on desktop and phone.

## Preview entrypoints
- Visual-only simulation: `/canton-demo` (fake data and local UI state).
- Isolated employee pilot: `/canton-pilot`.
- Pilot staff sign-in: `/canton-pilot/login`.

These pilot routes are intentionally blocked until an isolated Supabase project is wired to a *branch-specific* Vercel preview environment.

## Verified state
- Supabase parent project `jjbuxrlvxnlnrjcorpwt` has the full production Super Leader schema and real people. **Never use it to test Canton writes.**
- Supabase QA branch `xehstmnqljjhacjiukvc` has all Canton migrations and only minimal scaffolding for `organizations`, `crm_clients`, `organization_members`, `profiles`; there are no test employee accounts yet.
- Supabase branch reports `MIGRATIONS_FAILED` due to parent migrations not being reproducible from the tracked history. Direct SQL verification of isolated Canton tables passed, but branch status still requires resolution before full release.
- Project-wide Vercel preview variables are already present, so the Canton pilot must **override preview variables on the specific `feature/canton-visitor-v4-10-132` branch**. No decrypted values were read or shared.

## Operations setup checklist
1. Confirm staging project reference and ensure it is active before entering any variables.
2. In Supabase QA project's dashboard, locate the **publishable** key and a **server-only secret/service role** key. Never paste keys into chat or GitHub.
3. In Vercel project `ilead-global/super-leader` add branch-scoped preview variables for `feature/canton-visitor-v4-10-132`:
   - `NEXT_PUBLIC_SUPABASE_URL=https://xehstmnqljjhacjiukvc.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = matching QA publishable key
   - `SUPABASE_SERVICE_ROLE_KEY` = matching QA server-only service role key
   - `CANTON_INTAKE_RATE_SECRET` = newly generated high-entropy server-only value
   - `CANTON_TEST_DATABASE_READY=true` **only after** schema and test accounts are validated
   - `CANTON_VISITOR_ENABLE_LIVE=true` **only after** authorization and no-production-credential tests pass
4. Configure Supabase QA Auth redirect/site URLs for the preview hostname before creating users; use test-domain addresses only.
5. Using Supabase Auth *in the QA project*, create separate test-only identities for owner/admin, manager, commercial employee and receptionist. No real customer data or production passwords.
6. In the QA SQL editor, create one fake organization and its four active `organization_members` rows, keyed to the QA Auth UUIDs. Add a `profiles` row for each QA user. Assign the receptionist in `canton_reception_staff` and link to the same fake organization. **Never copy production identity IDs or customer rows.**
7. Confirm all 7 Canton tables plus `profiles` and `organizations` exist. Confirm only server-side code can read/write Canton tables. Check QA Auth sign-in and sign-out.
8. Run 4-account acceptance tests, including: existing appointment reuse, receptionist check-in/out, manager follow-up assignment, negative satisfaction + closure, denial to other departments/organizations, and one-response-only feedback.
9. Keep release gate disabled until role and integration tests pass, then redeploy branch preview and test again. Do NOT merge QA scaffold or branch migrations to production.
10. Decide whether to delete the temporary Supabase branch by **2026-11-22**; it has hourly charges while running.

## Release blockers
- The QA project does not yet contain test users or verified test auth.
- No branch-scoped matching QA Supabase credentials are configured on Vercel.
- Full live role/auth/data flows and mobile QR forms are not verified.
- Public feedback abuse protections and confidentiality policies require review.
- The production schema is not reconstructed from the same migrations as the QA branch. Do not treat the QA branch as a full copy of Super Leader.
