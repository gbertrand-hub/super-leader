-- SUPER LEADER V2.9.3
-- Politiques de travail fixes, flexibles et autonomes
-- Pauses, objectifs de temps et fermeture justifiee des journees courtes
-- A executer apres 038_attendance_contact_centre_v2_9_2.sql

alter table public.member_work_schedules
  add column if not exists work_policy text,
  add column if not exists start_window_from time,
  add column if not exists start_window_until time,
  add column if not exists daily_target_minutes integer,
  add column if not exists weekly_target_minutes integer,
  add column if not exists core_hours_start time,
  add column if not exists core_hours_end time,
  add column if not exists latest_end_time time,
  add column if not exists allow_overnight boolean,
  add column if not exists pause_tracking_enabled boolean,
  add column if not exists short_day_justification_required boolean,
  add column if not exists report_required_before_clock_out boolean,
  add column if not exists attendance_tracking_required boolean,
  add column if not exists employee_alert_delay_minutes integer,
  add column if not exists supervisor_alert_delay_minutes integer;

-- Backfill first, before NOT NULL and consistency constraints are applied.
update public.member_work_schedules
set work_policy = coalesce(work_policy, 'fixed'),
    start_window_from = coalesce(start_window_from, start_time),
    start_window_until = coalesce(start_window_until, start_time),
    daily_target_minutes = coalesce(
      daily_target_minutes,
      greatest(
        60,
        case
          when end_time > start_time then extract(epoch from (end_time - start_time))::integer / 60
          else 1440 - (extract(epoch from start_time)::integer / 60) + (extract(epoch from end_time)::integer / 60)
        end
      )
    ),
    weekly_target_minutes = coalesce(
      weekly_target_minutes,
      greatest(
        60,
        coalesce(array_length(work_days, 1), 5) * greatest(
          60,
          case
            when end_time > start_time then extract(epoch from (end_time - start_time))::integer / 60
            else 1440 - (extract(epoch from start_time)::integer / 60) + (extract(epoch from end_time)::integer / 60)
          end
        )
      )
    ),
    allow_overnight = coalesce(allow_overnight, false),
    pause_tracking_enabled = coalesce(pause_tracking_enabled, true),
    short_day_justification_required = coalesce(short_day_justification_required, true),
    report_required_before_clock_out = coalesce(report_required_before_clock_out, false),
    attendance_tracking_required = coalesce(attendance_tracking_required, true),
    employee_alert_delay_minutes = coalesce(employee_alert_delay_minutes, 0),
    supervisor_alert_delay_minutes = coalesce(supervisor_alert_delay_minutes, 30)
where true;

alter table public.member_work_schedules
  alter column work_policy set default 'fixed',
  alter column work_policy set not null,
  alter column start_window_from set default '09:00',
  alter column start_window_from set not null,
  alter column start_window_until set default '09:00',
  alter column start_window_until set not null,
  alter column daily_target_minutes set default 480,
  alter column daily_target_minutes set not null,
  alter column weekly_target_minutes set default 2400,
  alter column weekly_target_minutes set not null,
  alter column allow_overnight set default false,
  alter column allow_overnight set not null,
  alter column pause_tracking_enabled set default true,
  alter column pause_tracking_enabled set not null,
  alter column short_day_justification_required set default true,
  alter column short_day_justification_required set not null,
  alter column report_required_before_clock_out set default false,
  alter column report_required_before_clock_out set not null,
  alter column attendance_tracking_required set default true,
  alter column attendance_tracking_required set not null,
  alter column employee_alert_delay_minutes set default 0,
  alter column employee_alert_delay_minutes set not null,
  alter column supervisor_alert_delay_minutes set default 30,
  alter column supervisor_alert_delay_minutes set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'member_work_schedules_policy_check') then
    alter table public.member_work_schedules
      add constraint member_work_schedules_policy_check
      check (work_policy in ('fixed','flexible','autonomous'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'member_work_schedules_daily_target_check') then
    alter table public.member_work_schedules
      add constraint member_work_schedules_daily_target_check
      check (daily_target_minutes between 0 and 1440);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'member_work_schedules_weekly_target_check') then
    alter table public.member_work_schedules
      add constraint member_work_schedules_weekly_target_check
      check (weekly_target_minutes between 0 and 10080);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'member_work_schedules_alert_delays_check') then
    alter table public.member_work_schedules
      add constraint member_work_schedules_alert_delays_check
      check (
        employee_alert_delay_minutes between 0 and 1440 and
        supervisor_alert_delay_minutes between 0 and 1440
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'member_work_schedules_core_hours_check') then
    alter table public.member_work_schedules
      add constraint member_work_schedules_core_hours_check
      check (
        (core_hours_start is null and core_hours_end is null) or
        (core_hours_start is not null and core_hours_end is not null)
      );
  end if;
end $$;

alter table public.attendance_records
  add column if not exists work_policy text,
  add column if not exists target_work_minutes integer,
  add column if not exists gross_work_minutes integer,
  add column if not exists pause_minutes integer,
  add column if not exists short_day boolean,
  add column if not exists short_day_justification text,
  add column if not exists target_met boolean;

-- Existing attendance data must be made consistent before constraints are added.
update public.attendance_records
set work_policy = coalesce(work_policy, 'fixed'),
    target_work_minutes = greatest(coalesce(target_work_minutes, 0), coalesce(scheduled_work_minutes, 0)),
    gross_work_minutes = greatest(coalesce(gross_work_minutes, 0), coalesce(total_work_minutes, 0)),
    pause_minutes = greatest(coalesce(pause_minutes, 0), 0),
    short_day = coalesce(short_day, false),
    target_met = case
      when greatest(coalesce(target_work_minutes, 0), coalesce(scheduled_work_minutes, 0)) <= 0 then false
      else coalesce(total_work_minutes, 0) >= greatest(coalesce(target_work_minutes, 0), coalesce(scheduled_work_minutes, 0))
    end
where true;

alter table public.attendance_records
  alter column work_policy set default 'fixed',
  alter column work_policy set not null,
  alter column target_work_minutes set default 0,
  alter column target_work_minutes set not null,
  alter column gross_work_minutes set default 0,
  alter column gross_work_minutes set not null,
  alter column pause_minutes set default 0,
  alter column pause_minutes set not null,
  alter column short_day set default false,
  alter column short_day set not null,
  alter column target_met set default false,
  alter column target_met set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_records_work_policy_check') then
    alter table public.attendance_records
      add constraint attendance_records_work_policy_check
      check (work_policy in ('fixed','flexible','autonomous'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'attendance_records_flexible_totals_check') then
    alter table public.attendance_records
      add constraint attendance_records_flexible_totals_check
      check (
        target_work_minutes >= 0 and
        gross_work_minutes >= 0 and
        pause_minutes >= 0 and
        total_work_minutes >= 0 and
        total_work_minutes <= gross_work_minutes
      );
  end if;
end $$;

create table if not exists public.attendance_breaks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  attendance_id uuid not null references public.attendance_records(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists attendance_breaks_one_open_idx
  on public.attendance_breaks (attendance_id)
  where ended_at is null;

create index if not exists attendance_breaks_org_user_started_idx
  on public.attendance_breaks (organization_id, user_id, started_at desc);

create index if not exists attendance_breaks_attendance_idx
  on public.attendance_breaks (attendance_id, started_at);

alter table public.attendance_breaks enable row level security;
revoke all on public.attendance_breaks from anon, authenticated;
grant select, insert, update, delete on public.attendance_breaks to service_role;

drop trigger if exists set_attendance_breaks_updated_at on public.attendance_breaks;
create trigger set_attendance_breaks_updated_at
before update on public.attendance_breaks
for each row execute function public.performance_set_updated_at();

notify pgrst, 'reload schema';
