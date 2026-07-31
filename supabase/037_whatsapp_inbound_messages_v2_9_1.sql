-- SUPER LEADER V2.9.1
-- Réception, déduplication et rapprochement des messages WhatsApp entrants

begin;

create table if not exists public.crm_whatsapp_inbound_messages (
  id uuid primary key default gen_random_uuid(),

  provider text not null default 'meta'
    check (provider in ('meta')),

  provider_message_id text not null,
  phone_number_id text,
  from_phone text not null,
  profile_name text,

  message_type text not null,
  message_text text
    check (
      message_text is null
      or char_length(message_text) <= 5000
    ),

  organization_id uuid
    references public.organizations(id)
    on delete cascade,

  client_id uuid
    references public.crm_clients(id)
    on delete set null,

  feedback_request_id uuid
    references public.crm_feedback_requests(id)
    on delete set null,

  interaction_id uuid
    references public.crm_interactions(id)
    on delete set null,

  processing_status text not null default 'received'
    check (
      processing_status in (
        'received',
        'matched',
        'unmatched',
        'ignored',
        'failed'
      )
    ),

  processing_error text,

  payload jsonb not null default '{}'::jsonb,

  occurred_at timestamptz,
  processed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (provider, provider_message_id)
);

create index if not exists crm_whatsapp_inbound_status_idx
  on public.crm_whatsapp_inbound_messages
    (processing_status, created_at desc);

create index if not exists crm_whatsapp_inbound_client_idx
  on public.crm_whatsapp_inbound_messages
    (client_id, occurred_at desc)
  where client_id is not null;

create index if not exists crm_whatsapp_inbound_request_idx
  on public.crm_whatsapp_inbound_messages
    (feedback_request_id, occurred_at desc)
  where feedback_request_id is not null;

-- Recherche rapide indépendamment du format +1 737... ou 1737...
create index if not exists crm_clients_org_whatsapp_digits_idx
  on public.crm_clients (
    organization_id,
    (
      regexp_replace(
        coalesce(whatsapp_phone, ''),
        '[^0-9]',
        '',
        'g'
      )
    )
  )
  where whatsapp_phone is not null
    and btrim(whatsapp_phone) <> '';

create index if not exists crm_clients_org_phone_digits_idx
  on public.crm_clients (
    organization_id,
    (
      regexp_replace(
        coalesce(phone, ''),
        '[^0-9]',
        '',
        'g'
      )
    )
  )
  where phone is not null
    and btrim(phone) <> '';

drop trigger if exists
  set_crm_whatsapp_inbound_messages_updated_at
  on public.crm_whatsapp_inbound_messages;

create trigger set_crm_whatsapp_inbound_messages_updated_at
before update on public.crm_whatsapp_inbound_messages
for each row execute function public.set_updated_at();

alter table public.crm_whatsapp_inbound_messages
  enable row level security;

revoke all
  on public.crm_whatsapp_inbound_messages
  from anon, authenticated;

grant select, insert, update
  on public.crm_whatsapp_inbound_messages
  to service_role;

commit;