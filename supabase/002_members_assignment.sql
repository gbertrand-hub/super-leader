-- SUPER LEADER - Module membres et affectations V1
-- A executer apres 001_company_team.sql

alter table public.organization_members
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists disabled_at timestamptz;

alter table public.team_members
  add column if not exists assigned_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists organization_members_org_active_idx
  on public.organization_members (organization_id, is_active);

create index if not exists team_members_user_idx
  on public.team_members (user_id);

-- Les membres actifs uniquement sont consideres pour les controles applicatifs.
create or replace function public.is_active_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.organization_members
    where organization_id = org_id
      and user_id = auth.uid()
      and is_active = true
  );
$$;

create or replace function public.has_active_org_role(org_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.organization_members
    where organization_id = org_id
      and user_id = auth.uid()
      and is_active = true
      and role = any(allowed_roles)
  );
$$;

grant execute on function public.is_active_org_member(uuid) to authenticated;
grant execute on function public.has_active_org_role(uuid,text[]) to authenticated;
