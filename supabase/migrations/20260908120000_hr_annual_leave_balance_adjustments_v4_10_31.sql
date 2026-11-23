-- Super Leader V4.10.31
-- Annual leave opening balances and immutable adjustment history.

create extension if not exists pgcrypto;

create table if not exists public.leave_annual_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  leave_year integer not null check (leave_year between 2000 and 2200),
  annual_allowance integer not null default 20 check (annual_allowance between 0 and 365),
  prior_used_days integer not null default 0 check (prior_used_days between 0 and 365),
  adjustment_reason text not null check (char_length(trim(adjustment_reason)) between 3 and 1000),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, leave_year)
);

create table if not exists public.leave_annual_balance_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  leave_year integer not null check (leave_year between 2000 and 2200),
  previous_annual_allowance integer not null check (previous_annual_allowance between 0 and 365),
  new_annual_allowance integer not null check (new_annual_allowance between 0 and 365),
  previous_prior_used_days integer not null check (previous_prior_used_days between 0 and 365),
  new_prior_used_days integer not null check (new_prior_used_days between 0 and 365),
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  changed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists leave_annual_balances_org_year_idx
  on public.leave_annual_balances (organization_id, leave_year, user_id);

create index if not exists leave_annual_balance_audit_org_year_idx
  on public.leave_annual_balance_audit_log (organization_id, leave_year, created_at desc);

drop trigger if exists leave_annual_balances_updated_at_trigger on public.leave_annual_balances;
create trigger leave_annual_balances_updated_at_trigger
before update on public.leave_annual_balances
for each row execute function public.performance_set_updated_at();

alter table public.leave_annual_balances enable row level security;
alter table public.leave_annual_balance_audit_log enable row level security;

revoke all on public.leave_annual_balances from anon, authenticated;
revoke all on public.leave_annual_balance_audit_log from anon, authenticated;
grant select, insert, update, delete on public.leave_annual_balances to service_role;
grant select, insert on public.leave_annual_balance_audit_log to service_role;

comment on table public.leave_annual_balances is
  'HR-controlled annual entitlement and leave already consumed outside Super Leader, by employee and year.';
comment on column public.leave_annual_balances.prior_used_days is
  'Annual leave taken before or outside Super Leader. Do not duplicate approved leave_requests.';
comment on table public.leave_annual_balance_audit_log is
  'Immutable history of HR changes to annual leave balances.';

create or replace function public.set_leave_annual_balance(
  p_organization_id uuid,
  p_user_id uuid,
  p_leave_year integer,
  p_annual_allowance integer,
  p_prior_used_days integer,
  p_reason text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance_id uuid;
  v_previous_allowance integer := 20;
  v_previous_prior_used integer := 0;
begin
  if p_leave_year not between 2000 and 2200
    or p_annual_allowance not between 0 and 365
    or p_prior_used_days not between 0 and 365
    or char_length(trim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'invalid_leave_balance_adjustment';
  end if;

  if not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and user_id = p_actor_id
      and role = 'hr'
      and is_active = true
  ) then
    raise exception 'leave_balance_hr_required';
  end if;

  if not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and user_id = p_user_id
      and is_active = true
  ) then
    raise exception 'leave_balance_member_not_found';
  end if;

  select id, annual_allowance, prior_used_days
    into v_balance_id, v_previous_allowance, v_previous_prior_used
  from public.leave_annual_balances
  where organization_id = p_organization_id
    and user_id = p_user_id
    and leave_year = p_leave_year
  for update;

  v_previous_allowance := coalesce(v_previous_allowance, 20);
  v_previous_prior_used := coalesce(v_previous_prior_used, 0);

  insert into public.leave_annual_balances (
    organization_id, user_id, leave_year, annual_allowance,
    prior_used_days, adjustment_reason, updated_by
  ) values (
    p_organization_id, p_user_id, p_leave_year, p_annual_allowance,
    p_prior_used_days, trim(p_reason), p_actor_id
  )
  on conflict (organization_id, user_id, leave_year) do update set
    annual_allowance = excluded.annual_allowance,
    prior_used_days = excluded.prior_used_days,
    adjustment_reason = excluded.adjustment_reason,
    updated_by = excluded.updated_by
  returning id into v_balance_id;

  insert into public.leave_annual_balance_audit_log (
    organization_id, user_id, leave_year,
    previous_annual_allowance, new_annual_allowance,
    previous_prior_used_days, new_prior_used_days,
    reason, changed_by
  ) values (
    p_organization_id, p_user_id, p_leave_year,
    v_previous_allowance, p_annual_allowance,
    v_previous_prior_used, p_prior_used_days,
    trim(p_reason), p_actor_id
  );

  insert into public.performance_audit_log (
    organization_id, actor_id, subject_user_id,
    entity_type, entity_id, action, details
  ) values (
    p_organization_id, p_actor_id, p_user_id,
    'leave_annual_balance', v_balance_id, 'adjusted',
    jsonb_build_object(
      'leave_year', p_leave_year,
      'previous_annual_allowance', v_previous_allowance,
      'annual_allowance', p_annual_allowance,
      'previous_prior_used_days', v_previous_prior_used,
      'prior_used_days', p_prior_used_days,
      'reason', trim(p_reason)
    )
  );

  return v_balance_id;
end;
$$;

revoke all on function public.set_leave_annual_balance(uuid, uuid, integer, integer, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_leave_annual_balance(uuid, uuid, integer, integer, integer, text, uuid)
  to service_role;
