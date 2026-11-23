-- SUPER LEADER V3.2.4 - VIP INTERNATIONAL TRAVEL AND COUNTRY WELCOME
-- Travel notices, country representatives, welcome services and audit trail
-- Run after 043_super_leader_vip_cards_renewals_v3_2_2.sql

create table if not exists public.vip_country_representatives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  country text not null,
  city text,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_title text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, country, user_id),
  check (char_length(btrim(country)) >= 2)
);

create index if not exists vip_country_representatives_org_country_idx
  on public.vip_country_representatives (organization_id, lower(country), is_active, is_primary desc);
create index if not exists vip_country_representatives_user_idx
  on public.vip_country_representatives (organization_id, user_id, is_active);

create table if not exists public.vip_travel_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.vip_members(id) on delete cascade,
  destination_country text not null,
  destination_city text not null,
  arrival_date date not null,
  departure_date date not null,
  purpose text not null,
  arrival_details text,
  accommodation_details text,
  requested_services text[] not null default '{}'::text[],
  special_requirements text,
  emergency_contact_name text,
  emergency_contact_phone text,
  consent_to_share boolean not null default false,
  status text not null default 'submitted' check (
    status in ('draft','submitted','under_review','needs_information','approved','assigned','in_progress','completed','rejected','cancelled')
  ),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  assigned_representative_id uuid references public.vip_country_representatives(id) on delete set null,
  assigned_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_notes text,
  decided_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (departure_date >= arrival_date),
  check (char_length(btrim(destination_country)) >= 2),
  check (char_length(btrim(destination_city)) >= 2),
  check (char_length(btrim(purpose)) >= 5),
  check (requested_services <@ array[
    'airport_welcome','local_transport','accommodation_guidance','office_visit',
    'leadership_meeting','event_invitation','local_assistance','other'
  ]::text[])
);

create index if not exists vip_travel_requests_org_status_idx
  on public.vip_travel_requests (organization_id, status, arrival_date);
create index if not exists vip_travel_requests_member_idx
  on public.vip_travel_requests (member_id, arrival_date desc);
create index if not exists vip_travel_requests_destination_idx
  on public.vip_travel_requests (organization_id, lower(destination_country), lower(destination_city), arrival_date);
create index if not exists vip_travel_requests_representative_idx
  on public.vip_travel_requests (assigned_representative_id, status, arrival_date)
  where assigned_representative_id is not null;

create table if not exists public.vip_travel_service_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  travel_request_id uuid not null references public.vip_travel_requests(id) on delete cascade,
  service_type text not null check (
    service_type in ('airport_welcome','local_transport','accommodation_guidance','office_visit',
      'leadership_meeting','event_invitation','local_assistance','other')
  ),
  description text,
  status text not null default 'planned' check (
    status in ('planned','confirmed','in_progress','completed','cancelled')
  ),
  assigned_to uuid references auth.users(id) on delete set null,
  provider_name text,
  provider_contact text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (travel_request_id, service_type)
);

create index if not exists vip_travel_services_org_status_idx
  on public.vip_travel_service_items (organization_id, status, scheduled_at);
create index if not exists vip_travel_services_trip_idx
  on public.vip_travel_service_items (travel_request_id, service_type);

-- Reuse the central updated_at trigger function introduced by V3.2.1.
drop trigger if exists vip_country_representatives_updated_at_trigger on public.vip_country_representatives;
create trigger vip_country_representatives_updated_at_trigger
before update on public.vip_country_representatives
for each row execute function public.vip_set_updated_at();

drop trigger if exists vip_travel_requests_updated_at_trigger on public.vip_travel_requests;
create trigger vip_travel_requests_updated_at_trigger
before update on public.vip_travel_requests
for each row execute function public.vip_set_updated_at();

drop trigger if exists vip_travel_service_items_updated_at_trigger on public.vip_travel_service_items;
create trigger vip_travel_service_items_updated_at_trigger
before update on public.vip_travel_service_items
for each row execute function public.vip_set_updated_at();

alter table public.vip_audit_log drop constraint if exists vip_audit_log_entity_type_check;
alter table public.vip_audit_log add constraint vip_audit_log_entity_type_check
  check (entity_type in ('nomination','member','card','renewal','travel','travel_service','country_representative'));

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
      'country_representative_created','country_representative_updated'
    )
  );

create or replace function public.approve_vip_travel_request(
  p_travel_request_id uuid,
  p_actor_id uuid,
  p_review_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  travel_row public.vip_travel_requests%rowtype;
  representative_row public.vip_country_representatives%rowtype;
  selected_representative_id uuid;
  service_name text;
  next_status text;
begin
  select * into travel_row
  from public.vip_travel_requests
  where id = p_travel_request_id
  for update;

  if not found then
    raise exception 'VIP travel request not found';
  end if;

  if travel_row.status in ('rejected','cancelled','completed') then
    raise exception 'VIP travel request cannot be approved from status %', travel_row.status;
  end if;

  if not travel_row.consent_to_share then
    raise exception 'Consent to share travel information is required';
  end if;

  select * into representative_row
  from public.vip_country_representatives
  where organization_id = travel_row.organization_id
    and is_active = true
    and lower(btrim(country)) = lower(btrim(travel_row.destination_country))
  order by
    case when city is not null and lower(btrim(city)) = lower(btrim(travel_row.destination_city)) then 0 else 1 end,
    is_primary desc,
    created_at asc
  limit 1;

  selected_representative_id := representative_row.id;
  next_status := case when selected_representative_id is null then 'approved' else 'assigned' end;

  update public.vip_travel_requests
  set status = next_status,
      assigned_representative_id = selected_representative_id,
      assigned_at = case when selected_representative_id is null then null else now() end,
      reviewed_by = p_actor_id,
      review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
      decided_at = now(),
      updated_at = now()
  where id = travel_row.id;

  foreach service_name in array travel_row.requested_services
  loop
    insert into public.vip_travel_service_items (
      organization_id,
      travel_request_id,
      service_type,
      status,
      assigned_to,
      created_by,
      updated_by
    ) values (
      travel_row.organization_id,
      travel_row.id,
      service_name,
      'planned',
      representative_row.user_id,
      p_actor_id,
      p_actor_id
    )
    on conflict (travel_request_id, service_type) do nothing;
  end loop;

  insert into public.vip_audit_log (
    organization_id, entity_type, entity_id, actor_id, action,
    previous_status, new_status, details
  ) values (
    travel_row.organization_id,
    'travel',
    travel_row.id,
    p_actor_id,
    'travel_approved',
    travel_row.status,
    next_status,
    jsonb_build_object(
      'member_id', travel_row.member_id,
      'destination_country', travel_row.destination_country,
      'destination_city', travel_row.destination_city,
      'assigned_representative_id', selected_representative_id,
      'requested_services', travel_row.requested_services
    )
  );

  return selected_representative_id;
end;
$$;

comment on table public.vip_country_representatives is 'Local representatives responsible for Super Leader VIP welcome in each country.';
comment on table public.vip_travel_requests is 'International travel notices submitted for active Super Leader VIP members.';
comment on table public.vip_travel_service_items is 'Operational welcome services attached to an approved VIP trip.';
