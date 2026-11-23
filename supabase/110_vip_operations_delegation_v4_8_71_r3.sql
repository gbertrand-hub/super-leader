begin;

alter table if exists public.vip_program_settings
  add column if not exists vip_communications_assistant_user_id uuid,
  add column if not exists vip_events_travel_assistant_user_id uuid,
  add column if not exists vip_benefits_partners_assistant_user_id uuid,
  add column if not exists vip_membership_concierge_assistant_user_id uuid,
  add column if not exists vip_operations_require_backup_for_critical boolean not null default true,
  add column if not exists vip_operations_escalation_hours integer not null default 24;

create table if not exists public.vip_operational_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  title text not null,
  description text,
  category text not null default 'general' check (category in ('communications','events_travel','benefits_partners','membership_concierge','general')),
  priority text not null default 'normal' check (priority in ('normal','important','critical')),
  status text not null default 'open' check (status in ('open','in_progress','blocked','completed','cancelled')),
  owner_user_id uuid,
  backup_user_id uuid,
  due_at timestamptz,
  source_type text,
  source_id uuid,
  escalation_level integer not null default 0,
  last_escalated_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vip_operational_tasks_owner_backup_different check (owner_user_id is null or backup_user_id is null or owner_user_id <> backup_user_id)
);

create index if not exists vip_operational_tasks_org_status_idx on public.vip_operational_tasks(organization_id,status);
create index if not exists vip_operational_tasks_org_due_idx on public.vip_operational_tasks(organization_id,due_at);
create index if not exists vip_operational_tasks_owner_idx on public.vip_operational_tasks(owner_user_id,status);
create index if not exists vip_operational_tasks_backup_idx on public.vip_operational_tasks(backup_user_id,status);

create table if not exists public.vip_operational_task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.vip_operational_tasks(id) on delete cascade,
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists vip_operational_task_history_task_idx on public.vip_operational_task_history(task_id,created_at desc);

alter table public.vip_operational_tasks enable row level security;
alter table public.vip_operational_task_history enable row level security;

commit;
