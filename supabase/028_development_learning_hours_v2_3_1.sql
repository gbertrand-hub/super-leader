begin;

-- Super Leader V2.3.1 - Parcours de formation et heures de developpement

alter table public.growth_settings
  add column if not exists default_development_target_hours numeric(7,2) not null default 12 check (default_development_target_hours between 0 and 300),
  add column if not exists default_reading_target_hours numeric(7,2) not null default 2 check (default_reading_target_hours between 0 and 100),
  add column if not exists development_credit_per_hour numeric(7,2) not null default 1 check (development_credit_per_hour between 0 and 20),
  add column if not exists reading_credit_per_hour numeric(7,2) not null default 1.5 check (reading_credit_per_hour between 0 and 20),
  add column if not exists max_development_credits numeric(7,2) not null default 20 check (max_development_credits between 0 and 500);

alter table public.growth_plans
  add column if not exists target_development_hours numeric(7,2) not null default 12 check (target_development_hours between 0 and 300),
  add column if not exists target_reading_hours numeric(7,2) not null default 2 check (target_reading_hours between 0 and 100);

alter table public.academy_courses
  add column if not exists growth_program_code text not null default 'other_training';

alter table public.academy_courses
  drop constraint if exists academy_courses_growth_program_code_check;
alter table public.academy_courses
  add constraint academy_courses_growth_program_code_check check (growth_program_code in (
    'school_coaches',
    'school_business',
    'school_experts',
    'school_breeders',
    'vision_monday',
    'other_training'
  ));

create table if not exists public.development_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  source text not null default 'manual' check (source in ('manual','academy')),
  program_code text not null check (program_code in (
    'school_coaches',
    'school_business',
    'school_experts',
    'school_breeders',
    'vision_monday',
    'book_reading',
    'other_training'
  )),
  title text not null check (char_length(trim(title)) between 2 and 240),
  author text check (author is null or char_length(trim(author)) <= 180),
  start_time time,
  end_time time,
  crosses_midnight boolean not null default false,
  timezone text not null default 'Europe/Dublin',
  duration_minutes integer not null check (duration_minutes between 15 and 1440),
  night_minutes integer not null default 0 check (night_minutes between 0 and 1440),
  weekend_minutes integer not null default 0 check (weekend_minutes between 0 and 1440),
  status text not null default 'submitted' check (status in (
    'submitted','approved','partially_approved','rejected','cancelled','auto_validated'
  )),
  approved_minutes integer check (approved_minutes is null or approved_minutes between 0 and 1440),
  growth_credits numeric(7,2) not null default 0 check (growth_credits between 0 and 200),
  learning_summary text not null default '',
  application_commitment text not null default '',
  evidence_url text,
  academy_course_id uuid references public.academy_courses(id) on delete set null,
  academy_session_id uuid references public.academy_sessions(id) on delete set null,
  academy_attendance_id uuid references public.academy_session_attendance(id) on delete cascade,
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academy_attendance_id),
  check (
    (program_code = 'book_reading' and char_length(trim(learning_summary)) >= 5 and char_length(trim(application_commitment)) >= 5)
    or program_code <> 'book_reading'
  )
);

create index if not exists development_activities_org_user_date_idx
  on public.development_activities (organization_id, user_id, activity_date desc);
create index if not exists development_activities_org_status_idx
  on public.development_activities (organization_id, status, activity_date desc);
create index if not exists development_activities_program_idx
  on public.development_activities (organization_id, program_code, activity_date desc);

-- Helpers for the automatic Academy -> Growth Plan synchronisation.
create or replace function public.growth_minutes_overlap(
  p_start integer,
  p_end integer,
  p_window_start integer,
  p_window_end integer
)
returns integer
language sql
immutable
as $$
  select greatest(0, least(p_end, p_window_end) - greatest(p_start, p_window_start));
$$;

create or replace function public.growth_night_minutes(
  p_start_time time,
  p_duration integer,
  p_night_start time,
  p_night_end time
)
returns integer
language plpgsql
immutable
as $$
declare
  v_start integer := extract(hour from p_start_time)::integer * 60 + extract(minute from p_start_time)::integer;
  v_end integer := v_start + p_duration;
  v_night_start integer := extract(hour from p_night_start)::integer * 60 + extract(minute from p_night_start)::integer;
  v_night_end integer := extract(hour from p_night_end)::integer * 60 + extract(minute from p_night_end)::integer;
  v_total integer := 0;
  v_day integer;
begin
  for v_day in -1..1 loop
    if v_night_start > v_night_end then
      v_total := v_total + public.growth_minutes_overlap(v_start, v_end, v_day * 1440 + v_night_start, v_day * 1440 + 1440 + v_night_end);
    else
      v_total := v_total + public.growth_minutes_overlap(v_start, v_end, v_day * 1440 + v_night_start, v_day * 1440 + v_night_end);
    end if;
  end loop;
  return least(p_duration, v_total);
end;
$$;

create or replace function public.sync_academy_attendance_to_development()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.academy_sessions%rowtype;
  v_course public.academy_courses%rowtype;
  v_settings public.growth_settings%rowtype;
  v_duration integer;
  v_night integer;
  v_weekend integer;
  v_credits numeric(7,2);
begin
  if tg_op = 'DELETE' then
    delete from public.development_activities where academy_attendance_id = old.id;
    return old;
  end if;

  if new.status not in ('present','late') then
    delete from public.development_activities where academy_attendance_id = new.id;
    return new;
  end if;

  select * into v_session from public.academy_sessions where id = new.session_id;
  if v_session.id is null or v_session.status = 'cancelled' then
    delete from public.development_activities where academy_attendance_id = new.id;
    return new;
  end if;

  select * into v_course from public.academy_courses where id = v_session.course_id;
  select * into v_settings from public.growth_settings where organization_id = new.organization_id;

  v_duration := least(1440, case
    when coalesce(new.attended_minutes, 0) >= 15 then new.attended_minutes
    else greatest(15, round(extract(epoch from (v_session.ends_at - v_session.starts_at)) / 60)::integer)
  end);

  v_night := public.growth_night_minutes(
    v_session.local_start_time,
    v_duration,
    coalesce(v_settings.night_start_time, '22:00'::time),
    coalesce(v_settings.night_end_time, '06:00'::time)
  );
  v_weekend := case when extract(isodow from v_session.session_date) in (6,7) then v_duration else 0 end;
  v_credits := least(20, round((v_duration::numeric / 60) * coalesce(v_settings.development_credit_per_hour, 1) * 10) / 10);

  insert into public.development_activities (
    organization_id,
    user_id,
    activity_date,
    source,
    program_code,
    title,
    start_time,
    end_time,
    crosses_midnight,
    timezone,
    duration_minutes,
    night_minutes,
    weekend_minutes,
    status,
    approved_minutes,
    growth_credits,
    learning_summary,
    application_commitment,
    academy_course_id,
    academy_session_id,
    academy_attendance_id,
    reviewed_by,
    reviewed_at
  ) values (
    new.organization_id,
    new.user_id,
    v_session.session_date,
    'academy',
    coalesce(v_course.growth_program_code, 'other_training'),
    v_course.title || ' - ' || v_session.title,
    v_session.local_start_time,
    (v_session.local_start_time + make_interval(mins => v_duration))::time,
    (extract(hour from v_session.local_start_time)::integer * 60 + extract(minute from v_session.local_start_time)::integer + v_duration) >= 1440,
    v_session.timezone,
    v_duration,
    v_night,
    v_weekend,
    'auto_validated',
    v_duration,
    v_credits,
    'Presence validee dans Super Leader Academy.',
    'Appliquer les apprentissages dans le travail et le plan de croissance.',
    v_course.id,
    v_session.id,
    new.id,
    new.marked_by,
    coalesce(new.marked_at, now())
  )
  on conflict (academy_attendance_id) do update set
    activity_date = excluded.activity_date,
    program_code = excluded.program_code,
    title = excluded.title,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    crosses_midnight = excluded.crosses_midnight,
    timezone = excluded.timezone,
    duration_minutes = excluded.duration_minutes,
    night_minutes = excluded.night_minutes,
    weekend_minutes = excluded.weekend_minutes,
    status = 'auto_validated',
    approved_minutes = excluded.approved_minutes,
    growth_credits = excluded.growth_credits,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists academy_attendance_sync_development on public.academy_session_attendance;
create trigger academy_attendance_sync_development
after insert or delete or update of status, attended_minutes, marked_by, marked_at
on public.academy_session_attendance
for each row execute function public.sync_academy_attendance_to_development();

-- Replace the course bundle RPC so that the growth programme selected in the wizard is saved.
create or replace function public.academy_create_course_bundle_v2_2_4(
  p_organization_id uuid,
  p_actor_id uuid,
  p_course jsonb,
  p_schedules jsonb default '[]'::jsonb,
  p_questions jsonb default '[]'::jsonb,
  p_user_ids uuid[] default '{}'::uuid[],
  p_publish boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_schedule_id uuid;
  v_schedule jsonb;
  v_session jsonb;
  v_question jsonb;
  v_questions_count integer := 0;
  v_schedules_count integer := 0;
  v_sessions_count integer := 0;
  v_enrollments_count integer := 0;
  v_certificate_enabled boolean := coalesce((p_course->>'certificate_enabled')::boolean, true);
begin
  if not exists (
    select 1 from public.organization_members membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id
      and membership.is_active = true
      and membership.role in ('owner','admin','hr')
  ) then
    raise exception 'ACADEMY_WIZARD_PERMISSION_DENIED';
  end if;

  select count(*) into v_questions_count from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb));
  if p_publish and v_certificate_enabled and v_questions_count = 0 then
    raise exception 'ACADEMY_WIZARD_QUIZ_REQUIRED';
  end if;

  insert into public.academy_courses (
    organization_id,title,description,category,growth_program_code,training_month,deadline,
    duration_minutes,is_required,passing_score,max_attempts,attendance_required_percent,
    certificate_enabled,resource_url,status,created_by,published_by,published_at
  ) values (
    p_organization_id,
    trim(p_course->>'title'),
    coalesce(p_course->>'description',''),
    coalesce(nullif(trim(p_course->>'category'),''),'professional_development'),
    coalesce(nullif(trim(p_course->>'growth_program_code'),''),'other_training'),
    (p_course->>'training_month')::date,
    (p_course->>'deadline')::date,
    (p_course->>'duration_minutes')::integer,
    coalesce((p_course->>'is_required')::boolean,true),
    (p_course->>'passing_score')::numeric,
    (p_course->>'max_attempts')::integer,
    (p_course->>'attendance_required_percent')::numeric,
    v_certificate_enabled,
    nullif(trim(p_course->>'resource_url'),''),
    case when p_publish then 'published' else 'draft' end,
    p_actor_id,
    case when p_publish then p_actor_id else null end,
    case when p_publish then now() else null end
  ) returning id into v_course_id;

  for v_question in select value from jsonb_array_elements(coalesce(p_questions,'[]'::jsonb)) loop
    insert into public.academy_quiz_questions (
      organization_id,course_id,question_text,options,correct_option,points,position
    ) values (
      p_organization_id,v_course_id,trim(v_question->>'question_text'),v_question->'options',
      (v_question->>'correct_option')::integer,(v_question->>'points')::numeric,(v_question->>'position')::integer
    );
  end loop;

  for v_schedule in select value from jsonb_array_elements(coalesce(p_schedules,'[]'::jsonb)) loop
    insert into public.academy_course_schedules (
      organization_id,course_id,label,schedule_type,starts_on,ends_on,local_start_time,duration_minutes,
      timezone,weekdays,monthly_start_day,consecutive_days,zoom_join_url,created_by
    ) values (
      p_organization_id,v_course_id,trim(v_schedule->>'label'),v_schedule->>'schedule_type',
      (v_schedule->>'starts_on')::date,(v_schedule->>'ends_on')::date,(v_schedule->>'local_start_time')::time,
      (v_schedule->>'duration_minutes')::integer,coalesce(nullif(v_schedule->>'timezone',''),'Europe/Dublin'),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_schedule->'weekdays','[]'::jsonb))::smallint),'{}'::smallint[]),
      case when nullif(v_schedule->>'monthly_start_day','') is null then null else (v_schedule->>'monthly_start_day')::smallint end,
      case when nullif(v_schedule->>'consecutive_days','') is null then null else (v_schedule->>'consecutive_days')::smallint end,
      nullif(trim(v_schedule->>'zoom_join_url'),''),p_actor_id
    ) returning id into v_schedule_id;
    v_schedules_count := v_schedules_count + 1;

    for v_session in select value from jsonb_array_elements(coalesce(v_schedule->'sessions','[]'::jsonb)) loop
      insert into public.academy_sessions (
        organization_id,course_id,schedule_id,title,session_date,local_start_time,timezone,starts_at,ends_at,
        delivery_mode,zoom_join_url,status,created_by
      ) values (
        p_organization_id,v_course_id,v_schedule_id,trim(v_session->>'title'),(v_session->>'session_date')::date,
        (v_session->>'local_start_time')::time,coalesce(nullif(v_session->>'timezone',''),'Europe/Dublin'),
        (v_session->>'starts_at')::timestamptz,(v_session->>'ends_at')::timestamptz,
        coalesce(nullif(v_session->>'delivery_mode',''),'other'),nullif(trim(v_session->>'zoom_join_url'),''),
        'scheduled',p_actor_id
      );
      v_sessions_count := v_sessions_count + 1;
    end loop;
  end loop;

  if coalesce(array_length(p_user_ids,1),0) > 0 then
    insert into public.academy_enrollments (
      organization_id,course_id,user_id,status,progress_percent,assigned_by,assigned_at
    )
    select p_organization_id,v_course_id,member.user_id,'assigned',0,p_actor_id,now()
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.is_active = true
      and member.user_id = any(p_user_ids)
    on conflict (course_id,user_id) do nothing;
    get diagnostics v_enrollments_count = row_count;
  end if;

  return jsonb_build_object(
    'course_id',v_course_id,
    'questions_created',v_questions_count,
    'schedules_created',v_schedules_count,
    'sessions_created',v_sessions_count,
    'enrollments_created',v_enrollments_count,
    'published',p_publish
  );
end;
$$;

-- Backfill already validated Academy attendance records.
with attendance_rows as (
  select
    attendance.organization_id,
    attendance.user_id,
    attendance.id as attendance_id,
    attendance.marked_by,
    coalesce(attendance.marked_at, now()) as marked_at,
    session.id as session_id,
    session.session_date,
    session.local_start_time,
    session.timezone,
    course.id as course_id,
    course.title as course_title,
    session.title as session_title,
    coalesce(course.growth_program_code, 'other_training') as program_code,
    least(1440, greatest(
      15,
      coalesce(
        nullif(attendance.attended_minutes, 0),
        round(extract(epoch from (session.ends_at - session.starts_at)) / 60)::integer
      )
    )) as effective_minutes,
    coalesce(settings.night_start_time, '22:00'::time) as night_start_time,
    coalesce(settings.night_end_time, '06:00'::time) as night_end_time,
    coalesce(settings.development_credit_per_hour, 1) as credit_rate
  from public.academy_session_attendance attendance
  join public.academy_sessions session
    on session.id = attendance.session_id
   and session.status <> 'cancelled'
  join public.academy_courses course on course.id = session.course_id
  left join public.growth_settings settings on settings.organization_id = attendance.organization_id
  where attendance.status in ('present','late')
)
insert into public.development_activities (
  organization_id,user_id,activity_date,source,program_code,title,start_time,end_time,crosses_midnight,
  timezone,duration_minutes,night_minutes,weekend_minutes,status,approved_minutes,growth_credits,
  learning_summary,application_commitment,academy_course_id,academy_session_id,academy_attendance_id,
  reviewed_by,reviewed_at
)
select
  row.organization_id,
  row.user_id,
  row.session_date,
  'academy',
  row.program_code,
  row.course_title || ' - ' || row.session_title,
  row.local_start_time,
  (row.local_start_time + make_interval(mins => row.effective_minutes))::time,
  (extract(hour from row.local_start_time)::integer * 60 + extract(minute from row.local_start_time)::integer + row.effective_minutes) >= 1440,
  row.timezone,
  row.effective_minutes,
  public.growth_night_minutes(row.local_start_time, row.effective_minutes, row.night_start_time, row.night_end_time),
  case when extract(isodow from row.session_date) in (6,7) then row.effective_minutes else 0 end,
  'auto_validated',
  row.effective_minutes,
  least(20, round((row.effective_minutes::numeric / 60) * row.credit_rate * 10) / 10),
  'Presence validee dans Super Leader Academy.',
  'Appliquer les apprentissages dans le travail et le plan de croissance.',
  row.course_id,
  row.session_id,
  row.attendance_id,
  row.marked_by,
  row.marked_at
from attendance_rows row
on conflict (academy_attendance_id) do nothing;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'development_activities_updated_at') then
    create trigger development_activities_updated_at
    before update on public.development_activities
    for each row execute function public.performance_set_updated_at();
  end if;
end $$;

alter table public.development_activities enable row level security;

drop policy if exists "development activities visible by scope" on public.development_activities;
create policy "development activities visible by scope"
on public.development_activities for select to authenticated
using (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
);

drop policy if exists "development activities self submitted" on public.development_activities;
create policy "development activities self submitted"
on public.development_activities for insert to authenticated
with check (
  user_id = auth.uid()
  and source = 'manual'
  and public.has_active_org_role(organization_id, array['owner','admin','hr','manager','employee'])
);

drop policy if exists "development activities updated by scope" on public.development_activities;
create policy "development activities updated by scope"
on public.development_activities for update to authenticated
using (
  (user_id = auth.uid() and source = 'manual' and status = 'submitted')
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
)
with check (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
);

revoke all on public.development_activities from anon, authenticated;
grant select on public.development_activities to authenticated;
grant all on public.development_activities to service_role;

revoke all on function public.academy_create_course_bundle_v2_2_4(uuid,uuid,jsonb,jsonb,jsonb,uuid[],boolean) from public;
grant execute on function public.academy_create_course_bundle_v2_2_4(uuid,uuid,jsonb,jsonb,jsonb,uuid[],boolean) to service_role;

commit;
notify pgrst, 'reload schema';
