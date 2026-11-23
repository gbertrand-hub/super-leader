-- Super Leader V4.10.23 - Identite unifiee et acces etudiant Academy
begin;

-- Une inscription peut maintenant conserver simultanement :
-- 1. la fiche CRM commerciale/financiere ;
-- 2. le compte Auth utilise pour se connecter aux evaluations.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.academy_school_enrollments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%user_id%'
      and pg_get_constraintdef(oid) ilike '%crm_client_id%'
  loop
    execute format(
      'alter table public.academy_school_enrollments drop constraint %I',
      constraint_row.conname
    );
  end loop;
end $$;

alter table public.academy_school_enrollments
  drop constraint if exists academy_school_enrollments_identity_required;

alter table public.academy_school_enrollments
  add constraint academy_school_enrollments_identity_required
  check (user_id is not null or crm_client_id is not null);

create index if not exists academy_school_enrollments_user_org_idx
  on public.academy_school_enrollments (user_id, organization_id)
  where user_id is not null;

create table if not exists public.academy_student_access_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  crm_client_id uuid references public.crm_clients(id) on delete set null,
  student_user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('account_invited','existing_account_linked','enrollments_linked')),
  enrollment_ids uuid[] not null default '{}',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists academy_student_access_audit_org_created_idx
  on public.academy_student_access_audit_log (organization_id, created_at desc);

alter table public.academy_student_access_audit_log enable row level security;

revoke all on public.academy_student_access_audit_log from anon, authenticated;
grant all on public.academy_student_access_audit_log to service_role;

comment on table public.academy_student_access_audit_log is
  'Audit des invitations et rattachements de comptes etudiants Academy.';

commit;

notify pgrst, 'reload schema';
