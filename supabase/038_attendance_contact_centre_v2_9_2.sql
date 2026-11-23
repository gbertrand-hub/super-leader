-- SUPER LEADER V2.9.2 - Attendance contact and follow-up centre
-- Professional contact details are restricted and all operational access is
-- performed server-side after role and supervision checks.

begin;

create extension if not exists pgcrypto;

create table if not exists public.employee_work_contacts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_phone text,
  work_whatsapp text,
  position_title text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  check (work_phone is null or char_length(work_phone) <= 80),
  check (work_whatsapp is null or char_length(work_whatsapp) <= 80),
  check (position_title is null or char_length(position_title) <= 160)
);

comment on table public.employee_work_contacts is
  'Restricted professional directory used by authorised supervisors for operational contact.';

create index if not exists employee_work_contacts_user_idx
  on public.employee_work_contacts (user_id, organization_id);

create table if not exists public.absence_contact_followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_user_id uuid not null references auth.users(id) on delete cascade,
  attendance_id uuid references public.attendance_records(id) on delete set null,
  work_date date not null,
  contact_channel text not null check (contact_channel in ('phone','whatsapp','email','notification','other')),
  outcome text not null check (outcome in (
    'contacted_on_the_way',
    'contacted_sick',
    'contacted_technical_issue',
    'contacted_other',
    'no_answer',
    'justified',
    'escalated_hr',
    'notification_sent'
  )),
  note text not null default '' check (char_length(note) <= 3000),
  next_follow_up_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Upgrade an earlier development table that did not include the notification channel.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.absence_contact_followups'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%contact_channel%'
  ) then
    execute (
      select format('alter table public.absence_contact_followups drop constraint %I', conname)
      from pg_constraint
      where conrelid = 'public.absence_contact_followups'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%contact_channel%'
      limit 1
    );
  end if;
end;
$$;

alter table public.absence_contact_followups
  add constraint absence_contact_followups_contact_channel_check
  check (contact_channel in ('phone','whatsapp','email','notification','other'));

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.absence_contact_followups'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%outcome%'
  ) then
    execute (
      select format('alter table public.absence_contact_followups drop constraint %I', conname)
      from pg_constraint
      where conrelid = 'public.absence_contact_followups'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%outcome%'
      limit 1
    );
  end if;
end;
$$;

alter table public.absence_contact_followups
  add constraint absence_contact_followups_outcome_check
  check (outcome in (
    'contacted_on_the_way',
    'contacted_sick',
    'contacted_technical_issue',
    'contacted_other',
    'no_answer',
    'justified',
    'escalated_hr',
    'notification_sent'
  ));

create index if not exists absence_contact_followups_org_date_idx
  on public.absence_contact_followups (organization_id, work_date desc, created_at desc);
create index if not exists absence_contact_followups_subject_idx
  on public.absence_contact_followups (organization_id, subject_user_id, work_date desc, created_at desc);
create index if not exists absence_contact_followups_attendance_idx
  on public.absence_contact_followups (attendance_id, created_at desc)
  where attendance_id is not null;
create index if not exists absence_contact_followups_pending_idx
  on public.absence_contact_followups (organization_id, next_follow_up_at)
  where next_follow_up_at is not null;

create or replace function public.v2_9_2_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_employee_work_contacts_updated_at on public.employee_work_contacts;
create trigger set_employee_work_contacts_updated_at
before update on public.employee_work_contacts
for each row execute function public.v2_9_2_set_updated_at();

alter table public.employee_work_contacts enable row level security;
alter table public.absence_contact_followups enable row level security;

revoke all on public.employee_work_contacts from anon, authenticated;
revoke all on public.absence_contact_followups from anon, authenticated;
grant select, insert, update, delete on public.employee_work_contacts to service_role;
grant select, insert, update, delete on public.absence_contact_followups to service_role;

-- Reuse approved internal-access information when available.
do $$
begin
  if to_regclass('public.internal_access_requests') is not null then
    execute $backfill$
      with latest_approved_access as (
        select distinct on (access.organization_id, access.approved_user_id)
          access.organization_id,
          access.approved_user_id as user_id,
          access.phone,
          access.position_title,
          access.reviewed_by
        from public.internal_access_requests access
        where access.status = 'approved'
          and access.organization_id is not null
          and access.approved_user_id is not null
        order by access.organization_id, access.approved_user_id,
          access.reviewed_at desc nulls last, access.created_at desc
      )
      insert into public.employee_work_contacts (
        organization_id, user_id, work_phone, position_title, updated_by
      )
      select
        access.organization_id,
        access.user_id,
        nullif(btrim(access.phone), ''),
        nullif(btrim(access.position_title), ''),
        access.reviewed_by
      from latest_approved_access access
      on conflict (organization_id, user_id) do update set
        work_phone = coalesce(nullif(btrim(employee_work_contacts.work_phone), ''), excluded.work_phone),
        position_title = coalesce(nullif(btrim(employee_work_contacts.position_title), ''), excluded.position_title),
        updated_by = coalesce(employee_work_contacts.updated_by, excluded.updated_by),
        updated_at = now()
    $backfill$;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
