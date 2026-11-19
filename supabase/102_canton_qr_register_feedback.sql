-- Canton QR welcome registration and visit feedback code.
-- Public web forms use SERVER actions only; no public PostgREST grants.
create table if not exists public.canton_qr_sites(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 label text not null default 'Canton Reception' check(length(label) between 3 and 120),
 enabled boolean not null default true,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique(organization_id,id)
);
create table if not exists public.canton_intake_requests(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 site_id uuid not null,
 constraint canton_intake_site_org_fk foreign key(organization_id,site_id)
   references public.canton_qr_sites(organization_id,id),
 full_name text not null check(length(trim(full_name)) between 2 and 180),
 email text,
 phone text,
 department text not null check(department in ('DIG','TCF','OTHER')),
 purpose text not null default 'other',
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 ip_hash text,
 created_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 appointment_id uuid references public.canton_appointments(id)
);
create index if not exists canton_intake_queue_idx on public.canton_intake_requests(organization_id,status,created_at);
create index if not exists canton_intake_ip_idx on public.canton_intake_requests(ip_hash,created_at) where ip_hash is not null;
alter table public.canton_appointments
 add column if not exists feedback_code text generated always as
 (upper(substr(replace(feedback_token::text,'-',''),1,12))) stored;
create unique index if not exists canton_feedback_code_unique_idx on public.canton_appointments(feedback_code);
alter table public.canton_qr_sites enable row level security;
alter table public.canton_intake_requests enable row level security;
revoke all on public.canton_qr_sites, public.canton_intake_requests from anon,authenticated;
