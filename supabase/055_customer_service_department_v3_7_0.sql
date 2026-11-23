-- Super Leader V3.7.0
-- Independent Customer Service department: portfolio ownership, simple instalments,
-- payment evidence, finance validation and follow-up. No interest or balance engine.
-- Run after 054_customer_service_growth_v3_6_0.sql.

begin;

alter table public.crm_clients
  add column if not exists customer_service_owner_id uuid references auth.users(id) on delete set null,
  add column if not exists customer_service_since date,
  add column if not exists customer_service_status text not null default 'not_transferred';

do $$ begin
  alter table public.crm_clients add constraint crm_clients_customer_service_status_check
    check (customer_service_status in ('not_transferred','active','attention','suspended','completed'));
exception when duplicate_object then null; end $$;

create index if not exists crm_clients_customer_service_owner_idx
  on public.crm_clients (organization_id, customer_service_owner_id, customer_service_status, full_name);

create table if not exists public.customer_service_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  contract_id uuid references public.crm_contracts(id) on delete set null,
  sequence_number integer not null check (sequence_number > 0),
  due_date date not null,
  expected_amount numeric(14,2) not null check (expected_amount > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'upcoming' check (status in ('upcoming','due_today','partial','paid','overdue','promised','deferred','waived')),
  assigned_to uuid references auth.users(id) on delete set null,
  promise_date date,
  promise_note text check (promise_note is null or char_length(trim(promise_note)) <= 1500),
  exception_reason text check (exception_reason is null or char_length(trim(exception_reason)) <= 1500),
  exception_approved_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contract_id, sequence_number)
);

create table if not exists public.customer_service_installment_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  installment_id uuid not null references public.customer_service_installments(id) on delete cascade,
  amount_received numeric(14,2) not null check (amount_received > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  received_on date not null,
  payment_method text not null check (payment_method in ('bank_transfer','card','cash','mobile_money','cheque','other')),
  transaction_reference text,
  proof_storage_path text not null,
  proof_file_name text not null,
  proof_mime_type text not null,
  proof_size_bytes bigint not null check (proof_size_bytes > 0),
  finance_status text not null default 'pending' check (finance_status in ('pending','validated','rejected')),
  finance_reviewed_by uuid references auth.users(id) on delete set null,
  finance_reviewed_at timestamptz,
  finance_note text check (finance_note is null or char_length(trim(finance_note)) <= 1500),
  recorded_by uuid not null references auth.users(id),
  notes text check (notes is null or char_length(trim(notes)) <= 1500),
  created_at timestamptz not null default now()
);

create table if not exists public.customer_service_follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  installment_id uuid not null references public.customer_service_installments(id) on delete cascade,
  agent_id uuid not null references auth.users(id),
  channel text not null check (channel in ('phone','whatsapp','email','sms','in_person','other')),
  outcome text not null check (outcome in ('no_answer','reminder_sent','client_reached','promise_received','dispute','escalated','other')),
  note text not null check (char_length(trim(note)) between 2 and 3000),
  promised_date date,
  next_action_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists customer_service_installments_queue_idx on public.customer_service_installments (organization_id, status, due_date);
create index if not exists customer_service_installments_client_idx on public.customer_service_installments (client_id, due_date desc);
create index if not exists customer_service_payments_installment_idx on public.customer_service_installment_payments (installment_id, created_at desc);
create index if not exists customer_service_payments_finance_idx on public.customer_service_installment_payments (organization_id, finance_status, received_on desc);
create index if not exists customer_service_follow_ups_queue_idx on public.customer_service_follow_ups (organization_id, installment_id, created_at desc);

drop trigger if exists set_customer_service_installment_updated_at on public.customer_service_installments;
create trigger set_customer_service_installment_updated_at before update on public.customer_service_installments
for each row execute function public.customer_service_set_updated_at();

alter table public.customer_service_installments enable row level security;
alter table public.customer_service_installment_payments enable row level security;
alter table public.customer_service_follow_ups enable row level security;

revoke all on public.customer_service_installments, public.customer_service_installment_payments, public.customer_service_follow_ups from anon, authenticated;
grant select, insert, update, delete on public.customer_service_installments, public.customer_service_installment_payments, public.customer_service_follow_ups to service_role;

comment on table public.customer_service_installments is 'Simple contractual instalment tracking. Intentionally excludes interest and remaining-balance calculations.';
comment on table public.customer_service_installment_payments is 'Amounts received with mandatory private evidence and Finance validation.';

commit;
notify pgrst, 'reload schema';
