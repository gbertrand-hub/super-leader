-- Super Leader v4.10.10
-- Team Tasks & Delegation: manager-to-member daily assignments with source traceability.

begin;

create table if not exists public.team_delegated_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assignee_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  work_date date not null,
  title text not null check (char_length(btrim(title)) between 3 and 240),
  expected_outcome text not null check (char_length(btrim(expected_outcome)) between 3 and 1200),
  instructions text,
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  due_time time,
  status text not null default 'todo' check (status in ('todo','in_progress','completed','blocked','deferred','cancelled')),
  status_note text,
  source_type text not null default 'manager' check (source_type in ('manager','hr','executive','admin','system','crm','event','contract','automatic')),
  source_label text,
  source_entity_type text,
  source_entity_id uuid,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_delegated_tasks_org_date_idx
  on public.team_delegated_tasks (organization_id, work_date desc, status);
create index if not exists team_delegated_tasks_assignee_date_idx
  on public.team_delegated_tasks (organization_id, assignee_id, work_date desc);
create index if not exists team_delegated_tasks_assigner_date_idx
  on public.team_delegated_tasks (organization_id, assigned_by, work_date desc);
create index if not exists team_delegated_tasks_source_idx
  on public.team_delegated_tasks (organization_id, source_type, source_entity_type, source_entity_id);

create or replace function public.team_delegated_task_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_team_delegated_tasks_updated_at on public.team_delegated_tasks;
create trigger set_team_delegated_tasks_updated_at
before update on public.team_delegated_tasks
for each row execute function public.team_delegated_task_set_updated_at();

alter table public.team_delegated_tasks enable row level security;
revoke all on public.team_delegated_tasks from anon, authenticated;
grant select, insert, update, delete on public.team_delegated_tasks to service_role;

comment on table public.team_delegated_tasks is 'Daily tasks assigned to employees by managers or other Super Leader modules. Kept separate from the employee-authored daily priority plan.';
comment on column public.team_delegated_tasks.source_type is 'Origin of the task: manager, CRM, event, contract, automatic, etc. Enables a universal task source badge.';
comment on column public.team_delegated_tasks.status_note is 'Employee execution note, including blocking reason when status is blocked.';

notify pgrst, 'reload schema';
commit;
