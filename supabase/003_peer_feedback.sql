-- SUPER LEADER - Module feedback entre collegues V1
-- A executer apres 001_company_team.sql et 002_members_assignment.sql

create table if not exists public.peer_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in (
    'communication','collaboration','leadership','fiabilite',
    'organisation','qualite','service_client','innovation','autre'
  )),
  score smallint not null check (score between 1 and 5),
  strength text not null check (char_length(trim(strength)) between 3 and 1000),
  improvement text check (improvement is null or char_length(trim(improvement)) <= 1000),
  is_anonymous boolean not null default true,
  status text not null default 'published' check (status in ('published','reported','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint peer_feedback_not_self check (sender_id <> recipient_id)
);

create index if not exists peer_feedback_recipient_idx
  on public.peer_feedback (organization_id, recipient_id, created_at desc);

create index if not exists peer_feedback_sender_idx
  on public.peer_feedback (organization_id, sender_id, created_at desc);

alter table public.peer_feedback enable row level security;

-- Les operations passent uniquement par les Server Actions avec la cle serveur.
revoke all on public.peer_feedback from anon, authenticated;
grant select, insert, update, delete on public.peer_feedback to service_role;
