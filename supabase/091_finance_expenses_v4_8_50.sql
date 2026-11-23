-- SUPER LEADER V4.8.50 - Gestion securisee des depenses
-- Soumission employe, controle owner/admin, preuve privee et piste d'audit.
begin;

create or replace function public.finance_expense_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.finance_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expense_number text not null,
  title text not null check (char_length(trim(title)) between 2 and 220),
  category text not null check (category in (
    'operations','marketing','communication','travel','training','supplies',
    'technology','rent_utilities','professional_services','taxes_fees','other'
  )),
  vendor_name text check (vendor_name is null or char_length(trim(vendor_name)) <= 220),
  description text check (description is null or char_length(trim(description)) <= 3000),
  cost_center text check (cost_center is null or char_length(trim(cost_center)) <= 160),
  expense_date date not null,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) generated always as (subtotal + tax_amount) stored,
  status text not null default 'submitted' check (status in (
    'submitted','correction_requested','approved','rejected','paid','cancelled'
  )),
  receipt_storage_path text not null,
  receipt_file_name text not null,
  receipt_mime_type text not null,
  receipt_size_bytes bigint not null check (receipt_size_bytes between 1 and 10485760),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(trim(review_note)) <= 1500),
  payment_method text check (payment_method is null or payment_method in (
    'bank_transfer','card','cash','mobile_money','cheque','other'
  )),
  paid_on date,
  bank_reference text,
  bank_account_last4 text check (bank_account_last4 is null or bank_account_last4 ~ '^[0-9]{4}$'),
  payment_proof_storage_path text,
  payment_proof_file_name text,
  payment_proof_mime_type text,
  payment_proof_size_bytes bigint check (payment_proof_size_bytes is null or payment_proof_size_bytes between 1 and 10485760),
  paid_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, expense_number)
);

create index if not exists finance_expenses_org_status_idx
  on public.finance_expenses (organization_id, status, expense_date desc);
create index if not exists finance_expenses_submitter_idx
  on public.finance_expenses (organization_id, submitted_by, created_at desc);
create unique index if not exists finance_expenses_bank_reference_unique
  on public.finance_expenses (organization_id, lower(btrim(bank_reference)))
  where status = 'paid' and bank_reference is not null and btrim(bank_reference) <> '';

drop trigger if exists finance_expenses_updated_at_trigger on public.finance_expenses;
create trigger finance_expenses_updated_at_trigger
before update on public.finance_expenses
for each row execute function public.finance_expense_set_updated_at();

create table if not exists public.finance_expense_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expense_id uuid references public.finance_expenses(id) on delete set null,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in (
    'submitted','resubmitted','correction_requested','approved','rejected','paid','cancelled','receipt_opened','payment_proof_opened'
  )),
  previous_status text,
  new_status text,
  note text check (note is null or char_length(trim(note)) <= 1500),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists finance_expense_audit_expense_idx
  on public.finance_expense_audit_log (organization_id, expense_id, created_at desc);

alter table public.finance_expenses enable row level security;
alter table public.finance_expense_audit_log enable row level security;
revoke all on public.finance_expenses, public.finance_expense_audit_log from anon, authenticated;
grant select, insert, update, delete on public.finance_expenses to service_role;
grant select, insert on public.finance_expense_audit_log to service_role;
grant execute on function public.finance_expense_set_updated_at() to service_role;

comment on table public.finance_expenses is
  'Depenses et remboursements avec justificatifs prives, separation demandeur-validateur et preuve de paiement.';
comment on table public.finance_expense_audit_log is
  'Piste d audit immuable du cycle de vie des depenses.';

commit;
notify pgrst, 'reload schema';
