-- SUPER LEADER V3.2.9
-- Mon profil, photo privee, preferences personnelles et audit
-- A executer apres 048_super_leader_vip_settings_v3_2_8.sql

begin;

alter table public.profiles
  add column if not exists phone text,
  add column if not exists country text,
  add column if not exists city text,
  add column if not exists preferred_locale text not null default 'fr',
  add column if not exists time_zone text not null default 'Europe/Dublin',
  add column if not exists bio text,
  add column if not exists avatar_storage_path text,
  add column if not exists avatar_file_name text,
  add column if not exists avatar_mime_type text,
  add column if not exists avatar_size_bytes bigint,
  add column if not exists avatar_updated_at timestamptz;

update public.profiles
set preferred_locale = case when preferred_locale in ('fr','en') then preferred_locale else 'fr' end,
    time_zone = coalesce(nullif(btrim(time_zone), ''), 'Europe/Dublin');

alter table public.profiles drop constraint if exists profiles_preferred_locale_check;
alter table public.profiles add constraint profiles_preferred_locale_check
  check (preferred_locale in ('fr','en'));

alter table public.profiles drop constraint if exists profiles_phone_length_check;
alter table public.profiles add constraint profiles_phone_length_check
  check (phone is null or char_length(phone) <= 40);

alter table public.profiles drop constraint if exists profiles_country_length_check;
alter table public.profiles add constraint profiles_country_length_check
  check (country is null or char_length(country) <= 120);

alter table public.profiles drop constraint if exists profiles_city_length_check;
alter table public.profiles add constraint profiles_city_length_check
  check (city is null or char_length(city) <= 120);

alter table public.profiles drop constraint if exists profiles_bio_length_check;
alter table public.profiles add constraint profiles_bio_length_check
  check (bio is null or char_length(bio) <= 800);

alter table public.profiles drop constraint if exists profiles_avatar_size_check;
alter table public.profiles add constraint profiles_avatar_size_check
  check (avatar_size_bytes is null or avatar_size_bytes between 1 and 2097152);

alter table public.profiles drop constraint if exists profiles_avatar_mime_check;
alter table public.profiles add constraint profiles_avatar_mime_check
  check (avatar_mime_type is null or avatar_mime_type in ('image/jpeg','image/png','image/webp'));

create index if not exists profiles_country_city_idx on public.profiles (country, city);
create index if not exists profiles_avatar_updated_idx on public.profiles (avatar_updated_at desc)
  where avatar_storage_path is not null;

create table if not exists public.profile_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in (
    'profile_updated',
    'notification_preferences_updated',
    'password_changed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists profile_audit_user_created_idx
  on public.profile_audit_log (user_id, created_at desc);
create index if not exists profile_audit_org_created_idx
  on public.profile_audit_log (organization_id, created_at desc)
  where organization_id is not null;

alter table public.profile_audit_log enable row level security;
revoke all on public.profile_audit_log from anon, authenticated;
grant select, insert, update, delete on public.profile_audit_log to service_role;

-- Le bucket prive existe depuis la migration 014. Cette instruction rend la
-- migration autonome sur les installations plus recentes sans exposer les photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'super-leader-private',
  'super-leader-private',
  false,
  10485760,
  array[
    'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do nothing;

comment on column public.profiles.avatar_storage_path is
  'Chemin prive de la photo de profil dans le bucket super-leader-private.';
comment on table public.profile_audit_log is
  'Journal des modifications personnelles effectuees par le titulaire du compte.';

commit;

notify pgrst, 'reload schema';
