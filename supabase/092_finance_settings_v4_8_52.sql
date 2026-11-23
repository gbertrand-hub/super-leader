begin;
create table if not exists public.finance_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 base_currency text not null default 'USD' check(base_currency ~ '^[A-Z]{3}$'),
 allowed_currencies text[] not null default array['USD']::text[],
 fiscal_year_start_month integer not null default 1 check(fiscal_year_start_month between 1 and 12),
 payment_terms_days integer not null default 30 check(payment_terms_days between 0 and 365),
 reconciliation_warning_days integer not null default 3 check(reconciliation_warning_days between 1 and 90),
 receivable_warning_days integer not null default 30 check(receivable_warning_days between 1 and 365),
 expense_owner_threshold numeric(14,2) not null default 5000 check(expense_owner_threshold>=0),
 negative_cash_flow_alert boolean not null default true,
 invoice_prefix text not null default 'FAC', receipt_prefix text not null default 'REC', expense_prefix text not null default 'DEP',
 controller_user_id uuid references auth.users(id) on delete set null,
 approver_user_id uuid references auth.users(id) on delete set null,
 payer_user_id uuid references auth.users(id) on delete set null,
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table if not exists public.finance_bank_accounts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 bank_name text not null, account_name text not null, currency text not null check(currency ~ '^[A-Z]{3}$'), account_last4 text not null check(account_last4 ~ '^[0-9]{4}$'),
 is_primary boolean not null default false, is_active boolean not null default true, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.finance_cost_centers (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 code text not null, name text not null, is_active boolean not null default true, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(organization_id,code)
);
create table if not exists public.finance_settings_audit_log (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid not null references auth.users(id), action text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
alter table public.finance_settings enable row level security;
alter table public.finance_bank_accounts enable row level security;
alter table public.finance_cost_centers enable row level security;
alter table public.finance_settings_audit_log enable row level security;
revoke all on public.finance_settings,public.finance_bank_accounts,public.finance_cost_centers,public.finance_settings_audit_log from anon,authenticated;
grant select,insert,update,delete on public.finance_settings,public.finance_bank_accounts,public.finance_cost_centers,public.finance_settings_audit_log to service_role;
commit;
