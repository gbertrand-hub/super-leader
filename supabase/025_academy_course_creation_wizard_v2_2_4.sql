-- SUPER LEADER ACADEMY V2.2.4
-- Assistant transactionnel de creation des formations.
-- A executer apres 024_academy_session_integrity_v2_2_3.sql.

begin;

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
    select 1
    from public.organization_members membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_id
      and membership.is_active = true
      and membership.role in ('owner', 'admin', 'hr')
  ) then
    raise exception 'ACADEMY_WIZARD_PERMISSION_DENIED';
  end if;

  select count(*) into v_questions_count
  from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb));

  if p_publish and v_certificate_enabled and v_questions_count = 0 then
    raise exception 'ACADEMY_WIZARD_QUIZ_REQUIRED';
  end if;

  insert into public.academy_courses (
    organization_id,
    title,
    description,
    category,
    training_month,
    deadline,
    duration_minutes,
    is_required,
    passing_score,
    max_attempts,
    attendance_required_percent,
    certificate_enabled,
    resource_url,
    status,
    created_by,
    published_by,
    published_at
  ) values (
    p_organization_id,
    trim(p_course->>'title'),
    coalesce(p_course->>'description', ''),
    coalesce(nullif(trim(p_course->>'category'), ''), 'professional_development'),
    (p_course->>'training_month')::date,
    (p_course->>'deadline')::date,
    (p_course->>'duration_minutes')::integer,
    coalesce((p_course->>'is_required')::boolean, true),
    (p_course->>'passing_score')::numeric,
    (p_course->>'max_attempts')::integer,
    (p_course->>'attendance_required_percent')::numeric,
    v_certificate_enabled,
    nullif(trim(p_course->>'resource_url'), ''),
    case when p_publish then 'published' else 'draft' end,
    p_actor_id,
    case when p_publish then p_actor_id else null end,
    case when p_publish then now() else null end
  ) returning id into v_course_id;

  for v_question in
    select value from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb))
  loop
    insert into public.academy_quiz_questions (
      organization_id,
      course_id,
      question_text,
      options,
      correct_option,
      points,
      position
    ) values (
      p_organization_id,
      v_course_id,
      trim(v_question->>'question_text'),
      v_question->'options',
      (v_question->>'correct_option')::integer,
      (v_question->>'points')::numeric,
      (v_question->>'position')::integer
    );
  end loop;

  for v_schedule in
    select value from jsonb_array_elements(coalesce(p_schedules, '[]'::jsonb))
  loop
    insert into public.academy_course_schedules (
      organization_id,
      course_id,
      label,
      schedule_type,
      starts_on,
      ends_on,
      local_start_time,
      duration_minutes,
      timezone,
      weekdays,
      monthly_start_day,
      consecutive_days,
      zoom_join_url,
      created_by
    ) values (
      p_organization_id,
      v_course_id,
      trim(v_schedule->>'label'),
      v_schedule->>'schedule_type',
      (v_schedule->>'starts_on')::date,
      (v_schedule->>'ends_on')::date,
      (v_schedule->>'local_start_time')::time,
      (v_schedule->>'duration_minutes')::integer,
      coalesce(nullif(v_schedule->>'timezone', ''), 'Europe/Dublin'),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_schedule->'weekdays', '[]'::jsonb))::smallint), '{}'::smallint[]),
      case when nullif(v_schedule->>'monthly_start_day', '') is null then null else (v_schedule->>'monthly_start_day')::smallint end,
      case when nullif(v_schedule->>'consecutive_days', '') is null then null else (v_schedule->>'consecutive_days')::smallint end,
      nullif(trim(v_schedule->>'zoom_join_url'), ''),
      p_actor_id
    ) returning id into v_schedule_id;

    v_schedules_count := v_schedules_count + 1;

    for v_session in
      select value from jsonb_array_elements(coalesce(v_schedule->'sessions', '[]'::jsonb))
    loop
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
        created_by
      ) values (
        p_organization_id,
        v_course_id,
        v_schedule_id,
        trim(v_session->>'title'),
        (v_session->>'session_date')::date,
        (v_session->>'local_start_time')::time,
        coalesce(nullif(v_session->>'timezone', ''), 'Europe/Dublin'),
        (v_session->>'starts_at')::timestamptz,
        (v_session->>'ends_at')::timestamptz,
        coalesce(nullif(v_session->>'delivery_mode', ''), 'other'),
        nullif(trim(v_session->>'zoom_join_url'), ''),
        'scheduled',
        p_actor_id
      );
      v_sessions_count := v_sessions_count + 1;
    end loop;
  end loop;

  if coalesce(array_length(p_user_ids, 1), 0) > 0 then
    insert into public.academy_enrollments (
      organization_id,
      course_id,
      user_id,
      status,
      progress_percent,
      assigned_by,
      assigned_at
    )
    select
      p_organization_id,
      v_course_id,
      member.user_id,
      'assigned',
      0,
      p_actor_id,
      now()
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.is_active = true
      and member.user_id = any(p_user_ids)
    on conflict (course_id, user_id) do nothing;

    get diagnostics v_enrollments_count = row_count;
  end if;

  return jsonb_build_object(
    'course_id', v_course_id,
    'questions_created', v_questions_count,
    'schedules_created', v_schedules_count,
    'sessions_created', v_sessions_count,
    'enrollments_created', v_enrollments_count,
    'published', p_publish
  );
end;
$$;

revoke all on function public.academy_create_course_bundle_v2_2_4(uuid, uuid, jsonb, jsonb, jsonb, uuid[], boolean) from public;
grant execute on function public.academy_create_course_bundle_v2_2_4(uuid, uuid, jsonb, jsonb, jsonb, uuid[], boolean) to service_role;

commit;

notify pgrst, 'reload schema';
