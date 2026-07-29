-- SUPER LEADER V2.7 - Zoom meetings and automatic attendance
-- Execute after 034_events_temporary_teams_v2_6_3.sql

begin;

create extension if not exists pgcrypto;

create table if not exists public.organization_zoom_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  default_host_email text,
  auto_create_meetings boolean not null default false,
  auto_sync_attendance boolean not null default true,
  late_grace_minutes integer not null default 5 check (late_grace_minutes between 0 and 120),
  minimum_attendance_percent integer not null default 50 check (minimum_attendance_percent between 1 and 100),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.performance_meetings
  add column if not exists provider text not null default 'manual',
  add column if not exists meeting_url text,
  add column if not exists zoom_meeting_id text,
  add column if not exists zoom_meeting_uuid text,
  add column if not exists zoom_host_id text,
  add column if not exists zoom_host_email text,
  add column if not exists zoom_start_url text,
  add column if not exists zoom_status text not null default 'not_linked',
  add column if not exists zoom_created_at timestamptz,
  add column if not exists zoom_last_synced_at timestamptz,
  add column if not exists zoom_sync_error text,
  add column if not exists source_type text not null default 'performance',
  add column if not exists source_id uuid;

alter table public.performance_meetings
  drop constraint if exists performance_meetings_provider_check;
alter table public.performance_meetings
  add constraint performance_meetings_provider_check
  check (provider in ('manual','zoom'));

alter table public.performance_meetings
  drop constraint if exists performance_meetings_zoom_status_check;
alter table public.performance_meetings
  add constraint performance_meetings_zoom_status_check
  check (zoom_status in ('not_linked','scheduled','started','ended','cancelled','error'));

alter table public.performance_meetings
  drop constraint if exists performance_meetings_source_type_check;
alter table public.performance_meetings
  add constraint performance_meetings_source_type_check
  check (source_type in ('performance','event'));

create unique index if not exists performance_meetings_zoom_id_unique
  on public.performance_meetings (organization_id,zoom_meeting_id)
  where zoom_meeting_id is not null;
create index if not exists performance_meetings_zoom_uuid_idx
  on public.performance_meetings (zoom_meeting_uuid)
  where zoom_meeting_uuid is not null;

alter table public.performance_meeting_attendance
  add column if not exists left_at timestamptz,
  add column if not exists duration_minutes integer not null default 0,
  add column if not exists attendance_source text not null default 'manual',
  add column if not exists zoom_participant_id text,
  add column if not exists zoom_participant_uuid text,
  add column if not exists zoom_email text,
  add column if not exists zoom_display_name text,
  add column if not exists zoom_last_synced_at timestamptz;

alter table public.performance_meeting_attendance
  drop constraint if exists performance_meeting_attendance_source_check;
alter table public.performance_meeting_attendance
  add constraint performance_meeting_attendance_source_check
  check (attendance_source in ('manual','zoom_webhook','zoom_report'));

alter table public.performance_meeting_attendance
  drop constraint if exists performance_meeting_attendance_duration_check;
alter table public.performance_meeting_attendance
  add constraint performance_meeting_attendance_duration_check
  check (duration_minutes >= 0);

create table if not exists public.zoom_participant_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  performance_meeting_id uuid not null references public.performance_meetings(id) on delete cascade,
  attendance_id uuid references public.performance_meeting_attendance(id) on delete set null,
  zoom_meeting_id text not null,
  zoom_meeting_uuid text,
  zoom_participant_id text,
  zoom_participant_uuid text,
  participant_email text,
  participant_name text,
  joined_at timestamptz not null,
  left_at timestamptz,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  source text not null default 'webhook' check (source in ('webhook','report')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zoom_participant_sessions_meeting_idx
  on public.zoom_participant_sessions (performance_meeting_id,joined_at);
create index if not exists zoom_participant_sessions_participant_idx
  on public.zoom_participant_sessions (zoom_meeting_id,zoom_participant_id,left_at);

create table if not exists public.zoom_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  event_timestamp bigint,
  zoom_meeting_id text,
  zoom_meeting_uuid text,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);

create index if not exists zoom_webhook_events_meeting_idx
  on public.zoom_webhook_events (zoom_meeting_id,created_at desc);

alter table public.event_schedule_items
  add column if not exists performance_meeting_id uuid references public.performance_meetings(id) on delete set null;
create index if not exists event_schedule_performance_meeting_idx
  on public.event_schedule_items (performance_meeting_id)
  where performance_meeting_id is not null;

create or replace function public.zoom_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organization_zoom_settings_touch on public.organization_zoom_settings;
create trigger organization_zoom_settings_touch
before update on public.organization_zoom_settings
for each row execute function public.zoom_touch_updated_at();

drop trigger if exists zoom_participant_sessions_touch on public.zoom_participant_sessions;
create trigger zoom_participant_sessions_touch
before update on public.zoom_participant_sessions
for each row execute function public.zoom_touch_updated_at();

alter table public.organization_zoom_settings enable row level security;
alter table public.zoom_participant_sessions enable row level security;
alter table public.zoom_webhook_events enable row level security;

revoke all on public.organization_zoom_settings from anon, authenticated;
revoke all on public.zoom_participant_sessions from anon, authenticated;
revoke all on public.zoom_webhook_events from anon, authenticated;

grant select, insert, update, delete on public.organization_zoom_settings to service_role;
grant select, insert, update, delete on public.zoom_participant_sessions to service_role;
grant select, insert, update, delete on public.zoom_webhook_events to service_role;

commit;

notify pgrst, 'reload schema';
