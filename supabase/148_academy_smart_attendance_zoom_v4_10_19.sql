-- Super Leader V4.10.19 - Academy Smart Attendance Zoom
-- Zoom-first attendance for large Academy cohorts with registration-aware matching and audit.
begin;

create extension if not exists pgcrypto;

create table if not exists public.academy_zoom_attendance_settings (
  school_id uuid primary key references public.academy_schools(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  zoom_meeting_id text not null,
  timezone text not null default 'Europe/Dublin',
  late_grace_minutes integer not null default 15 check (late_grace_minutes between 0 and 120),
  present_threshold_percent integer not null default 75 check (present_threshold_percent between 1 and 100),
  partial_threshold_percent integer not null default 25 check (partial_threshold_percent between 1 and 99),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_zoom_attendance_threshold_order_check
    check (partial_threshold_percent < present_threshold_percent),
  constraint academy_zoom_attendance_meeting_id_check
    check (zoom_meeting_id ~ '^[0-9]{9,12}$')
);

create unique index if not exists academy_zoom_attendance_settings_org_school_uq
  on public.academy_zoom_attendance_settings(organization_id, school_id);

alter table public.academy_attendance_sessions
  add column if not exists zoom_meeting_id text,
  add column if not exists zoom_meeting_uuid text,
  add column if not exists zoom_host_email text,
  add column if not exists zoom_instance_started_at timestamptz,
  add column if not exists zoom_timezone text,
  add column if not exists zoom_last_synced_at timestamptz,
  add column if not exists zoom_sync_status text,
  add column if not exists zoom_sync_error text,
  add column if not exists zoom_matched_count integer not null default 0,
  add column if not exists zoom_review_count integer not null default 0,
  add column if not exists zoom_unmatched_participant_count integer not null default 0,
  add column if not exists zoom_registered_count integer not null default 0;

alter table public.academy_attendance_sessions
  drop constraint if exists academy_attendance_sessions_zoom_sync_status_check;
alter table public.academy_attendance_sessions
  add constraint academy_attendance_sessions_zoom_sync_status_check
  check (zoom_sync_status is null or zoom_sync_status in ('ready','synced','review','error'));

alter table public.academy_attendance_sessions
  drop constraint if exists academy_attendance_sessions_entry_mode_check,
  drop constraint if exists academy_attendance_sessions_retroactive_metadata_check;
alter table public.academy_attendance_sessions
  add constraint academy_attendance_sessions_entry_mode_check
    check (attendance_entry_mode in ('live','retroactive','zoom_sync')),
  add constraint academy_attendance_sessions_retroactive_metadata_check
    check (
      attendance_entry_mode in ('live','zoom_sync')
      or (
        attendance_entry_mode = 'retroactive'
        and retroactive_source is not null
        and nullif(btrim(retroactive_reason), '') is not null
        and retroactive_entered_by is not null
        and retroactive_entered_at is not null
      )
    );

alter table public.academy_attendance_records
  add column if not exists attendance_source text not null default 'manual',
  add column if not exists zoom_registrant_id text,
  add column if not exists zoom_email text,
  add column if not exists zoom_display_name text,
  add column if not exists zoom_first_join_at timestamptz,
  add column if not exists zoom_last_leave_at timestamptz,
  add column if not exists zoom_duration_minutes integer not null default 0,
  add column if not exists zoom_attendance_percent integer,
  add column if not exists zoom_late_minutes integer not null default 0,
  add column if not exists zoom_classification text,
  add column if not exists zoom_needs_review boolean not null default false,
  add column if not exists zoom_match_method text,
  add column if not exists zoom_last_synced_at timestamptz;

alter table public.academy_attendance_records
  drop constraint if exists academy_attendance_records_source_check,
  drop constraint if exists academy_attendance_records_zoom_classification_check,
  drop constraint if exists academy_attendance_records_zoom_percent_check,
  drop constraint if exists academy_attendance_records_zoom_duration_check,
  drop constraint if exists academy_attendance_records_zoom_late_check;
alter table public.academy_attendance_records
  add constraint academy_attendance_records_source_check
    check (attendance_source in ('manual','zoom_report','zoom_review')),
  add constraint academy_attendance_records_zoom_classification_check
    check (zoom_classification is null or zoom_classification in ('present','late','partial','absent','registration_missing')),
  add constraint academy_attendance_records_zoom_percent_check
    check (zoom_attendance_percent is null or zoom_attendance_percent between 0 and 100),
  add constraint academy_attendance_records_zoom_duration_check
    check (zoom_duration_minutes >= 0),
  add constraint academy_attendance_records_zoom_late_check
    check (zoom_late_minutes >= 0);

create table if not exists public.academy_zoom_attendance_syncs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.academy_attendance_sessions(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  zoom_meeting_id text not null,
  zoom_meeting_uuid text,
  zoom_instance_started_at timestamptz,
  registered_count integer not null default 0,
  zoom_participant_count integer not null default 0,
  matched_student_count integer not null default 0,
  auto_present_count integer not null default 0,
  auto_late_count integer not null default 0,
  auto_absent_count integer not null default 0,
  review_count integer not null default 0,
  unmatched_zoom_count integer not null default 0,
  status text not null default 'running' check (status in ('running','completed','completed_with_review','failed')),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists academy_zoom_attendance_syncs_session_idx
  on public.academy_zoom_attendance_syncs(session_id, created_at desc);

create table if not exists public.academy_zoom_attendance_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.academy_attendance_sessions(id) on delete cascade,
  sync_id uuid not null references public.academy_zoom_attendance_syncs(id) on delete cascade,
  zoom_meeting_id text not null,
  zoom_meeting_uuid text,
  zoom_registrant_id text,
  zoom_user_id text,
  participant_email text,
  participant_name text not null,
  first_join_at timestamptz,
  last_leave_at timestamptz,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  attendance_percent integer check (attendance_percent is null or attendance_percent between 0 and 100),
  late_minutes integer not null default 0 check (late_minutes >= 0),
  classification text check (classification is null or classification in ('present','late','partial','absent')),
  matched_enrollment_id uuid references public.academy_school_enrollments(id) on delete set null,
  match_method text,
  match_reason text,
  is_ignored boolean not null default false,
  ignore_reason text,
  ignored_by uuid references auth.users(id) on delete set null,
  ignored_at timestamptz,
  is_latest boolean not null default true,
  raw_segments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists academy_zoom_attendance_participants_latest_idx
  on public.academy_zoom_attendance_participants(session_id, is_latest, is_ignored, matched_enrollment_id);

create index if not exists academy_attendance_records_zoom_review_idx
  on public.academy_attendance_records(session_id, zoom_needs_review)
  where zoom_needs_review = true;

create table if not exists public.academy_zoom_student_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  zoom_meeting_id text not null,
  enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
  zoom_registrant_id text,
  zoom_email text,
  source text not null default 'automatic' check (source in ('automatic','manual')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_zoom_student_identity_value_check
    check (nullif(btrim(coalesce(zoom_registrant_id,'')), '') is not null or nullif(btrim(coalesce(zoom_email,'')), '') is not null)
);

create index if not exists academy_zoom_student_identities_lookup_idx
  on public.academy_zoom_student_identities(organization_id, school_id, zoom_meeting_id, enrollment_id);
create unique index if not exists academy_zoom_student_identities_registrant_uq
  on public.academy_zoom_student_identities(organization_id, school_id, zoom_meeting_id, zoom_registrant_id)
  where zoom_registrant_id is not null;
create unique index if not exists academy_zoom_student_identities_email_uq
  on public.academy_zoom_student_identities(organization_id, school_id, zoom_meeting_id, lower(zoom_email))
  where zoom_email is not null;

create or replace function public.academy_zoom_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists academy_zoom_attendance_settings_touch on public.academy_zoom_attendance_settings;
create trigger academy_zoom_attendance_settings_touch
before update on public.academy_zoom_attendance_settings
for each row execute function public.academy_zoom_touch_updated_at();

drop trigger if exists academy_zoom_student_identities_touch on public.academy_zoom_student_identities;
create trigger academy_zoom_student_identities_touch
before update on public.academy_zoom_student_identities
for each row execute function public.academy_zoom_touch_updated_at();

alter table public.academy_zoom_attendance_settings enable row level security;
alter table public.academy_zoom_attendance_syncs enable row level security;
alter table public.academy_zoom_attendance_participants enable row level security;
alter table public.academy_zoom_student_identities enable row level security;

revoke all on public.academy_zoom_attendance_settings from anon, authenticated;
revoke all on public.academy_zoom_attendance_syncs from anon, authenticated;
revoke all on public.academy_zoom_attendance_participants from anon, authenticated;
revoke all on public.academy_zoom_student_identities from anon, authenticated;

grant select, insert, update, delete on public.academy_zoom_attendance_settings to service_role;
grant select, insert, update, delete on public.academy_zoom_attendance_syncs to service_role;
grant select, insert, update, delete on public.academy_zoom_attendance_participants to service_role;
grant select, insert, update, delete on public.academy_zoom_student_identities to service_role;

comment on table public.academy_zoom_attendance_settings is
  'Configuration Zoom Smart Attendance par école Academy.';
comment on table public.academy_zoom_attendance_syncs is
  'Journal d audit des synchronisations Zoom vers les feuilles de présence Academy.';
comment on table public.academy_zoom_attendance_participants is
  'Participants Zoom agrégés par synchronisation, y compris ceux qui restent à rapprocher.';
comment on table public.academy_zoom_student_identities is
  'Correspondances persistantes Zoom registrant/email vers une inscription Academy.';

commit;

notify pgrst, 'reload schema';
