-- Super Leader Academy V2.2.5
-- Strict final-quiz and certificate governance.
-- A quiz/certificate is blocked until all non-cancelled sessions have ended
-- and the participant has reached the configured attendance threshold.

begin;

create or replace function public.academy_assert_training_eligibility(
  p_enrollment_id uuid,
  p_require_quiz_score boolean default false,
  p_score numeric default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enrollment public.academy_enrollments%rowtype;
  v_course public.academy_courses%rowtype;
  v_total_sessions integer := 0;
  v_finished_sessions integer := 0;
  v_excused integer := 0;
  v_expected integer := 0;
  v_attended integer := 0;
  v_attendance numeric := 0;
begin
  select * into v_enrollment
  from public.academy_enrollments
  where id = p_enrollment_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ACADEMY_ENROLLMENT_NOT_FOUND';
  end if;

  select * into v_course
  from public.academy_courses
  where id = v_enrollment.course_id
    and organization_id = v_enrollment.organization_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ACADEMY_COURSE_NOT_FOUND';
  end if;

  if p_require_quiz_score and coalesce(p_score, v_enrollment.best_score, 0) < v_course.passing_score then
    raise exception using errcode = 'P0001', message = 'ACADEMY_QUIZ_PASS_MARK_NOT_REACHED';
  end if;

  if coalesce(v_course.attendance_required_percent, 0) <= 0 then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where session.status = 'completed'
         or session.ends_at <= now()
    )::integer
  into v_total_sessions, v_finished_sessions
  from public.academy_sessions session
  where session.organization_id = v_enrollment.organization_id
    and session.course_id = v_enrollment.course_id
    and session.status <> 'cancelled';

  if v_total_sessions = 0 then
    raise exception using errcode = 'P0001', message = 'ACADEMY_QUIZ_LOCKED_NO_SESSIONS';
  end if;

  if v_finished_sessions < v_total_sessions then
    raise exception using errcode = 'P0001', message = 'ACADEMY_QUIZ_LOCKED_SESSIONS_PENDING';
  end if;

  select
    count(*) filter (where attendance.status = 'excused')::integer,
    count(*) filter (where attendance.status in ('present', 'late'))::integer
  into v_excused, v_attended
  from public.academy_sessions session
  left join public.academy_session_attendance attendance
    on attendance.session_id = session.id
   and attendance.enrollment_id = v_enrollment.id
   and attendance.organization_id = v_enrollment.organization_id
  where session.organization_id = v_enrollment.organization_id
    and session.course_id = v_enrollment.course_id
    and session.status <> 'cancelled'
    and (session.status = 'completed' or session.ends_at <= now());

  v_expected := greatest(0, v_finished_sessions - coalesce(v_excused, 0));
  v_attendance := case
    when v_expected > 0 then round((coalesce(v_attended, 0)::numeric / v_expected::numeric) * 100, 2)
    when v_finished_sessions > 0 then 100
    else 0
  end;

  if v_attendance < v_course.attendance_required_percent then
    raise exception using
      errcode = 'P0001',
      message = 'ACADEMY_QUIZ_LOCKED_ATTENDANCE',
      detail = format('Attendance %s%%; required %s%%.', v_attendance, v_course.attendance_required_percent);
  end if;
end;
$$;

create or replace function public.academy_guard_quiz_attempt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.academy_assert_training_eligibility(new.enrollment_id, false, null);
  return new;
end;
$$;

drop trigger if exists academy_quiz_attempt_strict_eligibility on public.academy_quiz_attempts;
create trigger academy_quiz_attempt_strict_eligibility
before insert on public.academy_quiz_attempts
for each row execute function public.academy_guard_quiz_attempt();

create or replace function public.academy_guard_certificate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$;
begin
  perform public.academy_assert_training_eligibility(new.enrollment_id, true, new.final_score);
  return new;
end;
$$;

drop trigger if exists academy_certificate_strict_eligibility on public.academy_certificates;
drop trigger if exists academy_certificate_strict_eligibility_insert on public.academy_certificates;
drop trigger if exists academy_certificate_strict_eligibility_update on public.academy_certificates;

create trigger academy_certificate_strict_eligibility_insert
before insert on public.academy_certificates
for each row
when (new.status = 'active')
execute function public.academy_guard_certificate();

create trigger academy_certificate_strict_eligibility_update
before update of enrollment_id, final_score, status on public.academy_certificates
for each row
when (new.status = 'active')
execute function public.academy_guard_certificate();

revoke all on function public.academy_assert_training_eligibility(uuid, boolean, numeric) from public, anon, authenticated;
grant execute on function public.academy_assert_training_eligibility(uuid, boolean, numeric) to service_role;

commit;

notify pgrst, 'reload schema';
