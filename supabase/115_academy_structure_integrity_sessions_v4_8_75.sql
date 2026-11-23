-- Super Leader V4.8.75
-- Academy Structure Integrity: Programme -> Cohorte -> Sessions/activites
-- Safe restructuring keeps enrollment IDs, payments, attendance, assessments and certificates intact.

begin;

create extension if not exists pgcrypto;

alter table public.academy_attendance_sessions
  add column if not exists session_type text not null default 'class';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname='academy_attendance_sessions_session_type_check'
  ) then
    alter table public.academy_attendance_sessions
      add constraint academy_attendance_sessions_session_type_check
      check (session_type in ('class','mastermind','practice','coaching_call','review','assessment','other'));
  end if;
end $$;

create index if not exists academy_attendance_sessions_type_idx
  on public.academy_attendance_sessions(organization_id,school_id,session_type,session_date desc);

create table if not exists public.academy_structure_change_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  canonical_program_id uuid references public.academy_programs(id) on delete set null,
  target_cohort_id uuid references public.academy_cohorts(id) on delete set null,
  source_cohort_id uuid references public.academy_cohorts(id) on delete set null,
  moved_enrollments integer not null default 0,
  copied_cohort_tariff boolean not null default false,
  archived_program_ids uuid[] not null default '{}'::uuid[],
  archived_cohort_ids uuid[] not null default '{}'::uuid[],
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists academy_structure_change_log_school_idx
  on public.academy_structure_change_log(organization_id,school_id,created_at desc);

alter table public.academy_structure_change_log enable row level security;
revoke all on public.academy_structure_change_log from anon, authenticated;
grant all on public.academy_structure_change_log to service_role;

create or replace function public.restructure_academy_school(
  target_organization_id uuid,
  target_school_id uuid,
  canonical_program_id uuid,
  target_cohort_id uuid,
  target_cohort_name text default null,
  source_cohort_id uuid default null,
  archive_program_ids uuid[] default '{}'::uuid[],
  archive_cohort_ids uuid[] default '{}'::uuid[],
  copy_source_tariff boolean default true,
  target_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  p record;
  tc record;
  sc record;
  source_tariff record;
  moved_ids uuid[] := '{}'::uuid[];
  moved_count integer := 0;
  copied_tariff boolean := false;
  bad_program uuid;
  bad_cohort uuid;
  next_version integer;
  enrollment_id_to_sync uuid;
begin
  select id,school_id,status into p
  from public.academy_programs
  where id=canonical_program_id
    and organization_id=target_organization_id
    and school_id=target_school_id
    and status <> 'archived';
  if not found then raise exception 'Programme officiel invalide ou archive.'; end if;

  select id,school_id,program_id,status into tc
  from public.academy_cohorts
  where id=target_cohort_id
    and organization_id=target_organization_id
    and school_id=target_school_id
    and status <> 'archived';
  if not found then raise exception 'Cohorte officielle invalide ou archivee.'; end if;

  if source_cohort_id is not null and source_cohort_id=target_cohort_id then
    raise exception 'La cohorte source et la cohorte cible doivent etre differentes.';
  end if;

  if source_cohort_id is not null then
    select id,school_id,program_id,status into sc
    from public.academy_cohorts
    where id=source_cohort_id
      and organization_id=target_organization_id
      and school_id=target_school_id;
    if not found then raise exception 'Cohorte source invalide.'; end if;
  end if;

  -- The canonical cohort must always point to the canonical programme. It can also be renamed in place.
  if target_cohort_name is not null and char_length(btrim(target_cohort_name)) < 2 then
    raise exception 'Le nom officiel de la cohorte est trop court.';
  end if;
  update public.academy_cohorts
    set program_id=canonical_program_id,
        name=case when target_cohort_name is null or btrim(target_cohort_name)='' then name else btrim(target_cohort_name) end,
        updated_at=now()
  where id=target_cohort_id and organization_id=target_organization_id;

  -- Migrate the wrong cohort without changing enrollment IDs. All downstream records remain linked.
  if source_cohort_id is not null then
    select coalesce(array_agg(id),'{}'::uuid[]) into moved_ids
    from public.academy_school_enrollments
    where organization_id=target_organization_id
      and school_id=target_school_id
      and cohort_id=source_cohort_id;

    moved_count := coalesce(array_length(moved_ids,1),0);

    update public.academy_school_enrollments
      set program_id=canonical_program_id,
          cohort_id=target_cohort_id,
          updated_at=now()
    where organization_id=target_organization_id
      and school_id=target_school_id
      and cohort_id=source_cohort_id;

    -- If the wrong cohort carried the official active tariff, copy it once to the correct cohort.
    if copy_source_tariff
       and to_regclass('public.academy_cohort_tariffs') is not null
       and not exists(
         select 1 from public.academy_cohort_tariffs
         where organization_id=target_organization_id
           and cohort_id=target_cohort_id
           and status='active'
           and effective_until is null
       ) then
      select * into source_tariff
      from public.academy_cohort_tariffs
      where organization_id=target_organization_id
        and cohort_id=source_cohort_id
        and status='active'
        and effective_from<=current_date
        and (effective_until is null or effective_until>=current_date)
      order by effective_from desc,version desc
      limit 1;

      if found then
        select coalesce(max(version),0)+1 into next_version
        from public.academy_cohort_tariffs where cohort_id=target_cohort_id;

        insert into public.academy_cohort_tariffs(
          organization_id,school_id,program_id,cohort_id,version,amount,currency,status,
          effective_from,effective_until,notes,approved_by,approved_at,created_by
        ) values(
          target_organization_id,target_school_id,canonical_program_id,target_cohort_id,next_version,
          source_tariff.amount,source_tariff.currency,'active',current_date,null,
          concat('Tarif transfere lors de la correction de structure depuis la cohorte ',source_cohort_id),
          target_actor_id,now(),target_actor_id
        );
        copied_tariff := true;
      end if;
    end if;

    update public.academy_cohorts
      set status='archived', updated_at=now()
    where id=source_cohort_id and organization_id=target_organization_id;
  end if;

  -- Enrollments already in the target cohort are normalized to the canonical programme.
  update public.academy_school_enrollments
    set program_id=canonical_program_id, updated_at=now()
  where organization_id=target_organization_id
    and school_id=target_school_id
    and cohort_id=target_cohort_id
    and program_id is distinct from canonical_program_id;

  -- Archive extra cohorts only when no active/admitted/enrolled student remains in them.
  foreach bad_cohort in array coalesce(archive_cohort_ids,'{}'::uuid[]) loop
    if bad_cohort=target_cohort_id or bad_cohort=source_cohort_id then continue; end if;
    if not exists(
      select 1 from public.academy_cohorts
      where id=bad_cohort and organization_id=target_organization_id and school_id=target_school_id
    ) then raise exception 'Une cohorte a archiver ne correspond pas a cette ecole.'; end if;
    if exists(
      select 1 from public.academy_school_enrollments
      where organization_id=target_organization_id and school_id=target_school_id
        and cohort_id=bad_cohort and academic_status in ('admitted','enrolled','active')
    ) then raise exception 'Impossible d archiver une cohorte qui contient encore des etudiants actifs.'; end if;
    update public.academy_cohorts set status='archived',updated_at=now() where id=bad_cohort;
  end loop;

  -- Archive extra programmes only when no active student still references them.
  foreach bad_program in array coalesce(archive_program_ids,'{}'::uuid[]) loop
    if bad_program=canonical_program_id then continue; end if;
    if not exists(
      select 1 from public.academy_programs
      where id=bad_program and organization_id=target_organization_id and school_id=target_school_id
    ) then raise exception 'Un programme a archiver ne correspond pas a cette ecole.'; end if;
    if exists(
      select 1 from public.academy_school_enrollments
      where organization_id=target_organization_id and school_id=target_school_id
        and program_id=bad_program and academic_status in ('admitted','enrolled','active')
    ) then raise exception 'Impossible d archiver un programme qui contient encore des etudiants actifs.'; end if;
    update public.academy_programs set status='archived',updated_at=now() where id=bad_program;
  end loop;

  -- Refresh inherited pricing only for moved enrollments without overwriting explicit active agreements.
  if to_regprocedure('public.sync_academy_inherited_finance(uuid)') is not null then
    foreach enrollment_id_to_sync in array moved_ids loop
      perform public.sync_academy_inherited_finance(enrollment_id_to_sync);
    end loop;
    for enrollment_id_to_sync in
      select id from public.academy_school_enrollments
      where organization_id=target_organization_id
        and school_id=target_school_id
        and cohort_id=target_cohort_id
    loop
      perform public.sync_academy_inherited_finance(enrollment_id_to_sync);
    end loop;
  end if;

  insert into public.academy_structure_change_log(
    organization_id,school_id,canonical_program_id,target_cohort_id,source_cohort_id,
    moved_enrollments,copied_cohort_tariff,archived_program_ids,archived_cohort_ids,created_by,details
  ) values(
    target_organization_id,target_school_id,canonical_program_id,target_cohort_id,source_cohort_id,
    moved_count,copied_tariff,coalesce(archive_program_ids,'{}'::uuid[]),
    coalesce(archive_cohort_ids,'{}'::uuid[]),target_actor_id,
    jsonb_build_object(
      'preserved_enrollment_ids',true,
      'payments_preserved',true,
      'attendance_preserved',true,
      'assessments_preserved',true,
      'certificates_preserved',true,
      'target_cohort_name',nullif(btrim(target_cohort_name),'')
    )
  );

  return jsonb_build_object(
    'moved_enrollments',moved_count,
    'copied_cohort_tariff',copied_tariff,
    'canonical_program_id',canonical_program_id,
    'target_cohort_id',target_cohort_id
  );
end;
$$;

revoke all on function public.restructure_academy_school(uuid,uuid,uuid,uuid,text,uuid,uuid[],uuid[],boolean,uuid) from public, anon, authenticated;
grant execute on function public.restructure_academy_school(uuid,uuid,uuid,uuid,text,uuid,uuid[],uuid[],boolean,uuid) to service_role;

commit;
