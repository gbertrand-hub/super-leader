-- SUPER LEADER V2.3 - Plan de croissance et contributions d'impact
-- A executer apres 026_academy_strict_quiz_certificate_lock_v2_2_5.sql

begin;

create extension if not exists pgcrypto;

create table if not exists public.growth_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_monthly_target_hours numeric(7,2) not null default 5 check (default_monthly_target_hours between 0 and 200),
  target_credits numeric(7,2) not null default 10 check (target_credits between 1 and 500),
  bonus_weight numeric(5,2) not null default 10 check (bonus_weight between 0 and 20),
  max_monthly_credits numeric(7,2) not null default 20 check (max_monthly_credits between 1 and 1000),
  night_start_time time not null default '22:00',
  night_end_time time not null default '06:00',
  wellbeing_warning_hours numeric(7,2) not null default 10 check (wellbeing_warning_hours between 0 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.growth_settings (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

create or replace function public.ensure_growth_settings_for_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.growth_settings (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_create_growth_settings on public.organizations;
create trigger organizations_create_growth_settings
after insert on public.organizations
for each row execute function public.ensure_growth_settings_for_organization();

create table if not exists public.growth_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_month date not null,
  target_hours numeric(7,2) not null default 5 check (target_hours between 0 and 200),
  target_credits numeric(7,2) not null default 10 check (target_credits between 1 and 500),
  focus_skill text not null check (char_length(trim(focus_skill)) between 2 and 160),
  objective text not null check (char_length(trim(objective)) between 5 and 1500),
  status text not null default 'active' check (status in ('active','completed','archived')),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, plan_month),
  check (date_trunc('month', plan_month)::date = plan_month)
);

create index if not exists growth_plans_org_month_idx
  on public.growth_plans (organization_id, plan_month, user_id);

create table if not exists public.impact_contributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contribution_date date not null,
  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  timezone text not null default 'Europe/Dublin',
  duration_minutes integer not null check (duration_minutes between 15 and 720),
  night_minutes integer not null default 0 check (night_minutes between 0 and 720),
  weekend_minutes integer not null default 0 check (weekend_minutes between 0 and 720),
  category text not null check (category in (
    'learning','mentoring','innovation','documentation','cross_team_support',
    'community','process_improvement','special_project','representation','other'
  )),
  title text not null check (char_length(trim(title)) between 3 and 180),
  description text not null check (char_length(trim(description)) between 10 and 3000),
  skill_developed text not null check (char_length(trim(skill_developed)) between 2 and 180),
  beneficiary text check (beneficiary is null or char_length(trim(beneficiary)) <= 240),
  result_summary text not null check (char_length(trim(result_summary)) between 5 and 2000),
  claimed_impact text not null default 'medium' check (claimed_impact in ('low','medium','high','strategic')),
  validated_impact text check (validated_impact is null or validated_impact in ('low','medium','high','strategic')),
  status text not null default 'submitted' check (status in ('submitted','approved','partially_approved','rejected','cancelled')),
  approved_minutes integer check (approved_minutes is null or approved_minutes between 0 and 720),
  growth_credits numeric(7,2) not null default 0 check (growth_credits between 0 and 100),
  payroll_treatment text not null default 'not_assessed' check (payroll_treatment in ('not_assessed','growth_only','requires_hr_review')),
  evidence_url text,
  proof_storage_path text,
  proof_file_name text,
  proof_mime_type text,
  proof_size_bytes bigint check (proof_size_bytes is null or proof_size_bytes between 1 and 10485760),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists impact_contributions_org_user_date_idx
  on public.impact_contributions (organization_id, user_id, contribution_date desc);
create index if not exists impact_contributions_org_status_idx
  on public.impact_contributions (organization_id, status, contribution_date desc);

alter table public.employee_month_scores
  add column if not exists growth_score numeric(5,2) not null default 0 check (growth_score between 0 and 20),
  add column if not exists growth_credits numeric(7,2) not null default 0 check (growth_credits between 0 and 1000);

-- Reutiliser le mecanisme updated_at du module Performance.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'growth_settings_updated_at') then
    create trigger growth_settings_updated_at
    before update on public.growth_settings
    for each row execute function public.performance_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'growth_plans_updated_at') then
    create trigger growth_plans_updated_at
    before update on public.growth_plans
    for each row execute function public.performance_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'impact_contributions_updated_at') then
    create trigger impact_contributions_updated_at
    before update on public.impact_contributions
    for each row execute function public.performance_set_updated_at();
  end if;
end $$;

alter table public.growth_settings enable row level security;
alter table public.growth_plans enable row level security;
alter table public.impact_contributions enable row level security;

drop policy if exists "growth settings visible to active members" on public.growth_settings;
create policy "growth settings visible to active members"
on public.growth_settings for select to authenticated
using (public.has_active_org_role(organization_id, array['owner','admin','hr','manager','employee']));

drop policy if exists "growth settings managed by hr leaders" on public.growth_settings;
create policy "growth settings managed by hr leaders"
on public.growth_settings for all to authenticated
using (public.has_active_org_role(organization_id, array['owner','admin','hr']))
with check (public.has_active_org_role(organization_id, array['owner','admin','hr']));

drop policy if exists "growth plans visible by scope" on public.growth_plans;
create policy "growth plans visible by scope"
on public.growth_plans for select to authenticated
using (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
);

drop policy if exists "growth plans created by scope" on public.growth_plans;
create policy "growth plans created by scope"
on public.growth_plans for insert to authenticated
with check (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
);

drop policy if exists "growth plans updated by scope" on public.growth_plans;
create policy "growth plans updated by scope"
on public.growth_plans for update to authenticated
using (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
)
with check (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
);

drop policy if exists "impact contributions visible by scope" on public.impact_contributions;
create policy "impact contributions visible by scope"
on public.impact_contributions for select to authenticated
using (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
);

drop policy if exists "impact contributions self submitted" on public.impact_contributions;
create policy "impact contributions self submitted"
on public.impact_contributions for insert to authenticated
with check (user_id = auth.uid() and public.has_active_org_role(organization_id, array['owner','admin','hr','manager','employee']));

drop policy if exists "impact contributions updated by scope" on public.impact_contributions;
create policy "impact contributions updated by scope"
on public.impact_contributions for update to authenticated
using (
  (user_id = auth.uid() and status = 'submitted')
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
)
with check (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
);

revoke all on public.growth_settings from anon, authenticated;
revoke all on public.growth_plans from anon, authenticated;
revoke all on public.impact_contributions from anon, authenticated;

grant select on public.growth_settings to authenticated;
-- Toutes les ecritures passent par les actions serveur avec service_role.
-- Les clients authentifies gardent uniquement la lecture limitee par RLS.
grant select on public.growth_plans to authenticated;
grant select on public.impact_contributions to authenticated;

grant all on public.growth_settings to service_role;
grant all on public.growth_plans to service_role;
grant all on public.impact_contributions to service_role;

commit;
notify pgrst, 'reload schema';
