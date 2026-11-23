-- SUPER LEADER V2.6
-- Gouvernance de Ma journee, verrouillage des rapports et classification du temps
-- A executer apres 032_free_plan_v2_5_2.sql

alter table public.performance_settings
  add column if not exists workday_reopen_enabled boolean not null default true,
  add column if not exists maximum_workday_reopenings_per_day integer not null default 1,
  add column if not exists long_day_warning_minutes integer not null default 720,
  add column if not exists night_work_start time not null default '22:00',
  add column if not exists night_work_end time not null default '06:00';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'performance_settings_workday_reopenings_check') then
    alter table public.performance_settings
      add constraint performance_settings_workday_reopenings_check
      check (maximum_workday_reopenings_per_day between 1 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'performance_settings_long_day_warning_check') then
    alter table public.performance_settings
      add constraint performance_settings_long_day_warning_check
      check (long_day_warning_minutes between 240 and 1440);
  end if;
end $$;

alter table public.attendance_records
  add column if not exists total_work_minutes integer not null default 0,
  add column if not exists scheduled_work_minutes integer not null default 0,
  add column if not exists outside_schedule_minutes integer not null default 0,
  add column if not exists night_minutes integer not null default 0,
  add column if not exists weekend_minutes integer not null default 0,
  add column if not exists work_timezone text,
  add column if not exists closure_count integer not null default 0,
  add column if not exists last_closed_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references auth.users(id),
  add column if not exists reopening_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_records_time_totals_check') then
    alter table public.attendance_records
      add constraint attendance_records_time_totals_check
      check (
        total_work_minutes >= 0 and
        scheduled_work_minutes >= 0 and
        outside_schedule_minutes >= 0 and
        night_minutes >= 0 and
        weekend_minutes >= 0 and
        closure_count >= 0
      );
  end if;
end $$;

create table if not exists public.attendance_reopenings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  attendance_id uuid not null references public.attendance_records(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  reason text not null check (char_length(trim(reason)) between 10 and 2000),
  previous_clock_out_at timestamptz not null,
  previous_total_work_minutes integer not null default 0,
  previous_outside_schedule_minutes integer not null default 0,
  previous_night_minutes integer not null default 0,
  previous_weekend_minutes integer not null default 0,
  status text not null default 'active' check (status in ('active','closed','revoked')),
  reopened_by uuid not null references auth.users(id),
  reopened_at timestamptz not null default now(),
  closed_at timestamptz,
  new_clock_out_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists attendance_reopenings_one_active_idx
  on public.attendance_reopenings (attendance_id)
  where status = 'active';

create index if not exists attendance_reopenings_org_date_idx
  on public.attendance_reopenings (organization_id, work_date desc, status);

alter table public.daily_report_reopenings
  add column if not exists reopening_type text not null default 'missing',
  add column if not exists existing_report_id uuid references public.daily_reports(id) on delete set null,
  add column if not exists previous_status text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'daily_report_reopenings_type_check') then
    alter table public.daily_report_reopenings
      add constraint daily_report_reopenings_type_check
      check (reopening_type in ('missing','revision'));
  end if;
end $$;

alter table public.daily_reports
  add column if not exists revision_number integer not null default 1,
  add column if not exists locked_at timestamptz,
  add column if not exists last_reopened_at timestamptz,
  add column if not exists last_reopened_by uuid references auth.users(id),
  add column if not exists last_revision_reason text;

update public.daily_reports
set locked_at = coalesce(locked_at, submitted_at),
    revision_number = greatest(coalesce(revision_number, 1), 1)
where locked_at is null or revision_number is null or revision_number < 1;

create table if not exists public.daily_report_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null references public.daily_reports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null,
  version_number integer not null check (version_number >= 1),
  accomplishments text not null,
  results text not null,
  blockers text not null,
  next_priorities text not null,
  status text not null,
  submitted_at timestamptz not null,
  submitted_by uuid not null references auth.users(id),
  submission_mode text not null,
  submission_score_factor numeric(4,3) not null,
  supervisor_reason text,
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  archived_by uuid not null references auth.users(id),
  archive_reason text not null,
  reopening_id uuid references public.daily_report_reopenings(id) on delete set null,
  archived_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (report_id, version_number)
);

create index if not exists daily_report_versions_org_user_date_idx
  on public.daily_report_versions (organization_id, user_id, report_date desc, version_number desc);

alter table public.attendance_reopenings enable row level security;
alter table public.daily_report_versions enable row level security;
revoke all on public.attendance_reopenings from anon, authenticated;
revoke all on public.daily_report_versions from anon, authenticated;
grant select, insert, update, delete on public.attendance_reopenings to service_role;
grant select, insert, update, delete on public.daily_report_versions to service_role;

drop trigger if exists set_attendance_reopenings_updated_at on public.attendance_reopenings;
create trigger set_attendance_reopenings_updated_at
before update on public.attendance_reopenings
for each row execute function public.performance_set_updated_at();

notify pgrst, 'reload schema';
