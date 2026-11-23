-- SUPER LEADER - Performance, Presences & Employe du mois V1
-- A executer apres 001_company_team.sql et 002_members_assignment.sql

create extension if not exists pgcrypto;

create table if not exists public.performance_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'Europe/Dublin',
  default_start_time time not null default '09:00',
  default_end_time time not null default '17:00',
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 180),
  report_deadline_time time not null default '18:00',
  minimum_work_days integer not null default 10 check (minimum_work_days between 1 and 31),
  minimum_report_rate numeric(5,2) not null default 90 check (minimum_report_rate between 0 and 100),
  minimum_score numeric(5,2) not null default 80 check (minimum_score between 0 and 100),
  maximum_unexcused_absences integer not null default 0 check (maximum_unexcused_absences between 0 and 31),
  attendance_weight numeric(5,2) not null default 20 check (attendance_weight between 0 and 100),
  punctuality_weight numeric(5,2) not null default 15 check (punctuality_weight between 0 and 100),
  meetings_weight numeric(5,2) not null default 10 check (meetings_weight between 0 and 100),
  reports_weight numeric(5,2) not null default 15 check (reports_weight between 0 and 100),
  collaboration_weight numeric(5,2) not null default 10 check (collaboration_weight between 0 and 100),
  role_kpi_weight numeric(5,2) not null default 30 check (role_kpi_weight between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_work_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  timezone text not null default 'Europe/Dublin',
  work_days smallint[] not null default array[1,2,3,4,5]::smallint[],
  start_time time not null default '09:00',
  end_time time not null default '17:00',
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 180),
  report_deadline_time time not null default '18:00',
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  scheduled_start time,
  scheduled_end time,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  status text not null default 'present' check (status in ('present','late','absent','excused','remote')),
  late_minutes integer not null default 0 check (late_minutes >= 0),
  justification text,
  source text not null default 'web' check (source in ('web','manual','qr','import')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, work_date)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  leave_type text not null check (leave_type in ('annual','sick','family','training','unpaid','other')),
  start_date date not null,
  end_date date not null,
  reason text not null,
  document_url text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.performance_meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 200),
  meeting_type text not null default 'team' check (meeting_type in ('team','training','client','company','other')),
  mandatory boolean not null default true,
  starts_at timestamptz not null,
  ends_at timestamptz,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.performance_meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid not null references public.performance_meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','present','late','absent','excused')),
  joined_at timestamptz,
  late_minutes integer not null default 0 check (late_minutes >= 0),
  notes text,
  marked_by uuid references auth.users(id),
  marked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, user_id)
);

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null,
  accomplishments text not null check (char_length(trim(accomplishments)) between 3 and 3000),
  results text not null check (char_length(trim(results)) between 3 and 3000),
  blockers text not null check (char_length(trim(blockers)) between 1 and 3000),
  next_priorities text not null check (char_length(trim(next_priorities)) between 3 and 3000),
  status text not null default 'submitted' check (status in ('submitted','on_time','late','incomplete','needs_revision','validated')),
  submitted_at timestamptz not null default now(),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, report_date)
);

create table if not exists public.monthly_kpi_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score_month date not null,
  score numeric(5,2) not null check (score between 0 and 30),
  notes text,
  assessed_by uuid not null references auth.users(id),
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, score_month),
  check (date_trunc('month', score_month)::date = score_month)
);

create table if not exists public.employee_month_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score_month date not null,
  attendance_score numeric(5,2) not null default 0,
  punctuality_score numeric(5,2) not null default 0,
  meetings_score numeric(5,2) not null default 0,
  reports_score numeric(5,2) not null default 0,
  collaboration_score numeric(5,2) not null default 0,
  role_kpi_score numeric(5,2) not null default 0,
  total_score numeric(5,2) not null default 0 check (total_score between 0 and 100),
  scheduled_days integer not null default 0,
  attended_days integer not null default 0,
  late_days integer not null default 0,
  unexcused_absences integer not null default 0,
  reports_expected integer not null default 0,
  reports_submitted integer not null default 0,
  mandatory_meetings integer not null default 0,
  meetings_attended integer not null default 0,
  eligible boolean not null default false,
  eligibility_note text,
  position integer,
  calculated_by uuid references auth.users(id),
  calculated_at timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, score_month),
  check (date_trunc('month', score_month)::date = score_month)
);

create table if not exists public.employee_month_awards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  award_month date not null,
  winner_id uuid not null references auth.users(id),
  final_score numeric(5,2) not null check (final_score between 0 and 100),
  announcement_note text,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, award_month),
  check (date_trunc('month', award_month)::date = award_month)
);

create table if not exists public.performance_score_appeals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score_month date not null,
  reason text not null check (char_length(trim(reason)) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  resolution_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, score_month),
  check (date_trunc('month', score_month)::date = score_month)
);

create table if not exists public.performance_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  subject_user_id uuid references auth.users(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attendance_records_org_date_idx on public.attendance_records (organization_id, work_date desc);
create index if not exists attendance_records_user_date_idx on public.attendance_records (user_id, work_date desc);
create index if not exists leave_requests_org_status_idx on public.leave_requests (organization_id, status, start_date);
create index if not exists performance_meetings_org_start_idx on public.performance_meetings (organization_id, starts_at desc);
create index if not exists daily_reports_org_date_idx on public.daily_reports (organization_id, report_date desc);
create index if not exists employee_month_scores_org_month_idx on public.employee_month_scores (organization_id, score_month, total_score desc);
create index if not exists performance_appeals_org_month_idx on public.performance_score_appeals (organization_id, score_month, status);
create index if not exists performance_audit_org_created_idx on public.performance_audit_log (organization_id, created_at desc);

create or replace function public.performance_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'performance_settings','member_work_schedules','attendance_records','leave_requests',
    'performance_meetings','performance_meeting_attendance','daily_reports',
    'monthly_kpi_scores','employee_month_scores','performance_score_appeals'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || table_name || '_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.performance_set_updated_at()',
      'set_' || table_name || '_updated_at', table_name
    );
  end loop;
end $$;

insert into public.performance_settings (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

alter table public.performance_settings enable row level security;
alter table public.member_work_schedules enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_requests enable row level security;
alter table public.performance_meetings enable row level security;
alter table public.performance_meeting_attendance enable row level security;
alter table public.daily_reports enable row level security;
alter table public.monthly_kpi_scores enable row level security;
alter table public.employee_month_scores enable row level security;
alter table public.employee_month_awards enable row level security;
alter table public.performance_score_appeals enable row level security;
alter table public.performance_audit_log enable row level security;

revoke all on public.performance_settings from anon, authenticated;
revoke all on public.member_work_schedules from anon, authenticated;
revoke all on public.attendance_records from anon, authenticated;
revoke all on public.leave_requests from anon, authenticated;
revoke all on public.performance_meetings from anon, authenticated;
revoke all on public.performance_meeting_attendance from anon, authenticated;
revoke all on public.daily_reports from anon, authenticated;
revoke all on public.monthly_kpi_scores from anon, authenticated;
revoke all on public.employee_month_scores from anon, authenticated;
revoke all on public.employee_month_awards from anon, authenticated;
revoke all on public.performance_score_appeals from anon, authenticated;
revoke all on public.performance_audit_log from anon, authenticated;

grant select, insert, update, delete on public.performance_settings to service_role;
grant select, insert, update, delete on public.member_work_schedules to service_role;
grant select, insert, update, delete on public.attendance_records to service_role;
grant select, insert, update, delete on public.leave_requests to service_role;
grant select, insert, update, delete on public.performance_meetings to service_role;
grant select, insert, update, delete on public.performance_meeting_attendance to service_role;
grant select, insert, update, delete on public.daily_reports to service_role;
grant select, insert, update, delete on public.monthly_kpi_scores to service_role;
grant select, insert, update, delete on public.employee_month_scores to service_role;
grant select, insert, update, delete on public.employee_month_awards to service_role;
grant select, insert, update, delete on public.performance_score_appeals to service_role;
grant select, insert, update, delete on public.performance_audit_log to service_role;

notify pgrst, 'reload schema';
