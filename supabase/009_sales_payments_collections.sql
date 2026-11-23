-- SUPER LEADER - Ventes, premiers versements, commissions et recouvrement V2
-- A executer apres 008_sales_commissions.sql

begin;

alter table public.sales_products
  add column if not exists payment_plan_type text not null default 'full',
  add column if not exists initial_payment_type text not null default 'percentage',
  add column if not exists initial_payment_value numeric(14,2) not null default 100,
  add column if not exists max_installments integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_products_payment_plan_type_check'
  ) then
    alter table public.sales_products
      add constraint sales_products_payment_plan_type_check
      check (payment_plan_type in ('full','deposit_balance','installments','custom'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_products_initial_payment_type_check'
  ) then
    alter table public.sales_products
      add constraint sales_products_initial_payment_type_check
      check (initial_payment_type in ('percentage','fixed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_products_initial_payment_value_check'
  ) then
    alter table public.sales_products
      add constraint sales_products_initial_payment_value_check
      check (initial_payment_value >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_products_max_installments_check'
  ) then
    alter table public.sales_products
      add constraint sales_products_max_installments_check
      check (max_installments is null or max_installments between 1 and 120);
  end if;
end $$;

alter table public.sales_records
  add column if not exists payment_plan_type text not null default 'full',
  add column if not exists initial_payment_type text not null default 'percentage',
  add column if not exists initial_payment_value numeric(14,2) not null default 100,
  add column if not exists first_payment_amount numeric(14,2) not null default 0,
  add column if not exists first_payment_received_at timestamptz,
  add column if not exists paid_amount numeric(14,2) not null default 0,
  add column if not exists balance_amount numeric(14,2) not null default 0,
  add column if not exists commission_basis_amount numeric(14,2) not null default 0,
  add column if not exists commission_rule text not null default 'first_payment_only',
  add column if not exists collection_owner_id uuid references auth.users(id) on delete set null,
  add column if not exists collection_status text not null default 'not_started',
  add column if not exists transferred_to_collection_at timestamptz,
  add column if not exists next_payment_due_date date,
  add column if not exists next_payment_amount numeric(14,2),
  add column if not exists collection_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_payment_plan_type_check'
  ) then
    alter table public.sales_records
      add constraint sales_records_payment_plan_type_check
      check (payment_plan_type in ('full','deposit_balance','installments','custom'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_initial_payment_type_check'
  ) then
    alter table public.sales_records
      add constraint sales_records_initial_payment_type_check
      check (initial_payment_type in ('percentage','fixed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_initial_payment_value_check'
  ) then
    alter table public.sales_records
      add constraint sales_records_initial_payment_value_check
      check (initial_payment_value >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_first_payment_amount_check'
  ) then
    alter table public.sales_records
      add constraint sales_records_first_payment_amount_check
      check (first_payment_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_paid_amount_check'
  ) then
    alter table public.sales_records
      add constraint sales_records_paid_amount_check
      check (paid_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_balance_amount_check'
  ) then
    alter table public.sales_records
      add constraint sales_records_balance_amount_check
      check (balance_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_commission_basis_check'
  ) then
    alter table public.sales_records
      add constraint sales_records_commission_basis_check
      check (commission_basis_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_commission_rule_check'
  ) then
    alter table public.sales_records
      add constraint sales_records_commission_rule_check
      check (commission_rule = 'first_payment_only');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_collection_status_check'
  ) then
    alter table public.sales_records
      add constraint sales_records_collection_status_check
      check (collection_status in ('not_started','assigned','in_progress','overdue','completed','suspended'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_records_next_payment_amount_check'
  ) then
    alter table public.sales_records
      add constraint sales_records_next_payment_amount_check
      check (next_payment_amount is null or next_payment_amount >= 0);
  end if;
end $$;

update public.sales_records
set balance_amount = greatest(total_amount - paid_amount, 0)
where balance_amount = 0 and total_amount > 0 and paid_amount = 0;

create index if not exists sales_records_collection_owner_idx
  on public.sales_records (organization_id, collection_owner_id, collection_status, next_payment_due_date);

create table if not exists public.sales_payment_schedule (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales_records(id) on delete cascade,
  sequence_number integer not null check (sequence_number between 1 and 240),
  due_date date not null,
  expected_amount numeric(14,2) not null check (expected_amount > 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  status text not null default 'upcoming' check (status in (
    'upcoming','partial','paid','overdue','cancelled','rescheduled'
  )),
  notes text check (notes is null or char_length(trim(notes)) <= 1500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sale_id, sequence_number)
);

create index if not exists sales_payment_schedule_due_idx
  on public.sales_payment_schedule (organization_id, status, due_date);

create table if not exists public.sales_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales_records(id) on delete cascade,
  schedule_item_id uuid references public.sales_payment_schedule(id) on delete set null,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  payment_method text not null default 'bank_transfer' check (payment_method in (
    'bank_transfer','card','cash','mobile_money','cheque','other'
  )),
  transaction_reference text,
  proof_url text,
  status text not null default 'pending' check (status in (
    'pending','confirmed','rejected','refunded'
  )),
  is_initial_payment boolean not null default false,
  recorded_by uuid not null references auth.users(id),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  notes text check (notes is null or char_length(trim(notes)) <= 1500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_payments_org_reference_unique
  on public.sales_payments (organization_id, lower(transaction_reference))
  where transaction_reference is not null and btrim(transaction_reference) <> '';

create index if not exists sales_payments_sale_idx
  on public.sales_payments (sale_id, payment_date, created_at);

create index if not exists sales_payments_pending_idx
  on public.sales_payments (organization_id, status, payment_date desc);

create unique index if not exists sales_payments_one_initial_unique
  on public.sales_payments (sale_id)
  where is_initial_payment = true and status = 'confirmed';

alter table public.sales_payment_schedule enable row level security;
alter table public.sales_payments enable row level security;

revoke all on public.sales_payment_schedule from anon, authenticated;
revoke all on public.sales_payments from anon, authenticated;

grant select, insert, update, delete on public.sales_payment_schedule to service_role;
grant select, insert, update, delete on public.sales_payments to service_role;

drop trigger if exists set_sales_payment_schedule_updated_at on public.sales_payment_schedule;
create trigger set_sales_payment_schedule_updated_at
before update on public.sales_payment_schedule
for each row execute function public.set_updated_at();

drop trigger if exists set_sales_payments_updated_at on public.sales_payments;
create trigger set_sales_payments_updated_at
before update on public.sales_payments
for each row execute function public.set_updated_at();

-- The first confirmed payment permanently becomes the commission trigger.
alter table public.sales_records
  add column if not exists commission_trigger_payment_id uuid references public.sales_payments(id) on delete set null,
  add column if not exists commission_locked_at timestamptz;

create or replace function public.refresh_sales_payment_summary(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales_records%rowtype;
  v_trigger_payment public.sales_payments%rowtype;
  v_total_paid numeric(14,2) := 0;
  v_balance numeric(14,2) := 0;
  v_payment_status text := 'unpaid';
  v_collection_status text := 'not_started';
  v_commission numeric(14,2) := 0;
  v_commission_status text := 'pending';
begin
  select * into v_sale
  from public.sales_records
  where id = p_sale_id
  for update;

  if not found then
    return;
  end if;

  if v_sale.commission_trigger_payment_id is null then
    select * into v_trigger_payment
    from public.sales_payments
    where sale_id = p_sale_id and status = 'confirmed'
    order by payment_date asc, created_at asc
    limit 1;

    if found then
      update public.sales_records
      set commission_trigger_payment_id = v_trigger_payment.id,
          commission_locked_at = coalesce(commission_locked_at, now())
      where id = p_sale_id;
    end if;
  else
    select * into v_trigger_payment
    from public.sales_payments
    where id = v_sale.commission_trigger_payment_id;
  end if;

  update public.sales_payments
  set is_initial_payment = (id = (select commission_trigger_payment_id from public.sales_records where id = p_sale_id))
  where sale_id = p_sale_id and is_initial_payment is distinct from (id = (select commission_trigger_payment_id from public.sales_records where id = p_sale_id));

  select coalesce(sum(amount), 0) into v_total_paid
  from public.sales_payments
  where sale_id = p_sale_id and status = 'confirmed';

  v_balance := greatest(v_sale.total_amount - v_total_paid, 0);

  if v_total_paid <= 0 then
    v_payment_status := 'unpaid';
  elsif v_total_paid >= v_sale.total_amount then
    v_payment_status := 'paid';
  else
    v_payment_status := 'partial';
  end if;

  if v_trigger_payment.id is not null and v_trigger_payment.status = 'confirmed' then
    if v_sale.commission_type = 'percentage' then
      v_commission := round(v_trigger_payment.amount * (v_sale.commission_value / 100.0), 2);
    else
      v_commission := round(v_sale.commission_value * v_sale.quantity, 2);
    end if;
  else
    v_commission := 0;
  end if;

  if v_sale.workflow_status in ('rejected','cancelled','refunded') then
    v_commission_status := 'cancelled';
  elsif v_trigger_payment.id is not null and v_trigger_payment.status in ('rejected','refunded') then
    v_commission_status := 'cancelled';
  elsif v_trigger_payment.id is null or v_trigger_payment.status <> 'confirmed' or v_commission <= 0 then
    v_commission_status := 'pending';
  elsif v_sale.commission_status = 'paid' then
    v_commission_status := 'paid';
  elsif v_sale.workflow_status = 'approved' then
    v_commission_status := 'payable';
  elsif v_sale.workflow_status = 'verified' then
    v_commission_status := 'validated';
  else
    v_commission_status := 'pending';
  end if;

  if v_balance <= 0 then
    v_collection_status := 'completed';
  elsif v_sale.collection_status = 'suspended' then
    v_collection_status := 'suspended';
  elsif v_sale.next_payment_due_date is not null and v_sale.next_payment_due_date < current_date then
    v_collection_status := 'overdue';
  elsif v_sale.collection_owner_id is not null and v_total_paid > 0 then
    v_collection_status := 'in_progress';
  elsif v_sale.collection_owner_id is not null then
    v_collection_status := 'assigned';
  elsif v_total_paid > 0 then
    v_collection_status := 'not_started';
  else
    v_collection_status := v_sale.collection_status;
  end if;

  update public.sales_records
  set first_payment_amount = case when v_trigger_payment.status = 'confirmed' then v_trigger_payment.amount else 0 end,
      first_payment_received_at = case when v_trigger_payment.status = 'confirmed' then coalesce(v_trigger_payment.confirmed_at, v_trigger_payment.created_at) else null end,
      paid_amount = v_total_paid,
      balance_amount = v_balance,
      payment_status = v_payment_status,
      commission_basis_amount = case when v_trigger_payment.status = 'confirmed' then v_trigger_payment.amount else 0 end,
      commission_amount = v_commission,
      commission_status = v_commission_status,
      collection_status = v_collection_status
  where id = p_sale_id;
end;
$$;

grant execute on function public.refresh_sales_payment_summary(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
