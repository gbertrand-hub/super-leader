-- Super Leader V4.8.6 — registre des annonces officielles

create table if not exists public.official_announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 220),
  body text not null check (char_length(body) between 10 and 12000),
  category text not null default 'direction' check (category in ('direction','hr','finance','platform','event','recognition','urgent')),
  priority text not null default 'normal' check (priority in ('normal','important','urgent')),
  audience_scope text not null default 'organization' check (audience_scope in ('organization','role','department','team')),
  audience_values text[] not null default '{}',
  acknowledgement_required boolean not null default false,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  publish_at timestamptz,
  expires_at timestamptz,
  published_at timestamptz,
  attachment_storage_path text,
  attachment_file_name text,
  attachment_mime_type text,
  attachment_size_bytes bigint,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or publish_at is null or expires_at > publish_at)
);

create table if not exists public.official_announcement_recipients (
  announcement_id uuid not null references public.official_announcements(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_opened_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create table if not exists public.official_announcement_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  announcement_id uuid references public.official_announcements(id) on delete set null,
  actor_id uuid not null references auth.users(id),
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists official_announcements_org_status_idx on public.official_announcements (organization_id,status,published_at desc);
create index if not exists official_announcement_recipients_user_idx on public.official_announcement_recipients (organization_id,user_id,created_at desc);
create index if not exists official_announcement_audit_idx on public.official_announcement_audit_log (organization_id,announcement_id,created_at desc);

alter table public.official_announcements enable row level security;
alter table public.official_announcement_recipients enable row level security;
alter table public.official_announcement_audit_log enable row level security;

drop policy if exists "announcement recipients read published" on public.official_announcements;
create policy "announcement recipients read published" on public.official_announcements for select to authenticated using (
  status = 'published' and exists (select 1 from public.official_announcement_recipients r where r.announcement_id = official_announcements.id and r.user_id = auth.uid())
);
drop policy if exists "announcement recipients own row" on public.official_announcement_recipients;
create policy "announcement recipients own row" on public.official_announcement_recipients for select to authenticated using (user_id = auth.uid());

revoke all on public.official_announcements, public.official_announcement_recipients, public.official_announcement_audit_log from anon, authenticated;
grant select on public.official_announcements, public.official_announcement_recipients to authenticated;
grant all on public.official_announcements, public.official_announcement_recipients, public.official_announcement_audit_log to service_role;
