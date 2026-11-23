-- SUPER LEADER V4.8.63
-- Communication interne complete
-- Mentions @, reactions et messages vocaux prives.

begin;

-- Extend message types for voice messages.
alter table public.internal_messages
  drop constraint if exists internal_messages_message_type_check;

alter table public.internal_messages
  add constraint internal_messages_message_type_check
  check (message_type in ('text','file','text_file','system','voice','text_voice'));

-- Voice metadata stays attached to the private message attachment.
alter table public.internal_message_attachments
  add column if not exists voice_duration_seconds integer;

alter table public.internal_message_attachments
  drop constraint if exists internal_message_attachments_voice_duration_check;

alter table public.internal_message_attachments
  add constraint internal_message_attachments_voice_duration_check
  check (voice_duration_seconds is null or voice_duration_seconds between 1 and 300);

create table if not exists public.internal_message_mentions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.internal_conversations(id) on delete cascade,
  message_id uuid not null references public.internal_messages(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (message_id, mentioned_user_id)
);

create index if not exists internal_message_mentions_user_idx
  on public.internal_message_mentions (organization_id, mentioned_user_id, created_at desc);
create index if not exists internal_message_mentions_message_idx
  on public.internal_message_mentions (message_id, mentioned_user_id);

create table if not exists public.internal_message_reactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.internal_conversations(id) on delete cascade,
  message_id uuid not null references public.internal_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('👍','❤️','👏','✅','😂')),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists internal_message_reactions_message_idx
  on public.internal_message_reactions (message_id, created_at);
create index if not exists internal_message_reactions_user_idx
  on public.internal_message_reactions (organization_id, user_id, created_at desc);

alter table public.internal_message_mentions enable row level security;
alter table public.internal_message_reactions enable row level security;

drop policy if exists "internal mentions visible to participants" on public.internal_message_mentions;
create policy "internal mentions visible to participants"
on public.internal_message_mentions for select to authenticated
using (public.is_internal_conversation_member(conversation_id, auth.uid()));

drop policy if exists "internal reactions visible to participants" on public.internal_message_reactions;
create policy "internal reactions visible to participants"
on public.internal_message_reactions for select to authenticated
using (public.is_internal_conversation_member(conversation_id, auth.uid()));

grant select on public.internal_message_mentions to authenticated;
grant select on public.internal_message_reactions to authenticated;

grant select, insert, update, delete on public.internal_message_mentions to service_role;
grant select, insert, update, delete on public.internal_message_reactions to service_role;

-- Realtime is useful for reactions/mentions when enabled on the project.
do $$
begin
  execute 'alter publication supabase_realtime add table public.internal_message_reactions';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  execute 'alter publication supabase_realtime add table public.internal_message_mentions';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

commit;

notify pgrst, 'reload schema';
