-- Super Leader V4.8.65 hotfix
-- Access approval must not fail when the School of Coaches already has a staff-default cohort
-- with a name different from "Staff permanent".
-- Safe/idempotent: replaces the seeding function and trigger behavior only.

begin;

create or replace function public.seed_grandes_ecoles_for_organization(
  target_organization_id uuid,
  actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  coaches_school_id uuid;
  coaches_program_id uuid;
  coaches_cohort_id uuid;
begin
  insert into public.academy_schools
    (organization_id, code, name, description, color, is_staff_default, created_by)
  values
    (target_organization_id, 'school_coaches', 'École des Coachs', 'Formation des coachs et parcours obligatoire de développement du staff.', 'violet', true, actor_id),
    (target_organization_id, 'school_business', 'École des Affaires', 'Programmes pour entrepreneurs, dirigeants et porteurs de projets.', 'blue', false, actor_id),
    (target_organization_id, 'school_real_estate', 'École des Experts en Immobilier International', 'Formation des experts et professionnels de l’immobilier international.', 'emerald', false, actor_id),
    (target_organization_id, 'school_breeders', 'École des Éleveurs', 'Formation internationale en entrepreneuriat agricole pour bâtir des fermes rentables, durables et bien structurées.', 'amber', false, actor_id),
    (target_organization_id, 'school_youth', 'iLead Global Youth', 'École des jeunes consacrée au leadership, au développement personnel, aux compétences de vie et à la préparation de la prochaine génération.', 'blue', false, actor_id)
  on conflict (organization_id, code) do update set
    name = excluded.name,
    description = excluded.description,
    color = excluded.color,
    is_active = true,
    updated_at = now();

  select id
    into coaches_school_id
  from public.academy_schools
  where organization_id = target_organization_id
    and code = 'school_coaches'
  limit 1;

  if coaches_school_id is null then
    raise exception 'École des Coachs introuvable pour organisation %', target_organization_id;
  end if;

  insert into public.academy_programs
    (organization_id, school_id, code, name, description, status, created_by)
  values
    (target_organization_id, coaches_school_id, 'staff_coaching_core', 'Parcours Coach du Staff', 'Parcours académique obligatoire pour tous les membres du staff.', 'active', actor_id)
  on conflict (school_id, code) do update set
    status = 'active'
  returning id into coaches_program_id;

  -- IMPORTANT: reuse the current active staff-default cohort if one already exists.
  -- The previous implementation always tried to make "Staff permanent" the default,
  -- which collided with academy_cohorts_one_staff_default_idx after a cohort rename/change.
  select id
    into coaches_cohort_id
  from public.academy_cohorts
  where school_id = coaches_school_id
    and is_staff_default = true
    and status <> 'archived'
  order by created_at asc
  limit 1;

  if coaches_cohort_id is not null then
    update public.academy_cohorts
    set
      organization_id = target_organization_id,
      program_id = coaches_program_id,
      status = 'active',
      is_staff_default = true,
      updated_at = now()
    where id = coaches_cohort_id;
  else
    insert into public.academy_cohorts
      (organization_id, school_id, program_id, name, status, is_staff_default, created_by)
    values
      (target_organization_id, coaches_school_id, coaches_program_id, 'Staff permanent', 'active', true, actor_id)
    on conflict (school_id, name) do update set
      organization_id = excluded.organization_id,
      program_id = excluded.program_id,
      status = 'active',
      is_staff_default = true,
      updated_at = now()
    returning id into coaches_cohort_id;
  end if;

  insert into public.academy_school_enrollments
    (organization_id, school_id, program_id, cohort_id, user_id, academic_status, source, created_by)
  select
    member.organization_id,
    coaches_school_id,
    coaches_program_id,
    coaches_cohort_id,
    member.user_id,
    'active',
    'staff_automatic',
    actor_id
  from public.organization_members member
  where member.organization_id = target_organization_id
    and coalesce(member.is_active, true)
  on conflict (school_id, cohort_id, user_id) where user_id is not null
  do update set
    program_id = excluded.program_id,
    academic_status = 'active',
    source = 'staff_automatic',
    updated_at = now();
end;
$$;

-- Keep academy auto-enrollment non-blocking for account activation if a future
-- academy-only uniqueness issue occurs. Access membership is the critical path.
create or replace function public.auto_enroll_staff_in_school_of_coaches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_active, true) then
    begin
      perform public.seed_grandes_ecoles_for_organization(new.organization_id, new.user_id);
    exception
      when unique_violation then
        raise warning 'Academy auto-enrollment skipped for user % in organization %: %', new.user_id, new.organization_id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

-- Repair/reconcile the current organization data now, without creating duplicates.
do $$
declare
  org record;
begin
  for org in select id, created_by from public.organizations loop
    perform public.seed_grandes_ecoles_for_organization(org.id, org.created_by);
  end loop;
end;
$$;

grant execute on function public.seed_grandes_ecoles_for_organization(uuid, uuid) to service_role;

commit;
