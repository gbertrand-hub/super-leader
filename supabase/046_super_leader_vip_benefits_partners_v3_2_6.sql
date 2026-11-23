-- SUPER LEADER V3.2.6 - VIP BENEFITS AND PARTNERS
-- Partner directory, benefit catalogue, eligibility and redemption tracking
-- Run after 045_super_leader_vip_annual_meeting_v3_2_5.sql

create table if not exists public.vip_partners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  partner_type text not null check (
    partner_type in ('hotel','transport','restaurant','healthcare','coworking','retail','professional_services','education','other')
  ),
  country text not null,
  city text,
  website_url text,
  contact_name text,
  contact_email text,
  contact_phone text,
  agreement_start date,
  agreement_end date,
  status text not null default 'active' check (status in ('active','suspended','expired','archived')),
  notes text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(name)) >= 2),
  check (char_length(btrim(country)) >= 2),
  check (agreement_end is null or agreement_start is null or agreement_end >= agreement_start)
);

create unique index if not exists vip_partners_org_identity_uidx
  on public.vip_partners (organization_id, lower(btrim(name)), lower(btrim(country)), coalesce(lower(btrim(city)), ''));

create index if not exists vip_partners_org_status_idx
  on public.vip_partners (organization_id, status, lower(country), lower(name));
create index if not exists vip_partners_org_type_idx
  on public.vip_partners (organization_id, partner_type, lower(country));

create table if not exists public.vip_benefits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_id uuid references public.vip_partners(id) on delete set null,
  title text not null,
  description text not null,
  benefit_type text not null check (
    benefit_type in ('discount','complimentary','priority','upgrade','exclusive_access','assistance','gift','other')
  ),
  value_label text,
  country text,
  city text,
  eligibility_scope text not null default 'active_members' check (
    eligibility_scope in ('all_members','active_members','honorary_only','internal_only','external_only','custom')
  ),
  eligible_categories text[] not null default '{}'::text[],
  redemption_instructions text not null,
  terms_and_conditions text,
  valid_from date,
  valid_until date,
  status text not null default 'draft' check (status in ('draft','active','suspended','expired','archived')),
  requires_approval boolean not null default true,
  usage_limit_per_member integer check (usage_limit_per_member is null or usage_limit_per_member > 0),
  total_usage_limit integer check (total_usage_limit is null or total_usage_limit > 0),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(title)) >= 3),
  check (char_length(btrim(description)) >= 5),
  check (char_length(btrim(redemption_instructions)) >= 3),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index if not exists vip_benefits_org_status_idx
  on public.vip_benefits (organization_id, status, valid_until, lower(title));
create index if not exists vip_benefits_partner_idx
  on public.vip_benefits (partner_id, status) where partner_id is not null;
create index if not exists vip_benefits_country_idx
  on public.vip_benefits (organization_id, lower(country), lower(city)) where country is not null;

create table if not exists public.vip_benefit_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  benefit_id uuid not null references public.vip_benefits(id) on delete cascade,
  member_id uuid not null references public.vip_members(id) on delete cascade,
  reference_number text not null default (
    'SLVIP-BEN-' || to_char(now(), 'YYYY') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))
  ),
  status text not null default 'requested' check (status in ('requested','approved','redeemed','rejected','cancelled')),
  request_notes text,
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  redeemed_at timestamptz,
  partner_reference text,
  value_realized numeric(12,2) check (value_realized is null or value_realized >= 0),
  decision_notes text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, reference_number)
);

create index if not exists vip_benefit_redemptions_org_status_idx
  on public.vip_benefit_redemptions (organization_id, status, requested_at desc);
create index if not exists vip_benefit_redemptions_member_idx
  on public.vip_benefit_redemptions (member_id, requested_at desc);
create index if not exists vip_benefit_redemptions_benefit_idx
  on public.vip_benefit_redemptions (benefit_id, status, requested_at desc);

-- Reuse the central updated_at trigger function introduced by V3.2.1.
drop trigger if exists vip_partners_updated_at_trigger on public.vip_partners;
create trigger vip_partners_updated_at_trigger
before update on public.vip_partners
for each row execute function public.vip_set_updated_at();

drop trigger if exists vip_benefits_updated_at_trigger on public.vip_benefits;
create trigger vip_benefits_updated_at_trigger
before update on public.vip_benefits
for each row execute function public.vip_set_updated_at();

drop trigger if exists vip_benefit_redemptions_updated_at_trigger on public.vip_benefit_redemptions;
create trigger vip_benefit_redemptions_updated_at_trigger
before update on public.vip_benefit_redemptions
for each row execute function public.vip_set_updated_at();

alter table public.vip_audit_log drop constraint if exists vip_audit_log_entity_type_check;
alter table public.vip_audit_log add constraint vip_audit_log_entity_type_check
  check (entity_type in (
    'nomination','member','card','renewal','travel','travel_service','country_representative',
    'annual_meeting','meeting_invitation','meeting_agenda',
    'partner','benefit','benefit_redemption'
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
      'benefit_redeemed','benefit_redemption_cancelled'
    )
  );

alter table public.vip_partners enable row level security;
alter table public.vip_benefits enable row level security;
alter table public.vip_benefit_redemptions enable row level security;

revoke all on public.vip_partners from anon, authenticated;
revoke all on public.vip_benefits from anon, authenticated;
revoke all on public.vip_benefit_redemptions from anon, authenticated;

grant select, insert, update, delete on public.vip_partners to service_role;
grant select, insert, update, delete on public.vip_benefits to service_role;
grant select, insert, update, delete on public.vip_benefit_redemptions to service_role;

comment on table public.vip_partners is 'Approved Super Leader VIP service partners by country and city.';
comment on table public.vip_benefits is 'VIP privileges, eligibility rules, validity and redemption instructions.';
comment on table public.vip_benefit_redemptions is 'Requests, approvals and confirmed usage of Super Leader VIP benefits.';

notify pgrst, 'reload schema';
