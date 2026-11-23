begin;
create table if not exists public.finance_budgets(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,fiscal_year integer not null check(fiscal_year between 2020 and 2100),currency text not null check(currency ~ '^[A-Z]{3}$'),
 status text not null default 'draft' check(status in('draft','submitted','approved','locked','archived')),
 created_by uuid not null references auth.users(id),submitted_by uuid references auth.users(id),submitted_at timestamptz,approved_by uuid references auth.users(id),approved_at timestamptz,locked_by uuid references auth.users(id),locked_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,name,fiscal_year,currency)
);
create table if not exists public.finance_budget_lines(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,budget_id uuid not null references public.finance_budgets(id) on delete cascade,
 month integer not null check(month between 1 and 12),direction text not null check(direction in('income','expense')),category text not null,cost_center_id uuid references public.finance_cost_centers(id) on delete set null,
 budget_amount numeric(14,2) not null default 0 check(budget_amount>=0),forecast_amount numeric(14,2) not null default 0 check(forecast_amount>=0),notes text,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists finance_budget_lines_budget_idx on public.finance_budget_lines(budget_id,month,direction);
create table if not exists public.finance_budget_audit_log(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,budget_id uuid references public.finance_budgets(id) on delete cascade,actor_id uuid not null references auth.users(id),action text not null,details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
alter table public.finance_budgets enable row level security;alter table public.finance_budget_lines enable row level security;alter table public.finance_budget_audit_log enable row level security;
revoke all on public.finance_budgets,public.finance_budget_lines,public.finance_budget_audit_log from anon,authenticated;
grant select,insert,update,delete on public.finance_budgets,public.finance_budget_lines,public.finance_budget_audit_log to service_role;
commit;
