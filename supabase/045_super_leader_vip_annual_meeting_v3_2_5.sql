-- SUPER LEADER V3.2.5 - VIP ANNUAL INTERNATIONAL GATHERING
-- Annual host country, invitations, attendance and agenda management
-- Run after 044_super_leader_vip_travel_welcome_v3_2_4.sql

create table if not exists public.vip_annual_meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_year integer not null check (event_year between 2020 and 2100),
  title text not null,
  theme text,
  host_country text not null,
  host_city text not null,
  venue text,
  start_date date not null,
  end_date date not null,
  registration_deadline date,
  status text not null default 'planning' check (
    status in ('planning','announced','registration_open','confirmed','completed','cancelled')
  ),
  description text,
  logistics_notes text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, event_year),
  check (char_length(btrim(title)) >= 3),
  check (char_length(btrim(host_country)) >= 2),
  check (char_length(btrim(host_city)) >= 2),
  check (end_date >= start_date),
  check (registration_deadline is null or registration_deadline <= start_date)
);

create index if not exists vip_annual_meetings_org_date_idx
  on public.vip_annual_meetings (organization_id, start_date desc);
create index if not exists vip_annual_meetings_org_status_idx
  on public.vip_annual_meetings (organization_id, status, event_year desc);

create table if not exists public.vip_annual_meeting_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid not null references public.vip_annual_meetings(id) on delete cascade,
  member_id uuid not null references public.vip_members(id) on delete cascade,
  status text not null default 'invited' check (
    status in ('invited','confirmed','declined','waitlisted','attended','absent','cancelled')
  ),
  guest_count integer not null default 0 check (guest_count between 0 and 5),
  visa_support_required boolean not null default false,
  travel_support_required boolean not null default false,
  dietary_requirements text,
  accommodation_notes text,
  response_notes text,
  invited_by uuid not null references auth.users(id),
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  checked_in_at timestamptz,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, member_id)
);

create index if not exists vip_annual_meeting_invites_meeting_idx
  on public.vip_annual_meeting_invitations (meeting_id, status, invited_at);
create index if not exists vip_annual_meeting_invites_member_idx
  on public.vip_annual_meeting_invitations (member_id, invited_at desc);
create index if not exists vip_annual_meeting_invites_support_idx
  on public.vip_annual_meeting_invitations (organization_id, visa_support_required, travel_support_required)
  where status in ('invited','confirmed','waitlisted');

create table if not exists public.vip_annual_meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid not null references public.vip_annual_meetings(id) on delete cascade,
  title text not null,
  description text,
  session_date date not null,
  start_time time,
  end_time time,
  speaker text,
  location text,
  sort_order integer not null default 0,
  status text not null default 'planned' check (
    status in ('planned','confirmed','completed','cancelled')
  ),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(title)) >= 3),
  check (end_time is null or start_time is null or end_time > start_time)
);

create index if not exists vip_annual_meeting_agenda_meeting_idx
  on public.vip_annual_meeting_agenda_items (meeting_id, session_date, sort_order, start_time);

-- Reuse the central updated_at trigger function introduced by V3.2.1.
drop trigger if exists vip_annual_meetings_updated_at_trigger on public.vip_annual_meetings;
create trigger vip_annual_meetings_updated_at_trigger
before update on public.vip_annual_meetings
for each row execute function public.vip_set_updated_at();

drop trigger if exists vip_annual_meeting_invitations_updated_at_trigger on public.vip_annual_meeting_invitations;
create trigger vip_annual_meeting_invitations_updated_at_trigger
before update on public.vip_annual_meeting_invitations
for each row execute function public.vip_set_updated_at();

drop trigger if exists vip_annual_meeting_agenda_items_updated_at_trigger on public.vip_annual_meeting_agenda_items;
create trigger vip_annual_meeting_agenda_items_updated_at_trigger
before update on public.vip_annual_meeting_agenda_items
for each row execute function public.vip_set_updated_at();

alter table public.vip_audit_log drop constraint if exists vip_audit_log_entity_type_check;
alter table public.vip_audit_log add constraint vip_audit_log_entity_type_check
  check (entity_type in (
    'nomination','member','card','renewal','travel','travel_service','country_representative',
    'annual_meeting','meeting_invitation','meeting_agenda'
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
      'annual_meeting_agenda_created','annual_meeting_agenda_updated'
    )
  );

alter table public.vip_annual_meetings enable row level security;
alter table public.vip_annual_meeting_invitations enable row level security;
alter table public.vip_annual_meeting_agenda_items enable row level security;

revoke all on public.vip_annual_meetings from anon, authenticated;
revoke all on public.vip_annual_meeting_invitations from anon, authenticated;
revoke all on public.vip_annual_meeting_agenda_items from anon, authenticated;

grant select, insert, update, delete on public.vip_annual_meetings to service_role;
grant select, insert, update, delete on public.vip_annual_meeting_invitations to service_role;
grant select, insert, update, delete on public.vip_annual_meeting_agenda_items to service_role;

comment on table public.vip_annual_meetings is 'One annual international Super Leader VIP gathering per organization and year.';
comment on table public.vip_annual_meeting_invitations is 'VIP member invitations, responses, support requirements and attendance for an annual gathering.';
comment on table public.vip_annual_meeting_agenda_items is 'Programme and agenda sessions for an annual Super Leader VIP gathering.';

notify pgrst, 'reload schema';
