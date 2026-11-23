-- Super Leader V4.10.32
-- Permit the organisation owner and administrators to manage annual leave balances.

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
      and role in ('owner', 'admin', 'hr')
      and is_active = true
  ) then
    raise exception 'leave_balance_management_role_required';
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
