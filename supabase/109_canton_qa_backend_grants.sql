-- Isolated QA project ONLY (xehstmnqljjhacjiukvc).
-- The minimal QA scaffold was created without Data API grants to service_role.
-- Grant backend-only access to the exact Canton QA tables; retain RLS deny-all
-- for anon/authenticated clients. Never apply this to production automatically.
grant usage on schema public to service_role;
grant select, insert, update, delete on table
 public.organizations,
 public.organization_members,
 public.profiles,
 public.crm_clients,
 public.canton_visitors,
 public.canton_appointments,
 public.canton_visit_feedback,
 public.canton_qr_sites,
 public.canton_intake_requests,
 public.canton_reception_staff,
 public.canton_qr_feedback_attempts
to service_role;
grant usage, select on all sequences in schema public to service_role;
-- Grant only server-side execution for the specific QR approval operation.
grant execute on function public.canton_approve_qr_intake(uuid,uuid,uuid) to service_role;
-- Verify that browser auth roles cannot use QA tables directly.
revoke all on table
 public.organizations,
 public.organization_members,
 public.profiles,
 public.crm_clients,
 public.canton_visitors,
 public.canton_appointments,
 public.canton_visit_feedback,
 public.canton_qr_sites,
 public.canton_intake_requests,
 public.canton_reception_staff,
 public.canton_qr_feedback_attempts
from anon, authenticated;
