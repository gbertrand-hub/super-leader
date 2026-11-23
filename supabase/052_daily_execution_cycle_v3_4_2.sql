-- Super Leader V3.4.2
-- Daily execution cycle: morning priorities -> progress -> report outcomes.

create table if not exists public.daily_execution_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  minimum_tasks smallint not null default 6 check (minimum_tasks between 1 and 12),
  maximum_tasks smallint not null default 12 check (maximum_tasks between 1 and 12),
  require_expected_outcome boolean not null default true,
  require_task_outcomes_for_report boolean not null default true,
  required_from date not null default current_date,
  plan_lock_time time not null default '10:00',
  allow_plan_revision boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maximum_tasks >= minimum_tasks)
);

create table if not exists public.daily_work_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  attendance_id uuid references public.attendance_records(id) on delete set null,
  daily_report_id uuid references public.daily_reports(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','submitted','locked','completed')),
  minimum_tasks_snapshot smallint not null default 6 check (minimum_tasks_snapshot between 1 and 12),
  submitted_at timestamptz,
  locked_at timestamptz,
  completed_at timestamptz,
  revision_count integer not null default 0 check (revision_count >= 0),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, work_date)
);

create table if not exists public.daily_work_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.daily_work_plans(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  position smallint not null check (position between 1 and 12),
  title text not null check (char_length(trim(title)) between 3 and 240),
  expected_outcome text not null check (char_length(trim(expected_outcome)) between 3 and 1200),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  due_time time,
  category text check (category is null or char_length(trim(category)) <= 120),
  progress_status text not null default 'todo' check (progress_status in ('todo','in_progress','completed','partial','blocked','deferred','cancelled')),
  actual_outcome text,
  outcome_reason text,
  next_action text check (next_action is null or next_action in ('none','tomorrow','reschedule','follow_up','request_help','cancel')),
  next_action_date date,
  completed_at timestamptz,
  report_finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, position)
);

create table if not exists public.daily_work_task_outcome_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.daily_work_plans(id) on delete cascade,
  task_id uuid not null references public.daily_work_tasks(id) on delete cascade,
  daily_report_id uuid not null references public.daily_reports(id) on delete cascade,
  report_revision_number integer not null check (report_revision_number >= 1),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  position smallint not null,
  title text not null,
  expected_outcome text not null,
  priority text not null,
  final_status text not null check (final_status in ('completed','partial','blocked','deferred','cancelled')),
  actual_outcome text not null check (char_length(trim(actual_outcome)) between 3 and 3000),
  outcome_reason text check (outcome_reason is null or char_length(trim(outcome_reason)) <= 2000),
  next_action text check (next_action is null or next_action in ('none','tomorrow','reschedule','follow_up','request_help','cancel')),
  next_action_date date,
  captured_at timestamptz not null default now(),
  unique (task_id, report_revision_number)
);

create index if not exists daily_work_plans_org_date_idx on public.daily_work_plans (organization_id, work_date desc);
create index if not exists daily_work_plans_user_date_idx on public.daily_work_plans (user_id, work_date desc);
create index if not exists daily_work_tasks_org_date_idx on public.daily_work_tasks (organization_id, work_date desc);
create index if not exists daily_work_tasks_user_date_idx on public.daily_work_tasks (user_id, work_date desc);
create index if not exists daily_work_tasks_plan_position_idx on public.daily_work_tasks (plan_id, position);
create index if not exists daily_work_task_versions_report_idx on public.daily_work_task_outcome_versions (daily_report_id, report_revision_number);

create or replace function public.daily_execution_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_daily_execution_settings_updated_at on public.daily_execution_settings;
create trigger set_daily_execution_settings_updated_at
before update on public.daily_execution_settings
for each row execute function public.daily_execution_set_updated_at();

drop trigger if exists set_daily_work_plans_updated_at on public.daily_work_plans;
create trigger set_daily_work_plans_updated_at
before update on public.daily_work_plans
for each row execute function public.daily_execution_set_updated_at();

drop trigger if exists set_daily_work_tasks_updated_at on public.daily_work_tasks;
create trigger set_daily_work_tasks_updated_at
before update on public.daily_work_tasks
for each row execute function public.daily_execution_set_updated_at();

create or replace function public.daily_work_task_sync_scope()
returns trigger
language plpgsql
as $$
declare
  p public.daily_work_plans%rowtype;
begin
  select * into p from public.daily_work_plans where id = new.plan_id;
  if p.id is null then
    raise exception 'Daily work plan not found';
  end if;
  new.organization_id = p.organization_id;
  new.user_id = p.user_id;
  new.work_date = p.work_date;
  return new;
end;
$$;

drop trigger if exists sync_daily_work_task_scope on public.daily_work_tasks;
create trigger sync_daily_work_task_scope
before insert or update of plan_id, organization_id, user_id, work_date on public.daily_work_tasks
for each row execute function public.daily_work_task_sync_scope();

insert into public.daily_execution_settings (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

alter table public.daily_execution_settings enable row level security;
alter table public.daily_work_plans enable row level security;
alter table public.daily_work_tasks enable row level security;
alter table public.daily_work_task_outcome_versions enable row level security;

revoke all on public.daily_execution_settings from anon, authenticated;
revoke all on public.daily_work_plans from anon, authenticated;
revoke all on public.daily_work_tasks from anon, authenticated;
revoke all on public.daily_work_task_outcome_versions from anon, authenticated;

grant select, insert, update, delete on public.daily_execution_settings to service_role;
grant select, insert, update, delete on public.daily_work_plans to service_role;
grant select, insert, update, delete on public.daily_work_tasks to service_role;
grant select, insert, update, delete on public.daily_work_task_outcome_versions to service_role;

comment on table public.daily_execution_settings is 'Organisation rules for the morning priority plan and end-of-day task outcomes.';
comment on table public.daily_work_plans is 'One daily execution plan per employee and work date.';
comment on table public.daily_work_tasks is 'Tasks declared at the start of the day and finalized in the daily report.';
comment on table public.daily_work_task_outcome_versions is 'Immutable task outcome snapshots for each daily report revision.';

notify pgrst, 'reload schema';
