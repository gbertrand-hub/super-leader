-- SUPER LEADER V2.2.1 - Academy recurring sessions and intensive programmes
-- Weekly schedules, monthly 3-day intensives, Zoom links, attendance and certificate governance.
-- Run after 021_super_leader_academy_v1.sql.

begin;

alter table public.academy_courses
  add column if not exists attendance_required_percent numeric(5,2) not null default 80
    check (attendance_required_percent between 0 and 100);

alter table public.academy_enrollments
  add column if not exists attendance_percent numeric(5,2) not null default 0
    check (attendance_percent between 0 and 100),
  add column if not exists sessions_expected integer not null default 0
    check (sessions_expected >= 0),
  add column if not exists sessions_attended integer not null default 0
    check (sessions_attended >= 0),
  add column if not exists quiz_passed_at timestamptz;

create table if not exists public.academy_course_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  label text not null default 'Programme récurrent' check (char_length(trim(label)) between 3 and 180),
  schedule_type text not null check (schedule_type in ('weekly','monthly_intensive','single')),
  starts_on date not null,
  ends_on date not null,
  local_start_time time not null,
  duration_minutes integer not null default 60 check (duration_minutes between 1 and 1440),
  timezone text not null default 'Europe/Dublin',
  weekdays smallint[] not null default '{}'::smallint[],
  monthly_start_day smallint,
  consecutive_days smallint,
  zoom_join_url text,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (monthly_start_day is null or monthly_start_day between 1 and 28),
  check (consecutive_days is null or consecutive_days between 1 and 14),
  check (
    (schedule_type = 'weekly' and cardinality(weekdays) between 1 and 7)
    or (schedule_type = 'monthly_intensive' and monthly_start_day is not null and consecutive_days is not null)
    or schedule_type = 'single'
  )
);

create index if not exists academy_course_schedules_course_idx
  on public.academy_course_schedules (course_id, starts_on, ends_on);

create table if not exists public.academy_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  schedule_id uuid references public.academy_course_schedules(id) on delete set null,
  title text not null check (char_length(trim(title)) between 3 and 220),
  session_date date not null,
  local_start_time time not null,
  timezone text not null default 'Europe/Dublin',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  delivery_mode text not null default 'zoom' check (delivery_mode in ('zoom','in_person','hybrid','other')),
  zoom_join_url text,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (course_id, starts_at)
);

create index if not exists academy_sessions_course_date_idx
  on public.academy_sessions (course_id, session_date, starts_at);
create index if not exists academy_sessions_org_date_idx
  on public.academy_sessions (organization_id, session_date, status);

create table if not exists public.academy_session_attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.academy_sessions(id) on delete cascade,
  enrollment_id uuid not null references public.academy_enrollments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','present','late','absent','excused')),
  joined_at timestamptz,
  left_at timestamptz,
  attended_minutes integer not null default 0 check (attended_minutes >= 0),
  late_minutes integer not null default 0 check (late_minutes >= 0),
  notes text,
  marked_by uuid references auth.users(id) on delete set null,
  marked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create index if not exists academy_session_attendance_enrollment_idx
  on public.academy_session_attendance (enrollment_id, status);
create index if not exists academy_session_attendance_session_idx
  on public.academy_session_attendance (session_id, status);

-- Create attendance placeholders whenever a session or enrollment is created.
create or replace function public.academy_seed_attendance_for_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.academy_session_attendance (
    organization_id, session_id, enrollment_id, user_id, status
  )
  select new.organization_id, new.id, enrollment.id, enrollment.user_id, 'invited'
  from public.academy_enrollments enrollment
  where enrollment.organization_id = new.organization_id
    and enrollment.course_id = new.course_id
  on conflict (session_id, user_id) do nothing;
  return new;
end;
$$;

create or replace function public.academy_seed_attendance_for_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.academy_session_attendance (
    organization_id, session_id, enrollment_id, user_id, status
  )
  select new.organization_id, session.id, new.id, new.user_id, 'invited'
  from public.academy_sessions session
  where session.organization_id = new.organization_id
    and session.course_id = new.course_id
    and session.status <> 'cancelled'
  on conflict (session_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists academy_sessions_seed_attendance on public.academy_sessions;
create trigger academy_sessions_seed_attendance
after insert on public.academy_sessions
for each row execute function public.academy_seed_attendance_for_session();

drop trigger if exists academy_enrollments_seed_session_attendance on public.academy_enrollments;
create trigger academy_enrollments_seed_session_attendance
after insert on public.academy_enrollments
for each row execute function public.academy_seed_attendance_for_enrollment();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'academy_course_schedules_updated_at') then
    create trigger academy_course_schedules_updated_at
    before update on public.academy_course_schedules
    for each row execute function public.performance_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'academy_sessions_updated_at') then
    create trigger academy_sessions_updated_at
    before update on public.academy_sessions
    for each row execute function public.performance_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'academy_session_attendance_updated_at') then
    create trigger academy_session_attendance_updated_at
    before update on public.academy_session_attendance
    for each row execute function public.performance_set_updated_at();
  end if;
end $$;

-- Backfill attendance placeholders for existing courses and enrollments.
insert into public.academy_session_attendance (
  organization_id, session_id, enrollment_id, user_id, status
)
select session.organization_id, session.id, enrollment.id, enrollment.user_id, 'invited'
from public.academy_sessions session
join public.academy_enrollments enrollment
  on enrollment.organization_id = session.organization_id
 and enrollment.course_id = session.course_id
where session.status <> 'cancelled'
on conflict (session_id, user_id) do nothing;

alter table public.academy_course_schedules enable row level security;
alter table public.academy_sessions enable row level security;
alter table public.academy_session_attendance enable row level security;

drop policy if exists "academy schedules visible by enrolment scope" on public.academy_course_schedules;
create policy "academy schedules visible by enrolment scope"
on public.academy_course_schedules for select to authenticated
using (
  public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or exists (
    select 1
    from public.academy_enrollments enrollment
    where enrollment.organization_id = academy_course_schedules.organization_id
      and enrollment.course_id = academy_course_schedules.course_id
      and (
        enrollment.user_id = auth.uid()
        or (
          public.active_org_role(academy_course_schedules.organization_id) = 'manager'
          and public.is_supervised_org_user(academy_course_schedules.organization_id, enrollment.user_id)
        )
      )
  )
);

drop policy if exists "academy schedules managed by academy admins" on public.academy_course_schedules;
create policy "academy schedules managed by academy admins"
on public.academy_course_schedules for all to authenticated
using (public.has_active_org_role(organization_id, array['owner','admin','hr']))
with check (public.has_active_org_role(organization_id, array['owner','admin','hr']));

drop policy if exists "academy sessions visible by enrolment scope" on public.academy_sessions;
create policy "academy sessions visible by enrolment scope"
on public.academy_sessions for select to authenticated
using (
  public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or exists (
    select 1
    from public.academy_enrollments enrollment
    where enrollment.organization_id = academy_sessions.organization_id
      and enrollment.course_id = academy_sessions.course_id
      and (
        enrollment.user_id = auth.uid()
        or (
          public.active_org_role(academy_sessions.organization_id) = 'manager'
          and public.is_supervised_org_user(academy_sessions.organization_id, enrollment.user_id)
        )
      )
  )
);

drop policy if exists "academy sessions managed by academy admins" on public.academy_sessions;
create policy "academy sessions managed by academy admins"
on public.academy_sessions for all to authenticated
using (public.has_active_org_role(organization_id, array['owner','admin','hr']))
with check (public.has_active_org_role(organization_id, array['owner','admin','hr']));

drop policy if exists "academy attendance visible by scope" on public.academy_session_attendance;
create policy "academy attendance visible by scope"
on public.academy_session_attendance for select to authenticated
using (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (
    public.active_org_role(organization_id) = 'manager'
    and public.is_supervised_org_user(organization_id, user_id)
  )
);

drop policy if exists "academy attendance managed by leaders" on public.academy_session_attendance;
create policy "academy attendance managed by leaders"
on public.academy_session_attendance for update to authenticated
using (
  public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (
    public.active_org_role(organization_id) = 'manager'
    and public.is_supervised_org_user(organization_id, user_id)
  )
)
with check (
  public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (
    public.active_org_role(organization_id) = 'manager'
    and public.is_supervised_org_user(organization_id, user_id)
  )
);

revoke all on public.academy_course_schedules from anon, authenticated;
revoke all on public.academy_sessions from anon, authenticated;
revoke all on public.academy_session_attendance from anon, authenticated;

grant select on public.academy_course_schedules to authenticated;
grant select on public.academy_sessions to authenticated;
grant select on public.academy_session_attendance to authenticated;

grant all on public.academy_course_schedules to service_role;
grant all on public.academy_sessions to service_role;
grant all on public.academy_session_attendance to service_role;

commit;
notify pgrst, 'reload schema';
