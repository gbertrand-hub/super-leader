-- SUPER LEADER - Premiere connexion avec mot de passe temporaire V1
-- Le mot de passe temporaire n'est jamais stocke en clair dans la base.

alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists temporary_password_issued_at timestamptz,
  add column if not exists temporary_password_expires_at timestamptz,
  add column if not exists temporary_password_issued_by uuid references auth.users(id) on delete set null,
  add column if not exists first_login_at timestamptz,
  add column if not exists password_changed_at timestamptz;

create index if not exists profiles_temporary_access_pending_idx
  on public.profiles (must_change_password, temporary_password_expires_at)
  where must_change_password = true;

comment on column public.profiles.must_change_password is
  'Bloque l acces au tableau de bord tant que le collaborateur n a pas remplace son mot de passe temporaire.';
comment on column public.profiles.temporary_password_expires_at is
  'Date limite d utilisation du mot de passe temporaire. Le secret lui-meme n est jamais stocke ici.';

create table if not exists public.temporary_access_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invitation_id uuid references public.organization_invitations(id) on delete set null,
  event_type text not null check (
    event_type in (
      'issued',
      'regenerated',
      'email_sent',
      'email_failed',
      'first_login',
      'expired_login_blocked',
      'password_changed'
    )
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists temporary_access_audit_org_created_idx
  on public.temporary_access_audit_log (organization_id, created_at desc);
create index if not exists temporary_access_audit_user_created_idx
  on public.temporary_access_audit_log (user_id, created_at desc);

alter table public.temporary_access_audit_log enable row level security;

drop policy if exists "temporary access audit visible to people admins"
  on public.temporary_access_audit_log;
create policy "temporary access audit visible to people admins"
  on public.temporary_access_audit_log
  for select
  to authenticated
  using (
    organization_id is not null
    and public.has_org_role(
      organization_id,
      array['owner','admin','hr']
    )
  );

revoke all on public.temporary_access_audit_log from anon, authenticated;
grant select on public.temporary_access_audit_log to authenticated;
grant select, insert, update, delete on public.temporary_access_audit_log
  to service_role;

-- Les utilisateurs peuvent toujours modifier leur profil courant, mais jamais
-- les colonnes de securite de premiere connexion. Seul le service_role les gere.
create or replace function public.protect_profile_temporary_access_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.must_change_password := old.must_change_password;
    new.temporary_password_issued_at := old.temporary_password_issued_at;
    new.temporary_password_expires_at := old.temporary_password_expires_at;
    new.temporary_password_issued_by := old.temporary_password_issued_by;
    new.first_login_at := old.first_login_at;
    new.password_changed_at := old.password_changed_at;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_temporary_access_fields
  on public.profiles;
create trigger protect_profile_temporary_access_fields
before update on public.profiles
for each row execute function public.protect_profile_temporary_access_fields();

notify pgrst, 'reload schema';
