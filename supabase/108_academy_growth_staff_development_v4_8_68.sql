-- Super Leader V4.8.68 - Academy Growth & Staff Development
-- Monthly staff training, individual growth plans and reading plans.

create table if not exists public.academy_staff_monthly_training_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  training_month date not null,
  academy_course_id uuid references public.academy_courses(id) on delete set null,
  title text not null,
  starts_on date not null,
  due_on date not null,
  status text not null default 'active' check (status in ('draft','active','completed','cancelled')),
  reminder_enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_staff_monthly_training_month_start_chk check (training_month = date_trunc('month', training_month)::date),
  constraint academy_staff_monthly_training_dates_chk check (due_on >= starts_on),
  constraint academy_staff_monthly_training_unique_month unique (organization_id, training_month)
);

create index if not exists academy_staff_monthly_training_org_month_idx
  on public.academy_staff_monthly_training_cycles (organization_id, training_month desc);

create table if not exists public.academy_staff_growth_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  manager_id uuid,
  period_start date not null,
  period_end date not null,
  focus_area text not null,
  objective text not null,
  action_plan text not null default '',
  target_measure text not null default '',
  status text not null default 'active' check (status in ('draft','active','paused','completed','cancelled')),
  progress_percent numeric(5,2) not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  review_frequency text not null default 'monthly' check (review_frequency in ('monthly','quarterly')),
  next_review_on date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_staff_growth_period_chk check (period_end >= period_start)
);

create index if not exists academy_staff_growth_org_user_idx
  on public.academy_staff_growth_plans (organization_id, user_id, period_end desc);
create index if not exists academy_staff_growth_org_status_idx
  on public.academy_staff_growth_plans (organization_id, status, next_review_on);

create table if not exists public.academy_staff_reading_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  growth_plan_id uuid references public.academy_staff_growth_plans(id) on delete set null,
  book_title text not null,
  author text not null default '',
  start_date date not null,
  target_date date not null,
  total_units integer not null default 1 check (total_units > 0 and total_units <= 100000),
  completed_units integer not null default 0 check (completed_units >= 0),
  unit_label text not null default 'chapters',
  summary_required boolean not null default true,
  summary_status text not null default 'not_started' check (summary_status in ('not_started','draft','submitted','reviewed')),
  summary_text text not null default '',
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed','overdue','cancelled')),
  assigned_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_staff_reading_dates_chk check (target_date >= start_date),
  constraint academy_staff_reading_progress_chk check (completed_units <= total_units)
);

create index if not exists academy_staff_reading_org_user_idx
  on public.academy_staff_reading_plans (organization_id, user_id, target_date desc);
create index if not exists academy_staff_reading_org_status_idx
  on public.academy_staff_reading_plans (organization_id, status, target_date);

alter table public.academy_staff_monthly_training_cycles enable row level security;
alter table public.academy_staff_growth_plans enable row level security;
alter table public.academy_staff_reading_plans enable row level security;

comment on table public.academy_staff_monthly_training_cycles is 'One staff training cycle per organization and month. The linked Academy course carries sessions, quiz, attendance and certificates.';
comment on table public.academy_staff_growth_plans is 'Individual staff growth/development plans managed through Super Leader Academy.';
comment on table public.academy_staff_reading_plans is 'Reading plans linked optionally to an individual staff growth plan.';
