-- Super Leader V4.8.94 - Series recurrentes d'activites Academy
begin;

create extension if not exists pgcrypto;

create table if not exists public.academy_attendance_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  trainer_user_id uuid references auth.users(id) on delete set null,
  title text not null check (char_length(trim(title)) between 2 and 200),
  session_type text not null default 'mastermind'
    check (session_type in ('class','mastermind','practice','coaching_call','review','assessment','other')),
  schedule_type text not null default 'weekly' check (schedule_type = 'weekly'),
  weekdays smallint[] not null default '{}'::smallint[],
  starts_on date not null,
  ends_on date not null,
  starts_at time,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440),
  delivery_mode text not null default 'online' check (delivery_mode in ('online','in_person','hybrid')),
  location_or_link text,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_attendance_series_dates_check check (ends_on >= starts_on),
  constraint academy_attendance_series_weekdays_count_check check (cardinality(weekdays) between 1 and 7),
  constraint academy_attendance_series_weekdays_values_check check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
);

create index if not exists academy_attendance_series_school_idx
  on public.academy_attendance_series (organization_id, school_id, is_active, starts_on, ends_on);

alter table public.academy_attendance_sessions
  add column if not exists series_id uuid references public.academy_attendance_series(id) on delete set null;

create unique index if not exists academy_attendance_sessions_series_date_unique
  on public.academy_attendance_sessions (series_id, session_date)
  where series_id is not null;

create index if not exists academy_attendance_sessions_series_idx
  on public.academy_attendance_sessions (organization_id, series_id, session_date);

alter table public.academy_attendance_series enable row level security;
grant all on public.academy_attendance_series to service_role;

comment on table public.academy_attendance_series is
  'Series recurrentes de seances/activites Academy. Ex: Mastermind chaque dimanche. Une serie n est pas un programme ni une cohorte.';
comment on column public.academy_attendance_series.weekdays is
  'Jours ISO JavaScript 0=dimanche ... 6=samedi.';
comment on column public.academy_attendance_sessions.series_id is
  'Serie recurrente ayant genere cette seance, si applicable.';

commit;
