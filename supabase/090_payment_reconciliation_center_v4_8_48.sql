-- SUPER LEADER V4.8.48 - Centre de controle des encaissements
-- Equipe des recus isolee de la paie, des commissions et du coeur Finance.
begin;

create table if not exists public.payment_reconciliation_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_role text not null default 'agent' check (assignment_role in ('agent','supervisor')),
  is_active boolean not null default true,
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  unique (organization_id, user_id)
);

create index if not exists payment_reconciliation_assignments_active_idx
  on public.payment_reconciliation_assignments (organization_id, is_active, user_id);

alter table public.sales_payments drop constraint if exists sales_payments_status_check;
alter table public.sales_payments add constraint sales_payments_status_check
  check (status in ('pending','correction_requested','confirmed','rejected','refunded'));

alter table public.sales_payments
  add column if not exists bank_posted_on date,
  add column if not exists bank_reference text,
  add column if not exists bank_account_last4 text,
  add column if not exists reconciliation_note text,
  add column if not exists reconciled_by uuid references auth.users(id) on delete set null,
  add column if not exists reconciled_at timestamptz;

alter table public.customer_service_installment_payments drop constraint if exists customer_service_installment_payments_finance_status_check;
alter table public.customer_service_installment_payments add constraint customer_service_installment_payments_finance_status_check
  check (finance_status in ('pending','correction_requested','validated','rejected'));

alter table public.customer_service_installment_payments
  add column if not exists bank_posted_on date,
  add column if not exists bank_reference text,
  add column if not exists bank_account_last4 text;

create unique index if not exists sales_payments_org_bank_reference_unique
  on public.sales_payments (organization_id, lower(btrim(bank_reference)))
  where bank_reference is not null and btrim(bank_reference) <> '' and status = 'confirmed';

create unique index if not exists customer_service_payments_org_bank_reference_unique
  on public.customer_service_installment_payments (organization_id, lower(btrim(bank_reference)))
  where bank_reference is not null and btrim(bank_reference) <> '' and finance_status = 'validated';

create table if not exists public.payment_reconciliation_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_source text not null check (payment_source in ('sale','customer_service','assignment')),
  payment_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('confirmed','correction_requested','rejected','assignment_created','assignment_updated','assignment_revoked')),
  old_status text,
  new_status text,
  bank_posted_on date,
  bank_reference text,
  bank_account_last4 text,
  note text check (note is null or char_length(trim(note)) <= 1500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_reconciliation_audit_payment_idx
  on public.payment_reconciliation_audit_log (organization_id, payment_source, payment_id, created_at desc);

alter table public.payment_reconciliation_assignments enable row level security;
alter table public.payment_reconciliation_audit_log enable row level security;

revoke all on public.payment_reconciliation_assignments, public.payment_reconciliation_audit_log from anon, authenticated;
grant select, insert, update, delete on public.payment_reconciliation_assignments to service_role;
grant select, insert on public.payment_reconciliation_audit_log to service_role;

comment on table public.payment_reconciliation_assignments is
  'Permission specialised payment reconciliation. It grants no payroll, commission, expense or finance-document access.';
comment on table public.payment_reconciliation_audit_log is
  'Immutable audit trail for receipt-team bank reconciliation decisions.';

commit;
notify pgrst, 'reload schema';
