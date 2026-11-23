-- Super Leader V4.8.58
-- Structured sales follow-ups used by the Finance receivables cockpit.
-- Customer-service follow-ups remain in customer_service_follow_ups.

begin;

alter table public.sales_records
  add column if not exists collection_promise_date date,
  add column if not exists collection_next_action_at timestamptz,
  add column if not exists collection_last_contact_at timestamptz;

create table if not exists public.sales_collection_follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales_records(id) on delete cascade,
  agent_id uuid not null references auth.users(id),
  channel text not null check (channel in ('phone','whatsapp','email','sms','in_person','other')),
  outcome text not null check (outcome in ('no_answer','reminder_sent','client_reached','promise_received','dispute','escalated','other')),
  note text not null check (char_length(trim(note)) between 2 and 3000),
  promised_date date,
  next_action_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sales_collection_follow_ups_sale_idx
  on public.sales_collection_follow_ups (sale_id, created_at desc);
create index if not exists sales_collection_follow_ups_queue_idx
  on public.sales_collection_follow_ups (organization_id, next_action_at, created_at desc);
create index if not exists sales_records_collection_action_idx
  on public.sales_records (organization_id, collection_next_action_at, collection_promise_date)
  where balance_amount > 0;

alter table public.sales_collection_follow_ups enable row level security;
revoke all on public.sales_collection_follow_ups from anon, authenticated;
grant select, insert, update, delete on public.sales_collection_follow_ups to service_role;

comment on table public.sales_collection_follow_ups is
  'Structured collection history for sales. Access is enforced by server actions and organization scope.';

commit;
notify pgrst, 'reload schema';
