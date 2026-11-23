-- Super Leader V4.8.35 - Évaluations Academy
begin;
create extension if not exists pgcrypto;

create table if not exists public.academy_assessments (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 school_id uuid not null references public.academy_schools(id) on delete cascade,
 program_id uuid references public.academy_programs(id) on delete set null,
 cohort_id uuid references public.academy_cohorts(id) on delete set null,
 evaluator_user_id uuid references auth.users(id) on delete set null,
 title text not null check(char_length(trim(title)) between 2 and 200),
 description text check(description is null or char_length(description)<=3000),
 assessment_type text not null default 'quiz' check(assessment_type in ('quiz','exam','project','practical','oral','other')),
 due_date date,
 max_score numeric(8,2) not null default 100 check(max_score>0),
 passing_score numeric(8,2) not null default 60 check(passing_score>=0 and passing_score<=max_score),
 status text not null default 'draft' check(status in ('draft','open','closed','archived')),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.academy_assessment_results (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 assessment_id uuid not null references public.academy_assessments(id) on delete cascade,
 enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
 score numeric(8,2),
 result_status text not null default 'ungraded' check(result_status in ('ungraded','passed','failed','absent','exempt')),
 feedback text check(feedback is null or char_length(feedback)<=2000),
 graded_by uuid references auth.users(id) on delete set null,
 graded_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(assessment_id,enrollment_id)
);
create index if not exists academy_assessments_scope_idx on public.academy_assessments(organization_id,school_id,due_date desc);
create index if not exists academy_assessment_results_enrollment_idx on public.academy_assessment_results(enrollment_id,result_status);
alter table public.academy_assessments enable row level security;
alter table public.academy_assessment_results enable row level security;
grant all on public.academy_assessments,public.academy_assessment_results to service_role;
commit;
