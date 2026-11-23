-- SUPER LEADER V4.7.0 - Rappels progressifs des rapports journaliers
-- A executer apres 068.

begin;

alter table public.performance_settings
  add column if not exists report_reminders_enabled boolean not null default true,
  add column if not exists report_first_reminder_minutes integer not null default 120,
  add column if not exists report_urgent_reminder_minutes integer not null default 30,
  add column if not exists report_supervisor_escalation_enabled boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'performance_report_first_reminder_minutes_check') then
    alter table public.performance_settings
      add constraint performance_report_first_reminder_minutes_check
      check (report_first_reminder_minutes between 30 and 720);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'performance_report_urgent_reminder_minutes_check') then
    alter table public.performance_settings
      add constraint performance_report_urgent_reminder_minutes_check
      check (report_urgent_reminder_minutes between 5 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'performance_report_reminder_order_check') then
    alter table public.performance_settings
      add constraint performance_report_reminder_order_check
      check (report_first_reminder_minutes > report_urgent_reminder_minutes);
  end if;
end $$;

comment on column public.performance_settings.report_first_reminder_minutes is
  'Minutes avant l heure limite pour le premier rappel automatique.';
comment on column public.performance_settings.report_urgent_reminder_minutes is
  'Minutes avant l heure limite pour le rappel urgent automatique.';

commit;

notify pgrst, 'reload schema';
