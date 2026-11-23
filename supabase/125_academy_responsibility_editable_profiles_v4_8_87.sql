-- Super Leader V4.8.87 - Editable Academy responsibility catalogue
-- Requires V4.8.85 academy responsibility assignments.

create extension if not exists pgcrypto;

create table if not exists public.academy_responsibility_profile_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_code text not null check (role_code in (
    'school_direction',
    'academic_coordination',
    'trainer',
    'student_followup',
    'communication',
    'marketing',
    'finance',
    'data_analyst',
    'observer'
  )),
  profile_json jsonb not null,
  revision integer not null default 2 check (revision >= 2),
  is_customized boolean not null default true,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, role_code)
);

create index if not exists academy_responsibility_profile_overrides_org_idx
  on public.academy_responsibility_profile_overrides (organization_id, role_code);

create table if not exists public.academy_responsibility_profile_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_code text not null check (role_code in (
    'school_direction',
    'academic_coordination',
    'trainer',
    'student_followup',
    'communication',
    'marketing',
    'finance',
    'data_analyst',
    'observer'
  )),
  previous_profile_json jsonb,
  new_profile_json jsonb not null,
  previous_revision integer not null,
  new_revision integer not null,
  change_reason text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists academy_responsibility_profile_history_org_role_idx
  on public.academy_responsibility_profile_history (organization_id, role_code, changed_at desc);

alter table public.academy_responsibility_profile_overrides enable row level security;
alter table public.academy_responsibility_profile_history enable row level security;

-- These tables are intentionally managed through authenticated server actions
-- using the service-role client. No direct browser-side access is granted.
revoke all on public.academy_responsibility_profile_overrides from anon, authenticated;
revoke all on public.academy_responsibility_profile_history from anon, authenticated;
grant all on public.academy_responsibility_profile_overrides to service_role;
grant all on public.academy_responsibility_profile_history to service_role;
