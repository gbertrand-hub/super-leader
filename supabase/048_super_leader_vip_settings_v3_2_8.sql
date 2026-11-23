-- SUPER LEADER V3.2.8 - VIP PROGRAM SETTINGS
-- Central programme rules, recognition categories and configurable services
-- Run after 047_super_leader_vip_communications_reports_v3_2_7.sql

create table if not exists public.vip_program_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  program_name text not null default 'Super Leader VIP',
  circle_title_fr text not null default 'Cercle rapproché d’iLEAD Global',
  circle_title_en text not null default 'iLEAD Global Inner Circle',
  card_subtitle_fr text not null default 'Carte officielle de membre VIP',
  card_subtitle_en text not null default 'Official VIP membership card',
  card_validity_months integer not null default 12 check (card_validity_months between 1 and 60),
  renewal_notice_days integer[] not null default array[90,60,30]::integer[],
  renewal_grace_days integer not null default 0 check (renewal_grace_days between 0 and 365),
  nomination_requires_evidence boolean not null default true,
  nomination_requires_committee_approval boolean not null default true,
  travel_min_notice_days integer not null default 14 check (travel_min_notice_days between 0 and 365),
  require_travel_consent boolean not null default true,
  auto_assign_country_representative boolean not null default true,
  enabled_travel_services text[] not null default array[
    'airport_welcome','local_transport','accommodation_guidance','office_visit',
    'leadership_meeting','event_invitation','local_assistance','other'
  ]::text[],
  annual_meeting_default_duration_days integer not null default 7 check (annual_meeting_default_duration_days between 1 and 60),
  benefit_default_approval_mode text not null default 'manual' check (benefit_default_approval_mode in ('manual','automatic')),
  communication_default_channels text[] not null default array['manual']::text[],
  public_card_verification_enabled boolean not null default true,
  member_portal_enabled boolean not null default false,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(renewal_notice_days) between 1 and 12),
  check (renewal_notice_days <@ array[365,180,120,90,60,45,30,21,14,7,3,1]::integer[]),
  check (enabled_travel_services <@ array[
    'airport_welcome','local_transport','accommodation_guidance','office_visit',
    'leadership_meeting','event_invitation','local_assistance','other'
  ]::text[]),
  check (cardinality(enabled_travel_services) >= 1),
  check (communication_default_channels <@ array['manual','email','whatsapp','in_person']::text[]),
  check (cardinality(communication_default_channels) >= 1)
);

create table if not exists public.vip_recognition_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name_fr text not null,
  name_en text not null,
  description_fr text,
  description_en text,
  is_honorary boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100 check (sort_order between 0 and 9999),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  check (char_length(btrim(name_fr)) >= 2),
  check (char_length(btrim(name_en)) >= 2)
);

create index if not exists vip_recognition_categories_org_active_idx
  on public.vip_recognition_categories (organization_id, is_active, sort_order, name_fr);

drop trigger if exists vip_program_settings_updated_at_trigger on public.vip_program_settings;
create trigger vip_program_settings_updated_at_trigger
before update on public.vip_program_settings
for each row execute function public.vip_set_updated_at();

drop trigger if exists vip_recognition_categories_updated_at_trigger on public.vip_recognition_categories;
create trigger vip_recognition_categories_updated_at_trigger
before update on public.vip_recognition_categories
for each row execute function public.vip_set_updated_at();

insert into public.vip_program_settings (organization_id)
select organization.id
from public.organizations organization
on conflict (organization_id) do nothing;

insert into public.vip_recognition_categories (
  organization_id, code, name_fr, name_en, is_honorary, sort_order
)
select organization.id, category.code, category.name_fr, category.name_en, category.is_honorary, category.sort_order
from public.organizations organization
cross join (values
  ('distinguished_contributor','Contributeur distinctif','Distinctive contributor',false,10),
  ('partner','Partenaire stratégique','Strategic partner',false,20),
  ('ambassador','Ambassadeur','Ambassador',false,30),
  ('investor','Investisseur','Investor',false,40),
  ('honorary','Membre honoraire','Honorary member',true,50),
  ('other','Autre distinction','Other distinction',false,60)
) as category(code,name_fr,name_en,is_honorary,sort_order)
on conflict (organization_id, code) do nothing;

-- Keep the programme ready for organizations created after this migration.
create or replace function public.vip_initialize_program_configuration()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.vip_program_settings (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;

  insert into public.vip_recognition_categories (
    organization_id, code, name_fr, name_en, is_honorary, sort_order
  )
  select new.id, category.code, category.name_fr, category.name_en, category.is_honorary, category.sort_order
  from (values
    ('distinguished_contributor','Contributeur distinctif','Distinctive contributor',false,10),
    ('partner','Partenaire stratégique','Strategic partner',false,20),
    ('ambassador','Ambassadeur','Ambassador',false,30),
    ('investor','Investisseur','Investor',false,40),
    ('honorary','Membre honoraire','Honorary member',true,50),
    ('other','Autre distinction','Other distinction',false,60)
  ) as category(code,name_fr,name_en,is_honorary,sort_order)
  on conflict (organization_id, code) do nothing;

  return new;
end;
$$;

drop trigger if exists vip_initialize_program_configuration_trigger on public.organizations;
create trigger vip_initialize_program_configuration_trigger
after insert on public.organizations
for each row execute function public.vip_initialize_program_configuration();

alter table public.vip_audit_log drop constraint if exists vip_audit_log_entity_type_check;
alter table public.vip_audit_log add constraint vip_audit_log_entity_type_check
  check (entity_type in (
    'nomination','member','card','renewal','travel','travel_service','country_representative',
    'annual_meeting','meeting_invitation','meeting_agenda',
    'partner','benefit','benefit_redemption',
    'communication','communication_delivery',
    'program_settings','recognition_category'
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
      'communication_delivery_status_changed',
      'program_settings_updated','recognition_category_created','recognition_category_updated','recognition_category_status_changed'
    )
  );

-- Renewals now follow the configured validity period instead of a fixed one-year interval.
create or replace function public.approve_vip_renewal(
  p_renewal_id uuid,
  p_actor_id uuid,
  p_review_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  renewal_row public.vip_renewal_requests%rowtype;
  member_row public.vip_members%rowtype;
  v_new_card_id uuid;
  v_new_valid_until date;
  v_validity_months integer := 12;
begin
  select * into renewal_row
  from public.vip_renewal_requests
  where id = p_renewal_id
  for update;

  if not found then raise exception 'VIP renewal request not found'; end if;
  if renewal_row.status = 'approved' and renewal_row.new_card_id is not null then return renewal_row.new_card_id; end if;
  if renewal_row.status in ('rejected','cancelled') then raise exception 'VIP renewal cannot be approved from status %', renewal_row.status; end if;

  select * into member_row from public.vip_members where id = renewal_row.member_id for update;
  if not found then raise exception 'VIP member not found'; end if;
  if member_row.status in ('suspended','withdrawn') then raise exception 'VIP membership cannot be renewed while status is %', member_row.status; end if;

  select coalesce(settings.card_validity_months, 12) into v_validity_months
  from public.vip_program_settings settings
  where settings.organization_id = member_row.organization_id;
  v_validity_months := coalesce(v_validity_months, 12);

  v_new_valid_until := (
    greatest(member_row.expires_on, current_date) + make_interval(months => v_validity_months)
  )::date;

  v_new_card_id := public.issue_vip_card(
    member_row.id, p_actor_id, current_date, v_new_valid_until, 'annual_renewal'
  );

  update public.vip_renewal_requests
  set status = 'approved', new_card_id = v_new_card_id, reviewed_by = p_actor_id,
      review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''), decided_at = now(), updated_at = now()
  where id = renewal_row.id;

  insert into public.vip_audit_log (
    organization_id, entity_type, entity_id, actor_id, action,
    previous_status, new_status, details
  ) values (
    renewal_row.organization_id, 'renewal', renewal_row.id, p_actor_id,
    'renewal_approved', renewal_row.status, 'approved',
    jsonb_build_object('member_id', member_row.id, 'new_card_id', v_new_card_id,
      'new_valid_until', v_new_valid_until, 'validity_months', v_validity_months)
  );

  return v_new_card_id;
end;
$$;

alter table public.vip_program_settings enable row level security;
alter table public.vip_recognition_categories enable row level security;
revoke all on public.vip_program_settings from anon, authenticated;
revoke all on public.vip_recognition_categories from anon, authenticated;
grant select, insert, update, delete on public.vip_program_settings to service_role;
grant select, insert, update, delete on public.vip_recognition_categories to service_role;
revoke all on function public.approve_vip_renewal(uuid, uuid, text) from anon, authenticated;
grant execute on function public.approve_vip_renewal(uuid, uuid, text) to service_role;

comment on table public.vip_program_settings is 'Organisation-level governance and operating rules for Super Leader VIP.';
comment on table public.vip_recognition_categories is 'Configurable VIP recognition categories used by nominations, members and communications.';

notify pgrst, 'reload schema';

-- Travel approval now follows consent, automatic assignment and enabled-service settings.
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
  settings_row public.vip_program_settings%rowtype;
  selected_representative_id uuid;
  selected_representative_user_id uuid;
  service_name text;
  next_status text;
begin
  select * into travel_row from public.vip_travel_requests where id = p_travel_request_id for update;
  if not found then raise exception 'VIP travel request not found'; end if;
  if travel_row.status in ('rejected','cancelled','completed') then raise exception 'VIP travel request cannot be approved from status %', travel_row.status; end if;

  select * into settings_row from public.vip_program_settings where organization_id = travel_row.organization_id;
  if settings_row.require_travel_consent and not travel_row.consent_to_share then
    raise exception 'Consent to share travel information is required';
  end if;

  if coalesce(settings_row.auto_assign_country_representative, true) then
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
    selected_representative_user_id := representative_row.user_id;
  end if;

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
    if service_name = any(coalesce(settings_row.enabled_travel_services, array[service_name]::text[])) then
      insert into public.vip_travel_service_items (
        organization_id, travel_request_id, service_type, status, assigned_to, created_by, updated_by
      ) values (
        travel_row.organization_id, travel_row.id, service_name, 'planned',
        selected_representative_user_id, p_actor_id, p_actor_id
      ) on conflict (travel_request_id, service_type) do nothing;
    end if;
  end loop;

  insert into public.vip_audit_log (
    organization_id, entity_type, entity_id, actor_id, action,
    previous_status, new_status, details
  ) values (
    travel_row.organization_id, 'travel', travel_row.id, p_actor_id,
    'travel_approved', travel_row.status, next_status,
    jsonb_build_object(
      'member_id', travel_row.member_id,
      'destination_country', travel_row.destination_country,
      'destination_city', travel_row.destination_city,
      'assigned_representative_id', selected_representative_id,
      'requested_services', travel_row.requested_services,
      'automatic_assignment_enabled', coalesce(settings_row.auto_assign_country_representative, true)
    )
  );

  return selected_representative_id;
end;
$$;

revoke all on function public.approve_vip_travel_request(uuid, uuid, text) from anon, authenticated;
grant execute on function public.approve_vip_travel_request(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';

-- Nomination approval follows configurable card validity and honorary categories.
create or replace function public.approve_vip_nomination(
  p_nomination_id uuid,
  p_actor_id uuid,
  p_review_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  nomination_row public.vip_nominations%rowtype;
  existing_member_id uuid;
  new_member_id uuid;
  validity_months integer := 12;
  category_is_honorary boolean := false;
  member_status text;
begin
  select * into nomination_row from public.vip_nominations where id = p_nomination_id for update;
  if not found then raise exception 'VIP nomination not found'; end if;

  if nomination_row.status = 'approved' then
    select id into existing_member_id from public.vip_members where nomination_id = nomination_row.id;
    if existing_member_id is not null then return existing_member_id; end if;
  end if;
  if nomination_row.status in ('rejected','withdrawn') then raise exception 'VIP nomination cannot be approved from status %', nomination_row.status; end if;

  if nomination_row.linked_user_id is not null then
    select id into existing_member_id
    from public.vip_members
    where organization_id = nomination_row.organization_id
      and linked_user_id = nomination_row.linked_user_id
      and status <> 'withdrawn'
    limit 1;
    if existing_member_id is not null then raise exception 'This internal person is already an active VIP member'; end if;
  end if;

  select coalesce(settings.card_validity_months, 12) into validity_months
  from public.vip_program_settings settings
  where settings.organization_id = nomination_row.organization_id;
  validity_months := coalesce(validity_months, 12);

  select coalesce(category.is_honorary, false) into category_is_honorary
  from public.vip_recognition_categories category
  where category.organization_id = nomination_row.organization_id
    and category.code = nomination_row.recognition_category;
  member_status := case when category_is_honorary then 'honorary' else 'active' end;

  insert into public.vip_members (
    organization_id, nomination_id, member_type, linked_user_id, full_name, email, phone,
    country, organization_name, job_title, recognition_category, contribution_summary,
    status, admission_date, expires_on, approved_by, approved_at, created_by, updated_by
  ) values (
    nomination_row.organization_id, nomination_row.id, nomination_row.nominee_type,
    nomination_row.linked_user_id, nomination_row.full_name, nomination_row.email,
    nomination_row.phone, nomination_row.country, nomination_row.organization_name,
    nomination_row.job_title, nomination_row.recognition_category,
    nomination_row.contribution_summary, member_status, current_date,
    (current_date + make_interval(months => validity_months))::date,
    p_actor_id, now(), p_actor_id, p_actor_id
  ) returning id into new_member_id;

  update public.vip_nominations
  set status = 'approved', reviewed_by = p_actor_id,
      review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
      decided_at = now(), updated_at = now()
  where id = nomination_row.id;

  insert into public.vip_audit_log (
    organization_id, entity_type, entity_id, actor_id, action,
    previous_status, new_status, details
  ) values (
    nomination_row.organization_id, 'nomination', nomination_row.id, p_actor_id,
    'nomination_approved', nomination_row.status, 'approved',
    jsonb_build_object('member_id', new_member_id, 'validity_months', validity_months)
  );

  insert into public.vip_audit_log (
    organization_id, entity_type, entity_id, actor_id, action, new_status, details
  ) values (
    nomination_row.organization_id, 'member', new_member_id, p_actor_id,
    'member_created', member_status,
    jsonb_build_object('nomination_id', nomination_row.id)
  );

  return new_member_id;
end;
$$;

-- Card issuance recognises any category flagged as honorary.
create or replace function public.issue_vip_card(
  p_member_id uuid,
  p_actor_id uuid,
  p_valid_from date,
  p_valid_until date,
  p_reason text default 'manual_issue'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member_row public.vip_members%rowtype;
  prior_card_id uuid;
  new_card_id uuid;
  next_issue integer;
  new_card_number text;
  audit_action text;
  category_is_honorary boolean := false;
begin
  select * into member_row from public.vip_members where id = p_member_id for update;
  if not found then raise exception 'VIP member not found'; end if;
  if member_row.status in ('suspended','withdrawn') then raise exception 'A card cannot be issued while member status is %', member_row.status; end if;
  if p_valid_from is null or p_valid_until is null or p_valid_until < p_valid_from then raise exception 'Invalid VIP card validity period'; end if;

  select coalesce(category.is_honorary, false) into category_is_honorary
  from public.vip_recognition_categories category
  where category.organization_id = member_row.organization_id
    and category.code = member_row.recognition_category;

  select id into prior_card_id
  from public.vip_cards
  where member_id = member_row.id and status = 'active'
  order by issue_number desc limit 1 for update;

  select coalesce(max(issue_number), 0) + 1 into next_issue from public.vip_cards where member_id = member_row.id;
  new_card_number := member_row.member_number || '-C' || lpad(next_issue::text, 2, '0');

  if prior_card_id is not null then
    update public.vip_cards set status = 'replaced' where id = prior_card_id;
    audit_action := 'card_reissued';
  else
    audit_action := 'card_issued';
  end if;

  insert into public.vip_cards (
    organization_id, member_id, card_number, issue_number, status,
    valid_from, valid_until, issued_by
  ) values (
    member_row.organization_id, member_row.id, new_card_number, next_issue,
    'active', p_valid_from, p_valid_until, p_actor_id
  ) returning id into new_card_id;

  if prior_card_id is not null then
    update public.vip_cards set replaced_by_card_id = new_card_id where id = prior_card_id;
  end if;

  update public.vip_members
  set expires_on = p_valid_until,
      status = case
        when category_is_honorary then 'honorary'
        when status in ('expired','pending_renewal','honorary') then 'active'
        else status
      end,
      updated_by = p_actor_id,
      updated_at = now()
  where id = member_row.id;

  insert into public.vip_audit_log (
    organization_id, entity_type, entity_id, actor_id, action, new_status, details
  ) values (
    member_row.organization_id, 'card', new_card_id, p_actor_id, audit_action,
    'active', jsonb_build_object(
      'member_id', member_row.id, 'card_number', new_card_number,
      'valid_from', p_valid_from, 'valid_until', p_valid_until,
      'reason', coalesce(p_reason, 'manual_issue'), 'replaced_card_id', prior_card_id
    )
  );

  return new_card_id;
end;
$$;

revoke all on function public.approve_vip_nomination(uuid, uuid, text) from anon, authenticated;
revoke all on function public.issue_vip_card(uuid, uuid, date, date, text) from anon, authenticated;
grant execute on function public.approve_vip_nomination(uuid, uuid, text) to service_role;
grant execute on function public.issue_vip_card(uuid, uuid, date, date, text) to service_role;

notify pgrst, 'reload schema';
