begin;

alter table public.service_contracts
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by uuid references auth.users(id) on delete set null;

create table if not exists public.service_contract_deliverables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 220),
  description text not null default '' check (char_length(description) <= 6000),
  due_date date not null,
  weight numeric(5,2) not null default 0 check (weight between 0 and 100),
  status text not null default 'planned' check (status in ('planned','in_progress','submitted','accepted','rejected','cancelled')),
  evidence_reference text not null default '' check (char_length(evidence_reference) <= 2000),
  submission_note text not null default '' check (char_length(submission_note) <= 4000),
  review_note text not null default '' check (char_length(review_note) <= 4000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_contract_deliverables_contract_idx
  on public.service_contract_deliverables (contract_id, due_date, status);
create index if not exists service_contract_deliverables_org_due_idx
  on public.service_contract_deliverables (organization_id, due_date, status);

create table if not exists public.service_contract_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  work_completed text not null check (char_length(trim(work_completed)) between 3 and 8000),
  challenges text not null default '' check (char_length(challenges) <= 6000),
  next_actions text not null default '' check (char_length(next_actions) <= 6000),
  evidence_reference text not null default '' check (char_length(evidence_reference) <= 2000),
  status text not null default 'submitted' check (status in ('submitted','accepted','rejected')),
  review_note text not null default '' check (char_length(review_note) <= 4000),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint service_contract_reports_dates_ck check (period_end >= period_start)
);

create index if not exists service_contract_reports_contract_idx
  on public.service_contract_reports (contract_id, period_end desc, submitted_at desc);

create table if not exists public.service_contract_kpis (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 180),
  description text not null default '' check (char_length(description) <= 3000),
  unit text not null default '%' check (char_length(unit) between 1 and 40),
  target_value numeric(18,4) not null default 100,
  weight numeric(5,2) not null default 0 check (weight between 0 and 100),
  direction text not null default 'higher' check (direction in ('higher','lower','manual')),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_contract_kpis_contract_idx
  on public.service_contract_kpis (contract_id, is_active, created_at);

create table if not exists public.service_contract_kpi_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  kpi_id uuid not null references public.service_contract_kpis(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  actual_value numeric(18,4),
  score numeric(5,2) not null check (score between 0 and 100),
  comment text not null default '' check (char_length(comment) <= 4000),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint service_contract_kpi_results_dates_ck check (period_end >= period_start)
);

create index if not exists service_contract_kpi_results_contract_idx
  on public.service_contract_kpi_results (contract_id, period_end desc, created_at desc);
create index if not exists service_contract_kpi_results_kpi_idx
  on public.service_contract_kpi_results (kpi_id, period_end desc, created_at desc);

alter table public.service_contract_deliverables enable row level security;
alter table public.service_contract_reports enable row level security;
alter table public.service_contract_kpis enable row level security;
alter table public.service_contract_kpi_results enable row level security;

-- Read access follows the parent contract: governance roles see all contracts,
-- assigned managers see only contracts they own. Writes continue through
-- authenticated Server Actions using the existing Super Leader access context.
drop policy if exists service_contract_deliverables_select on public.service_contract_deliverables;
create policy service_contract_deliverables_select
on public.service_contract_deliverables
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_deliverables.contract_id
      and sc.organization_id = service_contract_deliverables.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

drop policy if exists service_contract_reports_select on public.service_contract_reports;
create policy service_contract_reports_select
on public.service_contract_reports
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_reports.contract_id
      and sc.organization_id = service_contract_reports.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

drop policy if exists service_contract_kpis_select on public.service_contract_kpis;
create policy service_contract_kpis_select
on public.service_contract_kpis
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_kpis.contract_id
      and sc.organization_id = service_contract_kpis.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

drop policy if exists service_contract_kpi_results_select on public.service_contract_kpi_results;
create policy service_contract_kpi_results_select
on public.service_contract_kpi_results
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_kpi_results.contract_id
      and sc.organization_id = service_contract_kpi_results.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

commit;
