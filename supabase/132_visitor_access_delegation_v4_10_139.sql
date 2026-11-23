-- Super Leader V4.10.139
-- Multi-site access scope, cross-site referral permission, and access audit.

create table if not exists public.visitor_access_profiles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  site_scope text not null default 'assigned'
    check (site_scope in ('assigned','all_sites')),
  can_refer_cross_site boolean not null default false,
  can_manage_site_access boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

alter table public.visitor_access_profiles enable row level security;
revoke all on public.visitor_access_profiles from anon,authenticated;
grant select,insert,update,delete on public.visitor_access_profiles to service_role;

create index if not exists visitor_access_profiles_user_idx
  on public.visitor_access_profiles(user_id);

create table if not exists public.visitor_access_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  site_id uuid references public.visitor_sites(id) on delete set null,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

alter table public.visitor_access_audit enable row level security;
revoke all on public.visitor_access_audit from anon,authenticated;
grant select,insert on public.visitor_access_audit to service_role;

create index if not exists visitor_access_audit_org_created_idx
  on public.visitor_access_audit(organization_id,created_at desc);

create index if not exists visitor_access_audit_target_idx
  on public.visitor_access_audit(target_user_id,created_at desc);
