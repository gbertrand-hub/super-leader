-- SUPER LEADER V3.2.7 - VIP COMMUNICATIONS AND REPORTING
-- Communication campaigns, recipient tracking and VIP reporting foundation
-- Run after 046_super_leader_vip_benefits_partners_v3_2_6.sql

create table if not exists public.vip_communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  body text not null,
  communication_type text not null default 'announcement' check (
    communication_type in ('announcement','invitation','alert','newsletter','recognition','operational_update','other')
  ),
  priority text not null default 'normal' check (priority in ('normal','important','urgent')),
  status text not null default 'draft' check (status in ('draft','published','archived','cancelled')),
  audience_scope text not null default 'active_members' check (
    audience_scope in ('all_members','active_members','internal_only','external_only','honorary_only','country','category','selected_members')
  ),
  audience_country text,
  audience_category text,
  selected_member_ids uuid[] not null default '{}'::uuid[],
  channel_plan text[] not null default array['manual']::text[],
  response_required boolean not null default false,
  publish_at timestamptz,
  expires_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(title)) >= 3),
  check (char_length(btrim(body)) >= 10),
  check (channel_plan <@ array['manual','email','whatsapp','in_person']::text[]),
  check (cardinality(channel_plan) >= 1),
  check (expires_at is null or publish_at is null or expires_at >= publish_at),
  check (audience_scope <> 'country' or char_length(btrim(coalesce(audience_country, ''))) >= 2),
  check (audience_scope <> 'category' or char_length(btrim(coalesce(audience_category, ''))) >= 2),
  check (audience_scope <> 'selected_members' or cardinality(selected_member_ids) >= 1)
);

create index if not exists vip_communications_org_status_idx
  on public.vip_communications (organization_id, status, created_at desc);
create index if not exists vip_communications_org_publish_idx
  on public.vip_communications (organization_id, publish_at, expires_at);

create table if not exists public.vip_communication_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  communication_id uuid not null references public.vip_communications(id) on delete cascade,
  member_id uuid not null references public.vip_members(id) on delete cascade,
  channel text not null check (channel in ('manual','email','whatsapp','in_person')),
  status text not null default 'planned' check (
    status in ('planned','sent','delivered','read','acknowledged','failed','skipped')
  ),
  recipient_name text not null,
  recipient_email text,
  recipient_phone text,
  external_reference text,
  delivery_notes text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  acknowledged_at timestamptz,
  failure_reason text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (communication_id, member_id, channel)
);

create index if not exists vip_communication_deliveries_campaign_idx
  on public.vip_communication_deliveries (communication_id, status, channel);
create index if not exists vip_communication_deliveries_org_status_idx
  on public.vip_communication_deliveries (organization_id, status, created_at desc);
create index if not exists vip_communication_deliveries_member_idx
  on public.vip_communication_deliveries (member_id, created_at desc);

-- Reuse the central updated_at trigger function introduced by V3.2.1.
drop trigger if exists vip_communications_updated_at_trigger on public.vip_communications;
create trigger vip_communications_updated_at_trigger
before update on public.vip_communications
for each row execute function public.vip_set_updated_at();

drop trigger if exists vip_communication_deliveries_updated_at_trigger on public.vip_communication_deliveries;
create trigger vip_communication_deliveries_updated_at_trigger
before update on public.vip_communication_deliveries
for each row execute function public.vip_set_updated_at();

alter table public.vip_audit_log drop constraint if exists vip_audit_log_entity_type_check;
alter table public.vip_audit_log add constraint vip_audit_log_entity_type_check
  check (entity_type in (
    'nomination','member','card','renewal','travel','travel_service','country_representative',
    'annual_meeting','meeting_invitation','meeting_agenda',
    'partner','benefit','benefit_redemption',
    'communication','communication_delivery'
  ));

alter table public.vip_audit_log drop constraint if exists vip_audit_log_action_check;
alter table public.vip_audit_log add constraint vip_audit_log_action_check
  check (
    action in (
      'nomination_created','nomination_status_changed','nomination_approved','nomination_rejected',
      'member_created','member_status_changed','member_updated',
      'card_issued','card_reissued','card_revoked',
      'renewal_requested','renewal_status_changed','renewal_approved','renewal_rejected',
      'travel_requested','travel_status_changed','travel_approved','travel_rejected','travel_assigned','travel_completed',
      'travel_service_created','travel_service_updated','travel_service_completed',
      'country_representative_created','country_representative_updated',
      'annual_meeting_created','annual_meeting_updated','annual_meeting_status_changed',
      'annual_meeting_invitation_created','annual_meeting_invitation_status_changed','annual_meeting_bulk_invited',
      'annual_meeting_agenda_created','annual_meeting_agenda_updated',
      'partner_created','partner_updated','partner_status_changed',
      'benefit_created','benefit_updated','benefit_status_changed',
      'benefit_redemption_requested','benefit_redemption_approved','benefit_redemption_rejected',
      'benefit_redeemed','benefit_redemption_cancelled',
      'communication_created','communication_updated','communication_published','communication_archived','communication_cancelled',
      'communication_delivery_status_changed'
    )
  );

alter table public.vip_communications enable row level security;
alter table public.vip_communication_deliveries enable row level security;

revoke all on public.vip_communications from anon, authenticated;
revoke all on public.vip_communication_deliveries from anon, authenticated;

grant select, insert, update, delete on public.vip_communications to service_role;
grant select, insert, update, delete on public.vip_communication_deliveries to service_role;

comment on table public.vip_communications is 'Super Leader VIP communication drafts, audiences, channels and publication lifecycle.';
comment on table public.vip_communication_deliveries is 'Recipient snapshots and manually tracked delivery outcomes for VIP communications.';

notify pgrst, 'reload schema';
