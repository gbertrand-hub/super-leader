-- SUPER LEADER - Module Ventes & Commissions V1
-- A executer apres 001_company_team.sql et 002_members_assignment.sql

begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.sales_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 160),
  code text,
  description text check (description is null or char_length(trim(description)) <= 1500),
  default_price numeric(14,2) not null default 0 check (default_price >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  commission_type text not null default 'percentage' check (commission_type in ('percentage','fixed')),
  commission_value numeric(14,2) not null default 0 check (commission_value >= 0),
  proof_required boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_products_org_code_unique
  on public.sales_products (organization_id, lower(code))
  where code is not null and btrim(code) <> '';

create index if not exists sales_products_org_active_idx
  on public.sales_products (organization_id, is_active, name);

create table if not exists public.sales_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.sales_products(id) on delete set null,
  product_name text not null check (char_length(trim(product_name)) between 2 and 200),
  customer_name text not null check (char_length(trim(customer_name)) between 2 and 200),
  customer_email text,
  customer_phone text,
  sale_date date not null default current_date,
  quantity integer not null default 1 check (quantity between 1 and 100000),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  payment_method text not null default 'bank_transfer' check (payment_method in (
    'bank_transfer','card','cash','mobile_money','cheque','other'
  )),
  payment_status text not null default 'unpaid' check (payment_status in (
    'unpaid','partial','paid','refunded'
  )),
  workflow_status text not null default 'submitted' check (workflow_status in (
    'draft','submitted','verified','approved','rejected','cancelled','refunded'
  )),
  transaction_reference text,
  proof_url text,
  notes text check (notes is null or char_length(trim(notes)) <= 3000),
  commission_type text not null default 'percentage' check (commission_type in ('percentage','fixed')),
  commission_value numeric(14,2) not null default 0 check (commission_value >= 0),
  commission_amount numeric(14,2) not null default 0 check (commission_amount >= 0),
  commission_status text not null default 'pending' check (commission_status in (
    'pending','validated','payable','paid','cancelled'
  )),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  commission_paid_by uuid references auth.users(id),
  commission_paid_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_records_org_transaction_reference_unique
  on public.sales_records (organization_id, lower(transaction_reference))
  where transaction_reference is not null and btrim(transaction_reference) <> '';

create index if not exists sales_records_org_seller_date_idx
  on public.sales_records (organization_id, seller_id, sale_date desc);

create index if not exists sales_records_org_workflow_idx
  on public.sales_records (organization_id, workflow_status, sale_date desc);

create index if not exists sales_records_org_commission_idx
  on public.sales_records (organization_id, commission_status, sale_date desc);

create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month date not null check (date_trunc('month', period_month)::date = period_month),
  target_amount numeric(14,2) not null check (target_amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, period_month, currency)
);

create index if not exists sales_targets_org_month_idx
  on public.sales_targets (organization_id, period_month desc, user_id);

create table if not exists public.sales_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales_records(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action text not null,
  old_status text,
  new_status text,
  note text check (note is null or char_length(trim(note)) <= 1500),
  created_at timestamptz not null default now()
);

create index if not exists sales_audit_log_sale_idx
  on public.sales_audit_log (sale_id, created_at desc);

alter table public.sales_products enable row level security;
alter table public.sales_records enable row level security;
alter table public.sales_targets enable row level security;
alter table public.sales_audit_log enable row level security;

-- Toutes les operations passent par les Server Actions et la cle serveur.
revoke all on public.sales_products from anon, authenticated;
revoke all on public.sales_records from anon, authenticated;
revoke all on public.sales_targets from anon, authenticated;
revoke all on public.sales_audit_log from anon, authenticated;

grant select, insert, update, delete on public.sales_products to service_role;
grant select, insert, update, delete on public.sales_records to service_role;
grant select, insert, update, delete on public.sales_targets to service_role;
grant select, insert on public.sales_audit_log to service_role;

drop trigger if exists set_sales_products_updated_at on public.sales_products;
create trigger set_sales_products_updated_at
before update on public.sales_products
for each row execute function public.set_updated_at();

drop trigger if exists set_sales_records_updated_at on public.sales_records;
create trigger set_sales_records_updated_at
before update on public.sales_records
for each row execute function public.set_updated_at();

drop trigger if exists set_sales_targets_updated_at on public.sales_targets;
create trigger set_sales_targets_updated_at
before update on public.sales_targets
for each row execute function public.set_updated_at();

commit;

notify pgrst, 'reload schema';
