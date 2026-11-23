begin;

create table if not exists public.service_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legal_name text not null check (char_length(trim(legal_name)) between 2 and 220),
  trading_name text,
  service_category text not null check (char_length(trim(service_category)) between 2 and 120),
  contact_name text,
  contact_email text,
  contact_phone text,
  country text,
  status text not null default 'active' check (status in ('active','suspended','inactive')),
  notes text not null default '' check (char_length(notes) <= 5000),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_providers_org_status_idx
  on public.service_providers (organization_id, status, legal_name);
create unique index if not exists service_providers_org_legal_name_uq
  on public.service_providers (organization_id, lower(legal_name));

create table if not exists public.service_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_id uuid not null references public.service_providers(id) on delete restrict,
  contract_number text not null check (char_length(trim(contract_number)) between 2 and 80),
  title text not null check (char_length(trim(title)) between 3 and 220),
  service_scope text not null default '' check (char_length(service_scope) <= 8000),
  department text,
  internal_owner_user_id uuid not null references auth.users(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  value_amount numeric(18,2) not null default 0 check (value_amount >= 0),
  currency text not null default 'USD' check (char_length(currency) between 3 and 8),
  payment_terms text not null default '' check (char_length(payment_terms) <= 2000),
  status text not null default 'draft' check (status in ('draft','active','under_review','renewed','suspended','completed','terminated')),
  renewal_notice_days integer not null default 90 check (renewal_notice_days between 0 and 730),
  performance_target numeric(5,2) not null default 80 check (performance_target between 0 and 100),
  notes text not null default '' check (char_length(notes) <= 5000),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_contracts_dates_ck check (end_date >= start_date)
);

create unique index if not exists service_contracts_org_number_uq
  on public.service_contracts (organization_id, lower(contract_number));
create index if not exists service_contracts_org_status_end_idx
  on public.service_contracts (organization_id, status, end_date);
create index if not exists service_contracts_owner_idx
  on public.service_contracts (organization_id, internal_owner_user_id, status);
create index if not exists service_contracts_provider_idx
  on public.service_contracts (provider_id, end_date desc);

create table if not exists public.service_contract_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_id uuid references public.service_providers(id) on delete set null,
  contract_id uuid references public.service_contracts(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(trim(action)) between 2 and 120),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists service_contract_audit_org_idx
  on public.service_contract_audit_log (organization_id, created_at desc);
create index if not exists service_contract_audit_contract_idx
  on public.service_contract_audit_log (contract_id, created_at desc);

alter table public.service_providers enable row level security;
alter table public.service_contracts enable row level security;
alter table public.service_contract_audit_log enable row level security;

drop policy if exists service_providers_select on public.service_providers;
create policy service_providers_select
on public.service_providers
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = service_providers.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (
        om.role in ('owner','admin','executive','hr')
        or exists (
          select 1
          from public.service_contracts sc
          where sc.organization_id = service_providers.organization_id
            and sc.provider_id = service_providers.id
            and sc.internal_owner_user_id = auth.uid()
        )
      )
  )
);

drop policy if exists service_contracts_select on public.service_contracts;
create policy service_contracts_select
on public.service_contracts
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = service_contracts.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (
        om.role in ('owner','admin','executive','hr')
        or service_contracts.internal_owner_user_id = auth.uid()
      )
  )
);

drop policy if exists service_contract_audit_none on public.service_contract_audit_log;
create policy service_contract_audit_none
on public.service_contract_audit_log
for select
to authenticated
using (false);

commit;
