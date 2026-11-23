-- SUPER LEADER V4.8.62 - Recouvrement et relances automatiques
-- Migration 101 volontairement reservee apres la migration 100 du Health & Reliability Center.
begin;

create table if not exists public.finance_collection_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales_records(id) on delete cascade,
  reminder_key text not null,
  rule_kind text not null check (rule_kind in ('before_due','after_due','broken_promise')),
  rule_days integer not null default 0 check (rule_days between 0 and 3650),
  due_date date,
  promise_date date,
  outstanding_amount numeric(14,2) not null default 0 check (outstanding_amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  internal_recipient_id uuid references auth.users(id) on delete set null,
  internal_notification_id uuid,
  in_app_requested boolean not null default false,
  in_app_created boolean not null default false,
  email_requested boolean not null default false,
  email_sent boolean not null default false,
  email_provider_message_id text,
  customer_contact_suppressed boolean not null default false,
  status text not null default 'processing' check (status in ('processing','sent','partial','skipped','failed')),
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, sale_id, reminder_key)
);

create index if not exists finance_collection_reminders_recent_idx
  on public.finance_collection_reminders (organization_id, created_at desc);
create index if not exists finance_collection_reminders_status_idx
  on public.finance_collection_reminders (organization_id, status, created_at desc);
create index if not exists finance_collection_reminders_sale_idx
  on public.finance_collection_reminders (sale_id, created_at desc);

create table if not exists public.finance_collection_automation_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  organizations_scanned integer not null default 0,
  sales_scanned integer not null default 0,
  reminders_created integer not null default 0,
  internal_notifications_created integer not null default 0,
  customer_emails_sent integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  last_error text
);

create index if not exists finance_collection_automation_runs_recent_idx
  on public.finance_collection_automation_runs (started_at desc);

alter table public.finance_collection_reminders enable row level security;
alter table public.finance_collection_automation_runs enable row level security;

revoke all on public.finance_collection_reminders from anon, authenticated;
revoke all on public.finance_collection_automation_runs from anon, authenticated;
grant select, insert, update, delete on public.finance_collection_reminders to service_role;
grant select, insert, update, delete on public.finance_collection_automation_runs to service_role;

comment on table public.finance_collection_reminders is
  'Journal audite des relances automatiques de creances. Aucune cle, mot de passe ou chaine de connexion n y est stockee.';
comment on column public.finance_collection_reminders.customer_contact_suppressed is
  'Indique que le contact client externe a ete volontairement bloque (do_not_contact, promesse future, email absent ou canal desactive).';
comment on table public.finance_collection_automation_runs is
  'Etat technique des executions du moteur de relance Finance.';

commit;
notify pgrst, 'reload schema';
