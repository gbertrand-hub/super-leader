-- QA UTILITY ONLY. Never use on the production Supabase project.
-- 1) Create four FAKE users in the QA project's Authentication > Users UI.
--    Set unique temporary passwords there; DO NOT put passwords in this file.
-- 2) Set their email addresses to these exact test-only identifiers:
--      canton-admin@qa.example.invalid
--      canton-manager@qa.example.invalid
--      canton-commercial@qa.example.invalid
--      canton-reception@qa.example.invalid
-- 3) Execute this script ONLY in QA project xehstmnqljjhacjiukvc.
--    All four users must already exist in auth.users, or the transaction aborts.
begin;
do $qa$
declare
  org uuid;
  found_users integer;
begin
  select id into org from public.organizations
  where id='021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid
    and name='Canton Visitor Center - QA ONLY';
  if org is null then
    raise exception 'Canton QA organization missing: refusing to provision';
  end if;
  select count(*) into found_users from auth.users
  where lower(email) in (
    'canton-admin@qa.example.invalid',
    'canton-manager@qa.example.invalid',
    'canton-commercial@qa.example.invalid',
    'canton-reception@qa.example.invalid'
  );
  if found_users<>4 then
    raise exception 'Expected exactly four QA Auth users, found %. Create test users in QA Auth first.',found_users;
  end if;
end $qa$;
with staff(email,role,display_name) as (
 values
  ('canton-admin@qa.example.invalid','admin','QA Canton Admin'),
  ('canton-manager@qa.example.invalid','manager','QA Canton Manager'),
  ('canton-commercial@qa.example.invalid','employee','QA Canton Commercial'),
  ('canton-reception@qa.example.invalid','employee','QA Canton Reception')
)
insert into public.organization_members(organization_id,user_id,role,is_active)
select '021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid,u.id,s.role,true
from staff s join auth.users u on lower(u.email)=s.email
where not exists (
 select 1 from public.organization_members m
 where m.organization_id='021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid and m.user_id=u.id
);
with staff(email,display_name) as (
 values
  ('canton-admin@qa.example.invalid','QA Canton Admin'),
  ('canton-manager@qa.example.invalid','QA Canton Manager'),
  ('canton-commercial@qa.example.invalid','QA Canton Commercial'),
  ('canton-reception@qa.example.invalid','QA Canton Reception')
)
insert into public.profiles(id,full_name,email)
select u.id,s.display_name,s.email from staff s join auth.users u on lower(u.email)=s.email
on conflict (id) do update set full_name=excluded.full_name,email=excluded.email;
insert into public.canton_reception_staff(organization_id,user_id)
select '021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid,u.id
from auth.users u
where lower(u.email)='canton-reception@qa.example.invalid'
on conflict (organization_id,user_id) do nothing;
commit;
-- Postconditions
select m.role,p.full_name,m.is_active,
       case when rs.user_id is null then 'no' else 'yes' end as receptionist
from public.organization_members m
join public.profiles p on p.id=m.user_id
left join public.canton_reception_staff rs on rs.user_id=m.user_id and rs.organization_id=m.organization_id
where m.organization_id='021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid order by p.full_name;
