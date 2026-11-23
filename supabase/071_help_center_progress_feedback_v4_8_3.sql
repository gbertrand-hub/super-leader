-- Super Leader V4.8.3 — progression et retours du Centre d'aide à l'utilisateur

create table if not exists public.help_guide_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  guide_id text not null check (char_length(guide_id) between 1 and 100),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, guide_id)
);

create table if not exists public.help_guide_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  guide_id text not null check (char_length(guide_id) between 1 and 100),
  helpful boolean not null,
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, guide_id)
);

create index if not exists help_guide_progress_org_status_idx
  on public.help_guide_progress (organization_id, status, updated_at desc);
create index if not exists help_guide_feedback_org_guide_idx
  on public.help_guide_feedback (organization_id, guide_id, updated_at desc);

alter table public.help_guide_progress enable row level security;
alter table public.help_guide_feedback enable row level security;

drop policy if exists "help progress own membership" on public.help_guide_progress;
create policy "help progress own membership" on public.help_guide_progress
  for all to authenticated
  using (
    user_id = auth.uid() and exists (
      select 1 from public.organization_members om
      where om.organization_id = help_guide_progress.organization_id
        and om.user_id = auth.uid() and om.is_active = true
    )
  )
  with check (
    user_id = auth.uid() and exists (
      select 1 from public.organization_members om
      where om.organization_id = help_guide_progress.organization_id
        and om.user_id = auth.uid() and om.is_active = true
    )
  );

drop policy if exists "help feedback own membership" on public.help_guide_feedback;
create policy "help feedback own membership" on public.help_guide_feedback
  for all to authenticated
  using (
    user_id = auth.uid() and exists (
      select 1 from public.organization_members om
      where om.organization_id = help_guide_feedback.organization_id
        and om.user_id = auth.uid() and om.is_active = true
    )
  )
  with check (
    user_id = auth.uid() and exists (
      select 1 from public.organization_members om
      where om.organization_id = help_guide_feedback.organization_id
        and om.user_id = auth.uid() and om.is_active = true
    )
  );

