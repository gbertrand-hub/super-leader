-- SUPER LEADER - Module Reconnaissance V1
-- A executer apres 001_company_team.sql, 002_members_assignment.sql et 003_peer_feedback.sql

create table if not exists public.recognitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  badge text not null check (badge in (
    'leadership','teamwork','service','innovation',
    'reliability','communication','courage','excellence'
  )),
  message text not null check (char_length(trim(message)) between 3 and 600),
  visibility text not null default 'private' check (visibility in ('private','team')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recognitions_not_self check (sender_id <> recipient_id)
);

create index if not exists recognitions_recipient_idx
  on public.recognitions (organization_id, recipient_id, created_at desc);

create index if not exists recognitions_sender_idx
  on public.recognitions (organization_id, sender_id, created_at desc);

alter table public.recognitions enable row level security;

-- Les operations passent uniquement par les Server Actions avec la cle serveur.
revoke all on public.recognitions from anon, authenticated;
grant select, insert, update, delete on public.recognitions to service_role;

notify pgrst, 'reload schema';
