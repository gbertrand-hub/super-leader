-- SUPER LEADER - Automatisation omnicanale du feedback V2
-- A executer apres 010_crm_clients_feedback.sql

begin;

alter table public.crm_settings
  add column if not exists auto_request_feedback boolean not null default false,
  add column if not exists auto_request_delay_minutes integer not null default 0 check (auto_request_delay_minutes between 0 and 1440),
  add column if not exists auto_request_outcomes text[] not null default array['resolved','follow_up','payment_promise','escalated','other']::text[],
  add column if not exists auto_send_sms boolean not null default false,
  add column if not exists auto_send_whatsapp boolean not null default false,
  add column if not exists reminders_enabled boolean not null default true,
  add column if not exists first_reminder_hours integer not null default 24 check (first_reminder_hours between 1 and 720),
  add column if not exists reminder_interval_hours integer not null default 48 check (reminder_interval_hours between 1 and 720),
  add column if not exists max_reminders integer not null default 2 check (max_reminders between 0 and 5),
  add column if not exists fallback_channel text not null default 'web' check (fallback_channel in ('email','web','none'));

alter table public.crm_feedback_requests
  add column if not exists automated boolean not null default false,
  add column if not exists scheduled_send_at timestamptz,
  add column if not exists delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  add column if not exists reminder_count integer not null default 0 check (reminder_count >= 0),
  add column if not exists last_delivery_at timestamptz,
  add column if not exists next_reminder_at timestamptz,
  add column if not exists last_provider_status text,
  add column if not exists idempotency_key text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb,
  add column if not exists processing_at timestamptz,
  add column if not exists processing_token uuid;

create unique index if not exists crm_feedback_requests_idempotency_key_uidx
  on public.crm_feedback_requests (idempotency_key)
  where idempotency_key is not null;

create index if not exists crm_feedback_requests_dispatch_idx
  on public.crm_feedback_requests (status, scheduled_send_at, expires_at)
  where status in ('ready','pending','failed');

create index if not exists crm_feedback_requests_reminder_idx
  on public.crm_feedback_requests (status, next_reminder_at, expires_at)
  where status in ('sent','delivered','opened');

create index if not exists crm_feedback_requests_processing_idx
  on public.crm_feedback_requests (processing_at)
  where processing_at is not null;

create table if not exists public.crm_feedback_delivery_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.crm_feedback_requests(id) on delete cascade,
  provider text not null check (provider in ('resend','twilio','meta','manual','web')),
  provider_message_id text not null,
  delivery_kind text not null default 'initial' check (delivery_kind in ('initial','reminder','manual')),
  status text not null default 'sent',
  sent_at timestamptz not null default now(),
  last_event_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, provider_message_id)
);

create index if not exists crm_feedback_delivery_messages_request_idx
  on public.crm_feedback_delivery_messages (request_id, sent_at desc);

create table if not exists public.crm_feedback_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.crm_feedback_requests(id) on delete cascade,
  provider text not null check (provider in ('resend','twilio','meta','manual','web')),
  provider_event_id text not null,
  provider_message_id text,
  event_type text not null,
  event_status text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists crm_feedback_delivery_events_request_idx
  on public.crm_feedback_delivery_events (request_id, created_at desc);

create index if not exists crm_feedback_delivery_events_org_idx
  on public.crm_feedback_delivery_events (organization_id, created_at desc);

alter table public.crm_feedback_delivery_messages enable row level security;
alter table public.crm_feedback_delivery_events enable row level security;
revoke all on public.crm_feedback_delivery_messages from anon, authenticated;
revoke all on public.crm_feedback_delivery_events from anon, authenticated;
grant select, insert, update on public.crm_feedback_delivery_messages to service_role;
grant select, insert on public.crm_feedback_delivery_events to service_role;

commit;

notify pgrst, 'reload schema';
