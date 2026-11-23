-- SUPER LEADER V4.0 - Centre de gestion des prospects
-- A executer apres 056_crm_sales_targets_forecasting_v3_9_0.sql

begin;

alter table public.crm_clients
  add column if not exists lead_status text not null default 'new',
  add column if not exists source_detail text,
  add column if not exists campaign_name text,
  add column if not exists ambassador_name text,
  add column if not exists product_interest text,
  add column if not exists estimated_budget numeric(14,2),
  add column if not exists budget_currency text not null default 'USD',
  add column if not exists lead_priority text not null default 'normal',
  add column if not exists next_action text,
  add column if not exists next_action_at timestamptz,
  add column if not exists imported_batch_id uuid,
  add column if not exists converted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_lead_status_check') then
    alter table public.crm_clients add constraint crm_clients_lead_status_check check (lead_status in (
      'new','uncontacted','contact_attempt','contacted','qualified','appointment','follow_up','unqualified','converted','lost'
    ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_lead_priority_check') then
    alter table public.crm_clients add constraint crm_clients_lead_priority_check
      check (lead_priority in ('low','normal','high','urgent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_budget_currency_check') then
    alter table public.crm_clients add constraint crm_clients_budget_currency_check
      check (budget_currency ~ '^[A-Z]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_estimated_budget_check') then
    alter table public.crm_clients add constraint crm_clients_estimated_budget_check
      check (estimated_budget is null or estimated_budget >= 0);
  end if;
end $$;

create table if not exists public.crm_lead_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_name text not null,
  source text not null default 'import',
  campaign_name text,
  ambassador_name text,
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  rejected_rows integer not null default 0,
  error_summary jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.crm_clients
  drop constraint if exists crm_clients_imported_batch_id_fkey;
alter table public.crm_clients
  add constraint crm_clients_imported_batch_id_fkey
  foreign key (imported_batch_id) references public.crm_lead_import_batches(id) on delete set null;

create index if not exists crm_clients_lead_center_idx
  on public.crm_clients (organization_id, status, lead_status, lead_priority, created_at desc);
create index if not exists crm_clients_lead_owner_action_idx
  on public.crm_clients (organization_id, owner_id, lead_status, next_action_at);
create index if not exists crm_clients_lead_source_idx
  on public.crm_clients (organization_id, source_detail, campaign_name, ambassador_name);
create index if not exists crm_lead_import_batches_org_idx
  on public.crm_lead_import_batches (organization_id, created_at desc);

alter table public.crm_lead_import_batches enable row level security;
revoke all on public.crm_lead_import_batches from anon, authenticated;
grant select, insert, update, delete on public.crm_lead_import_batches to service_role;

comment on table public.crm_lead_import_batches is 'Auditable CSV/XLSX prospect import batches.';
comment on column public.crm_clients.converted_at is 'Moment when the prospect was converted into a pipeline opportunity.';

commit;
