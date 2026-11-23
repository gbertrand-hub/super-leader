begin;

-- Super Leader v4.10.9
-- Contract Financial Engine: payable items calculated from contractual compensation rules,
-- operational readiness gates, approval/hold/rejection, and external settlement recording.
-- This module does NOT execute bank payments and does NOT replace the Finance module.

create table if not exists public.service_contract_financial_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  compensation_rule_id uuid not null references public.service_contract_compensation_rules(id) on delete restrict,
  item_type text not null default 'compensation' check (item_type in ('compensation','benefit')),
  period_start date,
  period_end date,
  due_date date,
  base_amount numeric(18,2),
  quantity numeric(18,4) not null default 1,
  calculated_amount numeric(18,2) not null default 0,
  currency text not null default 'USD' check (char_length(currency) between 3 and 8),
  gate_status text not null default 'review' check (gate_status in ('ready','review','blocked')),
  gate_note text not null default '' check (char_length(gate_note) <= 4000),
  status text not null default 'pending' check (status in ('pending','approved','held','rejected','paid','delivered','cancelled')),
  source_reference text not null default '' check (char_length(source_reference) <= 2000),
  request_note text not null default '' check (char_length(request_note) <= 4000),
  review_note text not null default '' check (char_length(review_note) <= 4000),
  settlement_reference text not null default '' check (char_length(settlement_reference) <= 2000),
  settled_amount numeric(18,2),
  created_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  settled_by uuid references auth.users(id) on delete set null,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_contract_financial_items_period_ck check (period_end is null or period_start is null or period_end >= period_start),
  constraint service_contract_financial_items_base_ck check (base_amount is null or base_amount >= 0),
  constraint service_contract_financial_items_quantity_ck check (quantity >= 0),
  constraint service_contract_financial_items_calc_ck check (calculated_amount >= 0),
  constraint service_contract_financial_items_settled_ck check (settled_amount is null or settled_amount >= 0)
);

create index if not exists service_contract_financial_items_contract_idx
  on public.service_contract_financial_items (contract_id, status, due_date, created_at desc);
create index if not exists service_contract_financial_items_rule_idx
  on public.service_contract_financial_items (compensation_rule_id, status, period_end);

alter table public.service_contract_financial_items enable row level security;

drop policy if exists service_contract_financial_items_select on public.service_contract_financial_items;
create policy service_contract_financial_items_select
on public.service_contract_financial_items
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_financial_items.contract_id
      and sc.organization_id = service_contract_financial_items.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

comment on table public.service_contract_financial_items is
  'Contractual compensation/benefit items calculated from signed contract rules. Approval records contractual readiness only; external payment execution remains outside this table.';
comment on column public.service_contract_financial_items.gate_status is
  'ready = required provider obligations are validated, review = partial/no generated evidence requiring human review, blocked = unresolved/rejected obligation prevents approval.';

commit;
