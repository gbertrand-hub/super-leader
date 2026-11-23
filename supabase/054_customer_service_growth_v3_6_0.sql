-- Super Leader V3.6.0
-- Customer Service Growth Centre: tickets, SLA, conversation, audit trail and satisfaction.
-- Run after 010_crm_clients_feedback.sql and 053_multisector_crm_pipeline_v3_5_0.sql.

begin;

create table if not exists public.customer_service_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  first_response_hours integer not null default 4 check (first_response_hours between 1 and 168),
  resolution_hours integer not null default 48 check (resolution_hours between 1 and 720),
  satisfaction_enabled boolean not null default true,
  escalation_enabled boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_service_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference text not null,
  client_id uuid not null references public.crm_clients(id) on delete restrict,
  subject text not null check (char_length(trim(subject)) between 2 and 220),
  description text not null check (char_length(trim(description)) between 2 and 10000),
  category text not null default 'information' check (category in ('information','complaint','payment','technical','training','delivery','cancellation','other')),
  channel text not null default 'manual' check (channel in ('manual','phone','email','whatsapp','sms','web','social_media','in_person','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','assigned','in_progress','waiting_customer','escalated','resolved','closed','cancelled')),
  assigned_to uuid references auth.users(id) on delete set null,
  supervisor_id uuid references auth.users(id) on delete set null,
  first_response_due_at timestamptz not null,
  resolution_due_at timestamptz not null,
  first_responded_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  resolution_summary text check (resolution_summary is null or char_length(trim(resolution_summary)) <= 5000),
  satisfaction_rating smallint check (satisfaction_rating between 1 and 5),
  satisfaction_comment text check (satisfaction_comment is null or char_length(trim(satisfaction_comment)) <= 3000),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, reference)
);

create table if not exists public.customer_service_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.customer_service_tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  direction text not null default 'internal' check (direction in ('inbound','outbound','internal')),
  channel text not null default 'internal' check (channel in ('internal','phone','email','whatsapp','sms','web','social_media','in_person','other')),
  body text not null check (char_length(trim(body)) between 1 and 10000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_service_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.customer_service_tickets(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  event_type text not null check (event_type in ('created','assigned','status_changed','priority_changed','message_added','escalated','resolved','reopened','satisfaction_recorded')),
  note text check (note is null or char_length(trim(note)) <= 3000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_service_tickets_queue_idx on public.customer_service_tickets (organization_id, status, priority, resolution_due_at);
create index if not exists customer_service_tickets_assignee_idx on public.customer_service_tickets (organization_id, assigned_to, status, updated_at desc);
create index if not exists customer_service_tickets_client_idx on public.customer_service_tickets (client_id, created_at desc);
create index if not exists customer_service_messages_ticket_idx on public.customer_service_messages (ticket_id, created_at);
create index if not exists customer_service_events_ticket_idx on public.customer_service_events (ticket_id, created_at desc);

create or replace function public.customer_service_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists set_customer_service_ticket_updated_at on public.customer_service_tickets;
create trigger set_customer_service_ticket_updated_at before update on public.customer_service_tickets
for each row execute function public.customer_service_set_updated_at();

drop trigger if exists set_customer_service_settings_updated_at on public.customer_service_settings;
create trigger set_customer_service_settings_updated_at before update on public.customer_service_settings
for each row execute function public.customer_service_set_updated_at();

alter table public.customer_service_settings enable row level security;
alter table public.customer_service_tickets enable row level security;
alter table public.customer_service_messages enable row level security;
alter table public.customer_service_events enable row level security;

revoke all on public.customer_service_settings, public.customer_service_tickets, public.customer_service_messages, public.customer_service_events from anon, authenticated;
grant select, insert, update, delete on public.customer_service_settings, public.customer_service_tickets, public.customer_service_messages, public.customer_service_events to service_role;

comment on table public.customer_service_tickets is 'Omnichannel customer support tickets with SLA and growth-oriented satisfaction tracking.';
comment on table public.customer_service_events is 'Immutable operational audit history for customer service tickets.';

commit;
notify pgrst, 'reload schema';
