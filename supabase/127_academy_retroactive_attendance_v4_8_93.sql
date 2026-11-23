-- Super Leader V4.8.93 - Saisie auditee des presences passees
begin;

alter table public.academy_attendance_sessions
  add column if not exists attendance_entry_mode text not null default 'live',
  add column if not exists retroactive_source text,
  add column if not exists retroactive_reason text,
  add column if not exists retroactive_entered_by uuid references auth.users(id) on delete set null,
  add column if not exists retroactive_entered_at timestamptz;

alter table public.academy_attendance_sessions
  drop constraint if exists academy_attendance_sessions_entry_mode_check,
  drop constraint if exists academy_attendance_sessions_retroactive_source_check,
  drop constraint if exists academy_attendance_sessions_retroactive_reason_check,
  drop constraint if exists academy_attendance_sessions_retroactive_metadata_check;

alter table public.academy_attendance_sessions
  add constraint academy_attendance_sessions_entry_mode_check
    check (attendance_entry_mode in ('live','retroactive')),
  add constraint academy_attendance_sessions_retroactive_source_check
    check (retroactive_source is null or retroactive_source in ('paper_sheet','manual_register','other')),
  add constraint academy_attendance_sessions_retroactive_reason_check
    check (retroactive_reason is null or char_length(retroactive_reason) <= 1000),
  add constraint academy_attendance_sessions_retroactive_metadata_check
    check (
      attendance_entry_mode = 'live'
      or (
        attendance_entry_mode = 'retroactive'
        and retroactive_source is not null
        and nullif(btrim(retroactive_reason), '') is not null
        and retroactive_entered_by is not null
        and retroactive_entered_at is not null
      )
    );

comment on column public.academy_attendance_sessions.attendance_entry_mode is
  'live = appel saisi pendant/apres une seance actuelle; retroactive = appel reporte pour une date passee avec audit.';
comment on column public.academy_attendance_sessions.retroactive_source is
  'Source de la saisie passee: paper_sheet, manual_register ou other.';
comment on column public.academy_attendance_sessions.retroactive_reason is
  'Motif expliquant pourquoi les presences ont ete saisies apres la date de la seance.';
comment on column public.academy_attendance_sessions.retroactive_entered_by is
  'Utilisateur ayant ouvert/cree la saisie retroactive.';
comment on column public.academy_attendance_sessions.retroactive_entered_at is
  'Horodatage reel de la saisie retroactive.';

commit;
