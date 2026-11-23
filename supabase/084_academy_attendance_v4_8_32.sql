-- Super Leader V4.8.32 - Séances et feuilles de présence Academy
begin;
create extension if not exists pgcrypto;

create table if not exists public.academy_attendance_sessions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 school_id uuid not null references public.academy_schools(id) on delete cascade,
 program_id uuid references public.academy_programs(id) on delete set null,
 cohort_id uuid references public.academy_cohorts(id) on delete set null,
 trainer_user_id uuid references auth.users(id) on delete set null,
 title text not null check(char_length(trim(title)) between 2 and 200),
 session_date date not null,
 starts_at time,
 duration_minutes integer check(duration_minutes is null or duration_minutes between 1 and 1440),
 delivery_mode text not null default 'online' check(delivery_mode in ('online','in_person','hybrid')),
 location_or_link text,
 status text not null default 'planned' check(status in ('planned','open','closed','cancelled')),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.academy_attendance_records (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 session_id uuid not null references public.academy_attendance_sessions(id) on delete cascade,
 enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
 attendance_status text not null default 'unmarked' check(attendance_status in ('unmarked','present','absent','late','excused')),
 arrived_at time, comment text check(comment is null or char_length(comment)<=1000),
 marked_by uuid references auth.users(id) on delete set null, marked_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(session_id,enrollment_id)
);
create index if not exists academy_attendance_sessions_scope_idx on public.academy_attendance_sessions(organization_id,school_id,session_date desc);
create index if not exists academy_attendance_records_enrollment_idx on public.academy_attendance_records(enrollment_id,attendance_status);

alter table public.academy_attendance_sessions enable row level security;
alter table public.academy_attendance_records enable row level security;
grant all on public.academy_attendance_sessions,public.academy_attendance_records to service_role;
commit;
