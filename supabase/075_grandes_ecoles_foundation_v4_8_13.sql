-- Super Leader V4.8.13 - Grandes Ecoles
-- Ecoles autonomes, programmes, cohortes, inscriptions sans duplication et staff apprenant.
begin;

create extension if not exists pgcrypto;

create table if not exists public.academy_schools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null check (char_length(trim(name)) between 3 and 180),
  description text not null default '',
  color text not null default 'violet',
  is_staff_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, name)
);

create unique index if not exists academy_schools_one_staff_default_idx
  on public.academy_schools (organization_id) where is_staff_default and is_active;

create table if not exists public.academy_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  code text not null,
  name text not null check (char_length(trim(name)) between 3 and 180),
  description text not null default '',
  duration_months integer check (duration_months is null or duration_months between 1 and 120),
  status text not null default 'active' check (status in ('draft','active','archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, code)
);

create table if not exists public.academy_cohorts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  program_id uuid references public.academy_programs(id) on delete set null,
  name text not null check (char_length(trim(name)) between 2 and 180),
  starts_on date,
  ends_on date,
  capacity integer check (capacity is null or capacity > 0),
  status text not null default 'planned' check (status in ('planned','open','active','completed','archived')),
  is_staff_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  unique (school_id, name)
);

create unique index if not exists academy_cohorts_one_staff_default_idx
  on public.academy_cohorts (school_id) where is_staff_default and status <> 'archived';

create table if not exists public.academy_school_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  program_id uuid references public.academy_programs(id) on delete set null,
  cohort_id uuid references public.academy_cohorts(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  crm_client_id uuid references public.crm_clients(id) on delete cascade,
  academic_status text not null default 'enrolled' check (academic_status in ('candidate','admitted','enrolled','active','suspended','graduated','withdrawn','inactive')),
  source text not null default 'manual' check (source in ('manual','staff_automatic','crm_conversion','import')),
  enrolled_on date not null default current_date,
  completed_on date,
  assigned_follow_up_user_id uuid references auth.users(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 5000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((user_id is not null)::integer + (crm_client_id is not null)::integer = 1)
);

create unique index if not exists academy_school_enrollment_user_unique_idx
  on public.academy_school_enrollments (school_id, cohort_id, user_id) where user_id is not null;
create unique index if not exists academy_school_enrollment_crm_unique_idx
  on public.academy_school_enrollments (school_id, cohort_id, crm_client_id) where crm_client_id is not null;
create index if not exists academy_school_enrollments_dashboard_idx
  on public.academy_school_enrollments (organization_id, school_id, academic_status);

create table if not exists public.academy_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  program_id uuid references public.academy_programs(id) on delete cascade,
  cohort_id uuid references public.academy_cohorts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_role text not null check (assignment_role in ('director','academic_coordinator','instructor','follow_up','finance','observer')),
  is_active boolean not null default true,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (school_id, program_id, cohort_id, user_id, assignment_role)
);

create or replace function public.seed_grandes_ecoles_for_organization(target_organization_id uuid, actor_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare coaches_school_id uuid; coaches_program_id uuid; coaches_cohort_id uuid;
begin
  insert into public.academy_schools (organization_id, code, name, description, color, is_staff_default, created_by)
  values
    (target_organization_id, 'school_coaches', 'École des Coachs', 'Formation des coachs et parcours obligatoire de développement du staff.', 'violet', true, actor_id),
    (target_organization_id, 'school_business', 'École des Affaires', 'Programmes pour entrepreneurs, dirigeants et porteurs de projets.', 'blue', false, actor_id),
    (target_organization_id, 'school_real_estate', 'École des Experts en Immobilier International', 'Formation des experts et professionnels de l’immobilier international.', 'emerald', false, actor_id)
  on conflict (organization_id, code) do update set name=excluded.name, description=excluded.description, is_active=true;

  select id into coaches_school_id from public.academy_schools
  where organization_id=target_organization_id and code='school_coaches';

  insert into public.academy_programs (organization_id, school_id, code, name, description, status, created_by)
  values (target_organization_id, coaches_school_id, 'staff_coaching_core', 'Parcours Coach du Staff', 'Parcours académique obligatoire pour tous les membres du staff.', 'active', actor_id)
  on conflict (school_id, code) do update set status='active'
  returning id into coaches_program_id;

  insert into public.academy_cohorts (organization_id, school_id, program_id, name, status, is_staff_default, created_by)
  values (target_organization_id, coaches_school_id, coaches_program_id, 'Staff permanent', 'active', true, actor_id)
  on conflict (school_id, name) do update set program_id=excluded.program_id, status='active', is_staff_default=true
  returning id into coaches_cohort_id;

  insert into public.academy_school_enrollments
    (organization_id, school_id, program_id, cohort_id, user_id, academic_status, source, created_by)
  select member.organization_id, coaches_school_id, coaches_program_id, coaches_cohort_id,
         member.user_id, 'active', 'staff_automatic', actor_id
  from public.organization_members member
  where member.organization_id=target_organization_id and coalesce(member.is_active,true)
  on conflict (school_id, cohort_id, user_id) where user_id is not null
  do update set academic_status='active', source='staff_automatic', updated_at=now();
end;
$$;

create or replace function public.auto_enroll_staff_in_school_of_coaches()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_active,true) then
    perform public.seed_grandes_ecoles_for_organization(new.organization_id, new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists organization_member_academy_auto_enrollment on public.organization_members;
create trigger organization_member_academy_auto_enrollment
after insert or update of is_active on public.organization_members
for each row execute function public.auto_enroll_staff_in_school_of_coaches();

do $$ declare org record; begin
  for org in select id, created_by from public.organizations loop
    perform public.seed_grandes_ecoles_for_organization(org.id, org.created_by);
  end loop;
end $$;

alter table public.academy_schools enable row level security;
alter table public.academy_programs enable row level security;
alter table public.academy_cohorts enable row level security;
alter table public.academy_school_enrollments enable row level security;
alter table public.academy_staff_assignments enable row level security;

do $$ declare table_name text; begin
  foreach table_name in array array['academy_schools','academy_programs','academy_cohorts','academy_school_enrollments','academy_staff_assignments'] loop
    execute format('drop policy if exists "grandes ecoles member read" on public.%I', table_name);
    execute format('create policy "grandes ecoles member read" on public.%I for select to authenticated using (public.is_org_member(organization_id))', table_name);
    execute format('drop policy if exists "grandes ecoles admin write" on public.%I', table_name);
    execute format('create policy "grandes ecoles admin write" on public.%I for all to authenticated using (public.has_org_role(organization_id, array[''owner'',''admin'',''hr''])) with check (public.has_org_role(organization_id, array[''owner'',''admin'',''hr'']))', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;

grant execute on function public.seed_grandes_ecoles_for_organization(uuid,uuid) to service_role;
commit;
