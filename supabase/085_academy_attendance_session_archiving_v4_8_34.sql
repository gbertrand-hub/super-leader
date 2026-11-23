-- Super Leader V4.8.34 - Archivage sécurisé des séances Academy
begin;

alter table public.academy_attendance_sessions
  drop constraint if exists academy_attendance_sessions_status_check;

alter table public.academy_attendance_sessions
  add constraint academy_attendance_sessions_status_check
  check (status in ('planned','open','closed','cancelled','archived'));

commit;
