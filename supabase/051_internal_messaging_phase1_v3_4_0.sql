-- SUPER LEADER V3.4.0
-- Messagerie interne - Phase 1
-- Conversations directes, canaux d'equipe/departement, pieces jointes privees,
-- statuts de lecture, archivage, sourdine, notifications et audit.
-- A executer apres la migration 050.

begin;

create extension if not exists pgcrypto;

create table if not exists public.internal_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('direct','team','department')),
  title text,
  direct_pair_key text,
  team_id uuid references public.teams(id) on delete cascade,
  department text,
  created_by uuid not null references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_conversations_shape_check check (
    (kind = 'direct' and direct_pair_key is not null and team_id is null and department is null)
    or (kind = 'team' and team_id is not null and direct_pair_key is null and department is null)
    or (kind = 'department' and department is not null and btrim(department) <> '' and direct_pair_key is null and team_id is null)
  )
);

create unique index if not exists internal_conversations_direct_unique
  on public.internal_conversations (organization_id, direct_pair_key)
  where kind = 'direct' and is_active = true;

create unique index if not exists internal_conversations_team_unique
  on public.internal_conversations (organization_id, team_id)
  where kind = 'team' and is_active = true;

create unique index if not exists internal_conversations_department_unique
  on public.internal_conversations (organization_id, lower(btrim(department)))
  where kind = 'department' and is_active = true;

create index if not exists internal_conversations_org_activity_idx
  on public.internal_conversations (organization_id, is_active, last_message_at desc nulls last, created_at desc);

create table if not exists public.internal_conversation_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.internal_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner','member')),
  is_muted boolean not null default false,
  archived_at timestamptz,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create index if not exists internal_conversation_members_user_idx
  on public.internal_conversation_members (organization_id, user_id, archived_at, updated_at desc);

create index if not exists internal_conversation_members_conversation_idx
  on public.internal_conversation_members (conversation_id, left_at, user_id);

create table if not exists public.internal_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.internal_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  body text not null default '' check (char_length(body) <= 5000),
  message_type text not null default 'text' check (message_type in ('text','file','text_file','system')),
  sent_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists internal_messages_conversation_idx
  on public.internal_messages (conversation_id, sent_at desc, id desc)
  where deleted_at is null;

create index if not exists internal_messages_sender_idx
  on public.internal_messages (organization_id, sender_id, sent_at desc);

create table if not exists public.internal_message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.internal_conversations(id) on delete cascade,
  message_id uuid not null references public.internal_messages(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  unique (message_id, storage_path)
);

create index if not exists internal_message_attachments_message_idx
  on public.internal_message_attachments (message_id, created_at);

create table if not exists public.internal_message_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.internal_conversations(id) on delete cascade,
  message_id uuid not null references public.internal_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index if not exists internal_message_receipts_unread_idx
  on public.internal_message_receipts (organization_id, user_id, conversation_id, created_at desc)
  where read_at is null;

create index if not exists internal_message_receipts_message_idx
  on public.internal_message_receipts (message_id, read_at);

create table if not exists public.internal_messaging_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.internal_conversations(id) on delete set null,
  message_id uuid references public.internal_messages(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists internal_messaging_audit_org_idx
  on public.internal_messaging_audit_log (organization_id, created_at desc);

create or replace function public.internal_messaging_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_internal_conversations_updated_at on public.internal_conversations;
create trigger set_internal_conversations_updated_at
before update on public.internal_conversations
for each row execute function public.internal_messaging_set_updated_at();

drop trigger if exists set_internal_conversation_members_updated_at on public.internal_conversation_members;
create trigger set_internal_conversation_members_updated_at
before update on public.internal_conversation_members
for each row execute function public.internal_messaging_set_updated_at();

create or replace function public.internal_messaging_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.internal_conversations
  set last_message_at = new.sent_at,
      updated_at = now()
  where id = new.conversation_id
    and organization_id = new.organization_id;
  return new;
end;
$$;

drop trigger if exists touch_internal_conversation_after_message on public.internal_messages;
create trigger touch_internal_conversation_after_message
after insert on public.internal_messages
for each row execute function public.internal_messaging_touch_conversation();

create or replace function public.is_internal_conversation_member(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.internal_conversation_members cm
    join public.internal_conversations c on c.id = cm.conversation_id
    join public.organization_members om
      on om.organization_id = c.organization_id
     and om.user_id = p_user_id
     and om.is_active = true
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
      and cm.left_at is null
      and c.is_active = true
  );
$$;

alter table public.internal_conversations enable row level security;
alter table public.internal_conversation_members enable row level security;
alter table public.internal_messages enable row level security;
alter table public.internal_message_attachments enable row level security;
alter table public.internal_message_receipts enable row level security;
alter table public.internal_messaging_audit_log enable row level security;

drop policy if exists "internal conversations visible to participants" on public.internal_conversations;
create policy "internal conversations visible to participants"
on public.internal_conversations for select to authenticated
using (public.is_internal_conversation_member(id, auth.uid()));

drop policy if exists "internal conversation members visible to participants" on public.internal_conversation_members;
create policy "internal conversation members visible to participants"
on public.internal_conversation_members for select to authenticated
using (public.is_internal_conversation_member(conversation_id, auth.uid()));

drop policy if exists "internal messages visible to participants" on public.internal_messages;
create policy "internal messages visible to participants"
on public.internal_messages for select to authenticated
using (public.is_internal_conversation_member(conversation_id, auth.uid()));

drop policy if exists "internal attachments visible to participants" on public.internal_message_attachments;
create policy "internal attachments visible to participants"
on public.internal_message_attachments for select to authenticated
using (public.is_internal_conversation_member(conversation_id, auth.uid()));

drop policy if exists "internal receipts visible to own user" on public.internal_message_receipts;
create policy "internal receipts visible to own user"
on public.internal_message_receipts for select to authenticated
using (
  user_id = auth.uid()
  or public.is_internal_conversation_member(conversation_id, auth.uid())
);

drop policy if exists "internal audit visible to organization administrators" on public.internal_messaging_audit_log;
create policy "internal audit visible to organization administrators"
on public.internal_messaging_audit_log for select to authenticated
using (public.has_active_org_role(organization_id, array['owner','admin']));

revoke all on public.internal_conversations from anon, authenticated;
revoke all on public.internal_conversation_members from anon, authenticated;
revoke all on public.internal_messages from anon, authenticated;
revoke all on public.internal_message_attachments from anon, authenticated;
revoke all on public.internal_message_receipts from anon, authenticated;
revoke all on public.internal_messaging_audit_log from anon, authenticated;

grant select on public.internal_conversations to authenticated;
grant select on public.internal_conversation_members to authenticated;
grant select on public.internal_messages to authenticated;
grant select on public.internal_message_attachments to authenticated;
grant select on public.internal_message_receipts to authenticated;
grant select on public.internal_messaging_audit_log to authenticated;

grant select, insert, update, delete on public.internal_conversations to service_role;
grant select, insert, update, delete on public.internal_conversation_members to service_role;
grant select, insert, update, delete on public.internal_messages to service_role;
grant select, insert, update, delete on public.internal_message_attachments to service_role;
grant select, insert, update, delete on public.internal_message_receipts to service_role;
grant select, insert, update, delete on public.internal_messaging_audit_log to service_role;

revoke all on function public.is_internal_conversation_member(uuid,uuid) from public;
grant execute on function public.is_internal_conversation_member(uuid,uuid) to authenticated, service_role;

-- Realtime is optional for future phases. Ignore the duplicate-object error when
-- the table has already been added to the publication.
do $$
begin
  execute 'alter publication supabase_realtime add table public.internal_messages';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

commit;

notify pgrst, 'reload schema';
