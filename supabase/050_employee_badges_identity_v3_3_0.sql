-- SUPER LEADER V3.3.0
-- Badges collaborateurs, validation administrative, QR public et révocation immédiate
-- A exécuter après 049_my_profile_personal_settings_v3_2_9.sql

begin;

create extension if not exists pgcrypto;

create table if not exists public.employee_badge_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  badge_year integer not null check (badge_year between 2020 and 2200),
  last_number integer not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, badge_year)
);

create table if not exists public.employee_badge_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null check (request_type in ('initial','update','renewal','replacement')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reason text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reason is null or char_length(reason) <= 1200),
  check (review_note is null or char_length(review_note) <= 2000)
);

create unique index if not exists employee_badge_requests_one_pending_idx
  on public.employee_badge_requests (organization_id, user_id)
  where status = 'pending';
create index if not exists employee_badge_requests_queue_idx
  on public.employee_badge_requests (organization_id, status, requested_at desc);

create table if not exists public.employee_badges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_number text not null,
  issue_number integer not null check (issue_number >= 1),
  verification_token uuid not null default gen_random_uuid(),
  status text not null default 'active' check (status in ('active','suspended','revoked','expired','replaced')),
  valid_from date not null,
  valid_until date not null,
  issued_by uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default now(),
  suspended_by uuid references auth.users(id) on delete set null,
  suspended_at timestamptz,
  suspension_reason text,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revocation_reason text,
  replaced_by_badge_id uuid references public.employee_badges(id) on delete set null,
  needs_reissue boolean not null default false,
  full_name_snapshot text not null,
  email_snapshot text,
  country_snapshot text,
  city_snapshot text,
  avatar_storage_path_snapshot text,
  role_snapshot text not null,
  role_label_snapshot text not null,
  position_title_snapshot text,
  department_snapshot text,
  team_name_snapshot text,
  organization_name_snapshot text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (badge_number),
  unique (verification_token),
  unique (organization_id, user_id, issue_number),
  check (valid_until >= valid_from),
  check (char_length(full_name_snapshot) between 2 and 160),
  check (notes is null or char_length(notes) <= 2000),
  check (suspension_reason is null or char_length(suspension_reason) <= 1200),
  check (revocation_reason is null or char_length(revocation_reason) <= 1200)
);

create unique index if not exists employee_badges_one_current_idx
  on public.employee_badges (organization_id, user_id)
  where status in ('active','suspended');
create index if not exists employee_badges_user_history_idx
  on public.employee_badges (organization_id, user_id, issue_number desc);
create index if not exists employee_badges_expiry_idx
  on public.employee_badges (organization_id, status, valid_until);
create index if not exists employee_badges_verification_idx
  on public.employee_badges (verification_token);

create table if not exists public.employee_badge_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id uuid references public.employee_badges(id) on delete set null,
  request_id uuid references public.employee_badge_requests(id) on delete set null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in (
    'request_created','request_cancelled','request_approved','request_rejected',
    'badge_issued','badge_reissued','badge_suspended','badge_reactivated',
    'badge_revoked','badge_expired','badge_marked_for_reissue'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists employee_badge_audit_org_idx
  on public.employee_badge_audit_log (organization_id, created_at desc);
create index if not exists employee_badge_audit_user_idx
  on public.employee_badge_audit_log (organization_id, user_id, created_at desc);

create or replace function public.v3_3_0_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists employee_badge_requests_updated_at on public.employee_badge_requests;
create trigger employee_badge_requests_updated_at
before update on public.employee_badge_requests
for each row execute function public.v3_3_0_set_updated_at();

drop trigger if exists employee_badges_updated_at on public.employee_badges;
create trigger employee_badges_updated_at
before update on public.employee_badges
for each row execute function public.v3_3_0_set_updated_at();

create or replace function public.next_employee_badge_number(p_organization_id uuid, p_year integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if p_organization_id is null or p_year < 2020 or p_year > 2200 then
    raise exception 'Invalid badge counter input';
  end if;

  insert into public.employee_badge_counters (organization_id, badge_year, last_number)
  values (p_organization_id, p_year, 1)
  on conflict (organization_id, badge_year)
  do update set last_number = public.employee_badge_counters.last_number + 1, updated_at = now()
  returning last_number into next_number;

  return 'ILG-' || p_year::text || '-' || lpad(next_number::text, 6, '0');
end;
$$;

revoke all on function public.next_employee_badge_number(uuid, integer) from public, anon, authenticated;
grant execute on function public.next_employee_badge_number(uuid, integer) to service_role;

create or replace function public.mark_employee_badges_for_reissue(p_organization_id uuid, p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.employee_badges
  set needs_reissue = true,
      updated_at = now()
  where organization_id = p_organization_id
    and user_id = p_user_id
    and status in ('active','suspended')
    and needs_reissue = false;
end;
$$;

revoke all on function public.mark_employee_badges_for_reissue(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_employee_badges_for_reissue(uuid, uuid, text) to service_role;

create or replace function public.v3_3_0_profile_badge_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_row record;
begin
  if old.full_name is distinct from new.full_name
     or old.country is distinct from new.country
     or old.city is distinct from new.city
     or old.avatar_storage_path is distinct from new.avatar_storage_path then
    for membership_row in
      select organization_id
      from public.organization_members
      where user_id = new.id
    loop
      perform public.mark_employee_badges_for_reissue(membership_row.organization_id, new.id, 'profile_changed');
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists profile_employee_badge_sync on public.profiles;
create trigger profile_employee_badge_sync
after update of full_name, country, city, avatar_storage_path on public.profiles
for each row execute function public.v3_3_0_profile_badge_sync();

create or replace function public.v3_3_0_membership_badge_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_active is distinct from new.is_active and new.is_active = false then
    update public.employee_badges
    set status = 'revoked',
        revoked_at = now(),
        revocation_reason = coalesce(revocation_reason, 'Organisation membership deactivated'),
        updated_at = now()
    where organization_id = new.organization_id
      and user_id = new.user_id
      and status in ('active','suspended');
  elsif old.role is distinct from new.role then
    perform public.mark_employee_badges_for_reissue(new.organization_id, new.user_id, 'role_changed');
  end if;
  return new;
end;
$$;

drop trigger if exists organization_member_employee_badge_sync on public.organization_members;
create trigger organization_member_employee_badge_sync
after update of role, is_active on public.organization_members
for each row execute function public.v3_3_0_membership_badge_sync();

create or replace function public.v3_3_0_team_member_badge_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_team_id uuid;
  target_user_id uuid;
  target_org_id uuid;
begin
  if tg_op = 'DELETE' then
    target_team_id := old.team_id;
    target_user_id := old.user_id;
  else
    target_team_id := new.team_id;
    target_user_id := new.user_id;
  end if;

  select organization_id into target_org_id from public.teams where id = target_team_id;
  if target_org_id is not null then
    perform public.mark_employee_badges_for_reissue(target_org_id, target_user_id, 'team_assignment_changed');
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists team_member_employee_badge_sync on public.team_members;
create trigger team_member_employee_badge_sync
after insert or update or delete on public.team_members
for each row execute function public.v3_3_0_team_member_badge_sync();

create or replace function public.v3_3_0_team_badge_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_row record;
begin
  if old.name is distinct from new.name or old.department is distinct from new.department then
    for member_row in select user_id from public.team_members where team_id = new.id loop
      perform public.mark_employee_badges_for_reissue(new.organization_id, member_row.user_id, 'team_details_changed');
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists team_employee_badge_sync on public.teams;
create trigger team_employee_badge_sync
after update of name, department on public.teams
for each row execute function public.v3_3_0_team_badge_sync();


create or replace function public.approve_employee_badge_request(
  p_request_id uuid,
  p_actor_id uuid,
  p_valid_months integer,
  p_review_note text,
  p_full_name text,
  p_email text,
  p_country text,
  p_city text,
  p_avatar_storage_path text,
  p_role text,
  p_role_label text,
  p_position_title text,
  p_department text,
  p_team_name text,
  p_organization_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.employee_badge_requests%rowtype;
  current_badge public.employee_badges%rowtype;
  new_badge_id uuid;
  new_badge_number text;
  next_issue integer;
  start_date date := current_date;
  end_date date;
begin
  if p_valid_months < 1 or p_valid_months > 36 then
    raise exception 'Badge validity must be between 1 and 36 months';
  end if;

  select * into request_row
  from public.employee_badge_requests
  where id = p_request_id
  for update;

  if not found or request_row.status <> 'pending' then
    raise exception 'Badge request is no longer pending';
  end if;

  if not exists (
    select 1 from public.organization_members membership
    where membership.organization_id = request_row.organization_id
      and membership.user_id = request_row.user_id
      and membership.is_active = true
  ) then
    raise exception 'Employee membership is not active';
  end if;

  end_date := (start_date + make_interval(months => p_valid_months))::date - 1;
  new_badge_number := public.next_employee_badge_number(request_row.organization_id, extract(year from start_date)::integer);

  select * into current_badge
  from public.employee_badges
  where organization_id = request_row.organization_id
    and user_id = request_row.user_id
    and status in ('active','suspended')
  order by issue_number desc
  limit 1
  for update;

  select coalesce(max(issue_number), 0) + 1 into next_issue
  from public.employee_badges
  where organization_id = request_row.organization_id
    and user_id = request_row.user_id;

  if current_badge.id is not null then
    update public.employee_badges
    set status = 'replaced', updated_at = now()
    where id = current_badge.id;
  end if;

  insert into public.employee_badges (
    organization_id, user_id, badge_number, issue_number, status,
    valid_from, valid_until, issued_by, issued_at, needs_reissue,
    full_name_snapshot, email_snapshot, country_snapshot, city_snapshot,
    avatar_storage_path_snapshot, role_snapshot, role_label_snapshot,
    position_title_snapshot, department_snapshot, team_name_snapshot,
    organization_name_snapshot
  ) values (
    request_row.organization_id, request_row.user_id, new_badge_number, next_issue, 'active',
    start_date, end_date, p_actor_id, now(), false,
    btrim(p_full_name), nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_country, '')), ''), nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_avatar_storage_path, '')), ''), p_role, p_role_label,
    nullif(btrim(coalesce(p_position_title, '')), ''),
    nullif(btrim(coalesce(p_department, '')), ''),
    nullif(btrim(coalesce(p_team_name, '')), ''), btrim(p_organization_name)
  ) returning id into new_badge_id;

  if current_badge.id is not null then
    update public.employee_badges
    set replaced_by_badge_id = new_badge_id, updated_at = now()
    where id = current_badge.id;
  end if;

  update public.employee_badge_requests
  set status = 'approved', reviewed_by = p_actor_id, reviewed_at = now(),
      review_note = nullif(btrim(coalesce(p_review_note, '')), '')
  where id = request_row.id;

  insert into public.employee_badge_audit_log (
    organization_id, user_id, badge_id, request_id, actor_id, action, details
  ) values (
    request_row.organization_id, request_row.user_id, new_badge_id, request_row.id,
    p_actor_id,
    case when current_badge.id is null then 'badge_issued' else 'badge_reissued' end,
    jsonb_build_object('valid_months', p_valid_months, 'request_type', request_row.request_type)
  );

  insert into public.employee_badge_audit_log (
    organization_id, user_id, badge_id, request_id, actor_id, action, details
  ) values (
    request_row.organization_id, request_row.user_id, new_badge_id, request_row.id,
    p_actor_id, 'request_approved', jsonb_build_object('review_note', p_review_note)
  );

  return new_badge_id;
end;
$$;

revoke all on function public.approve_employee_badge_request(
  uuid,uuid,integer,text,text,text,text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.approve_employee_badge_request(
  uuid,uuid,integer,text,text,text,text,text,text,text,text,text,text,text,text
) to service_role;

alter table public.employee_badge_counters enable row level security;
alter table public.employee_badge_requests enable row level security;
alter table public.employee_badges enable row level security;
alter table public.employee_badge_audit_log enable row level security;

revoke all on public.employee_badge_counters from anon, authenticated;
revoke all on public.employee_badge_requests from anon, authenticated;
revoke all on public.employee_badges from anon, authenticated;
revoke all on public.employee_badge_audit_log from anon, authenticated;

grant select, insert, update, delete on public.employee_badge_counters to service_role;
grant select, insert, update, delete on public.employee_badge_requests to service_role;
grant select, insert, update, delete on public.employee_badges to service_role;
grant select, insert, update, delete on public.employee_badge_audit_log to service_role;

comment on table public.employee_badges is
  'Badges officiels iLEAD Global. La copie imprimée n’est valide que si le QR confirme un statut actif.';
comment on column public.employee_badges.needs_reissue is
  'Indique que les informations source ont changé depuis l’émission et qu’une nouvelle édition doit être approuvée.';

commit;

notify pgrst, 'reload schema';
