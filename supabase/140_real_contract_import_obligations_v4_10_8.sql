begin;

-- Super Leader v4.10.8
-- Real contract import, immutable source document metadata, clause-based obligations,
-- recurring obligation occurrences, and contractual compensation / benefit rules.

alter table public.service_contracts
  add column if not exists source_mode text not null default 'native',
  add column if not exists source_document_storage_path text,
  add column if not exists source_document_file_name text,
  add column if not exists source_document_mime_type text,
  add column if not exists source_document_size_bytes bigint,
  add column if not exists source_document_uploaded_at timestamptz,
  add column if not exists source_document_uploaded_by uuid references auth.users(id) on delete set null,
  add column if not exists imported_at timestamptz,
  add column if not exists imported_by uuid references auth.users(id) on delete set null,
  add column if not exists tracking_start_date date,
  add column if not exists renewal_type text not null default 'manual',
  add column if not exists renewal_period_months integer,
  add column if not exists non_renewal_notice_days integer,
  add column if not exists termination_notice_days integer,
  add column if not exists confidentiality_post_term_months integer,
  add column if not exists confidentiality_indefinite boolean not null default false,
  add column if not exists immediate_termination_triggers text not null default '',
  add column if not exists contract_clarity_status text not null default 'unchecked',
  add column if not exists contract_clarity_note text not null default '',
  add column if not exists legacy_execution_note text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contracts_source_mode_ck'
      and conrelid = 'public.service_contracts'::regclass
  ) then
    alter table public.service_contracts
      add constraint service_contracts_source_mode_ck
      check (source_mode in ('native','current_import','historical_import'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contracts_renewal_type_ck'
      and conrelid = 'public.service_contracts'::regclass
  ) then
    alter table public.service_contracts
      add constraint service_contracts_renewal_type_ck
      check (renewal_type in ('manual','tacit','none'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contracts_renewal_period_months_ck'
      and conrelid = 'public.service_contracts'::regclass
  ) then
    alter table public.service_contracts
      add constraint service_contracts_renewal_period_months_ck
      check (renewal_period_months is null or renewal_period_months between 1 and 120);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contracts_non_renewal_notice_days_ck'
      and conrelid = 'public.service_contracts'::regclass
  ) then
    alter table public.service_contracts
      add constraint service_contracts_non_renewal_notice_days_ck
      check (non_renewal_notice_days is null or non_renewal_notice_days between 0 and 730);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contracts_termination_notice_days_ck'
      and conrelid = 'public.service_contracts'::regclass
  ) then
    alter table public.service_contracts
      add constraint service_contracts_termination_notice_days_ck
      check (termination_notice_days is null or termination_notice_days between 0 and 730);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contracts_confidentiality_months_ck'
      and conrelid = 'public.service_contracts'::regclass
  ) then
    alter table public.service_contracts
      add constraint service_contracts_confidentiality_months_ck
      check (confidentiality_post_term_months is null or confidentiality_post_term_months between 0 and 1200);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contracts_clarity_status_ck'
      and conrelid = 'public.service_contracts'::regclass
  ) then
    alter table public.service_contracts
      add constraint service_contracts_clarity_status_ck
      check (contract_clarity_status in ('unchecked','clear','review_required'));
  end if;
end
$$;

create table if not exists public.service_contract_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 220),
  description text not null default '' check (char_length(description) <= 6000),
  obligation_type text not null default 'activity' check (obligation_type in ('activity','deliverable','reporting','compliance','payment','benefit','support','other')),
  responsible_party text not null default 'provider' check (responsible_party in ('provider','organization','both')),
  recurrence text not null default 'once' check (recurrence in ('once','weekly','monthly','quarterly','annual','continuous')),
  target_quantity numeric(18,4),
  unit text not null default '' check (char_length(unit) <= 80),
  evidence_required boolean not null default true,
  clause_reference text not null default '' check (char_length(clause_reference) <= 240),
  start_date date,
  end_date date,
  first_due_date date,
  status text not null default 'active' check (status in ('active','paused','completed','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_contract_obligations_dates_ck check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists service_contract_obligations_contract_idx
  on public.service_contract_obligations (contract_id, status, first_due_date, recurrence);

create table if not exists public.service_contract_obligation_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  obligation_id uuid not null references public.service_contract_obligations(id) on delete cascade,
  period_start date,
  period_end date,
  due_date date not null,
  expected_quantity numeric(18,4),
  actual_quantity numeric(18,4),
  status text not null default 'planned' check (status in ('planned','submitted','accepted','partial','rejected','waived')),
  evidence_reference text not null default '' check (char_length(evidence_reference) <= 2000),
  submission_note text not null default '' check (char_length(submission_note) <= 4000),
  review_note text not null default '' check (char_length(review_note) <= 4000),
  review_score numeric(5,2),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_contract_obligation_occurrences_period_ck check (period_end is null or period_start is null or period_end >= period_start),
  constraint service_contract_obligation_occurrences_score_ck check (review_score is null or review_score between 0 and 100)
);

create unique index if not exists service_contract_obligation_occurrences_due_uq
  on public.service_contract_obligation_occurrences (obligation_id, due_date);
create index if not exists service_contract_obligation_occurrences_contract_idx
  on public.service_contract_obligation_occurrences (contract_id, due_date, status);

create table if not exists public.service_contract_compensation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 2 and 220),
  rule_type text not null default 'other' check (rule_type in ('fixed_periodic','fixed_event','percentage','threshold','benefit','other')),
  cadence text not null default 'one_time' check (cadence in ('one_time','weekly','monthly','quarterly','annual','per_event','per_sale','other')),
  amount numeric(18,2),
  percentage numeric(9,4),
  threshold_min numeric(18,2),
  threshold_max numeric(18,2),
  currency text not null default 'USD' check (char_length(currency) between 3 and 8),
  condition_text text not null default '' check (char_length(condition_text) <= 4000),
  clause_reference text not null default '' check (char_length(clause_reference) <= 240),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_contract_compensation_percentage_ck check (percentage is null or percentage between 0 and 100),
  constraint service_contract_compensation_amount_ck check (amount is null or amount >= 0)
);

create index if not exists service_contract_compensation_rules_contract_idx
  on public.service_contract_compensation_rules (contract_id, is_active, rule_type);

alter table public.service_contract_obligations enable row level security;
alter table public.service_contract_obligation_occurrences enable row level security;
alter table public.service_contract_compensation_rules enable row level security;

drop policy if exists service_contract_obligations_select on public.service_contract_obligations;
create policy service_contract_obligations_select
on public.service_contract_obligations
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_obligations.contract_id
      and sc.organization_id = service_contract_obligations.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

drop policy if exists service_contract_obligation_occurrences_select on public.service_contract_obligation_occurrences;
create policy service_contract_obligation_occurrences_select
on public.service_contract_obligation_occurrences
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_obligation_occurrences.contract_id
      and sc.organization_id = service_contract_obligation_occurrences.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

drop policy if exists service_contract_compensation_rules_select on public.service_contract_compensation_rules;
create policy service_contract_compensation_rules_select
on public.service_contract_compensation_rules
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_compensation_rules.contract_id
      and sc.organization_id = service_contract_compensation_rules.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

comment on column public.service_contracts.source_mode is 'native = created in Super Leader, current_import = existing active contract imported, historical_import = historical/expired contract reconstructed after the fact.';
comment on column public.service_contracts.contract_clarity_status is 'Manual transcription quality / inconsistency flag. Super Leader does not adjudicate contractual interpretation.';
comment on table public.service_contract_obligations is 'Clause-based operational obligations extracted from a signed contract.';
comment on table public.service_contract_obligation_occurrences is 'Generated tracking periods / due items for recurring contractual obligations.';
comment on table public.service_contract_compensation_rules is 'Contractual remuneration, commission and benefit rules. This table does not authorize or execute payments.';

commit;
