-- SUPER LEADER V2.2.2 - Academy recurring schedule editing
-- Adds schedule revisions, safe regeneration of future sessions, archiving/restoration,
-- and duplicate protection. Run after 022_academy_recurring_sessions_v2_2_1.sql.

begin;

alter table public.academy_sessions
  add column if not exists archived_by_schedule boolean not null default false;

alter table public.academy_course_schedules
  add column if not exists revision integer not null default 1 check (revision >= 1),
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists last_regenerated_at timestamptz,
  add column if not exists last_regenerated_by uuid references auth.users(id) on delete set null;

create table if not exists public.academy_schedule_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  schedule_id uuid not null references public.academy_course_schedules(id) on delete cascade,
  revision integer not null check (revision >= 1),
  change_type text not null check (change_type in ('updated','archived','restored')),
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  sessions_removed integer not null default 0 check (sessions_removed >= 0),
  sessions_created integer not null default 0 check (sessions_created >= 0),
  reason text,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (schedule_id, revision)
);

create index if not exists academy_schedule_revisions_schedule_idx
  on public.academy_schedule_revisions (schedule_id, revision desc);
create index if not exists academy_schedule_revisions_org_idx
  on public.academy_schedule_revisions (organization_id, created_at desc);

alter table public.academy_schedule_revisions enable row level security;

drop policy if exists "academy schedule revisions visible to academy admins" on public.academy_schedule_revisions;
create policy "academy schedule revisions visible to academy admins"
on public.academy_schedule_revisions for select to authenticated
using (public.has_active_org_role(organization_id, array['owner','admin','hr']));

revoke all on public.academy_schedule_revisions from anon, authenticated;
grant select on public.academy_schedule_revisions to authenticated;
grant all on public.academy_schedule_revisions to service_role;

create or replace function public.academy_replace_schedule_v2_2_2(
  p_organization_id uuid,
  p_schedule_id uuid,
  p_actor_id uuid,
  p_schedule jsonb,
  p_sessions jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.academy_course_schedules%rowtype;
  v_previous jsonb;
  v_new jsonb;
  v_revision integer;
  v_removed integer := 0;
  v_created integer := 0;
  v_course_id uuid;
  v_now timestamptz := now();
begin
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id
      and member.is_active = true
      and member.role in ('owner','admin','hr')
  ) then
    raise exception 'ACADEMY_SCHEDULE_PERMISSION_DENIED';
  end if;

  select * into v_schedule
  from public.academy_course_schedules
  where id = p_schedule_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'ACADEMY_SCHEDULE_NOT_FOUND';
  end if;

  if v_schedule.is_active = false then
    raise exception 'ACADEMY_SCHEDULE_ARCHIVED';
  end if;

  v_previous := to_jsonb(v_schedule);
  v_course_id := v_schedule.course_id;
  v_revision := v_schedule.revision + 1;

  -- A generated start time may not collide with another series or a manually created session.
  if exists (
    select 1
    from public.academy_sessions existing
    join jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
      as incoming(starts_at timestamptz)
      on incoming.starts_at = existing.starts_at
    where existing.organization_id = p_organization_id
      and existing.course_id = v_course_id
      and existing.schedule_id is distinct from p_schedule_id
  ) then
    raise exception 'ACADEMY_SCHEDULE_SESSION_CONFLICT';
  end if;

  -- Only future, still scheduled sessions without meaningful attendance are regenerated.
  -- Past sessions and any session already marked present/late/absent/excused are preserved.
  with deletable as (
    select session.id
    from public.academy_sessions session
    where session.organization_id = p_organization_id
      and session.course_id = v_course_id
      and session.schedule_id = p_schedule_id
      and session.starts_at > v_now
      and (session.status = 'scheduled' or session.archived_by_schedule = true)
      and not exists (
        select 1
        from public.academy_session_attendance attendance
        where attendance.session_id = session.id
          and attendance.status <> 'invited'
      )
  ), removed as (
    delete from public.academy_sessions session
    using deletable
    where session.id = deletable.id
    returning session.id
  )
  select count(*) into v_removed from removed;

  update public.academy_course_schedules
  set label = trim(p_schedule->>'label'),
      schedule_type = p_schedule->>'schedule_type',
      starts_on = (p_schedule->>'starts_on')::date,
      ends_on = (p_schedule->>'ends_on')::date,
      local_start_time = (p_schedule->>'local_start_time')::time,
      duration_minutes = (p_schedule->>'duration_minutes')::integer,
      timezone = p_schedule->>'timezone',
      weekdays = coalesce(
        array(select jsonb_array_elements_text(coalesce(p_schedule->'weekdays', '[]'::jsonb))::smallint),
        '{}'::smallint[]
      ),
      monthly_start_day = nullif(p_schedule->>'monthly_start_day', '')::smallint,
      consecutive_days = nullif(p_schedule->>'consecutive_days', '')::smallint,
      zoom_join_url = nullif(trim(coalesce(p_schedule->>'zoom_join_url', '')), ''),
      revision = v_revision,
      last_regenerated_at = v_now,
      last_regenerated_by = p_actor_id,
      updated_at = v_now
  where id = p_schedule_id;

  with inserted as (
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
      p_organization_id,
      v_course_id,
      p_schedule_id,
      incoming.title,
      incoming.session_date,
      incoming.local_start_time,
      incoming.timezone,
      incoming.starts_at,
      incoming.ends_at,
      incoming.delivery_mode,
      incoming.zoom_join_url,
      'scheduled',
      false,
      p_actor_id
    from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb)) as incoming(
      title text,
      session_date date,
      local_start_time time,
      timezone text,
      starts_at timestamptz,
      ends_at timestamptz,
      delivery_mode text,
      zoom_join_url text
    )
    on conflict (course_id, starts_at) do nothing
    returning id
  )
  select count(*) into v_created from inserted;

  select to_jsonb(schedule) into v_new
  from public.academy_course_schedules schedule
  where schedule.id = p_schedule_id;

  insert into public.academy_schedule_revisions (
    organization_id,
    course_id,
    schedule_id,
    revision,
    change_type,
    previous_values,
    new_values,
    sessions_removed,
    sessions_created,
    reason,
    actor_id
  ) values (
    p_organization_id,
    v_course_id,
    p_schedule_id,
    v_revision,
    'updated',
    v_previous,
    v_new,
    v_removed,
    v_created,
    nullif(trim(coalesce(p_reason, '')), ''),
    p_actor_id
  );

  return jsonb_build_object(
    'revision', v_revision,
    'sessions_removed', v_removed,
    'sessions_created', v_created
  );
end;
$$;

create or replace function public.academy_set_schedule_active_v2_2_2(
  p_organization_id uuid,
  p_schedule_id uuid,
  p_actor_id uuid,
  p_active boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.academy_course_schedules%rowtype;
  v_previous jsonb;
  v_new jsonb;
  v_revision integer;
  v_affected integer := 0;
  v_change_type text;
begin
  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id
      and member.is_active = true
      and member.role in ('owner','admin','hr')
  ) then
    raise exception 'ACADEMY_SCHEDULE_PERMISSION_DENIED';
  end if;

  select * into v_schedule
  from public.academy_course_schedules
  where id = p_schedule_id
    and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'ACADEMY_SCHEDULE_NOT_FOUND';
  end if;

  v_previous := to_jsonb(v_schedule);
  v_revision := v_schedule.revision + 1;
  v_change_type := case when p_active then 'restored' else 'archived' end;

  if p_active = false then
    update public.academy_sessions
    set status = 'cancelled', archived_by_schedule = true, updated_at = now()
    where organization_id = p_organization_id
      and course_id = v_schedule.course_id
      and schedule_id = p_schedule_id
      and starts_at > now()
      and status = 'scheduled';
    get diagnostics v_affected = row_count;
  end if;

  update public.academy_course_schedules
  set is_active = p_active,
      archived_at = case when p_active then null else now() end,
      archived_by = case when p_active then null else p_actor_id end,
      revision = v_revision,
      updated_at = now()
  where id = p_schedule_id;

  select to_jsonb(schedule) into v_new
  from public.academy_course_schedules schedule
  where schedule.id = p_schedule_id;

  insert into public.academy_schedule_revisions (
    organization_id,
    course_id,
    schedule_id,
    revision,
    change_type,
    previous_values,
    new_values,
    sessions_removed,
    sessions_created,
    reason,
    actor_id
  ) values (
    p_organization_id,
    v_schedule.course_id,
    p_schedule_id,
    v_revision,
    v_change_type,
    v_previous,
    v_new,
    0,
    0,
    nullif(trim(coalesce(p_reason, '')), ''),
    p_actor_id
  );

  return jsonb_build_object(
    'revision', v_revision,
    'sessions_cancelled', v_affected,
    'is_active', p_active
  );
end;
$$;

revoke all on function public.academy_replace_schedule_v2_2_2(uuid,uuid,uuid,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.academy_set_schedule_active_v2_2_2(uuid,uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.academy_replace_schedule_v2_2_2(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
grant execute on function public.academy_set_schedule_active_v2_2_2(uuid,uuid,uuid,boolean,text) to service_role;

commit;
notify pgrst, 'reload schema';
