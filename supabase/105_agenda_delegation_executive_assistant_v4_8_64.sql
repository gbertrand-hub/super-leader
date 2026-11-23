-- SUPER LEADER V4.8.64
-- Delegation d'agenda & assistant executif
-- Execute after 104_voice_messages_storage_mime_v4_8_63.sql

begin;

create extension if not exists pgcrypto;

create table if not exists public.schedule_delegations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  principal_user_id uuid not null references auth.users(id) on delete cascade,
  delegate_user_id uuid not null references auth.users(id) on delete cascade,
  access_level text not null default 'manage' check (access_level in ('availability','manage','executive')),
  can_view_private_details boolean not null default false,
  expires_on date,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, principal_user_id, delegate_user_id),
  check (principal_user_id <> delegate_user_id)
);

create table if not exists public.personal_agenda_appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  timezone text not null default 'Europe/Dublin',
  title text not null check (char_length(trim(title)) between 1 and 180),
  location text,
  meeting_link text,
  attendees text,
  notes text,
  visibility text not null default 'normal' check (visibility in ('normal','private')),
  source text not null default 'self' check (source in ('self','delegate')),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create table if not exists public.schedule_delegation_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delegation_id uuid references public.schedule_delegations(id) on delete set null,
  appointment_id uuid references public.personal_agenda_appointments(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  principal_user_id uuid references auth.users(id) on delete set null,
  delegate_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists schedule_delegations_principal_idx
  on public.schedule_delegations (organization_id, principal_user_id, is_active, expires_on);
create index if not exists schedule_delegations_delegate_idx
  on public.schedule_delegations (organization_id, delegate_user_id, is_active, expires_on);
create index if not exists personal_agenda_owner_date_idx
  on public.personal_agenda_appointments (organization_id, owner_user_id, work_date, start_time)
  where status = 'scheduled';
create index if not exists personal_agenda_creator_idx
  on public.personal_agenda_appointments (organization_id, created_by, created_at desc);
create index if not exists schedule_delegation_audit_org_idx
  on public.schedule_delegation_audit_log (organization_id, created_at desc);

create or replace function public.agenda_delegation_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_schedule_delegations_updated_at on public.schedule_delegations;
create trigger set_schedule_delegations_updated_at
before update on public.schedule_delegations
for each row execute function public.agenda_delegation_set_updated_at();

drop trigger if exists set_personal_agenda_appointments_updated_at on public.personal_agenda_appointments;
create trigger set_personal_agenda_appointments_updated_at
before update on public.personal_agenda_appointments
for each row execute function public.agenda_delegation_set_updated_at();

alter table public.schedule_delegations enable row level security;
alter table public.personal_agenda_appointments enable row level security;
alter table public.schedule_delegation_audit_log enable row level security;

revoke all on public.schedule_delegations from anon, authenticated;
revoke all on public.personal_agenda_appointments from anon, authenticated;
revoke all on public.schedule_delegation_audit_log from anon, authenticated;

grant select, insert, update, delete on public.schedule_delegations to service_role;
grant select, insert, update, delete on public.personal_agenda_appointments to service_role;
grant select, insert, update, delete on public.schedule_delegation_audit_log to service_role;

comment on table public.schedule_delegations is
  'Delegated calendar access. Delegation never changes the member system role.';
comment on column public.schedule_delegations.access_level is
  'availability = busy/free only; manage = create/edit; executive = create/edit/cancel.';
comment on column public.schedule_delegations.can_view_private_details is
  'When false, private appointments are exposed only as Busy/Indisponible to the delegate.';
comment on table public.personal_agenda_appointments is
  'Personal appointments owned by one member and optionally managed by an authorized delegate.';

notify pgrst, 'reload schema';

commit;
