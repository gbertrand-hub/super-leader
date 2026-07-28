-- SUPER LEADER V2.6.3 - Evenements et equipes temporaires
-- A executer apres 033_day_report_time_governance_v2_6.sql

begin;

create extension if not exists pgcrypto;

insert into public.subscription_features (
  feature_key,name_fr,name_en,description_fr,description_en,category,value_type,sort_order
)
values (
  'events',
  'Evenements et equipes de mission',
  'Events and mission teams',
  'Organisation des conferences, equipes temporaires, taches et planning evenementiel.',
  'Conference operations, temporary teams, tasks and event schedules.',
  'operations',
  'boolean',
  65
)
on conflict (feature_key) do update set
  name_fr = excluded.name_fr,
  name_en = excluded.name_en,
  description_fr = excluded.description_fr,
  description_en = excluded.description_en,
  category = excluded.category,
  value_type = excluded.value_type,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.subscription_plan_features (plan_id,feature_key,enabled,limit_value,updated_at)
select
  plan.id,
  'events',
  plan.code in ('legacy_full_access','growth','enterprise'),
  null,
  now()
from public.subscription_plans plan
on conflict (plan_id,feature_key) do update set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value,
  updated_at = now();

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 180),
  event_type text not null default 'conference' check (event_type in (
    'conference','masterclass','training','ceremony','networking','community','other'
  )),
  status text not null default 'planning' check (status in (
    'draft','planning','open','in_progress','completed','cancelled','archived'
  )),
  description text,
  objectives text,
  country text,
  city text,
  venue text,
  timezone text not null default 'Europe/Dublin',
  start_at timestamptz not null,
  end_at timestamptz not null,
  expected_participants integer not null default 0 check (expected_participants >= 0),
  budget_amount numeric(14,2),
  currency text not null default 'USD' check (char_length(currency) = 3),
  leader_id uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  archived_at timestamptz,
  check (end_at > start_at)
);

create index if not exists events_org_status_start_idx
  on public.events (organization_id,status,start_at);
create index if not exists events_org_leader_idx
  on public.events (organization_id,leader_id,start_at desc);

create table if not exists public.event_team_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_role text not null default 'Membre',
  unit_name text,
  responsibilities text,
  can_manage boolean not null default false,
  status text not null default 'assigned' check (status in ('assigned','confirmed','declined','removed')),
  starts_at timestamptz,
  ends_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id,user_id)
);

create index if not exists event_team_members_event_status_idx
  on public.event_team_members (event_id,status,user_id);
create index if not exists event_team_members_user_idx
  on public.event_team_members (organization_id,user_id,status);

create table if not exists public.event_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 200),
  description text,
  milestone text,
  assignee_id uuid references auth.users(id) on delete set null,
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','done','cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  due_at timestamptz,
  budget_estimate numeric(14,2),
  actual_cost numeric(14,2),
  currency text not null default 'USD' check (char_length(currency) = 3),
  proof_url text,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists event_tasks_event_status_idx
  on public.event_tasks (event_id,status,due_at);
create index if not exists event_tasks_assignee_idx
  on public.event_tasks (organization_id,assignee_id,status,due_at);

create table if not exists public.event_schedule_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 200),
  item_type text not null default 'session' check (item_type in (
    'meeting','session','travel','logistics','rehearsal','setup','break','other'
  )),
  start_at timestamptz not null,
  end_at timestamptz not null,
  location text,
  meeting_url text,
  unit_name text,
  owner_id uuid references auth.users(id) on delete set null,
  status text not null default 'planned' check (status in ('planned','confirmed','completed','cancelled')),
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create index if not exists event_schedule_event_start_idx
  on public.event_schedule_items (event_id,start_at,status);
create index if not exists event_schedule_owner_start_idx
  on public.event_schedule_items (organization_id,owner_id,start_at);

create table if not exists public.event_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null,
  category text not null default 'other' check (category in (
    'contract','quote','invoice','programme','marketing','travel','hotel','presentation','photo_video','report','other'
  )),
  document_url text not null,
  notes text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists event_documents_event_created_idx
  on public.event_documents (event_id,created_at desc);

create table if not exists public.event_closure_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null unique references public.events(id) on delete cascade,
  actual_participants integer not null default 0 check (actual_participants >= 0),
  revenue_amount numeric(14,2),
  expense_amount numeric(14,2),
  currency text not null default 'USD' check (char_length(currency) = 3),
  objectives_achieved text,
  highlights text,
  incidents text,
  lessons_learned text,
  recommendations text,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.event_activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists event_activity_event_created_idx
  on public.event_activity_log (event_id,created_at desc);

create or replace function public.event_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
before update on public.events
for each row execute function public.event_touch_updated_at();

drop trigger if exists event_team_members_touch_updated_at on public.event_team_members;
create trigger event_team_members_touch_updated_at
before update on public.event_team_members
for each row execute function public.event_touch_updated_at();

drop trigger if exists event_tasks_touch_updated_at on public.event_tasks;
create trigger event_tasks_touch_updated_at
before update on public.event_tasks
for each row execute function public.event_touch_updated_at();

drop trigger if exists event_schedule_touch_updated_at on public.event_schedule_items;
create trigger event_schedule_touch_updated_at
before update on public.event_schedule_items
for each row execute function public.event_touch_updated_at();

drop trigger if exists event_reports_touch_updated_at on public.event_closure_reports;
create trigger event_reports_touch_updated_at
before update on public.event_closure_reports
for each row execute function public.event_touch_updated_at();

create or replace function public.can_view_event(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events event_record
    where event_record.id = target_event_id
      and exists (
        select 1
        from public.organization_members membership
        where membership.organization_id = event_record.organization_id
          and membership.user_id = auth.uid()
          and membership.is_active = true
      )
      and (
        public.has_active_org_role(event_record.organization_id,array['owner','admin','hr'])
        or event_record.leader_id = auth.uid()
        or exists (
          select 1
          from public.event_team_members event_member
          where event_member.event_id = event_record.id
            and event_member.user_id = auth.uid()
            and event_member.status in ('assigned','confirmed')
        )
      )
  );
$$;

create or replace function public.can_manage_event(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events event_record
    where event_record.id = target_event_id
      and (
        public.has_active_org_role(event_record.organization_id,array['owner','admin','hr'])
        or event_record.leader_id = auth.uid()
        or exists (
          select 1
          from public.event_team_members event_member
          where event_member.event_id = event_record.id
            and event_member.user_id = auth.uid()
            and event_member.can_manage = true
            and event_member.status in ('assigned','confirmed')
        )
      )
  );
$$;

alter table public.events enable row level security;
alter table public.event_team_members enable row level security;
alter table public.event_tasks enable row level security;
alter table public.event_schedule_items enable row level security;
alter table public.event_documents enable row level security;
alter table public.event_closure_reports enable row level security;
alter table public.event_activity_log enable row level security;

drop policy if exists "events visible by mission scope" on public.events;
create policy "events visible by mission scope" on public.events
for select to authenticated using (public.can_view_event(id));

drop policy if exists "events created by admins" on public.events;
create policy "events created by admins" on public.events
for insert to authenticated with check (
  public.has_active_org_role(organization_id,array['owner','admin','hr'])
  and created_by = auth.uid()
);

drop policy if exists "events updated by event managers" on public.events;
create policy "events updated by event managers" on public.events
for update to authenticated using (public.can_manage_event(id))
with check (public.can_manage_event(id));

drop policy if exists "events deleted by admins" on public.events;
create policy "events deleted by admins" on public.events
for delete to authenticated using (
  public.has_active_org_role(organization_id,array['owner','admin'])
);

-- Child-table policies.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'event_team_members','event_tasks','event_schedule_items','event_documents','event_closure_reports'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || ' visible by event scope', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_view_event(event_id))',
      table_name || ' visible by event scope', table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || ' managed by event managers', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id))',
      table_name || ' managed by event managers', table_name
    );
  end loop;
end;
$$;

-- An assignee may update only through server-side validation; the service-role action enforces the exact fields.

drop policy if exists "event activity visible by event scope" on public.event_activity_log;
create policy "event activity visible by event scope" on public.event_activity_log
for select to authenticated using (public.can_view_event(event_id));

revoke all on public.events from anon,authenticated;
revoke all on public.event_team_members from anon,authenticated;
revoke all on public.event_tasks from anon,authenticated;
revoke all on public.event_schedule_items from anon,authenticated;
revoke all on public.event_documents from anon,authenticated;
revoke all on public.event_closure_reports from anon,authenticated;
revoke all on public.event_activity_log from anon,authenticated;

grant select,insert,update,delete on public.events to authenticated;
grant select,insert,update,delete on public.event_team_members to authenticated;
grant select,insert,update,delete on public.event_tasks to authenticated;
grant select,insert,update,delete on public.event_schedule_items to authenticated;
grant select,insert,update,delete on public.event_documents to authenticated;
grant select,insert,update,delete on public.event_closure_reports to authenticated;
grant select on public.event_activity_log to authenticated;
grant all on public.events to service_role;
grant all on public.event_team_members to service_role;
grant all on public.event_tasks to service_role;
grant all on public.event_schedule_items to service_role;
grant all on public.event_documents to service_role;
grant all on public.event_closure_reports to service_role;
grant all on public.event_activity_log to service_role;

grant execute on function public.can_view_event(uuid) to authenticated,service_role;
grant execute on function public.can_manage_event(uuid) to authenticated,service_role;

commit;
notify pgrst, 'reload schema';
