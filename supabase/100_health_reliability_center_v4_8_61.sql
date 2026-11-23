-- Super Leader V4.8.61
-- Health & Reliability Center
-- Safe operational monitoring without exposing secrets.
-- Run after 099_finance_settings_complete_v4_8_60.sql.

begin;

create table if not exists public.system_schema_state (
  id smallint primary key default 1 check (id = 1),
  app_version text not null,
  migration_number integer not null check (migration_number >= 1),
  migration_name text not null,
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.system_schema_state (
  id,
  app_version,
  migration_number,
  migration_name,
  applied_at,
  updated_at
) values (
  1,
  '4.8.61',
  100,
  '100_health_reliability_center_v4_8_61',
  now(),
  now()
)
on conflict (id) do update set
  app_version = excluded.app_version,
  migration_number = excluded.migration_number,
  migration_name = excluded.migration_name,
  applied_at = excluded.applied_at,
  updated_at = excluded.updated_at;

create table if not exists public.system_background_job_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  job_name text not null check (char_length(trim(job_name)) between 2 and 120),
  status text not null check (status in ('success','warning','failed')),
  started_at timestamptz not null,
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_summary text check (error_summary is null or char_length(error_summary) <= 500),
  result_summary text check (result_summary is null or char_length(result_summary) <= 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_background_job_runs_started_idx
  on public.system_background_job_runs (started_at desc);
create index if not exists system_background_job_runs_org_started_idx
  on public.system_background_job_runs (organization_id, started_at desc);
create index if not exists system_background_job_runs_status_idx
  on public.system_background_job_runs (status, started_at desc);

create table if not exists public.system_technical_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  source text not null check (char_length(trim(source)) between 2 and 120),
  severity text not null check (severity in ('warning','critical')),
  title text not null check (char_length(trim(title)) between 2 and 180),
  summary text check (summary is null or char_length(summary) <= 500),
  status text not null default 'open' check (status in ('open','resolved')),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_technical_incidents_resolution_check check (
    (status = 'open' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);

create index if not exists system_technical_incidents_org_time_idx
  on public.system_technical_incidents (organization_id, occurred_at desc);
create index if not exists system_technical_incidents_status_idx
  on public.system_technical_incidents (status, severity, occurred_at desc);

alter table public.system_schema_state enable row level security;
alter table public.system_background_job_runs enable row level security;
alter table public.system_technical_incidents enable row level security;

revoke all on public.system_schema_state from anon, authenticated;
revoke all on public.system_background_job_runs from anon, authenticated;
revoke all on public.system_technical_incidents from anon, authenticated;

grant select, insert, update, delete on public.system_schema_state to service_role;
grant select, insert, update, delete on public.system_background_job_runs to service_role;
grant select, insert, update, delete on public.system_technical_incidents to service_role;

comment on table public.system_schema_state is 'Single-row Super Leader application/schema alignment marker. Contains no secrets.';
comment on table public.system_background_job_runs is 'Safe background-job execution journal. Error summaries must be redacted before insertion.';
comment on table public.system_technical_incidents is 'Safe technical incident journal. Never store passwords, tokens, API keys, or connection strings.';

commit;

notify pgrst, 'reload schema';
