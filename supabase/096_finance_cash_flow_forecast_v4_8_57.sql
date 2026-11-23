-- SUPER LEADER V4.8.57 - Tresorerie previsionnelle
-- Position de depart, seuil d alerte, hypotheses et ajustements manuels audites.
begin;

create table if not exists public.finance_cash_flow_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  as_of_date date not null default current_date,
  opening_balance numeric(14,2) not null default 0,
  minimum_balance numeric(14,2) not null default 0,
  receipt_confidence_pct integer not null default 80 check (receipt_confidence_pct between 0 and 100),
  expense_contingency_pct integer not null default 105 check (expense_contingency_pct between 100 and 200),
  horizon_months integer not null default 6 check (horizon_months between 3 and 18),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (organization_id, currency)
);

create table if not exists public.finance_cash_flow_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  direction text not null check (direction in ('income','expense')),
  title text not null check (char_length(trim(title)) between 2 and 220),
  category text not null default 'other' check (char_length(trim(category)) between 2 and 100),
  expected_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  probability_pct integer not null default 100 check (probability_pct between 0 and 100),
  status text not null default 'planned' check (status in ('planned','confirmed','cancelled')),
  notes text check (notes is null or char_length(trim(notes)) <= 1500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_cash_adjustments_forecast_idx
  on public.finance_cash_flow_adjustments (organization_id, currency, expected_date, status);

create table if not exists public.finance_cash_flow_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  adjustment_id uuid references public.finance_cash_flow_adjustments(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists finance_cash_audit_org_idx
  on public.finance_cash_flow_audit_log (organization_id, created_at desc);

alter table public.finance_cash_flow_settings enable row level security;
alter table public.finance_cash_flow_adjustments enable row level security;
alter table public.finance_cash_flow_audit_log enable row level security;
revoke all on public.finance_cash_flow_settings, public.finance_cash_flow_adjustments,
  public.finance_cash_flow_audit_log from anon, authenticated;
grant select, insert, update, delete on public.finance_cash_flow_settings,
  public.finance_cash_flow_adjustments, public.finance_cash_flow_audit_log to service_role;

comment on table public.finance_cash_flow_settings is
  'Hypotheses de pilotage de tresorerie par organisation et devise.';
comment on table public.finance_cash_flow_adjustments is
  'Flux manuels futurs distincts des factures, depenses, paie, commissions et budgets.';

commit;
notify pgrst, 'reload schema';
