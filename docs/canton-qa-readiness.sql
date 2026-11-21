-- QA-only operational readiness check. Read-only.
-- Run in Supabase staging ref xehstmnqljjhacjiukvc, NEVER production.
with qa_org as (
 select id from public.organizations
 where id='021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid
 and name='Canton Visitor Center - QA ONLY'
), staff_roles as (
 select m.role, lower(u.email) as email, m.user_id
 from public.organization_members m
 join auth.users u on u.id=m.user_id
 where m.organization_id in (select id from qa_org) and m.is_active=true
), qa_tables as (
 select count(*) as n from pg_tables
 where schemaname='public'
 and tablename in (
   'canton_visitors','canton_appointments','canton_visit_feedback',
   'canton_qr_sites','canton_intake_requests','canton_reception_staff','canton_qr_feedback_attempts')
)
select
 (select count(*)=1 from qa_org) as qa_organization_ready,
 (select n=7 from qa_tables) as canton_tables_ready,
 (select count(*)>=1 from public.canton_qr_sites where organization_id in (select id from qa_org) and enabled) as qr_site_ready,
 (select count(*)=1 from staff_roles where role='admin' and email='canton-admin@qa.example.invalid') as admin_ready,
 (select count(*)=1 from staff_roles where role='manager' and email='canton-manager@qa.example.invalid') as manager_ready,
 (select count(*)=1 from staff_roles where role='employee' and email='canton-commercial@qa.example.invalid') as commercial_ready,
 (select count(*)=1 from staff_roles s
   join public.canton_reception_staff rs on rs.user_id=s.user_id
   where s.email='canton-reception@qa.example.invalid' and s.role='employee') as reception_ready,
 (select count(*)=0 from public.canton_appointments) as no_test_visits_yet;
