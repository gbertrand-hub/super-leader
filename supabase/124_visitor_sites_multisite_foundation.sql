-- V4.10.132 multi-site visitor foundation.
-- Schema only. Site records are seeded per organization during controlled rollout.

create table if not exists public.visitor_sites (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 code text not null,
 name text not null,
 city text,
 country_code text,
 timezone text not null,
 street_address text,
 is_hq boolean not null default false,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,code),
 unique(organization_id,id)
);

alter table public.visitor_sites enable row level security;
revoke all on public.visitor_sites from anon,authenticated;
grant select,insert,update on public.visitor_sites to service_role;

create table if not exists public.visitor_site_staff (
 site_id uuid not null references public.visitor_sites(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 access_role text not null default 'host'
   check(access_role in ('reception','host','manager')),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 primary key(site_id,user_id)
);

alter table public.visitor_site_staff enable row level security;
revoke all on public.visitor_site_staff from anon,authenticated;
grant select,insert,update,delete on public.visitor_site_staff to service_role;

alter table public.canton_appointments
 add column if not exists site_id uuid references public.visitor_sites(id);

alter table public.canton_qr_sites
 add column if not exists visitor_site_id uuid references public.visitor_sites(id);

create index if not exists canton_appointments_site_schedule_idx
 on public.canton_appointments(organization_id,site_id,scheduled_local);

create index if not exists visitor_site_staff_user_idx
 on public.visitor_site_staff(user_id,is_active);

-- Existing Canton data should be backfilled to the organization's Canton HQ
-- during controlled deployment after the production organization is confirmed.


create unique index if not exists visitor_sites_one_hq_per_org_idx
 on public.visitor_sites(organization_id)
 where is_hq=true;


-- Multi-site foreign-key coverage must be created only after the site columns exist.
create index if not exists canton_appointments_site_fk_idx
 on public.canton_appointments(site_id) where site_id is not null;

create index if not exists canton_qr_sites_visitor_site_fk_idx
 on public.canton_qr_sites(visitor_site_id) where visitor_site_id is not null;
