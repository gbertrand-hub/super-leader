-- Super Leader V4.7.3
-- Advanced organization rules for daily priorities.

alter table public.daily_execution_settings
  add column if not exists maximum_critical_tasks smallint not null default 2,
  add column if not exists require_due_time_for_high_priority boolean not null default false,
  add column if not exists require_category_for_critical boolean not null default false;

alter table public.daily_execution_settings
  drop constraint if exists daily_execution_settings_maximum_critical_tasks_check;

alter table public.daily_execution_settings
  add constraint daily_execution_settings_maximum_critical_tasks_check
  check (maximum_critical_tasks between 1 and 12 and maximum_critical_tasks <= maximum_tasks);

comment on column public.daily_execution_settings.maximum_critical_tasks is 'Maximum number of critical priorities allowed in one daily plan.';
comment on column public.daily_execution_settings.require_due_time_for_high_priority is 'Requires a due time for high and critical daily priorities.';
comment on column public.daily_execution_settings.require_category_for_critical is 'Requires a category for critical daily priorities.';

notify pgrst, 'reload schema';
