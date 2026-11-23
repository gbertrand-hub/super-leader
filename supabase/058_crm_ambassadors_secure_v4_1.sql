-- SUPER LEADER V4.1 - Gestion securisee des ambassadeurs et recommandations
-- A executer apres 057_crm_prospect_center_v4_0.sql
begin;

create or replace function public.can_manage_ambassadors(org_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.has_active_org_role(org_id, array['owner','admin','hr']) or exists (
    select 1 from public.organization_members m join public.teams t
      on t.organization_id=m.organization_id and t.manager_id=m.user_id and t.is_active=true
    where m.organization_id=org_id and m.user_id=auth.uid() and m.is_active=true and m.role='manager'
      and lower(trim(coalesce(t.department,''))) in ('finance','finances','financial','rh','hr','human resources','ressources humaines')
  );
$$;

create table if not exists public.crm_ambassadors (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null, full_name text not null, email text, phone text, country_code text, city text,
  status text not null default 'active' check(status in ('active','suspended','inactive')),
  level_name text, commission_type text not null default 'percentage' check(commission_type in ('percentage','fixed')),
  commission_value numeric(14,2) not null default 0 check(commission_value>=0), currency text not null default 'USD' check(currency ~ '^[A-Z]{3}$'),
  notes text, joined_at date not null default current_date, created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,code)
);
create unique index if not exists crm_ambassadors_email_unique on public.crm_ambassadors(organization_id,lower(email)) where email is not null and trim(email)<>'';
alter table public.crm_clients add column if not exists ambassador_id uuid references public.crm_ambassadors(id) on delete set null;
alter table public.crm_opportunities add column if not exists ambassador_id uuid references public.crm_ambassadors(id) on delete set null;

create table if not exists public.crm_ambassador_commissions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  ambassador_id uuid not null references public.crm_ambassadors(id), sale_id uuid not null references public.sales_records(id), payment_id uuid not null references public.sales_payments(id),
  basis_amount numeric(14,2) not null check(basis_amount>0), commission_type text not null, commission_value numeric(14,2) not null,
  commission_amount numeric(14,2) not null check(commission_amount>=0), currency text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','paid','cancelled')),
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz, paid_by uuid references auth.users(id), paid_at timestamptz, payment_reference text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(payment_id,ambassador_id)
);
create table if not exists public.crm_ambassador_audit_log (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 ambassador_id uuid references public.crm_ambassadors(id) on delete set null, commission_id uuid references public.crm_ambassador_commissions(id) on delete set null,
 actor_id uuid references auth.users(id), action text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

alter table public.crm_ambassadors enable row level security;
alter table public.crm_ambassador_commissions enable row level security;
alter table public.crm_ambassador_audit_log enable row level security;
revoke all on public.crm_ambassadors,public.crm_ambassador_commissions,public.crm_ambassador_audit_log from anon,authenticated;
grant select on public.crm_ambassadors to authenticated;
grant insert,update on public.crm_ambassadors to authenticated;
grant select,insert,update on public.crm_ambassador_commissions to authenticated;
grant select,insert on public.crm_ambassador_audit_log to authenticated;
create policy ambassadors_active_select on public.crm_ambassadors for select using (
 public.has_active_org_role(organization_id,array['owner','admin','hr','manager','employee']) and (status='active' or public.can_manage_ambassadors(organization_id))
);
create policy ambassadors_manage on public.crm_ambassadors for all using(public.can_manage_ambassadors(organization_id)) with check(public.can_manage_ambassadors(organization_id));
create policy ambassador_commissions_manage on public.crm_ambassador_commissions for all using(public.can_manage_ambassadors(organization_id)) with check(public.can_manage_ambassadors(organization_id));
create policy ambassador_audit_manage on public.crm_ambassador_audit_log for select using(public.can_manage_ambassadors(organization_id));
create policy ambassador_audit_insert on public.crm_ambassador_audit_log for insert with check(public.can_manage_ambassadors(organization_id) and actor_id=auth.uid());
grant execute on function public.can_manage_ambassadors(uuid) to authenticated;
commit;
