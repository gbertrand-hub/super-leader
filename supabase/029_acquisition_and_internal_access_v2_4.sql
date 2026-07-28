-- SUPER LEADER V2.4 - Acquisition SaaS et demandes d'acces internes
-- A executer apres 028_development_learning_hours_v2_3_1.sql

begin;

create extension if not exists pgcrypto;

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  email text not null,
  phone text,
  whatsapp text,
  organization_name text not null check (char_length(trim(organization_name)) between 2 and 180),
  country text not null,
  sector text,
  employee_count_range text,
  needs text not null check (char_length(trim(needs)) between 10 and 4000),
  interested_modules text[] not null default '{}'::text[],
  preferred_demo_date date,
  contact_consent boolean not null default false,
  status text not null default 'new' check (status in (
    'new','contact_pending','demo_scheduled','demo_completed',
    'trial_approved','client_active','rejected','archived'
  )),
  assigned_to uuid references auth.users(id) on delete set null,
  scheduled_demo_at timestamptz,
  sales_notes text,
  converted_organization_id uuid references public.organizations(id) on delete set null,
  source text not null default 'public_signup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demo_requests_status_created_idx
  on public.demo_requests (status, created_at desc);
create index if not exists demo_requests_email_idx
  on public.demo_requests (lower(email));
create index if not exists demo_requests_assigned_idx
  on public.demo_requests (assigned_to, status, created_at desc);

create table if not exists public.internal_access_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  email text not null,
  phone text,
  entity_name text not null,
  department text,
  position_title text not null,
  supervisor_name text,
  requested_team text,
  employee_reference text,
  reason text not null check (char_length(trim(reason)) between 10 and 3000),
  status text not null default 'pending' check (status in (
    'pending','reviewing','approved','rejected','cancelled'
  )),
  organization_id uuid references public.organizations(id) on delete set null,
  approved_user_id uuid references auth.users(id) on delete set null,
  assigned_role text check (assigned_role is null or assigned_role in ('admin','hr','manager','employee')),
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists internal_access_status_created_idx
  on public.internal_access_requests (status, created_at desc);
create index if not exists internal_access_email_idx
  on public.internal_access_requests (lower(email));

create table if not exists public.acquisition_audit_log (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('demo','internal_access')),
  request_id uuid not null,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists acquisition_audit_request_idx
  on public.acquisition_audit_log (request_type, request_id, created_at desc);
create index if not exists acquisition_audit_org_idx
  on public.acquisition_audit_log (organization_id, created_at desc);

create or replace function public.acquisition_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_demo_requests_updated_at on public.demo_requests;
create trigger set_demo_requests_updated_at
before update on public.demo_requests
for each row execute function public.acquisition_set_updated_at();

drop trigger if exists set_internal_access_requests_updated_at on public.internal_access_requests;
create trigger set_internal_access_requests_updated_at
before update on public.internal_access_requests
for each row execute function public.acquisition_set_updated_at();

alter table public.demo_requests enable row level security;
alter table public.internal_access_requests enable row level security;
alter table public.acquisition_audit_log enable row level security;

-- Ces tables contiennent des donnees commerciales et RH sensibles.
-- Toutes les lectures et ecritures passent par des actions serveur avec la cle service_role.
revoke all on public.demo_requests from anon, authenticated;
revoke all on public.internal_access_requests from anon, authenticated;
revoke all on public.acquisition_audit_log from anon, authenticated;

grant select, insert, update, delete on public.demo_requests to service_role;
grant select, insert, update, delete on public.internal_access_requests to service_role;
grant select, insert on public.acquisition_audit_log to service_role;

commit;
notify pgrst, 'reload schema';
