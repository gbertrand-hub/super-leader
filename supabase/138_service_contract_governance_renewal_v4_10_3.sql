begin;

-- Super Leader v4.10.3
-- Contract governance: scored deliverables, incidents/non-conformities,
-- and traceable renewal decisions.

alter table public.service_contract_deliverables
  add column if not exists review_score numeric(5,2),
  add column if not exists review_outcome text;

update public.service_contract_deliverables
set review_score = case when status = 'accepted' then 100 when status = 'rejected' then 0 else review_score end
where review_score is null and status in ('accepted','rejected');

update public.service_contract_deliverables
set review_outcome = case when status = 'accepted' then 'accepted' when status = 'rejected' then 'rejected' else review_outcome end
where review_outcome is null and status in ('accepted','rejected');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contract_deliverables_review_score_ck'
      and conrelid = 'public.service_contract_deliverables'::regclass
  ) then
    alter table public.service_contract_deliverables
      add constraint service_contract_deliverables_review_score_ck
      check (review_score is null or review_score between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contract_deliverables_review_outcome_ck'
      and conrelid = 'public.service_contract_deliverables'::regclass
  ) then
    alter table public.service_contract_deliverables
      add constraint service_contract_deliverables_review_outcome_ck
      check (review_outcome is null or review_outcome in ('accepted','partial','rejected'));
  end if;
end
$$;

create table if not exists public.service_contract_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 220),
  description text not null default '' check (char_length(description) <= 6000),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','corrective_action','resolved','closed')),
  corrective_action text not null default '' check (char_length(corrective_action) <= 6000),
  owner_user_id uuid references auth.users(id) on delete set null,
  due_date date,
  resolution_note text not null default '' check (char_length(resolution_note) <= 4000),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_contract_incidents_contract_idx
  on public.service_contract_incidents (contract_id, status, severity, created_at desc);
create index if not exists service_contract_incidents_org_due_idx
  on public.service_contract_incidents (organization_id, status, due_date);

create table if not exists public.service_contract_renewal_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  performance_score numeric(5,2),
  kpi_score numeric(5,2),
  deliverable_score numeric(5,2),
  incident_penalty numeric(5,2) not null default 0,
  open_incidents integer not null default 0,
  critical_incidents integer not null default 0,
  recommended_action text not null check (recommended_action in ('insufficient_data','renew','renew_with_conditions','suspend_review','do_not_renew_review')),
  final_decision text not null check (final_decision in ('renew','renew_with_conditions','extend','suspend','do_not_renew','terminate')),
  decision_note text not null default '' check (char_length(decision_note) <= 6000),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists service_contract_renewal_reviews_contract_idx
  on public.service_contract_renewal_reviews (contract_id, decided_at desc);

alter table public.service_contract_incidents enable row level security;
alter table public.service_contract_renewal_reviews enable row level security;

drop policy if exists service_contract_incidents_select on public.service_contract_incidents;
create policy service_contract_incidents_select
on public.service_contract_incidents
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_incidents.contract_id
      and sc.organization_id = service_contract_incidents.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

drop policy if exists service_contract_renewal_reviews_select on public.service_contract_renewal_reviews;
create policy service_contract_renewal_reviews_select
on public.service_contract_renewal_reviews
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_renewal_reviews.contract_id
      and sc.organization_id = service_contract_renewal_reviews.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

commit;
