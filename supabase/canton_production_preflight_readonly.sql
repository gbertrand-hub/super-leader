-- Visitor & Appointment Management - production preflight (READ ONLY)
-- Safe to run before any Canton/Visitor production migration.

select
  current_database() as database_name,
  now() as checked_at,
  exists(
    select 1 from public.organizations
    where id='7681043d-2ce8-47e7-bb93-6dacef906875'::uuid
      and name='iLEAD Global'
  ) as expected_organization_present,
  exists(
    select 1 from information_schema.tables
    where table_schema='public' and table_name='crm_clients'
  ) as crm_clients_present,
  exists(
    select 1 from information_schema.tables
    where table_schema='public' and table_name='crm_interactions'
  ) as crm_interactions_present,
  exists(
    select 1 from information_schema.tables
    where table_schema='public' and table_name='crm_follow_up_tasks'
  ) as crm_follow_up_tasks_present,
  exists(
    select 1 from information_schema.tables
    where table_schema='public' and table_name='canton_appointments'
  ) as canton_already_installed,
  exists(
    select 1 from information_schema.tables
    where table_schema='public' and table_name='visitor_sites'
  ) as visitor_sites_already_installed;

-- Expected BEFORE first production install:
-- expected_organization_present = true
-- crm_clients_present = true
-- crm_interactions_present = true
-- crm_follow_up_tasks_present = true
-- canton_already_installed = false
-- visitor_sites_already_installed = false

select
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable
from information_schema.columns c
where c.table_schema='public'
  and (
    (c.table_name='crm_clients' and c.column_name in ('id','organization_id','full_name','email','phone'))
    or
    (c.table_name='crm_interactions' and c.column_name in (
      'id','organization_id','client_id','employee_id','channel','direction',
      'interaction_type','outcome','summary','occurred_at','created_by'
    ))
    or
    (c.table_name='crm_follow_up_tasks' and c.column_name in (
      'id','organization_id','client_id','interaction_id','assigned_to',
      'title','due_at','priority','status'
    ))
  )
order by c.table_name,c.ordinal_position;

-- No DDL and no DML in this file.
