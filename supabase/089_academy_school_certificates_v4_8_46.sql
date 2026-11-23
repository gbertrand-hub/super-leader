-- Super Leader V4.8.46 - Certificats officiels des grandes ecoles
begin;
create extension if not exists pgcrypto;

create table if not exists public.academy_school_certificate_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  certificate_year integer not null,
  last_number integer not null default 0,
  primary key (organization_id, certificate_year)
);

create table if not exists public.academy_school_certificates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete restrict,
  program_id uuid references public.academy_programs(id) on delete set null,
  cohort_id uuid references public.academy_cohorts(id) on delete set null,
  certificate_number text not null unique,
  verification_token uuid not null default gen_random_uuid() unique,
  title text not null check (char_length(title) between 2 and 240),
  final_score numeric(7,2),
  attendance_percent numeric(5,2) check (attendance_percent is null or attendance_percent between 0 and 100),
  status text not null default 'active' check (status in ('active','revoked','replaced')),
  issued_by uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revocation_reason text,
  student_name_snapshot text not null,
  school_name_snapshot text not null,
  program_name_snapshot text,
  cohort_name_snapshot text,
  school_logo_storage_path_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists academy_school_certificates_one_active_idx
  on public.academy_school_certificates(enrollment_id) where status='active';
create index if not exists academy_school_certificates_org_idx
  on public.academy_school_certificates(organization_id,issued_at desc);
create index if not exists academy_school_certificates_token_idx
  on public.academy_school_certificates(verification_token);

create table if not exists public.academy_school_certificate_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  certificate_id uuid references public.academy_school_certificates(id) on delete set null,
  enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('issued','revoked')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.issue_academy_school_certificate(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_title text,
  p_final_score numeric default null,
  p_attendance_percent numeric default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare e record; person_name text; seq int; new_id uuid; new_number text; cert_year int:=extract(year from current_date)::int;
begin
  if char_length(trim(coalesce(p_title,'')))<2 then raise exception 'Certificate title required'; end if;
  select enrollment.*,school.name school_name,school.logo_storage_path,program.name program_name,cohort.name cohort_name
    into e from public.academy_school_enrollments enrollment
    join public.academy_schools school on school.id=enrollment.school_id
    left join public.academy_programs program on program.id=enrollment.program_id
    left join public.academy_cohorts cohort on cohort.id=enrollment.cohort_id
    where enrollment.id=p_enrollment_id;
  if not found then raise exception 'Enrollment not found'; end if;
  if e.academic_status<>'graduated' then raise exception 'Student must be graduated before certificate issuance'; end if;
  if exists(select 1 from public.academy_school_certificates where enrollment_id=p_enrollment_id and status='active') then
    raise exception 'An active certificate already exists';
  end if;
  if e.user_id is not null then
    select coalesce(full_name,email,'Etudiant') into person_name from public.profiles where id=e.user_id;
  else
    select full_name into person_name from public.crm_clients where id=e.crm_client_id and organization_id=e.organization_id;
  end if;
  if person_name is null then raise exception 'Student identity not found'; end if;
  insert into public.academy_school_certificate_counters(organization_id,certificate_year,last_number)
    values(e.organization_id,cert_year,1)
    on conflict(organization_id,certificate_year) do update
    set last_number=academy_school_certificate_counters.last_number+1 returning last_number into seq;
  new_number:='ILEAD-CERT-'||cert_year||'-'||lpad(seq::text,6,'0');
  insert into public.academy_school_certificates(
    organization_id,enrollment_id,school_id,program_id,cohort_id,certificate_number,title,
    final_score,attendance_percent,issued_by,student_name_snapshot,school_name_snapshot,
    program_name_snapshot,cohort_name_snapshot,school_logo_storage_path_snapshot)
  values(e.organization_id,e.id,e.school_id,e.program_id,e.cohort_id,new_number,trim(p_title),
    p_final_score,p_attendance_percent,p_actor_id,person_name,e.school_name,e.program_name,e.cohort_name,e.logo_storage_path)
  returning id into new_id;
  insert into public.academy_school_certificate_audit_log(organization_id,certificate_id,enrollment_id,actor_id,action)
    values(e.organization_id,new_id,e.id,p_actor_id,'issued');
  return new_id;
end $$;

alter table public.academy_school_certificates enable row level security;
alter table public.academy_school_certificate_audit_log enable row level security;
alter table public.academy_school_certificate_counters enable row level security;
create policy "school certificates members read" on public.academy_school_certificates for select to authenticated using(public.is_org_member(organization_id));
create policy "school certificate audit leaders read" on public.academy_school_certificate_audit_log for select to authenticated using(public.has_org_role(organization_id,array['owner','admin','hr']));
grant select on public.academy_school_certificates to authenticated;
grant all on public.academy_school_certificates,public.academy_school_certificate_audit_log,public.academy_school_certificate_counters to service_role;
grant execute on function public.issue_academy_school_certificate(uuid,uuid,text,numeric,numeric) to service_role;
commit;
notify pgrst, 'reload schema';
