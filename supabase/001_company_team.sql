-- SUPER LEADER - Module entreprise et équipe V1
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) >= 2),
  sector text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','hr','manager','employee')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  department text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','hr','manager','employee')),
  token uuid not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','cancelled','expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  unique (organization_id, email, status)
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email)
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, full_name, email)
select id, coalesce(raw_user_meta_data->>'full_name',''), email from auth.users
on conflict (id) do nothing;

create or replace function public.is_org_member(org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.organization_members where organization_id = org_id and user_id = auth.uid());
$$;

create or replace function public.has_org_role(org_id uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.organization_members where organization_id = org_id and user_id = auth.uid() and role = any(allowed_roles));
$$;

create or replace function public.create_organization_with_owner(organization_name text, organization_sector text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.organization_members where user_id = auth.uid()) then raise exception 'User already belongs to an organization'; end if;
  insert into public.organizations(name, sector, created_by) values(trim(organization_name), nullif(trim(organization_sector),''), auth.uid()) returning id into new_id;
  insert into public.organization_members(organization_id,user_id,role) values(new_id,auth.uid(),'owner');
  return new_id;
end;
$$;

create or replace function public.accept_organization_invitation(invitation_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.organization_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into inv from public.organization_invitations where token = invitation_token and status = 'pending' and expires_at > now() for update;
  if not found then raise exception 'Invitation invalide ou expirée'; end if;
  if lower(inv.email) <> lower(coalesce((select email from auth.users where id = auth.uid()),'')) then raise exception 'Cette invitation appartient à une autre adresse email'; end if;
  insert into public.organization_members(organization_id,user_id,role) values(inv.organization_id,auth.uid(),inv.role) on conflict (organization_id,user_id) do update set role=excluded.role;
  update public.organization_invitations set status='accepted' where id=inv.id;
  return inv.organization_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.organization_invitations enable row level security;

drop policy if exists "profiles own or same org" on public.profiles;
create policy "profiles own or same org" on public.profiles for select to authenticated using (
  id = (select auth.uid()) or exists (
    select 1 from public.organization_members mine join public.organization_members theirs on mine.organization_id=theirs.organization_id
    where mine.user_id=(select auth.uid()) and theirs.user_id=profiles.id
  )
);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));

drop policy if exists "organizations visible to members" on public.organizations;
create policy "organizations visible to members" on public.organizations for select to authenticated using ((select public.is_org_member(id)));

drop policy if exists "members visible to org members" on public.organization_members;
create policy "members visible to org members" on public.organization_members for select to authenticated using ((select public.is_org_member(organization_id)));

drop policy if exists "teams visible to members" on public.teams;
create policy "teams visible to members" on public.teams for select to authenticated using ((select public.is_org_member(organization_id)));
drop policy if exists "teams manageable by leaders" on public.teams;
create policy "teams manageable by leaders" on public.teams for all to authenticated using ((select public.has_org_role(organization_id, array['owner','admin','hr','manager']))) with check ((select public.has_org_role(organization_id, array['owner','admin','hr','manager'])));

drop policy if exists "team members visible to org" on public.team_members;
create policy "team members visible to org" on public.team_members for select to authenticated using (exists(select 1 from public.teams t where t.id=team_id and (select public.is_org_member(t.organization_id))));
drop policy if exists "team members manageable by leaders" on public.team_members;
create policy "team members manageable by leaders" on public.team_members for all to authenticated using (exists(select 1 from public.teams t where t.id=team_id and (select public.has_org_role(t.organization_id,array['owner','admin','hr','manager'])))) with check (exists(select 1 from public.teams t where t.id=team_id and (select public.has_org_role(t.organization_id,array['owner','admin','hr','manager']))));

-- Invitations are managed server-side with the service-role key.
revoke all on public.organization_invitations from anon, authenticated;
grant select, insert, update, delete on public.organization_invitations to service_role;

grant execute on function public.create_organization_with_owner(text,text) to authenticated;
grant execute on function public.accept_organization_invitation(uuid) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid,text[]) to authenticated;
