-- Super Leader V4.8.38 - Moteur de quiz sécurisé
begin;
create extension if not exists pgcrypto;

create table if not exists public.academy_assessment_quiz_questions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 assessment_id uuid not null references public.academy_assessments(id) on delete cascade,
 prompt text not null check(char_length(trim(prompt)) between 2 and 2000),
 question_type text not null check(question_type in ('single_choice','multiple_choice','true_false','short_answer','long_answer')),
 points numeric(8,2) not null default 1 check(points>0),
 position integer not null default 1 check(position>0),
 required boolean not null default true,
 accepted_answers jsonb not null default '[]'::jsonb,
 explanation text,
 is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.academy_assessment_quiz_options (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 question_id uuid not null references public.academy_assessment_quiz_questions(id) on delete cascade,
 option_text text not null check(char_length(trim(option_text)) between 1 and 1000),
 is_correct boolean not null default false,
 position integer not null default 1,
 created_at timestamptz not null default now()
);
create table if not exists public.academy_assessment_quiz_attempts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 assessment_id uuid not null references public.academy_assessments(id) on delete cascade,
 result_id uuid not null references public.academy_assessment_results(id) on delete cascade,
 enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
 student_user_id uuid references auth.users(id) on delete set null,
 status text not null default 'in_progress' check(status in ('in_progress','submitted','pending_review','graded')),
 auto_score numeric(8,2) not null default 0,
 manual_score numeric(8,2) not null default 0,
 total_score numeric(8,2) not null default 0,
 started_at timestamptz not null default now(), submitted_at timestamptz,
 unique(result_id)
);
create table if not exists public.academy_assessment_quiz_answers (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 attempt_id uuid not null references public.academy_assessment_quiz_attempts(id) on delete cascade,
 question_id uuid not null references public.academy_assessment_quiz_questions(id) on delete cascade,
 selected_option_ids uuid[] not null default '{}',
 text_answer text,
 awarded_points numeric(8,2) not null default 0,
 auto_correct boolean,
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,
 feedback text,
 unique(attempt_id,question_id)
);
create index if not exists academy_assessment_quiz_questions_assessment_idx on public.academy_assessment_quiz_questions(assessment_id,position);
create index if not exists academy_assessment_quiz_attempts_student_idx on public.academy_assessment_quiz_attempts(student_user_id,status);
alter table public.academy_assessment_quiz_questions enable row level security;
alter table public.academy_assessment_quiz_options enable row level security;
alter table public.academy_assessment_quiz_attempts enable row level security;
alter table public.academy_assessment_quiz_answers enable row level security;
grant all on public.academy_assessment_quiz_questions,public.academy_assessment_quiz_options,public.academy_assessment_quiz_attempts,public.academy_assessment_quiz_answers to service_role;
commit;
