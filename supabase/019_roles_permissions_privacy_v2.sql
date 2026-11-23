begin;

-- SUPER LEADER - Roles, permissions et confidentialite V2
-- A executer apres 018_temporary_password_first_login.sql
-- Cette migration resserre la visibilite des personnes et des equipes au niveau RLS.

create or replace function public.active_org_role(org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.organization_members
  where organization_id = org_id
    and user_id = auth.uid()
    and is_active = true
  limit 1;
$$;

create or replace function public.is_active_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.active_org_role(org_id) is not null;
$$;

create or replace function public.has_active_org_role(org_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.active_org_role(org_id) = any(allowed_roles), false);
$$;

-- Remplace les anciennes fonctions par une verification qui tient compte des comptes desactives.
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_org_member(org_id);
$$;

create or replace function public.has_org_role(org_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_active_org_role(org_id, allowed_roles);
$$;

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
    join public.member_work_schedules schedule
      on schedule.organization_id = manager_membership.organization_id
     and schedule.user_id = target_user_id
     and schedule.supervisor_id = auth.uid()
     and schedule.is_active = true
    where manager_membership.organization_id = org_id
      and manager_membership.user_id = auth.uid()
      and manager_membership.role = 'manager'
      and manager_membership.is_active = true
  );
$$;

create or replace function public.can_view_org_user(org_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when target_user_id = auth.uid() then public.is_active_org_member(org_id)
    when public.has_active_org_role(org_id, array['owner','admin','hr']) then exists (
      select 1
      from public.organization_members target
      where target.organization_id = org_id
        and target.user_id = target_user_id
    )
    when public.active_org_role(org_id) = 'manager' then public.is_supervised_org_user(org_id, target_user_id)
    else false
  end;
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
          and (
            team.created_by = auth.uid()
            or exists (
              select 1
              from public.team_members membership
              where membership.team_id = team.id
                and (
                  membership.user_id = auth.uid()
                  or public.is_supervised_org_user(team.organization_id, membership.user_id)
                )
            )
          )
        )
        or (
          public.active_org_role(team.organization_id) = 'employee'
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
      and (
        public.has_active_org_role(team.organization_id, array['owner','admin','hr'])
        or (
          public.active_org_role(team.organization_id) = 'manager'
          and (
            team.created_by = auth.uid()
            or exists (
              select 1
              from public.team_members membership
              where membership.team_id = team.id
                and public.is_supervised_org_user(team.organization_id, membership.user_id)
            )
          )
        )
      )
  );
$$;

-- Profils: soi-meme, toute l'organisation pour owner/admin/RH, equipe supervisee pour manager.
drop policy if exists "profiles own or same org" on public.profiles;
drop policy if exists "profiles privacy v2" on public.profiles;
create policy "profiles privacy v2"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.organization_members target
    where target.user_id = profiles.id
      and public.can_view_org_user(target.organization_id, profiles.id)
  )
);

-- Membres: le manager ne voit plus automatiquement toute l'organisation.
drop policy if exists "members visible to org members" on public.organization_members;
drop policy if exists "members privacy v2" on public.organization_members;
create policy "members privacy v2"
on public.organization_members
for select
to authenticated
using (public.can_view_org_user(organization_id, user_id));

-- Organisation: seuls les membres actifs peuvent la lire.
drop policy if exists "organizations visible to members" on public.organizations;
drop policy if exists "organizations active members v2" on public.organizations;
create policy "organizations active members v2"
on public.organizations
for select
to authenticated
using (public.is_active_org_member(id));

-- Equipes: visibilite limitee selon le role et le perimetre de supervision.
drop policy if exists "teams visible to members" on public.teams;
drop policy if exists "teams manageable by leaders" on public.teams;
drop policy if exists "teams visible by scope v2" on public.teams;
drop policy if exists "teams insert by scope v2" on public.teams;
drop policy if exists "teams update by scope v2" on public.teams;
drop policy if exists "teams delete by scope v2" on public.teams;

create policy "teams visible by scope v2"
on public.teams
for select
to authenticated
using (public.can_view_team(id));

create policy "teams insert by scope v2"
on public.teams
for insert
to authenticated
with check (
  public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (
    public.active_org_role(organization_id) = 'manager'
    and created_by = auth.uid()
  )
);

create policy "teams update by scope v2"
on public.teams
for update
to authenticated
using (public.can_manage_team(id))
with check (
  public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or public.active_org_role(organization_id) = 'manager'
);

create policy "teams delete by scope v2"
on public.teams
for delete
to authenticated
using (public.can_manage_team(id));

-- Affectations: un manager ne peut manipuler que ses collaborateurs supervises.
drop policy if exists "team members visible to org" on public.team_members;
drop policy if exists "team members manageable by leaders" on public.team_members;
drop policy if exists "team members visible by scope v2" on public.team_members;
drop policy if exists "team members insert by scope v2" on public.team_members;
drop policy if exists "team members update by scope v2" on public.team_members;
drop policy if exists "team members delete by scope v2" on public.team_members;

create policy "team members visible by scope v2"
on public.team_members
for select
to authenticated
using (
  public.can_view_team(team_id)
  and exists (
    select 1
    from public.teams team
    where team.id = team_id
      and public.can_view_org_user(team.organization_id, user_id)
  )
);

create policy "team members insert by scope v2"
on public.team_members
for insert
to authenticated
with check (
  exists (
    select 1
    from public.teams team
    where team.id = team_id
      and (
        public.has_active_org_role(team.organization_id, array['owner','admin','hr'])
        or (
          public.active_org_role(team.organization_id) = 'manager'
          and public.can_manage_team(team.id)
          and public.is_supervised_org_user(team.organization_id, user_id)
        )
      )
  )
);

create policy "team members update by scope v2"
on public.team_members
for update
to authenticated
using (
  exists (
    select 1
    from public.teams team
    where team.id = team_id
      and (
        public.has_active_org_role(team.organization_id, array['owner','admin','hr'])
        or (
          public.active_org_role(team.organization_id) = 'manager'
          and public.can_manage_team(team.id)
          and public.is_supervised_org_user(team.organization_id, user_id)
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.teams team
    where team.id = team_id
      and (
        public.has_active_org_role(team.organization_id, array['owner','admin','hr'])
        or (
          public.active_org_role(team.organization_id) = 'manager'
          and public.can_manage_team(team.id)
          and public.is_supervised_org_user(team.organization_id, user_id)
        )
      )
  )
);

create policy "team members delete by scope v2"
on public.team_members
for delete
to authenticated
using (
  exists (
    select 1
    from public.teams team
    where team.id = team_id
      and (
        public.has_active_org_role(team.organization_id, array['owner','admin','hr'])
        or (
          public.active_org_role(team.organization_id) = 'manager'
          and public.can_manage_team(team.id)
          and public.is_supervised_org_user(team.organization_id, user_id)
        )
      )
  )
);

revoke all on function public.active_org_role(uuid) from public;
revoke all on function public.is_active_org_member(uuid) from public;
revoke all on function public.has_active_org_role(uuid,text[]) from public;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid,text[]) from public;
revoke all on function public.is_supervised_org_user(uuid,uuid) from public;
revoke all on function public.can_view_org_user(uuid,uuid) from public;
revoke all on function public.can_view_team(uuid) from public;
revoke all on function public.can_manage_team(uuid) from public;

grant execute on function public.active_org_role(uuid) to authenticated;
grant execute on function public.is_active_org_member(uuid) to authenticated;
grant execute on function public.has_active_org_role(uuid,text[]) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid,text[]) to authenticated;
grant execute on function public.is_supervised_org_user(uuid,uuid) to authenticated;
grant execute on function public.can_view_org_user(uuid,uuid) to authenticated;
grant execute on function public.can_view_team(uuid) to authenticated;
grant execute on function public.can_manage_team(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
