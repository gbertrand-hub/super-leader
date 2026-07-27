begin;

-- SUPER LEADER - Gestion complete des departements et equipes V2.1
-- A executer apres 019_roles_permissions_privacy_v2.sql

alter table public.teams
  add column if not exists manager_id uuid references auth.users(id) on delete set null,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

create index if not exists teams_organization_manager_idx
  on public.teams (organization_id, manager_id)
  where is_active = true;

create index if not exists teams_organization_active_idx
  on public.teams (organization_id, is_active, name);

create table if not exists public.team_activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (
    action in (
      'team_created',
      'team_updated',
      'manager_assigned',
      'manager_removed',
      'member_assigned',
      'member_removed',
      'team_archived',
      'team_restored'
    )
  ),
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists team_activity_log_team_created_idx
  on public.team_activity_log (team_id, created_at desc);

create index if not exists team_activity_log_organization_created_idx
  on public.team_activity_log (organization_id, created_at desc);

-- Le perimetre manager repose maintenant sur deux sources officielles :
-- 1. le superviseur defini dans le planning individuel ;
-- 2. le responsable officiellement affecte a une equipe et les membres de cette equipe.
create or replace function public.is_supervised_org_user(org_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members manager_membership
    join public.organization_members target_membership
      on target_membership.organization_id = manager_membership.organization_id
     and target_membership.user_id = target_user_id
     and target_membership.is_active = true
    where manager_membership.organization_id = org_id
      and manager_membership.user_id = auth.uid()
      and manager_membership.role = 'manager'
      and manager_membership.is_active = true
      and (
        exists (
          select 1
          from public.member_work_schedules schedule
          where schedule.organization_id = org_id
            and schedule.user_id = target_user_id
            and schedule.supervisor_id = auth.uid()
            and schedule.is_active = true
        )
        or exists (
          select 1
          from public.teams team
          join public.team_members team_member
            on team_member.team_id = team.id
           and team_member.user_id = target_user_id
          where team.organization_id = org_id
            and team.manager_id = auth.uid()
            and team.is_active = true
        )
      )
  );
$$;


create or replace function public.is_valid_team_manager(org_id uuid, candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select candidate_id is null or exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = org_id
      and membership.user_id = candidate_id
      and membership.role = 'manager'
      and membership.is_active = true
  );
$$;

create or replace function public.is_assignable_team_member(target_team_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams team
    join public.organization_members membership
      on membership.organization_id = team.organization_id
     and membership.user_id = target_user_id
     and membership.is_active = true
     and membership.role <> 'owner'
    where team.id = target_team_id
      and team.is_active = true
      and (team.manager_id is null or team.manager_id <> target_user_id)
  );
$$;

create or replace function public.can_view_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams team
    where team.id = target_team_id
      and (
        public.has_active_org_role(team.organization_id, array['owner','admin','hr'])
        or (
          public.active_org_role(team.organization_id) = 'manager'
          and team.manager_id = auth.uid()
          and team.is_active = true
        )
        or (
          public.active_org_role(team.organization_id) = 'employee'
          and team.is_active = true
          and exists (
            select 1
            from public.team_members membership
            where membership.team_id = team.id
              and membership.user_id = auth.uid()
          )
        )
      )
  );
$$;

create or replace function public.can_manage_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams team
    where team.id = target_team_id
      and public.has_active_org_role(team.organization_id, array['owner','admin'])
  );
$$;

create or replace function public.can_assign_team_members(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams team
    where team.id = target_team_id
      and public.has_active_org_role(team.organization_id, array['owner','admin','hr'])
  );
$$;

-- Les equipes sont configurables uniquement par Owner/Admin.
-- Le RH gere les affectations. Le Manager consulte uniquement les equipes qui lui sont confiees.
drop policy if exists "teams visible by scope v2" on public.teams;
drop policy if exists "teams insert by scope v2" on public.teams;
drop policy if exists "teams update by scope v2" on public.teams;
drop policy if exists "teams delete by scope v2" on public.teams;
drop policy if exists "teams visible by scope v2 1" on public.teams;
drop policy if exists "teams insert by scope v2 1" on public.teams;
drop policy if exists "teams update by scope v2 1" on public.teams;
drop policy if exists "teams delete by scope v2 1" on public.teams;

create policy "teams visible by scope v2 1"
on public.teams
for select
to authenticated
using (public.can_view_team(id));

create policy "teams insert by scope v2 1"
on public.teams
for insert
to authenticated
with check (
  public.has_active_org_role(organization_id, array['owner','admin'])
  and created_by = auth.uid()
  and public.is_valid_team_manager(organization_id, manager_id)
);

create policy "teams update by scope v2 1"
on public.teams
for update
to authenticated
using (public.can_manage_team(id))
with check (
  public.has_active_org_role(organization_id, array['owner','admin'])
  and public.is_valid_team_manager(organization_id, manager_id)
);

create policy "teams delete by scope v2 1"
on public.teams
for delete
to authenticated
using (public.can_manage_team(id));

-- Les affectations sont modifiables uniquement par Owner/Admin/RH.
drop policy if exists "team members visible by scope v2" on public.team_members;
drop policy if exists "team members insert by scope v2" on public.team_members;
drop policy if exists "team members update by scope v2" on public.team_members;
drop policy if exists "team members delete by scope v2" on public.team_members;
drop policy if exists "team members visible by scope v2 1" on public.team_members;
drop policy if exists "team members insert by scope v2 1" on public.team_members;
drop policy if exists "team members update by scope v2 1" on public.team_members;
drop policy if exists "team members delete by scope v2 1" on public.team_members;

create policy "team members visible by scope v2 1"
on public.team_members
for select
to authenticated
using (
  public.can_view_team(team_id)
  and exists (
    select 1
    from public.teams team
    where team.id = team_id
      and (
        public.has_active_org_role(team.organization_id, array['owner','admin','hr'])
        or user_id = auth.uid()
        or public.is_supervised_org_user(team.organization_id, user_id)
      )
  )
);

create policy "team members insert by scope v2 1"
on public.team_members
for insert
to authenticated
with check (
  public.can_assign_team_members(team_id)
  and public.is_assignable_team_member(team_id, user_id)
);

create policy "team members update by scope v2 1"
on public.team_members
for update
to authenticated
using (public.can_assign_team_members(team_id))
with check (
  public.can_assign_team_members(team_id)
  and public.is_assignable_team_member(team_id, user_id)
);

create policy "team members delete by scope v2 1"
on public.team_members
for delete
to authenticated
using (public.can_assign_team_members(team_id));

alter table public.team_activity_log enable row level security;

drop policy if exists "team activity visible by scope v2 1" on public.team_activity_log;
create policy "team activity visible by scope v2 1"
on public.team_activity_log
for select
to authenticated
using (
  public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (
    public.active_org_role(organization_id) = 'manager'
    and public.can_view_team(team_id)
  )
);

revoke all on public.team_activity_log from anon, authenticated;
grant select on public.team_activity_log to authenticated;
grant select, insert, update, delete on public.team_activity_log to service_role;

revoke all on function public.can_assign_team_members(uuid) from public;
revoke all on function public.is_valid_team_manager(uuid,uuid) from public;
revoke all on function public.is_assignable_team_member(uuid,uuid) from public;
grant execute on function public.can_assign_team_members(uuid) to authenticated;
grant execute on function public.is_valid_team_manager(uuid,uuid) to authenticated;
grant execute on function public.is_assignable_team_member(uuid,uuid) to authenticated;

grant execute on function public.is_supervised_org_user(uuid,uuid) to authenticated;
grant execute on function public.can_view_team(uuid) to authenticated;
grant execute on function public.can_manage_team(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
