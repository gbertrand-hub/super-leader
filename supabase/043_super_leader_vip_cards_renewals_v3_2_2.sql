-- SUPER LEADER V3.2.2 - VIP CARDS AND RENEWALS
-- Digital annual cards, secure public verification, reissues and renewal workflow
-- Run after 042_super_leader_vip_phase1_v3_2_1.sql

create table if not exists public.vip_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.vip_members(id) on delete cascade,
  card_number text not null,
  issue_number integer not null check (issue_number > 0),
  verification_token uuid not null default gen_random_uuid(),
  status text not null default 'active' check (status in ('active','expired','revoked','replaced')),
  valid_from date not null,
  valid_until date not null,
  issued_by uuid not null references auth.users(id),
  issued_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  revocation_reason text,
  replaced_by_card_id uuid references public.vip_cards(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, card_number),
  unique (verification_token),
  unique (member_id, issue_number),
  check (valid_until >= valid_from)
);

create index if not exists vip_cards_org_status_idx
  on public.vip_cards (organization_id, status, valid_until);
create index if not exists vip_cards_member_history_idx
  on public.vip_cards (member_id, issue_number desc);
create unique index if not exists vip_cards_one_active_per_member_idx
  on public.vip_cards (member_id)
  where status = 'active';

create table if not exists public.vip_renewal_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.vip_members(id) on delete cascade,
  current_card_id uuid references public.vip_cards(id) on delete set null,
  new_card_id uuid references public.vip_cards(id) on delete set null,
  status text not null default 'submitted' check (
    status in ('submitted','under_review','needs_information','approved','rejected','cancelled')
  ),
  request_reason text,
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  review_notes text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vip_renewals_org_status_idx
  on public.vip_renewal_requests (organization_id, status, requested_at desc);
create index if not exists vip_renewals_member_history_idx
  on public.vip_renewal_requests (member_id, requested_at desc);
create unique index if not exists vip_renewals_one_open_per_member_idx
  on public.vip_renewal_requests (member_id)
  where status in ('submitted','under_review','needs_information');

drop trigger if exists vip_renewals_updated_at_trigger on public.vip_renewal_requests;
create trigger vip_renewals_updated_at_trigger
before update on public.vip_renewal_requests
for each row execute function public.vip_set_updated_at();

alter table public.vip_audit_log drop constraint if exists vip_audit_log_entity_type_check;
alter table public.vip_audit_log add constraint vip_audit_log_entity_type_check
  check (entity_type in ('nomination','member','card','renewal'));

alter table public.vip_audit_log drop constraint if exists vip_audit_log_action_check;
alter table public.vip_audit_log add constraint vip_audit_log_action_check
  check (
    action in (
      'nomination_created','nomination_status_changed','nomination_approved','nomination_rejected',
      'member_created','member_status_changed','member_updated',
      'card_issued','card_reissued','card_revoked',
      'renewal_requested','renewal_status_changed','renewal_approved','renewal_rejected'
    )
  );

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
begin
  select * into member_row
  from public.vip_members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'VIP member not found';
  end if;

  if member_row.status in ('suspended','withdrawn') then
    raise exception 'A card cannot be issued while member status is %', member_row.status;
  end if;

  if p_valid_from is null or p_valid_until is null or p_valid_until < p_valid_from then
    raise exception 'Invalid VIP card validity period';
  end if;

  select id into prior_card_id
  from public.vip_cards
  where member_id = member_row.id
    and status = 'active'
  order by issue_number desc
  limit 1
  for update;

  select coalesce(max(issue_number), 0) + 1 into next_issue
  from public.vip_cards
  where member_id = member_row.id;

  new_card_number := member_row.member_number || '-C' || lpad(next_issue::text, 2, '0');

  if prior_card_id is not null then
    update public.vip_cards
    set status = 'replaced'
    where id = prior_card_id;
    audit_action := 'card_reissued';
  else
    audit_action := 'card_issued';
  end if;

  insert into public.vip_cards (
    organization_id,
    member_id,
    card_number,
    issue_number,
    status,
    valid_from,
    valid_until,
    issued_by
  ) values (
    member_row.organization_id,
    member_row.id,
    new_card_number,
    next_issue,
    'active',
    p_valid_from,
    p_valid_until,
    p_actor_id
  ) returning id into new_card_id;

  if prior_card_id is not null then
    update public.vip_cards
    set replaced_by_card_id = new_card_id
    where id = prior_card_id;
  end if;

  update public.vip_members
  set expires_on = p_valid_until,
      status = case
        when recognition_category = 'honorary' then 'honorary'
        when status in ('expired','pending_renewal') then 'active'
        else status
      end,
      updated_by = p_actor_id,
      updated_at = now()
  where id = member_row.id;

  insert into public.vip_audit_log (
    organization_id, entity_type, entity_id, actor_id, action,
    new_status, details
  ) values (
    member_row.organization_id, 'card', new_card_id, p_actor_id, audit_action,
    'active',
    jsonb_build_object(
      'member_id', member_row.id,
      'card_number', new_card_number,
      'valid_from', p_valid_from,
      'valid_until', p_valid_until,
      'reason', coalesce(p_reason, 'manual_issue'),
      'replaced_card_id', prior_card_id
    )
  );

  return new_card_id;
end;
$$;

-- Create the first digital card automatically for members added after this migration.
create or replace function public.vip_create_initial_card()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.issue_vip_card(
    new.id,
    new.created_by,
    new.admission_date,
    new.expires_on,
    'initial_membership'
  );
  return new;
end;
$$;

drop trigger if exists vip_members_initial_card_trigger on public.vip_members;
create trigger vip_members_initial_card_trigger
after insert on public.vip_members
for each row execute function public.vip_create_initial_card();

-- Backfill one card for each existing member created during V3.2.1.
insert into public.vip_cards (
  organization_id,
  member_id,
  card_number,
  issue_number,
  status,
  valid_from,
  valid_until,
  issued_by,
  revoked_by,
  revoked_at,
  revocation_reason
)
select
  member.organization_id,
  member.id,
  member.member_number || '-C01',
  1,
  case
    when member.status in ('suspended','withdrawn') then 'revoked'
    when member.expires_on < current_date then 'expired'
    else 'active'
  end,
  member.admission_date,
  member.expires_on,
  coalesce(member.approved_by, member.created_by),
  case when member.status in ('suspended','withdrawn') then coalesce(member.updated_by, member.created_by) else null end,
  case when member.status in ('suspended','withdrawn') then now() else null end,
  case when member.status in ('suspended','withdrawn') then 'Member status at migration' else null end
from public.vip_members member
where not exists (
  select 1 from public.vip_cards card where card.member_id = member.id
);

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
begin
  select * into renewal_row
  from public.vip_renewal_requests
  where id = p_renewal_id
  for update;

  if not found then
    raise exception 'VIP renewal request not found';
  end if;

  if renewal_row.status = 'approved' and renewal_row.new_card_id is not null then
    return renewal_row.new_card_id;
  end if;

  if renewal_row.status in ('rejected','cancelled') then
    raise exception 'VIP renewal cannot be approved from status %', renewal_row.status;
  end if;

  select * into member_row
  from public.vip_members
  where id = renewal_row.member_id
  for update;

  if not found then
    raise exception 'VIP member not found';
  end if;

  if member_row.status in ('suspended','withdrawn') then
    raise exception 'VIP membership cannot be renewed while status is %', member_row.status;
  end if;

  v_new_valid_until := (greatest(member_row.expires_on, current_date) + interval '1 year')::date;

  v_new_card_id := public.issue_vip_card(
    member_row.id,
    p_actor_id,
    current_date,
    v_new_valid_until,
    'annual_renewal'
  );

  update public.vip_renewal_requests
  set status = 'approved',
      new_card_id = v_new_card_id,
      reviewed_by = p_actor_id,
      review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
      decided_at = now(),
      updated_at = now()
  where id = renewal_row.id;

  insert into public.vip_audit_log (
    organization_id, entity_type, entity_id, actor_id, action,
    previous_status, new_status, details
  ) values (
    renewal_row.organization_id, 'renewal', renewal_row.id, p_actor_id,
    'renewal_approved', renewal_row.status, 'approved',
    jsonb_build_object('member_id', member_row.id, 'new_card_id', v_new_card_id, 'new_valid_until', v_new_valid_until)
  );

  return v_new_card_id;
end;
$$;

alter table public.vip_cards enable row level security;
alter table public.vip_renewal_requests enable row level security;

revoke all on public.vip_cards from anon, authenticated;
revoke all on public.vip_renewal_requests from anon, authenticated;
revoke all on function public.issue_vip_card(uuid, uuid, date, date, text) from anon, authenticated;
revoke all on function public.vip_create_initial_card() from anon, authenticated;
revoke all on function public.approve_vip_renewal(uuid, uuid, text) from anon, authenticated;

grant select, insert, update, delete on public.vip_cards to service_role;
grant select, insert, update, delete on public.vip_renewal_requests to service_role;
grant execute on function public.issue_vip_card(uuid, uuid, date, date, text) to service_role;
grant execute on function public.vip_create_initial_card() to service_role;
grant execute on function public.approve_vip_renewal(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
