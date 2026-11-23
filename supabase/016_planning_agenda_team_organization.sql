-- SUPER LEADER - Planning, Agenda & Organisation des equipes V1
-- A executer apres 012_performance_employee_of_month.sql et 015_notifications_center.sql

create extension if not exists pgcrypto;

create table if not exists public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  timezone text not null default 'Europe/Dublin',
  start_time time,
  end_time time,
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 180),
  report_deadline_time time,
  work_mode text not null default 'onsite' check (work_mode in ('onsite','remote','hybrid','off')),
  location text,
  report_required boolean not null default true,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (work_mode = 'off' and start_time is null and end_time is null)
    or
    (work_mode <> 'off' and start_time is not null and end_time is not null and end_time > start_time)
  )
);

create table if not exists public.work_schedule_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  timezone text not null default 'Europe/Dublin',
  start_time time,
  end_time time,
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 180),
  report_deadline_time time,
  work_mode text not null default 'onsite' check (work_mode in ('onsite','remote','hybrid','off')),
  location text,
  supervisor_id uuid references auth.users(id) on delete set null,
  report_required boolean not null default true,
  status text not null default 'draft' check (status in ('draft','published','cancelled')),
  source text not null default 'manual' check (source in ('manual','template','rotation','import')),
  template_id uuid references public.schedule_templates(id) on delete set null,
  notes text,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, work_date),
  check (
    (work_mode = 'off' and start_time is null and end_time is null and report_required = false)
    or
    (work_mode <> 'off' and start_time is not null and end_time is not null and end_time > start_time)
  )
);

create table if not exists public.schedule_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_entry_id uuid references public.work_schedule_entries(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  subject_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists work_schedule_entries_org_date_idx
  on public.work_schedule_entries (organization_id, work_date, status);
create index if not exists work_schedule_entries_user_date_idx
  on public.work_schedule_entries (user_id, work_date desc);
create index if not exists work_schedule_entries_supervisor_idx
  on public.work_schedule_entries (organization_id, supervisor_id, work_date);
create index if not exists schedule_templates_org_active_idx
  on public.schedule_templates (organization_id, is_active, name);
create index if not exists schedule_audit_org_created_idx
  on public.schedule_audit_log (organization_id, created_at desc);

create or replace function public.schedule_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_schedule_templates_updated_at on public.schedule_templates;
create trigger set_schedule_templates_updated_at
before update on public.schedule_templates
for each row execute function public.schedule_set_updated_at();

drop trigger if exists set_work_schedule_entries_updated_at on public.work_schedule_entries;
create trigger set_work_schedule_entries_updated_at
before update on public.work_schedule_entries
for each row execute function public.schedule_set_updated_at();

create or replace function public.notify_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title_fr text;
  v_title_en text;
  v_body_fr text;
  v_body_en text;
  v_event text;
  v_priority text := 'info';
  v_date_text text;
begin
  v_date_text := to_char(new.work_date, 'DD/MM/YYYY');

  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    v_event := 'schedule_published';
    v_title_fr := 'Nouveau planning publie';
    v_title_en := 'New schedule published';
    v_body_fr := case when new.work_mode = 'off'
      then 'La journee du ' || v_date_text || ' est marquee comme jour de repos.'
      else 'Ton horaire du ' || v_date_text || ' est disponible dans Super Leader.' end;
    v_body_en := case when new.work_mode = 'off'
      then 'The day ' || v_date_text || ' is marked as a day off.'
      else 'Your schedule for ' || v_date_text || ' is now available in Super Leader.' end;
  elsif new.status = 'cancelled' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    v_event := 'schedule_cancelled';
    v_title_fr := 'Planning annule';
    v_title_en := 'Schedule cancelled';
    v_body_fr := 'Ton planning du ' || v_date_text || ' a ete annule.';
    v_body_en := 'Your schedule for ' || v_date_text || ' has been cancelled.';
    v_priority := 'warning';
  elsif tg_op = 'UPDATE' and new.status = 'published' and (
    old.start_time is distinct from new.start_time or
    old.end_time is distinct from new.end_time or
    old.work_mode is distinct from new.work_mode or
    old.location is distinct from new.location or
    old.report_required is distinct from new.report_required
  ) then
    v_event := 'schedule_updated';
    v_title_fr := 'Planning modifie';
    v_title_en := 'Schedule updated';
    v_body_fr := 'Ton planning du ' || v_date_text || ' a ete modifie. Consulte les nouveaux details.';
    v_body_en := 'Your schedule for ' || v_date_text || ' has changed. Review the new details.';
    v_priority := 'warning';
  else
    return new;
  end if;

  if to_regprocedure('public.notify_user(uuid,uuid,uuid,text,text,text,text,text,text,text,text,boolean,text,jsonb,boolean,timestamptz)') is not null then
    perform public.notify_user(
      new.organization_id,
      new.user_id,
      coalesce(new.published_by, new.created_by),
      'system',
      v_event,
      v_title_fr,
      v_title_en,
      v_body_fr,
      v_body_en,
      '/dashboard/schedule',
      v_priority,
      false,
      'schedule:' || new.id::text || ':' || v_event || ':' || extract(epoch from new.updated_at)::bigint::text,
      jsonb_build_object('schedule_entry_id', new.id, 'work_date', new.work_date, 'work_mode', new.work_mode),
      true,
      now()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_work_schedule_change on public.work_schedule_entries;
create trigger notify_work_schedule_change
after insert or update on public.work_schedule_entries
for each row execute function public.notify_schedule_change();

alter table public.schedule_templates enable row level security;
alter table public.work_schedule_entries enable row level security;
alter table public.schedule_audit_log enable row level security;

revoke all on public.schedule_templates from anon, authenticated;
revoke all on public.work_schedule_entries from anon, authenticated;
revoke all on public.schedule_audit_log from anon, authenticated;

grant select, insert, update, delete on public.schedule_templates to service_role;
grant select, insert, update, delete on public.work_schedule_entries to service_role;
grant select, insert, update, delete on public.schedule_audit_log to service_role;

notify pgrst, 'reload schema';
