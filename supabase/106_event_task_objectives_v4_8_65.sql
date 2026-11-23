-- Super Leader V4.8.65
-- Gestion par objectifs des tâches événementielles.
-- Objectif: chaque tâche doit exprimer un résultat attendu et peut être mesurée dans le temps.

begin;

alter table public.event_tasks
  add column if not exists objective_text text,
  add column if not exists objective_measurement_type text,
  add column if not exists objective_kpi_label text,
  add column if not exists objective_target_value numeric(16,2),
  add column if not exists objective_current_value numeric(16,2),
  add column if not exists objective_unit text;

-- Preserve historical tasks: use their description when available, otherwise their title.
update public.event_tasks
set objective_text = coalesce(nullif(btrim(objective_text), ''), nullif(btrim(description), ''), title)
where objective_text is null or btrim(objective_text) = '';

update public.event_tasks
set objective_measurement_type = coalesce(nullif(btrim(objective_measurement_type), ''), 'qualitative'),
    objective_current_value = coalesce(objective_current_value, case when status = 'done' then 100 else progress end)
where objective_measurement_type is null
   or btrim(objective_measurement_type) = ''
   or objective_current_value is null;

alter table public.event_tasks
  alter column objective_text set not null,
  alter column objective_measurement_type set default 'qualitative',
  alter column objective_measurement_type set not null,
  alter column objective_current_value set default 0,
  alter column objective_current_value set not null;

alter table public.event_tasks drop constraint if exists event_tasks_objective_measurement_type_check;
alter table public.event_tasks
  add constraint event_tasks_objective_measurement_type_check
  check (objective_measurement_type in ('quantity','percentage','currency','yes_no','qualitative'));

alter table public.event_tasks drop constraint if exists event_tasks_objective_target_nonnegative_check;
alter table public.event_tasks
  add constraint event_tasks_objective_target_nonnegative_check
  check (objective_target_value is null or objective_target_value >= 0);

alter table public.event_tasks drop constraint if exists event_tasks_objective_current_nonnegative_check;
alter table public.event_tasks
  add constraint event_tasks_objective_current_nonnegative_check
  check (objective_current_value >= 0);

create table if not exists public.event_task_objective_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  task_id uuid not null references public.event_tasks(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  current_value numeric(16,2) not null default 0 check (current_value >= 0),
  note text,
  proof_url text,
  created_at timestamptz not null default now()
);

create index if not exists event_task_objective_updates_task_idx
  on public.event_task_objective_updates (task_id, created_at desc);
create index if not exists event_task_objective_updates_event_idx
  on public.event_task_objective_updates (event_id, created_at desc);

alter table public.event_task_objective_updates enable row level security;

drop policy if exists "event objective updates visible by event scope" on public.event_task_objective_updates;
create policy "event objective updates visible by event scope"
on public.event_task_objective_updates
for select to authenticated
using (public.can_view_event(event_id));

-- Writes are performed by validated server actions using the service role.
revoke all on public.event_task_objective_updates from anon, authenticated;
grant select on public.event_task_objective_updates to authenticated;
grant all on public.event_task_objective_updates to service_role;

-- Seed one history point for historical tasks so their objective dashboard has an audit baseline.
insert into public.event_task_objective_updates (
  organization_id, event_id, task_id, actor_id, current_value, note, created_at
)
select
  task.organization_id,
  task.event_id,
  task.id,
  task.created_by,
  coalesce(task.objective_current_value, 0),
  'Baseline V4.8.65',
  coalesce(task.updated_at, task.created_at, now())
from public.event_tasks task
where not exists (
  select 1 from public.event_task_objective_updates u where u.task_id = task.id
);

commit;
