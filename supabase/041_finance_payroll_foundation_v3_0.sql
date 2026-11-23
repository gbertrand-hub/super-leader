-- SUPER LEADER V3.0.0 - PHASE 1
-- Finance documents, payroll foundation and secure payslip publication
-- Run after 040_executive_role_supervision_v2_9_4.sql


-- Extend the existing notification centre for finance and payslip events.
alter table public.notification_preferences
  add column if not exists finance_updates boolean not null default true;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table public.notifications drop constraint if exists %I', constraint_row.conname);
  end loop;
end $$;

alter table public.notifications
  add constraint notifications_category_check
  check (category in (
    'system','reports','absences','meetings','sales','collections','feedback','performance','crm','finance'
  ));

create or replace function public.finance_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.finance_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null check (
    document_type in ('proforma','invoice','receipt','credit_note','expense_receipt','other')
  ),
  document_number text not null,
  title text not null,
  counterparty_name text,
  issue_date date not null default current_date,
  due_date date,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  balance_amount numeric(14,2) not null default 0 check (balance_amount >= 0),
  status text not null default 'draft' check (
    status in (
      'draft','pending_approval','approved','sent','accepted','rejected','expired',
      'partial','paid','overdue','cancelled','converted','archived'
    )
  ),
  related_document_id uuid references public.finance_documents(id) on delete set null,
  notes text,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes > 0),
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, document_type, document_number),
  check (due_date is null or due_date >= issue_date),
  check (paid_amount <= total_amount or total_amount = 0)
);

create index if not exists finance_documents_org_status_idx
  on public.finance_documents (organization_id, status, issue_date desc);
create index if not exists finance_documents_org_type_idx
  on public.finance_documents (organization_id, document_type, issue_date desc);
create index if not exists finance_documents_due_idx
  on public.finance_documents (organization_id, due_date)
  where due_date is not null and status not in ('paid','cancelled','archived');

create or replace function public.finance_document_totals()
returns trigger
language plpgsql
as $$
begin
  if new.total_amount = 0 and (new.subtotal > 0 or new.tax_amount > 0) then
    new.total_amount = new.subtotal + new.tax_amount;
  end if;
  new.balance_amount = greatest(new.total_amount - new.paid_amount, 0);
  if new.total_amount > 0 and new.paid_amount >= new.total_amount and new.status not in ('cancelled','archived') then
    new.status = 'paid';
  elsif new.paid_amount > 0 and new.paid_amount < new.total_amount and new.status not in ('cancelled','archived') then
    new.status = 'partial';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_documents_totals_trigger on public.finance_documents;
create trigger finance_documents_totals_trigger
before insert or update on public.finance_documents
for each row execute function public.finance_document_totals();

drop trigger if exists finance_documents_updated_at_trigger on public.finance_documents;
create trigger finance_documents_updated_at_trigger
before update on public.finance_documents
for each row execute function public.finance_set_updated_at();

create table if not exists public.finance_document_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid references public.finance_documents(id) on delete set null,
  actor_id uuid not null references auth.users(id),
  action text not null check (
    action in ('created','updated','status_changed','approved','published','downloaded','cancelled','archived')
  ),
  previous_status text,
  new_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists finance_document_audit_org_idx
  on public.finance_document_audit_log (organization_id, created_at desc);
create index if not exists finance_document_audit_document_idx
  on public.finance_document_audit_log (document_id, created_at desc);

create table if not exists public.payroll_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_user_id uuid not null references auth.users(id) on delete cascade,
  salary_basis text not null default 'monthly' check (
    salary_basis in ('hourly','weekly','biweekly','semimonthly','monthly','custom')
  ),
  base_salary numeric(14,2) not null default 0 check (base_salary >= 0),
  hourly_rate numeric(14,2) not null default 0 check (hourly_rate >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  payment_method text not null default 'bank_transfer' check (
    payment_method in ('bank_transfer','cash','cheque','mobile_money','other')
  ),
  bank_account_last4 text,
  standard_allowance numeric(14,2) not null default 0 check (standard_allowance >= 0),
  standard_deduction numeric(14,2) not null default 0 check (standard_deduction >= 0),
  effective_from date not null default current_date,
  effective_until date,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_user_id),
  check (effective_until is null or effective_until >= effective_from),
  check (bank_account_last4 is null or bank_account_last4 ~ '^[0-9]{4}$')
);

create index if not exists payroll_profiles_org_active_idx
  on public.payroll_profiles (organization_id, is_active, employee_user_id);

drop trigger if exists payroll_profiles_updated_at_trigger on public.payroll_profiles;
create trigger payroll_profiles_updated_at_trigger
before update on public.payroll_profiles
for each row execute function public.finance_set_updated_at();

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  period_start date not null,
  period_end date not null,
  pay_date date,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check (
    status in ('draft','open','review','approved','paid','locked','cancelled')
  ),
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_start, period_end),
  check (period_end >= period_start),
  check (pay_date is null or pay_date >= period_start)
);

create index if not exists payroll_periods_org_status_idx
  on public.payroll_periods (organization_id, status, period_end desc);

drop trigger if exists payroll_periods_updated_at_trigger on public.payroll_periods;
create trigger payroll_periods_updated_at_trigger
before update on public.payroll_periods
for each row execute function public.finance_set_updated_at();

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_user_id uuid not null references auth.users(id) on delete cascade,
  base_amount numeric(14,2) not null default 0 check (base_amount >= 0),
  overtime_amount numeric(14,2) not null default 0 check (overtime_amount >= 0),
  bonus_amount numeric(14,2) not null default 0 check (bonus_amount >= 0),
  commission_amount numeric(14,2) not null default 0 check (commission_amount >= 0),
  allowance_amount numeric(14,2) not null default 0 check (allowance_amount >= 0),
  deduction_amount numeric(14,2) not null default 0 check (deduction_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  gross_amount numeric(14,2) not null default 0 check (gross_amount >= 0),
  net_amount numeric(14,2) not null default 0 check (net_amount >= 0),
  notes text,
  status text not null default 'draft' check (
    status in ('draft','review','approved','published','paid','disputed','cancelled')
  ),
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_period_id, employee_user_id)
);

create index if not exists payroll_entries_org_employee_idx
  on public.payroll_entries (organization_id, employee_user_id, created_at desc);
create index if not exists payroll_entries_period_status_idx
  on public.payroll_entries (payroll_period_id, status, employee_user_id);

create or replace function public.payroll_entry_totals()
returns trigger
language plpgsql
as $$
begin
  new.gross_amount = greatest(
    new.base_amount + new.overtime_amount + new.bonus_amount + new.commission_amount + new.allowance_amount,
    0
  );
  new.net_amount = greatest(new.gross_amount - new.deduction_amount - new.tax_amount, 0);
  return new;
end;
$$;

drop trigger if exists payroll_entries_totals_trigger on public.payroll_entries;
create trigger payroll_entries_totals_trigger
before insert or update on public.payroll_entries
for each row execute function public.payroll_entry_totals();

drop trigger if exists payroll_entries_updated_at_trigger on public.payroll_entries;
create trigger payroll_entries_updated_at_trigger
before update on public.payroll_entries
for each row execute function public.finance_set_updated_at();

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  employee_user_id uuid not null references auth.users(id) on delete cascade,
  password_protected boolean not null default true,
  password_mode text not null default 'employee_secret' check (
    password_mode in ('none','employee_secret','unique')
  ),
  password_hint text,
  encryption_verified_at timestamptz,
  storage_path text not null,
  file_name text not null,
  mime_type text not null default 'application/pdf',
  size_bytes bigint not null check (size_bytes > 0),
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_entry_id),
  check (mime_type = 'application/pdf'),
  check ((password_mode = 'none' and password_protected = false) or password_mode <> 'none')
);

create index if not exists payslips_employee_idx
  on public.payslips (organization_id, employee_user_id, published_at desc);

drop trigger if exists payslips_updated_at_trigger on public.payslips;
create trigger payslips_updated_at_trigger
before update on public.payslips
for each row execute function public.finance_set_updated_at();

create table if not exists public.payroll_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_period_id uuid references public.payroll_periods(id) on delete set null,
  payroll_entry_id uuid references public.payroll_entries(id) on delete set null,
  payslip_id uuid references public.payslips(id) on delete set null,
  employee_user_id uuid references auth.users(id) on delete set null,
  actor_id uuid not null references auth.users(id),
  action text not null check (
    action in (
      'profile_saved','period_created','period_status_changed','entry_saved','entry_approved',
      'payslip_published','payslip_downloaded','payment_marked','period_locked'
    )
  ),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payroll_audit_org_idx
  on public.payroll_audit_log (organization_id, created_at desc);
create index if not exists payroll_audit_employee_idx
  on public.payroll_audit_log (employee_user_id, created_at desc);

alter table public.finance_documents enable row level security;
alter table public.finance_document_audit_log enable row level security;
alter table public.payroll_profiles enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payslips enable row level security;
alter table public.payroll_audit_log enable row level security;

revoke all on public.finance_documents from anon, authenticated;
revoke all on public.finance_document_audit_log from anon, authenticated;
revoke all on public.payroll_profiles from anon, authenticated;
revoke all on public.payroll_periods from anon, authenticated;
revoke all on public.payroll_entries from anon, authenticated;
revoke all on public.payslips from anon, authenticated;
revoke all on public.payroll_audit_log from anon, authenticated;

grant select, insert, update, delete on public.finance_documents to service_role;
grant select, insert on public.finance_document_audit_log to service_role;
grant select, insert, update, delete on public.payroll_profiles to service_role;
grant select, insert, update, delete on public.payroll_periods to service_role;
grant select, insert, update, delete on public.payroll_entries to service_role;
grant select, insert, update, delete on public.payslips to service_role;
grant select, insert on public.payroll_audit_log to service_role;

grant execute on function public.finance_set_updated_at() to service_role;
grant execute on function public.finance_document_totals() to service_role;
grant execute on function public.payroll_entry_totals() to service_role;

notify pgrst, 'reload schema';
