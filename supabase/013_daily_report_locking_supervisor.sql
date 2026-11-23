-- SUPER LEADER - Performance V1.1
-- Verrouillage des rapports journaliers, reouverture superviseur et saisie pour le compte d'un collaborateur
-- A executer apres 012_performance_employee_of_month.sql

alter table public.performance_settings
  add column if not exists report_lock_enabled boolean not null default true,
  add column if not exists maximum_reopen_hours integer not null default 24,
  add column if not exists maximum_reopenings_per_day integer not null default 1,
  add column if not exists reopened_report_score_percent numeric(5,2) not null default 70,
  add column if not exists supervisor_report_score_percent numeric(5,2) not null default 50;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'performance_settings_maximum_reopen_hours_check'
  ) then
    alter table public.performance_settings
      add constraint performance_settings_maximum_reopen_hours_check
      check (maximum_reopen_hours between 1 and 168);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'performance_settings_maximum_reopenings_check'
  ) then
    alter table public.performance_settings
      add constraint performance_settings_maximum_reopenings_check
      check (maximum_reopenings_per_day between 1 and 10);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'performance_settings_reopened_score_check'
  ) then
    alter table public.performance_settings
      add constraint performance_settings_reopened_score_check
      check (reopened_report_score_percent between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'performance_settings_supervisor_score_check'
  ) then
    alter table public.performance_settings
      add constraint performance_settings_supervisor_score_check
      check (supervisor_report_score_percent between 0 and 100);
  end if;
end $$;

alter table public.member_work_schedules
  add column if not exists supervisor_id uuid references auth.users(id);

create index if not exists member_work_schedules_supervisor_idx
  on public.member_work_schedules (organization_id, supervisor_id)
  where is_active = true;

create table if not exists public.daily_report_reopenings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null,
  reason text not null check (char_length(trim(reason)) between 10 and 2000),
  justified boolean not null default false,
  score_factor numeric(4,3) not null default 0.700 check (score_factor between 0 and 1),
  status text not null default 'active' check (status in ('active','used','expired','revoked')),
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > opened_at)
);

create index if not exists daily_report_reopenings_org_date_idx
  on public.daily_report_reopenings (organization_id, report_date desc, status);

create index if not exists daily_report_reopenings_user_date_idx
  on public.daily_report_reopenings (user_id, report_date desc, status);

create unique index if not exists daily_report_reopenings_one_active_idx
  on public.daily_report_reopenings (organization_id, user_id, report_date)
  where status = 'active';

alter table public.daily_reports
  add column if not exists submitted_by uuid references auth.users(id),
  add column if not exists submission_mode text not null default 'employee',
  add column if not exists submission_score_factor numeric(4,3) not null default 1,
  add column if not exists supervisor_reason text,
  add column if not exists reopening_id uuid references public.daily_report_reopenings(id);

update public.daily_reports
set submitted_by = user_id
where submitted_by is null;

alter table public.daily_reports
  alter column submitted_by set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'daily_reports_status_check'
  ) then
    alter table public.daily_reports drop constraint daily_reports_status_check;
  end if;
  alter table public.daily_reports
    add constraint daily_reports_status_check
    check (status in ('submitted','on_time','late','incomplete','needs_revision','validated','supervisor_completed'));

  if not exists (
    select 1 from pg_constraint where conname = 'daily_reports_submission_mode_check'
  ) then
    alter table public.daily_reports
      add constraint daily_reports_submission_mode_check
      check (submission_mode in ('employee','reopened_employee','supervisor'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'daily_reports_score_factor_check'
  ) then
    alter table public.daily_reports
      add constraint daily_reports_score_factor_check
      check (submission_score_factor between 0 and 1);
  end if;
end $$;

alter table public.daily_report_reopenings enable row level security;
revoke all on public.daily_report_reopenings from anon, authenticated;
grant select, insert, update, delete on public.daily_report_reopenings to service_role;

-- Reutilise le mecanisme updated_at installe par la migration 012.
drop trigger if exists set_daily_report_reopenings_updated_at on public.daily_report_reopenings;
create trigger set_daily_report_reopenings_updated_at
before update on public.daily_report_reopenings
for each row execute function public.performance_set_updated_at();

notify pgrst, 'reload schema';
