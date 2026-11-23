-- Super Leader V3.9.0
-- Commercial targets and forecasting. Run after 053_multisector_crm_pipeline_v3_5_0.sql.

begin;

create table if not exists public.crm_sales_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  owner_id uuid references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  product_id uuid references public.sales_products(id) on delete cascade,
  sector text check (sector is null or sector in ('house','land','training','livestock')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  target_amount numeric(14,2) not null default 0 check (target_amount >= 0),
  target_count integer not null default 0 check (target_count >= 0),
  notes text check (notes is null or char_length(trim(notes)) <= 1000),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_sales_targets_period_check check (period_end >= period_start),
  constraint crm_sales_targets_scope_check check (
    ((owner_id is not null)::integer + (team_id is not null)::integer) <= 1
  )
);

create unique index if not exists crm_sales_targets_scope_unique_idx
  on public.crm_sales_targets (
    organization_id, period_start, period_end,
    coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(sector, ''), currency
  );

create index if not exists crm_sales_targets_org_period_idx
  on public.crm_sales_targets (organization_id, period_start, period_end, currency);

create or replace function public.crm_sales_targets_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_crm_sales_targets_updated_at on public.crm_sales_targets;
create trigger set_crm_sales_targets_updated_at
before update on public.crm_sales_targets
for each row execute function public.crm_sales_targets_set_updated_at();

alter table public.crm_sales_targets enable row level security;
revoke all on public.crm_sales_targets from anon, authenticated;
grant select, insert, update, delete on public.crm_sales_targets to service_role;

comment on table public.crm_sales_targets is 'Periodic commercial targets by organization, seller or team.';
comment on column public.crm_sales_targets.target_amount is 'Confirmed first-payment revenue target in the selected currency.';

commit;
notify pgrst, 'reload schema';
