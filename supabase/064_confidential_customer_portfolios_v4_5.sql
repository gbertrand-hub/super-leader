-- Super Leader V4.5 - Portefeuilles clients confidentiels
-- À exécuter après 063_historical_clients_onboarding_v4_4.sql.
begin;

alter table public.crm_clients
  add column if not exists customer_service_assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists customer_service_assigned_at timestamptz;

create table if not exists public.crm_client_assignment_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  previous_owner_id uuid references auth.users(id) on delete set null,
  new_owner_id uuid references auth.users(id) on delete set null,
  assigned_by uuid not null references auth.users(id),
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  created_at timestamptz not null default now()
);

create index if not exists crm_client_assignment_history_client_idx
  on public.crm_client_assignment_history (organization_id, client_id, created_at desc);

create or replace function public.can_access_customer_portfolio(target_client_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.crm_clients c
    join public.organization_members om on om.organization_id=c.organization_id and om.user_id=auth.uid() and om.is_active=true
    where c.id=target_client_id and (
      om.role in ('owner','admin')
      or c.customer_service_owner_id=auth.uid()
      or (om.role='manager' and c.customer_service_owner_id in (
        select tm.user_id from public.teams t join public.team_members tm on tm.team_id=t.id
        where t.organization_id=c.organization_id and t.is_active=true and t.manager_id=auth.uid()
        union select mws.user_id from public.member_work_schedules mws
        where mws.organization_id=c.organization_id and mws.is_active=true and mws.supervisor_id=auth.uid()
      ))
    )
  )
$$;

revoke all on function public.can_access_customer_portfolio(uuid) from public;
grant execute on function public.can_access_customer_portfolio(uuid) to authenticated,service_role;

alter table public.crm_client_assignment_history enable row level security;
revoke all on public.crm_client_assignment_history from anon,authenticated;
grant select,insert on public.crm_client_assignment_history to service_role;

-- Politiques restrictives : elles complètent les politiques existantes et empêchent
-- l'accès direct à un client hors portefeuille avec une session authentifiée.
drop policy if exists crm_clients_confidential_portfolio_select on public.crm_clients;
create policy crm_clients_confidential_portfolio_select on public.crm_clients as restrictive
for select to authenticated using (public.can_access_customer_portfolio(id));

drop policy if exists crm_clients_confidential_portfolio_update on public.crm_clients;
create policy crm_clients_confidential_portfolio_update on public.crm_clients as restrictive
for update to authenticated using (public.can_access_customer_portfolio(id))
with check (public.can_access_customer_portfolio(id));

create or replace function public.audit_customer_service_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.customer_service_owner_id is distinct from old.customer_service_owner_id then
    new.customer_service_assigned_by:=coalesce(auth.uid(),new.customer_service_assigned_by);
    new.customer_service_assigned_at:=now();
  end if;
  return new;
end $$;

drop trigger if exists audit_customer_service_assignment_trigger on public.crm_clients;
create trigger audit_customer_service_assignment_trigger before update of customer_service_owner_id
on public.crm_clients for each row execute function public.audit_customer_service_assignment();

comment on table public.crm_client_assignment_history is 'Historique immuable des attributions et transferts de portefeuilles clients.';
comment on function public.can_access_customer_portfolio(uuid) is 'Autorisation centrale : agent propriétaire, manager de son équipe, ou Admin/Owner.';

commit;
notify pgrst, 'reload schema';
