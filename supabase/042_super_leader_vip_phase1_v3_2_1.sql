-- SUPER LEADER V3.2.1 - VIP PHASE 1
-- Registry, nominations, approvals, statuses and audit trail
-- Run after 041_finance_payroll_foundation_v3_0.sql

create sequence if not exists public.vip_member_number_seq start with 1 increment by 1;

create or replace function public.generate_vip_member_number()
returns text
language sql
volatile
as $$
  select 'SLVIP-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.vip_member_number_seq')::text, 6, '0');
$$;

create or replace function public.vip_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.vip_nominations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nominee_type text not null check (nominee_type in ('internal','external')),
  linked_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  country text,
  organization_name text,
  job_title text,
  recognition_category text not null check (
    recognition_category in ('distinguished_contributor','partner','ambassador','investor','honorary','other')
  ),
  relationship_to_organization text,
  contribution_summary text not null,
  evidence_notes text,
  status text not null default 'submitted' check (
    status in ('draft','submitted','under_review','needs_information','approved','rejected','withdrawn')
  ),
  nominated_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  review_notes text,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((nominee_type = 'internal' and linked_user_id is not null) or nominee_type = 'external'),
  check (char_length(btrim(full_name)) >= 2),
  check (char_length(btrim(contribution_summary)) >= 10)
);

create index if not exists vip_nominations_org_status_idx
  on public.vip_nominations (organization_id, status, submitted_at desc);
create index if not exists vip_nominations_linked_user_idx
  on public.vip_nominations (organization_id, linked_user_id)
  where linked_user_id is not null;

create table if not exists public.vip_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nomination_id uuid unique references public.vip_nominations(id) on delete set null,
  member_number text not null default public.generate_vip_member_number(),
  member_type text not null check (member_type in ('internal','external')),
  linked_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  country text,
  organization_name text,
  job_title text,
  recognition_category text not null check (
    recognition_category in ('distinguished_contributor','partner','ambassador','investor','honorary','other')
  ),
  contribution_summary text not null,
  status text not null default 'active' check (
    status in ('active','pending_renewal','expired','suspended','withdrawn','honorary')
  ),
  admission_date date not null default current_date,
  expires_on date not null default (current_date + interval '1 year')::date,
  notes text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, member_number),
  check ((member_type = 'internal' and linked_user_id is not null) or member_type = 'external'),
  check (expires_on >= admission_date),
  check (char_length(btrim(full_name)) >= 2),
  check (char_length(btrim(contribution_summary)) >= 10)
);

create unique index if not exists vip_members_org_linked_user_unique
  on public.vip_members (organization_id, linked_user_id)
  where linked_user_id is not null and status <> 'withdrawn';
create index if not exists vip_members_org_status_idx
  on public.vip_members (organization_id, status, expires_on);
create index if not exists vip_members_org_country_idx
  on public.vip_members (organization_id, country, full_name);

create table if not exists public.vip_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('nomination','member')),
  entity_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action text not null check (
    action in (
      'nomination_created','nomination_status_changed','nomination_approved','nomination_rejected',
      'member_created','member_status_changed','member_updated'
    )
  ),
  previous_status text,
  new_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vip_audit_org_idx
  on public.vip_audit_log (organization_id, created_at desc);
create index if not exists vip_audit_entity_idx
  on public.vip_audit_log (entity_type, entity_id, created_at desc);

drop trigger if exists vip_nominations_updated_at_trigger on public.vip_nominations;
create trigger vip_nominations_updated_at_trigger
before update on public.vip_nominations
for each row execute function public.vip_set_updated_at();

drop trigger if exists vip_members_updated_at_trigger on public.vip_members;
create trigger vip_members_updated_at_trigger
before update on public.vip_members
for each row execute function public.vip_set_updated_at();

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
begin
  select * into nomination_row
  from public.vip_nominations
  where id = p_nomination_id
  for update;

  if not found then
    raise exception 'VIP nomination not found';
  end if;

  if nomination_row.status = 'approved' then
    select id into existing_member_id
    from public.vip_members
    where nomination_id = nomination_row.id;
    if existing_member_id is not null then
      return existing_member_id;
    end if;
  end if;

  if nomination_row.status in ('rejected','withdrawn') then
    raise exception 'VIP nomination cannot be approved from status %', nomination_row.status;
  end if;

  if nomination_row.linked_user_id is not null then
    select id into existing_member_id
    from public.vip_members
    where organization_id = nomination_row.organization_id
      and linked_user_id = nomination_row.linked_user_id
      and status <> 'withdrawn'
    limit 1;
    if existing_member_id is not null then
      raise exception 'This internal person is already an active VIP member';
    end if;
  end if;

  insert into public.vip_members (
    organization_id,
    nomination_id,
    member_type,
    linked_user_id,
    full_name,
    email,
    phone,
    country,
    organization_name,
    job_title,
    recognition_category,
    contribution_summary,
    status,
    admission_date,
    expires_on,
    approved_by,
    approved_at,
    created_by,
    updated_by
  ) values (
    nomination_row.organization_id,
    nomination_row.id,
    nomination_row.nominee_type,
    nomination_row.linked_user_id,
    nomination_row.full_name,
    nomination_row.email,
    nomination_row.phone,
    nomination_row.country,
    nomination_row.organization_name,
    nomination_row.job_title,
    nomination_row.recognition_category,
    nomination_row.contribution_summary,
    case when nomination_row.recognition_category = 'honorary' then 'honorary' else 'active' end,
    current_date,
    (current_date + interval '1 year')::date,
    p_actor_id,
    now(),
    p_actor_id,
    p_actor_id
  ) returning id into new_member_id;

  update public.vip_nominations
  set status = 'approved',
      reviewed_by = p_actor_id,
      review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
      decided_at = now(),
      updated_at = now()
  where id = nomination_row.id;

  insert into public.vip_audit_log (
    organization_id, entity_type, entity_id, actor_id, action,
    previous_status, new_status, details
  ) values (
    nomination_row.organization_id, 'nomination', nomination_row.id, p_actor_id,
    'nomination_approved', nomination_row.status, 'approved',
    jsonb_build_object('member_id', new_member_id)
  );

  insert into public.vip_audit_log (
    organization_id, entity_type, entity_id, actor_id, action,
    new_status, details
  ) values (
    nomination_row.organization_id, 'member', new_member_id, p_actor_id,
    'member_created', case when nomination_row.recognition_category = 'honorary' then 'honorary' else 'active' end,
    jsonb_build_object('nomination_id', nomination_row.id)
  );

  return new_member_id;
end;
$$;

alter table public.vip_nominations enable row level security;
alter table public.vip_members enable row level security;
alter table public.vip_audit_log enable row level security;

revoke all on public.vip_nominations from anon, authenticated;
revoke all on public.vip_members from anon, authenticated;
revoke all on public.vip_audit_log from anon, authenticated;
revoke all on sequence public.vip_member_number_seq from anon, authenticated;
revoke all on function public.generate_vip_member_number() from anon, authenticated;
revoke all on function public.vip_set_updated_at() from anon, authenticated;
revoke all on function public.approve_vip_nomination(uuid, uuid, text) from anon, authenticated;

alter sequence public.vip_member_number_seq owner to postgres;

grant select, insert, update, delete on public.vip_nominations to service_role;
grant select, insert, update, delete on public.vip_members to service_role;
grant select, insert on public.vip_audit_log to service_role;
grant usage, select on sequence public.vip_member_number_seq to service_role;
grant execute on function public.generate_vip_member_number() to service_role;
grant execute on function public.vip_set_updated_at() to service_role;
grant execute on function public.approve_vip_nomination(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
