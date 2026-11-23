-- Super Leader V4.9.0 - Academy monthly recurrence engine
begin;

alter table public.academy_attendance_series
  add column if not exists monthly_ordinal smallint;

alter table public.academy_attendance_series
  drop constraint if exists academy_attendance_series_schedule_type_check;

alter table public.academy_attendance_series
  add constraint academy_attendance_series_schedule_type_check
  check (schedule_type in ('weekly','monthly'));

alter table public.academy_attendance_series
  drop constraint if exists academy_attendance_series_monthly_rule_check;

alter table public.academy_attendance_series
  add constraint academy_attendance_series_monthly_rule_check
  check (
    (schedule_type = 'weekly' and monthly_ordinal is null)
    or
    (schedule_type = 'monthly' and monthly_ordinal in (-1,1,2,3,4) and cardinality(weekdays) = 1)
  );

comment on column public.academy_attendance_series.schedule_type is
  'Type de recurrence: weekly ou monthly.';
comment on column public.academy_attendance_series.monthly_ordinal is
  'Position mensuelle: 1=premier, 2=deuxieme, 3=troisieme, 4=quatrieme, -1=dernier. Le jour est stocke dans weekdays[1].';

commit;
