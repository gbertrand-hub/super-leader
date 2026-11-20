-- QA-only: follow-up continuation after a completed commercial action.
-- Separate records preserve the original outcome and enable subsequent work.
create table if not exists public.canton_next_actions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 appointment_id uuid not null references public.canton_appointments(id) on delete cascade,
 assigned_to uuid not null,
 action_text text not null check(length(btrim(action_text))>=5),
 due_date date not null,
 status text not null default 'open' check(status in ('open','completed')),
 created_by uuid,
 created_at timestamptz not null default now(),
 completed_by uuid,
 completed_at timestamptz,
 completion_note text,
 constraint canton_next_actions_completed_integrity check(
   status<>'completed' or
   (completed_at is not null and completed_by is not null and length(btrim(coalesce(completion_note,'')))>=5)
 )
);
create index if not exists canton_next_actions_org_owner_open_due
 on public.canton_next_actions (organization_id,assigned_to,due_date)
 where status='open';
create index if not exists canton_next_actions_appointment
 on public.canton_next_actions(appointment_id);
alter table public.canton_next_actions enable row level security;
revoke all on public.canton_next_actions from anon,authenticated;
grant select,insert,update on public.canton_next_actions to service_role;
-- Application server is responsible for authz and organization scoping.
