-- SUPER LEADER V2.8 - Zoom multi-host and department routing
-- Execute after 035_zoom_meetings_v2_7.sql

begin;

create extension if not exists pgcrypto;

create table if not exists public.organization_zoom_hosts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  zoom_user_id text not null,
  email text not null,
  first_name text,
  last_name text,
  display_name text,
  department text,
  department_key text not null default '',
  zoom_user_type integer,
  zoom_status text not null default 'active',
  is_active boolean not null default true,
  is_department_default boolean not null default false,
  allow_concurrent_meetings boolean not null default false,
  last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_zoom_hosts_user_unique unique (organization_id, zoom_user_id),
  constraint organization_zoom_hosts_email_not_blank check (length(trim(email)) > 3),
  constraint organization_zoom_hosts_department_default_check check (
    is_department_default = false or (is_active = true and department_key <> '')
  )
);

create unique index if not exists organization_zoom_hosts_email_unique
  on public.organization_zoom_hosts (organization_id, lower(email));

create unique index if not exists organization_zoom_hosts_department_default_unique
  on public.organization_zoom_hosts (organization_id, department_key)
  where is_department_default = true and department_key <> '';

create index if not exists organization_zoom_hosts_active_idx
  on public.organization_zoom_hosts (organization_id, is_active, department_key, display_name);

alter table public.performance_meetings
  add column if not exists zoom_host_account_id uuid references public.organization_zoom_hosts(id) on delete set null,
  add column if not exists zoom_department text;

create index if not exists performance_meetings_zoom_host_account_idx
  on public.performance_meetings (organization_id, zoom_host_account_id, starts_at)
  where zoom_host_account_id is not null;

create or replace function public.zoom_multi_host_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organization_zoom_hosts_touch on public.organization_zoom_hosts;
create trigger organization_zoom_hosts_touch
before update on public.organization_zoom_hosts
for each row execute function public.zoom_multi_host_touch_updated_at();

alter table public.organization_zoom_hosts enable row level security;
revoke all on public.organization_zoom_hosts from anon, authenticated;
grant select, insert, update, delete on public.organization_zoom_hosts to service_role;

commit;

notify pgrst, 'reload schema';
