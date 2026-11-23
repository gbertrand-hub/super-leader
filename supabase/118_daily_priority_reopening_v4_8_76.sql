begin;

create table if not exists public.daily_priority_reopenings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  work_date date not null,
  reason_code text not null default 'other',
  reason text not null,
  duration_minutes integer not null default 60,
  expires_at timestamptz not null,
  reopened_by uuid not null,
  status text not null default 'active',
  used_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_priority_reopenings_status_check
    check (status in ('active','used','revoked','expired')),
  constraint daily_priority_reopenings_duration_check
    check (duration_minutes between 15 and 480),
  constraint daily_priority_reopenings_reason_check
    check (char_length(btrim(reason)) >= 5)
);

create index if not exists daily_priority_reopenings_org_date_idx
  on public.daily_priority_reopenings (organization_id, work_date);

create index if not exists daily_priority_reopenings_user_date_idx
  on public.daily_priority_reopenings (organization_id, user_id, work_date);

create unique index if not exists daily_priority_reopenings_one_active_idx
  on public.daily_priority_reopenings (organization_id, user_id, work_date)
  where status = 'active';

comment on table public.daily_priority_reopenings is
  'Audited, time-limited supervisor reopenings of the morning daily-priority submission window.';

comment on column public.daily_priority_reopenings.reason_code is
  'Operational reason category such as internet, technical, manager_request or other.';

-- Close stale active windows so historical rows cannot remain operational forever.
update public.daily_priority_reopenings
set status = 'expired',
    closed_at = coalesce(closed_at, now()),
    updated_at = now()
where status = 'active'
  and expires_at <= now();

commit;
