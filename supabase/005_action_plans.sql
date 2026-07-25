-- SUPER LEADER - Module plans d'action V1
-- A executer apres 001_company_team.sql, 002_members_assignment.sql et 003_peer_feedback.sql

create table if not exists public.action_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_feedback_id uuid references public.peer_feedback(id) on delete set null,
  objective text not null check (char_length(trim(objective)) between 3 and 200),
  action_title text not null check (char_length(trim(action_title)) between 3 and 200),
  description text check (description is null or char_length(trim(description)) <= 2000),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','completed','cancelled')),
  due_date date,
  progress smallint not null default 0 check (progress between 0 and 100),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists action_plans_owner_idx
  on public.action_plans (organization_id, owner_id, status, due_date);

create index if not exists action_plans_creator_idx
  on public.action_plans (organization_id, created_by, created_at desc);

alter table public.action_plans enable row level security;

-- Les operations passent par les Server Actions et la cle serveur.
revoke all on public.action_plans from anon, authenticated;
grant select, insert, update, delete on public.action_plans to service_role;
