-- SUPER LEADER V2.2.3 - Academy session integrity and quiz governance
-- Repairs missing sessions from active schedules, backfills attendance placeholders,
-- and keeps learner attendance counters aligned with the actual session calendar.
-- Run after 023_academy_schedule_editing_v2_2_2.sql.

begin;

create or replace function public.academy_repair_course_sessions_v2_2_3(
  p_organization_id uuid,
  p_course_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions_created integer := 0;
  v_attendance_created integer := 0;
begin
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id
      and member.is_active = true
      and member.role in ('owner','admin','hr')
  ) then
    raise exception 'ACADEMY_SESSION_REPAIR_PERMISSION_DENIED';
  end if;

  if not exists (
    select 1
    from public.academy_courses course
    where course.id = p_course_id
      and course.organization_id = p_organization_id
  ) then
    raise exception 'ACADEMY_COURSE_NOT_FOUND';
  end if;

  with active_schedules as (
    select schedule.*
    from public.academy_course_schedules schedule
    where schedule.organization_id = p_organization_id
      and schedule.course_id = p_course_id
      and schedule.is_active = true
  ), weekly_dates as (
    select
      schedule.id as schedule_id,
      schedule.organization_id,
      schedule.course_id,
      schedule.label,
      schedule.schedule_type,
      day_value::date as session_date,
      1::integer as day_number,
      schedule.local_start_time,
      schedule.duration_minutes,
      schedule.timezone,
      schedule.zoom_join_url
    from active_schedules schedule
    cross join lateral generate_series(schedule.starts_on, schedule.ends_on, interval '1 day') day_value
    where schedule.schedule_type = 'weekly'
      and extract(isodow from day_value)::smallint = any(schedule.weekdays)
  ), monthly_dates as (
    select
      schedule.id as schedule_id,
      schedule.organization_id,
      schedule.course_id,
      schedule.label,
      schedule.schedule_type,
      (month_value::date + (schedule.monthly_start_day - 1) + day_offset)::date as session_date,
      day_offset + 1 as day_number,
      schedule.local_start_time,
      schedule.duration_minutes,
      schedule.timezone,
      schedule.zoom_join_url
    from active_schedules schedule
    cross join lateral generate_series(
      date_trunc('month', schedule.starts_on::timestamp),
      date_trunc('month', schedule.ends_on::timestamp),
      interval '1 month'
    ) month_value
    cross join lateral generate_series(0, schedule.consecutive_days - 1) day_offset
    where schedule.schedule_type = 'monthly_intensive'
      and (month_value::date + (schedule.monthly_start_day - 1) + day_offset)::date between schedule.starts_on and schedule.ends_on
  ), single_dates as (
    select
      schedule.id as schedule_id,
      schedule.organization_id,
      schedule.course_id,
      schedule.label,
      schedule.schedule_type,
      schedule.starts_on as session_date,
      1::integer as day_number,
      schedule.local_start_time,
      schedule.duration_minutes,
      schedule.timezone,
      schedule.zoom_join_url
    from active_schedules schedule
    where schedule.schedule_type = 'single'
  ), candidate_dates as (
    select * from weekly_dates
    union all
    select * from monthly_dates
    union all
    select * from single_dates
  ), inserted as (
    insert into public.academy_sessions (
      organization_id,
      course_id,
      schedule_id,
      title,
      session_date,
      local_start_time,
      timezone,
      starts_at,
      ends_at,
      delivery_mode,
      zoom_join_url,
      status,
      archived_by_schedule,
      created_by
    )
    select
      candidate.organization_id,
      candidate.course_id,
      candidate.schedule_id,
      case
        when candidate.schedule_type = 'monthly_intensive'
          then candidate.label || ' - Jour ' || candidate.day_number::text
        else candidate.label
      end,
      candidate.session_date,
      candidate.local_start_time,
      candidate.timezone,
      (candidate.session_date + candidate.local_start_time) at time zone candidate.timezone,
      ((candidate.session_date + candidate.local_start_time) at time zone candidate.timezone)
        + candidate.duration_minutes * interval '1 minute',
      case when nullif(trim(coalesce(candidate.zoom_join_url, '')), '') is null then 'other' else 'zoom' end,
      nullif(trim(coalesce(candidate.zoom_join_url, '')), ''),
      'scheduled',
      false,
      p_actor_id
    from candidate_dates candidate
    on conflict (course_id, starts_at) do nothing
    returning id
  )
  select count(*) into v_sessions_created from inserted;

  insert into public.academy_session_attendance (
    organization_id,
    session_id,
    enrollment_id,
    user_id,
    status
  )
  select
    session.organization_id,
    session.id,
    enrollment.id,
    enrollment.user_id,
    'invited'
  from public.academy_sessions session
  join public.academy_enrollments enrollment
    on enrollment.organization_id = session.organization_id
   and enrollment.course_id = session.course_id
  where session.organization_id = p_organization_id
    and session.course_id = p_course_id
    and session.status <> 'cancelled'
  on conflict (session_id, user_id) do nothing;
  get diagnostics v_attendance_created = row_count;

  with session_scope as (
    select session.id
    from public.academy_sessions session
    where session.organization_id = p_organization_id
      and session.course_id = p_course_id
      and session.status <> 'cancelled'
  ), attendance_stats as (
    select
      enrollment.id as enrollment_id,
      greatest(
        0,
        count(session_scope.id)::integer
          - count(*) filter (where attendance.status = 'excused')::integer
      ) as expected,
      count(*) filter (where attendance.status in ('present','late'))::integer as attended
    from public.academy_enrollments enrollment
    left join session_scope on true
    left join public.academy_session_attendance attendance
      on attendance.enrollment_id = enrollment.id
     and attendance.session_id = session_scope.id
    where enrollment.organization_id = p_organization_id
      and enrollment.course_id = p_course_id
    group by enrollment.id
  )
  update public.academy_enrollments enrollment
  set sessions_expected = stats.expected,
      sessions_attended = stats.attended,
      attendance_percent = case
        when stats.expected > 0 then round((stats.attended::numeric / stats.expected::numeric) * 100, 2)
        when exists (select 1 from session_scope) then 100
        else 0
      end,
      updated_at = now()
  from attendance_stats stats
  where enrollment.id = stats.enrollment_id;

  return jsonb_build_object(
    'sessions_created', v_sessions_created,
    'attendance_rows_created', v_attendance_created
  );
end;
$$;

revoke all on function public.academy_repair_course_sessions_v2_2_3(uuid, uuid, uuid) from public;
grant execute on function public.academy_repair_course_sessions_v2_2_3(uuid, uuid, uuid) to authenticated, service_role;

-- Repair existing active course schedules immediately after migration.
do $$
declare
  item record;
  actor_id uuid;
begin
  for item in
    select distinct schedule.organization_id, schedule.course_id
    from public.academy_course_schedules schedule
    where schedule.is_active = true
  loop
    select member.user_id into actor_id
    from public.organization_members member
    where member.organization_id = item.organization_id
      and member.is_active = true
      and member.role in ('owner','admin','hr')
    order by case member.role when 'owner' then 1 when 'admin' then 2 else 3 end
    limit 1;

    if actor_id is not null then
      perform public.academy_repair_course_sessions_v2_2_3(
        item.organization_id,
        item.course_id,
        actor_id
      );
    end if;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
