-- SUPER LEADER V4.8.55 - Cloture financiere gouvernee
-- Preparation owner/admin, cloture et reouverture owner, verrouillage DB et audit immuable.
begin;

create table if not exists public.finance_close_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 2 and 160),
  period_start date not null,
  period_end date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check (status in ('draft','in_review','ready','closed','reopened','archived')),
  opening_bank_balance numeric(16,2) not null default 0,
  declared_closing_bank_balance numeric(16,2),
  incoming_snapshot numeric(16,2) not null default 0,
  outgoing_snapshot numeric(16,2) not null default 0,
  net_snapshot numeric(16,2) not null default 0,
  calculated_closing_balance numeric(16,2) not null default 0,
  variance_snapshot numeric(16,2),
  checks_snapshot jsonb not null default '[]'::jsonb,
  notes text check (notes is null or char_length(trim(notes)) <= 2000),
  created_by uuid not null references auth.users(id),
  last_checked_by uuid references auth.users(id) on delete set null,
  last_checked_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopen_reason text check (reopen_reason is null or char_length(trim(reopen_reason)) between 10 and 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (organization_id, period_start, period_end, currency)
);

create index if not exists finance_close_periods_org_idx
  on public.finance_close_periods (organization_id, period_end desc, status);

create table if not exists public.finance_close_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid references public.finance_close_periods(id) on delete set null,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('created','balances_updated','checks_refreshed','closed','reopened','archived')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists finance_close_audit_period_idx
  on public.finance_close_audit_log (organization_id, period_id, created_at desc);

create or replace function public.finance_guard_closed_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb := '{}'::jsonb;
  new_row jsonb := '{}'::jsonb;
  row_org uuid;
  row_currency text;
  movement_date date;
  old_relevant boolean := false;
  new_relevant boolean := false;
begin
  if tg_op in ('UPDATE','DELETE') then old_row := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then new_row := to_jsonb(new); end if;
  row_org := coalesce(nullif(new_row->>'organization_id','')::uuid, nullif(old_row->>'organization_id','')::uuid);
  row_currency := coalesce(nullif(new_row->>'currency',''), nullif(old_row->>'currency',''));

  if tg_table_name = 'sales_payments' then
    old_relevant := old_row->>'status' = 'confirmed'; new_relevant := new_row->>'status' = 'confirmed';
    movement_date := coalesce(nullif(new_row->>'payment_date','')::date, nullif(old_row->>'payment_date','')::date);
  elsif tg_table_name = 'customer_service_installment_payments' then
    old_relevant := old_row->>'finance_status' = 'validated'; new_relevant := new_row->>'finance_status' = 'validated';
    movement_date := coalesce(nullif(new_row->>'received_on','')::date, nullif(old_row->>'received_on','')::date);
  elsif tg_table_name = 'finance_expenses' then
    old_relevant := old_row->>'status' = 'paid'; new_relevant := new_row->>'status' = 'paid';
    movement_date := coalesce(nullif(new_row->>'paid_on','')::date, nullif(old_row->>'paid_on','')::date);
  elsif tg_table_name = 'payroll_periods' then
    old_relevant := (old_row->>'status') in ('paid','locked'); new_relevant := (new_row->>'status') in ('paid','locked');
    movement_date := coalesce(nullif(new_row->>'pay_date','')::date, nullif(new_row->>'period_end','')::date, nullif(old_row->>'pay_date','')::date, nullif(old_row->>'period_end','')::date);
  elsif tg_table_name = 'sales_records' then
    old_relevant := old_row->>'commission_status' = 'paid'; new_relevant := new_row->>'commission_status' = 'paid';
    movement_date := coalesce(nullif(new_row->>'commission_paid_at','')::timestamptz::date, nullif(old_row->>'commission_paid_at','')::timestamptz::date);
  end if;

  if row_org is not null and row_currency is not null and movement_date is not null and (old_relevant or new_relevant)
     and exists (
       select 1 from public.finance_close_periods p
       where p.organization_id = row_org and p.currency = row_currency and p.status = 'closed'
         and movement_date between p.period_start and p.period_end
     ) then
    raise exception 'FINANCE_PERIOD_CLOSED: movement dated % is locked', movement_date using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists finance_close_guard_sales_payments on public.sales_payments;
create trigger finance_close_guard_sales_payments before insert or update or delete on public.sales_payments for each row execute function public.finance_guard_closed_period();
drop trigger if exists finance_close_guard_service_payments on public.customer_service_installment_payments;
create trigger finance_close_guard_service_payments before insert or update or delete on public.customer_service_installment_payments for each row execute function public.finance_guard_closed_period();
drop trigger if exists finance_close_guard_expenses on public.finance_expenses;
create trigger finance_close_guard_expenses before insert or update or delete on public.finance_expenses for each row execute function public.finance_guard_closed_period();
drop trigger if exists finance_close_guard_payroll on public.payroll_periods;
create trigger finance_close_guard_payroll before insert or update or delete on public.payroll_periods for each row execute function public.finance_guard_closed_period();
drop trigger if exists finance_close_guard_commissions on public.sales_records;
create trigger finance_close_guard_commissions before insert or update or delete on public.sales_records for each row execute function public.finance_guard_closed_period();

alter table public.finance_close_periods enable row level security;
alter table public.finance_close_audit_log enable row level security;
revoke all on public.finance_close_periods, public.finance_close_audit_log from anon, authenticated;
grant select, insert, update, delete on public.finance_close_periods to service_role;
grant select, insert on public.finance_close_audit_log to service_role;
revoke all on function public.finance_guard_closed_period() from public, anon, authenticated;
grant execute on function public.finance_guard_closed_period() to service_role;

comment on table public.finance_close_periods is 'Clotures financieres avec controles, rapprochement bancaire, snapshots et verrouillage des mouvements.';
comment on table public.finance_close_audit_log is 'Journal immuable des preparations, clotures et reouvertures exceptionnelles.';

commit;
notify pgrst, 'reload schema';
