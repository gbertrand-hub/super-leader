-- SUPER LEADER V2.9.4
-- Role Executif, supervision multi-managers et perimetre hierarchique
-- A executer apres 039_flexible_work_policies_v2_9_3.sql

-- 1. Etendre les contraintes de roles existantes.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.organization_members'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.organization_members drop constraint if exists %I', constraint_row.conname);
  end loop;

  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.organization_invitations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.organization_invitations drop constraint if exists %I', constraint_row.conname);
  end loop;

  if to_regclass('public.internal_access_requests') is not null then
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = 'public.internal_access_requests'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%assigned_role%'
    loop
      execute format('alter table public.internal_access_requests drop constraint if exists %I', constraint_row.conname);
    end loop;
  end if;
end $$;

alter table public.organization_members
  add constraint organization_members_role_check
  check (role in ('owner','admin','executive','hr','manager','employee'));

alter table public.organization_invitations
  add constraint organization_invitations_role_check
  check (role in ('admin','executive','hr','manager','employee'));

do $$
begin
  if to_regclass('public.internal_access_requests') is not null then
    execute $ddl$
      alter table public.internal_access_requests
        add constraint internal_access_requests_assigned_role_check
        check (
          assigned_role is null or
          assigned_role in ('admin','executive','hr','manager','employee')
        )
    $ddl$;
  end if;
end $$;

-- 2. Affectation d'un manager a un executif.
create table if not exists public.executive_manager_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  executive_user_id uuid not null references auth.users(id) on delete cascade,
  manager_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (executive_user_id <> manager_user_id),
  unique (organization_id, manager_user_id),
  unique (organization_id, executive_user_id, manager_user_id)
);

create index if not exists executive_manager_assignments_executive_idx
  on public.executive_manager_assignments (organization_id, executive_user_id, assigned_at desc);

create index if not exists executive_manager_assignments_manager_idx
  on public.executive_manager_assignments (organization_id, manager_user_id);

create table if not exists public.executive_supervision_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assignment_id uuid references public.executive_manager_assignments(id) on delete set null,
  executive_user_id uuid references auth.users(id) on delete set null,
  manager_user_id uuid references auth.users(id) on delete set null,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('assigned','reassigned','removed','role_changed','member_deactivated')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists executive_supervision_audit_org_idx
  on public.executive_supervision_audit_log (organization_id, created_at desc);

create index if not exists executive_supervision_audit_people_idx
  on public.executive_supervision_audit_log (executive_user_id, manager_user_id, created_at desc);

create or replace function public.executive_supervision_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_executive_manager_assignments_updated_at
  on public.executive_manager_assignments;
create trigger set_executive_manager_assignments_updated_at
before update on public.executive_manager_assignments
for each row execute function public.executive_supervision_set_updated_at();

create or replace function public.validate_executive_manager_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  executive_role text;
  executive_active boolean;
  manager_role text;
  manager_active boolean;
begin
  select role, is_active
    into executive_role, executive_active
  from public.organization_members
  where organization_id = new.organization_id
    and user_id = new.executive_user_id;

  select role, is_active
    into manager_role, manager_active
  from public.organization_members
  where organization_id = new.organization_id
    and user_id = new.manager_user_id;

  if executive_role is distinct from 'executive' or executive_active is distinct from true then
    raise exception 'The selected executive is not an active executive in this organization.';
  end if;

  if manager_role is distinct from 'manager' or manager_active is distinct from true then
    raise exception 'The selected manager is not an active manager in this organization.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_executive_manager_assignment_trigger
  on public.executive_manager_assignments;
create trigger validate_executive_manager_assignment_trigger
before insert or update on public.executive_manager_assignments
for each row execute function public.validate_executive_manager_assignment();

alter table public.executive_manager_assignments enable row level security;
alter table public.executive_supervision_audit_log enable row level security;

revoke all on public.executive_manager_assignments from anon, authenticated;
revoke all on public.executive_supervision_audit_log from anon, authenticated;

grant select, insert, update, delete on public.executive_manager_assignments to service_role;
grant select, insert on public.executive_supervision_audit_log to service_role;

grant execute on function public.validate_executive_manager_assignment() to service_role;
grant execute on function public.executive_supervision_set_updated_at() to service_role;

notify pgrst, 'reload schema';
