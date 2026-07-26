-- SUPER LEADER - CRM Clients, Contrats, Interactions & Feedback instantane V1
-- A executer apres 008_sales_commissions.sql et 009_sales_payments_collections.sql

begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.crm_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_feedback_channel text not null default 'email' check (default_feedback_channel in ('email','whatsapp','sms','web')),
  feedback_cooldown_days integer not null default 7 check (feedback_cooldown_days between 0 and 365),
  feedback_expiry_days integer not null default 14 check (feedback_expiry_days between 1 and 90),
  low_score_threshold integer not null default 2 check (low_score_threshold between 1 and 5),
  auto_send_email boolean not null default false,
  feedback_message_fr text not null default 'Merci pour votre echange avec notre equipe. Votre avis nous aide a mieux vous servir.',
  feedback_message_en text not null default 'Thank you for speaking with our team. Your feedback helps us serve you better.',
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference text not null,
  full_name text not null check (char_length(trim(full_name)) between 2 and 200),
  email text,
  phone text,
  whatsapp_phone text,
  country text,
  city text,
  company_name text,
  preferred_language text not null default 'fr' check (preferred_language in ('fr','en')),
  preferred_feedback_channel text not null default 'email' check (preferred_feedback_channel in ('email','whatsapp','sms','web')),
  feedback_opt_in boolean not null default true,
  marketing_opt_in boolean not null default false,
  do_not_contact boolean not null default false,
  consent_recorded_at timestamptz,
  owner_id uuid references auth.users(id) on delete set null,
  follow_up_owner_id uuid references auth.users(id) on delete set null,
  source text not null default 'manual' check (source in ('manual','sale_import','website','referral','event','other')),
  status text not null default 'active' check (status in ('prospect','active','inactive','closed')),
  notes text check (notes is null or char_length(trim(notes)) <= 5000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, reference)
);

create index if not exists crm_clients_org_status_idx
  on public.crm_clients (organization_id, status, full_name);
create index if not exists crm_clients_org_email_idx
  on public.crm_clients (organization_id, lower(email))
  where email is not null and btrim(email) <> '';
create index if not exists crm_clients_org_phone_idx
  on public.crm_clients (organization_id, phone)
  where phone is not null and btrim(phone) <> '';
create index if not exists crm_clients_owner_idx
  on public.crm_clients (organization_id, owner_id, follow_up_owner_id);

create table if not exists public.crm_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  sale_id uuid references public.sales_records(id) on delete set null,
  contract_number text not null,
  title text not null check (char_length(trim(title)) between 2 and 220),
  product_name text,
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'preparation' check (status in (
    'preparation','awaiting_signature','active','payment_in_progress','paid','suspended','cancelled','terminated'
  )),
  signed_at date,
  start_date date,
  expected_end_date date,
  seller_id uuid references auth.users(id) on delete set null,
  collection_owner_id uuid references auth.users(id) on delete set null,
  document_url text,
  notes text check (notes is null or char_length(trim(notes)) <= 5000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contract_number)
);

create unique index if not exists crm_contracts_sale_unique
  on public.crm_contracts (sale_id)
  where sale_id is not null;
create index if not exists crm_contracts_client_idx
  on public.crm_contracts (client_id, status, created_at desc);
create index if not exists crm_contracts_org_status_idx
  on public.crm_contracts (organization_id, status, expected_end_date);

create table if not exists public.crm_interactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  contract_id uuid references public.crm_contracts(id) on delete set null,
  employee_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('phone','whatsapp','email','sms','meeting','video','web_chat','other')),
  direction text not null default 'outbound' check (direction in ('inbound','outbound')),
  interaction_type text not null default 'support' check (interaction_type in (
    'sales','support','collection','training','complaint','information','other'
  )),
  outcome text not null default 'resolved' check (outcome in (
    'resolved','follow_up','payment_promise','no_answer','escalated','other'
  )),
  summary text not null check (char_length(trim(summary)) between 2 and 5000),
  occurred_at timestamptz not null default now(),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 0 and 1440),
  next_follow_up_at timestamptz,
  feedback_requested boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_interactions_client_idx
  on public.crm_interactions (client_id, occurred_at desc);
create index if not exists crm_interactions_employee_idx
  on public.crm_interactions (organization_id, employee_id, occurred_at desc);

create table if not exists public.crm_follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  contract_id uuid references public.crm_contracts(id) on delete set null,
  interaction_id uuid references public.crm_interactions(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  title text not null check (char_length(trim(title)) between 2 and 240),
  description text check (description is null or char_length(trim(description)) <= 5000),
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'todo' check (status in ('todo','in_progress','completed','overdue','cancelled')),
  completed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_tasks_assignee_idx
  on public.crm_follow_up_tasks (organization_id, assigned_to, status, due_at);
create index if not exists crm_tasks_client_idx
  on public.crm_follow_up_tasks (client_id, status, due_at);

create table if not exists public.crm_feedback_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  contract_id uuid references public.crm_contracts(id) on delete set null,
  interaction_id uuid references public.crm_interactions(id) on delete set null,
  employee_id uuid not null references auth.users(id) on delete cascade,
  public_token uuid not null default gen_random_uuid() unique,
  channel text not null check (channel in ('email','whatsapp','sms','web')),
  locale text not null default 'fr' check (locale in ('fr','en')),
  recipient text,
  message text not null,
  status text not null default 'ready' check (status in (
    'ready','pending','sent','delivered','opened','completed','expired','cancelled','failed'
  )),
  delivery_provider text,
  provider_message_id text,
  delivery_error text,
  sent_at timestamptz,
  opened_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  completed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_feedback_requests_client_idx
  on public.crm_feedback_requests (client_id, created_at desc);
create index if not exists crm_feedback_requests_org_status_idx
  on public.crm_feedback_requests (organization_id, status, created_at desc);
create index if not exists crm_feedback_requests_employee_idx
  on public.crm_feedback_requests (organization_id, employee_id, created_at desc);

create table if not exists public.crm_feedback_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null unique references public.crm_feedback_requests(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  interaction_id uuid references public.crm_interactions(id) on delete set null,
  employee_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(trim(comment)) <= 5000),
  consent_to_contact boolean not null default true,
  resolution_status text not null default 'not_required' check (resolution_status in (
    'not_required','open','in_progress','resolved'
  )),
  resolution_assigned_to uuid references auth.users(id) on delete set null,
  resolution_notes text check (resolution_notes is null or char_length(trim(resolution_notes)) <= 5000),
  resolved_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_feedback_responses_org_rating_idx
  on public.crm_feedback_responses (organization_id, rating, submitted_at desc);
create index if not exists crm_feedback_responses_resolution_idx
  on public.crm_feedback_responses (organization_id, resolution_status, submitted_at desc);

create table if not exists public.crm_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crm_audit_log_org_idx
  on public.crm_audit_log (organization_id, created_at desc);
create index if not exists crm_audit_log_entity_idx
  on public.crm_audit_log (entity_type, entity_id, created_at desc);

alter table public.crm_settings enable row level security;
alter table public.crm_clients enable row level security;
alter table public.crm_contracts enable row level security;
alter table public.crm_interactions enable row level security;
alter table public.crm_follow_up_tasks enable row level security;
alter table public.crm_feedback_requests enable row level security;
alter table public.crm_feedback_responses enable row level security;
alter table public.crm_audit_log enable row level security;

revoke all on public.crm_settings from anon, authenticated;
revoke all on public.crm_clients from anon, authenticated;
revoke all on public.crm_contracts from anon, authenticated;
revoke all on public.crm_interactions from anon, authenticated;
revoke all on public.crm_follow_up_tasks from anon, authenticated;
revoke all on public.crm_feedback_requests from anon, authenticated;
revoke all on public.crm_feedback_responses from anon, authenticated;
revoke all on public.crm_audit_log from anon, authenticated;

grant select, insert, update, delete on public.crm_settings to service_role;
grant select, insert, update, delete on public.crm_clients to service_role;
grant select, insert, update, delete on public.crm_contracts to service_role;
grant select, insert, update, delete on public.crm_interactions to service_role;
grant select, insert, update, delete on public.crm_follow_up_tasks to service_role;
grant select, insert, update, delete on public.crm_feedback_requests to service_role;
grant select, insert, update, delete on public.crm_feedback_responses to service_role;
grant select, insert on public.crm_audit_log to service_role;

drop trigger if exists set_crm_settings_updated_at on public.crm_settings;
create trigger set_crm_settings_updated_at before update on public.crm_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_crm_clients_updated_at on public.crm_clients;
create trigger set_crm_clients_updated_at before update on public.crm_clients
for each row execute function public.set_updated_at();

drop trigger if exists set_crm_contracts_updated_at on public.crm_contracts;
create trigger set_crm_contracts_updated_at before update on public.crm_contracts
for each row execute function public.set_updated_at();

drop trigger if exists set_crm_interactions_updated_at on public.crm_interactions;
create trigger set_crm_interactions_updated_at before update on public.crm_interactions
for each row execute function public.set_updated_at();

drop trigger if exists set_crm_follow_up_tasks_updated_at on public.crm_follow_up_tasks;
create trigger set_crm_follow_up_tasks_updated_at before update on public.crm_follow_up_tasks
for each row execute function public.set_updated_at();

drop trigger if exists set_crm_feedback_requests_updated_at on public.crm_feedback_requests;
create trigger set_crm_feedback_requests_updated_at before update on public.crm_feedback_requests
for each row execute function public.set_updated_at();

drop trigger if exists set_crm_feedback_responses_updated_at on public.crm_feedback_responses;
create trigger set_crm_feedback_responses_updated_at before update on public.crm_feedback_responses
for each row execute function public.set_updated_at();

-- Direct links from the sales module to the CRM dossier.
do $$
begin
  if to_regclass('public.sales_records') is not null then
    alter table public.sales_records
      add column if not exists crm_client_id uuid references public.crm_clients(id) on delete set null,
      add column if not exists crm_contract_id uuid references public.crm_contracts(id) on delete set null;

    create index if not exists sales_records_crm_client_idx
      on public.sales_records (organization_id, crm_client_id);
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
