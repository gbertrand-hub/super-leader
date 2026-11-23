-- Super Leader V4.8.85 - Academy responsibility assignments
-- Execute after the Academy and organization foundations.

create extension if not exists pgcrypto;

create table if not exists public.academy_responsibility_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
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
  context_label text not null default '',
  notes text,
  is_active boolean not null default true,
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academy_responsibility_assignments_org_idx
  on public.academy_responsibility_assignments (organization_id, is_active);

create index if not exists academy_responsibility_assignments_user_idx
  on public.academy_responsibility_assignments (user_id, is_active);

create unique index if not exists academy_responsibility_assignments_active_unique_idx
  on public.academy_responsibility_assignments (organization_id, user_id, role_code, context_label)
  where is_active = true;

alter table public.academy_responsibility_assignments enable row level security;

-- The application deliberately manages these assignments only through
-- authenticated server actions using the service-role client. No direct client
-- mutation/read permission is granted here, so a user cannot bypass the UI.
revoke all on public.academy_responsibility_assignments from anon, authenticated;
grant all on public.academy_responsibility_assignments to service_role;
