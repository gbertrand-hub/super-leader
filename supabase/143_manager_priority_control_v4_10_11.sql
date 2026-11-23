-- Super Leader v4.10.11
-- Manager Priority Control & Audit
-- Allows authorized leaders to reprioritize an employee-authored daily priority
-- while preserving source ownership, employee visibility and a complete audit trail.

begin;

alter table public.daily_work_tasks
  add column if not exists manager_controlled boolean not null default false,
  add column if not exists manager_modified_by uuid references auth.users(id) on delete set null,
  add column if not exists manager_modified_at timestamptz,
  add column if not exists manager_change_reason text,
  add column if not exists manager_revision_count integer not null default 0,
  add column if not exists manager_removed_by uuid references auth.users(id) on delete set null,
  add column if not exists manager_removed_at timestamptz,
  add column if not exists manager_removed_reason text;

alter table public.daily_work_tasks
  drop constraint if exists daily_work_tasks_manager_revision_count_check;
alter table public.daily_work_tasks
  add constraint daily_work_tasks_manager_revision_count_check
  check (manager_revision_count >= 0);

alter table public.daily_work_tasks
  drop constraint if exists daily_work_tasks_manager_change_reason_check;
alter table public.daily_work_tasks
  add constraint daily_work_tasks_manager_change_reason_check
  check (manager_change_reason is null or char_length(btrim(manager_change_reason)) <= 1000);

alter table public.daily_work_tasks
  drop constraint if exists daily_work_tasks_manager_removed_reason_check;
alter table public.daily_work_tasks
  add constraint daily_work_tasks_manager_removed_reason_check
  check (manager_removed_reason is null or char_length(btrim(manager_removed_reason)) <= 1000);

create index if not exists daily_work_tasks_manager_control_idx
  on public.daily_work_tasks (organization_id, work_date desc, manager_controlled)
  where manager_controlled = true;

comment on column public.daily_work_tasks.manager_controlled is
  'True when a manager or authorized leader has changed the employee-authored priority. Employee plan revisions must preserve the manager-controlled content.';
comment on column public.daily_work_tasks.manager_change_reason is
  'Business reason for the latest manager change to the employee-authored priority.';
comment on column public.daily_work_tasks.manager_removed_at is
  'When set, the priority was removed from the active day by an authorized leader and cannot be restored by the employee.';

notify pgrst, 'reload schema';
commit;
