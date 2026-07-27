-- SUPER LEADER V2.2 - Super Leader Academy V1
-- Catalogue mensuel, inscriptions, quiz, certificats et integration au score mensuel.
-- A executer apres 020_team_management_v2_1.sql.

begin;

create extension if not exists pgcrypto;

alter table public.performance_settings
  add column if not exists training_weight numeric(5,2) not null default 10
    check (training_weight between 0 and 100),
  alter column role_kpi_weight set default 20;

-- Lorsque les poids historiques totalisaient 100 points, reserver 10 points a la formation
-- en ramenant le KPI metier de 30 a 20. Les configurations personnalisees restent intactes.
update public.performance_settings
set role_kpi_weight = greatest(0, role_kpi_weight - 10)
where training_weight = 10
  and round((attendance_weight + punctuality_weight + meetings_weight + reports_weight + collaboration_weight + role_kpi_weight)::numeric, 2) = 100;

alter table public.employee_month_scores
  add column if not exists training_score numeric(5,2) not null default 0,
  add column if not exists trainings_required integer not null default 0,
  add column if not exists trainings_completed integer not null default 0;

create table if not exists public.academy_courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 180),
  description text not null default '',
  category text not null default 'professional_development',
  training_month date not null,
  deadline date not null,
  duration_minutes integer not null default 60 check (duration_minutes between 1 and 10080),
  is_required boolean not null default true,
  passing_score numeric(5,2) not null default 70 check (passing_score between 0 and 100),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  certificate_enabled boolean not null default true,
  resource_url text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_trunc('month', training_month)::date = training_month),
  check (deadline >= training_month)
);

create index if not exists academy_courses_org_month_idx
  on public.academy_courses (organization_id, training_month desc, status);

create table if not exists public.academy_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  question_text text not null check (char_length(trim(question_text)) between 3 and 1000),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8),
  correct_option integer not null check (correct_option between 0 and 7),
  points numeric(7,2) not null default 1 check (points > 0),
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, position)
);

create index if not exists academy_questions_course_position_idx
  on public.academy_quiz_questions (course_id, position);

create table if not exists public.academy_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'assigned'
    check (status in ('assigned','in_progress','completed','failed','overdue','exempted')),
  progress_percent numeric(5,2) not null default 0 check (progress_percent between 0 and 100),
  attempts_count integer not null default 0 check (attempts_count >= 0),
  best_score numeric(5,2) check (best_score is null or best_score between 0 and 100),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  exempted_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, user_id)
);

create index if not exists academy_enrollments_org_user_status_idx
  on public.academy_enrollments (organization_id, user_id, status);
create index if not exists academy_enrollments_course_status_idx
  on public.academy_enrollments (course_id, status);

create table if not exists public.academy_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  enrollment_id uuid not null references public.academy_enrollments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  score numeric(5,2) not null check (score between 0 and 100),
  passed boolean not null,
  attempted_at timestamptz not null default now()
);

create index if not exists academy_attempts_enrollment_idx
  on public.academy_quiz_attempts (enrollment_id, attempted_at desc);

create table if not exists public.academy_certificates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  enrollment_id uuid not null unique references public.academy_enrollments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  certificate_number text not null unique,
  verification_token uuid not null default gen_random_uuid() unique,
  final_score numeric(5,2) check (final_score is null or final_score between 0 and 100),
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active','revoked')),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academy_certificates_org_user_idx
  on public.academy_certificates (organization_id, user_id, issued_at desc);

-- Reutiliser la fonction de mise a jour existante du module performance.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'academy_courses_updated_at') then
    create trigger academy_courses_updated_at
    before update on public.academy_courses
    for each row execute function public.performance_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'academy_questions_updated_at') then
    create trigger academy_questions_updated_at
    before update on public.academy_quiz_questions
    for each row execute function public.performance_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'academy_enrollments_updated_at') then
    create trigger academy_enrollments_updated_at
    before update on public.academy_enrollments
    for each row execute function public.performance_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'academy_certificates_updated_at') then
    create trigger academy_certificates_updated_at
    before update on public.academy_certificates
    for each row execute function public.performance_set_updated_at();
  end if;
end $$;

alter table public.academy_courses enable row level security;
alter table public.academy_quiz_questions enable row level security;
alter table public.academy_enrollments enable row level security;
alter table public.academy_quiz_attempts enable row level security;
alter table public.academy_certificates enable row level security;

-- Catalogue : tous les membres actifs voient les formations publiees de leur organisation.
drop policy if exists "academy courses visible by scope" on public.academy_courses;
create policy "academy courses visible by scope"
on public.academy_courses for select to authenticated
using (
  public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (
    status = 'published'
    and public.has_active_org_role(organization_id, array['owner','admin','hr','manager','employee'])
  )
);

drop policy if exists "academy courses managed by hr leaders" on public.academy_courses;
create policy "academy courses managed by hr leaders"
on public.academy_courses for all to authenticated
using (public.has_active_org_role(organization_id, array['owner','admin','hr']))
with check (public.has_active_org_role(organization_id, array['owner','admin','hr']));

-- Questions : les reponses correctes restent exclusivement cote serveur.
-- Aucun droit direct n'est accorde aux utilisateurs authentifies sur cette table.
drop policy if exists "academy questions visible" on public.academy_quiz_questions;

drop policy if exists "academy questions managed" on public.academy_quiz_questions;
create policy "academy questions managed"
on public.academy_quiz_questions for all to authenticated
using (public.has_active_org_role(organization_id, array['owner','admin','hr']))
with check (public.has_active_org_role(organization_id, array['owner','admin','hr']));

-- Inscriptions : chacun voit les siennes; les responsables voient leur perimetre.
drop policy if exists "academy enrollments visible by scope" on public.academy_enrollments;
create policy "academy enrollments visible by scope"
on public.academy_enrollments for select to authenticated
using (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (
    public.active_org_role(organization_id) = 'manager'
    and public.is_supervised_org_user(organization_id, user_id)
  )
);

drop policy if exists "academy enrollments assigned by leaders" on public.academy_enrollments;
create policy "academy enrollments assigned by leaders"
on public.academy_enrollments for insert to authenticated
with check (
  public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (
    public.active_org_role(organization_id) = 'manager'
    and public.is_supervised_org_user(organization_id, user_id)
  )
);

drop policy if exists "academy enrollments updated by scope" on public.academy_enrollments;
create policy "academy enrollments updated by scope"
on public.academy_enrollments for update to authenticated
using (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (
    public.active_org_role(organization_id) = 'manager'
    and public.is_supervised_org_user(organization_id, user_id)
  )
)
with check (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (
    public.active_org_role(organization_id) = 'manager'
    and public.is_supervised_org_user(organization_id, user_id)
  )
);

-- Tentatives et certificats suivent le meme perimetre.
drop policy if exists "academy attempts visible by scope" on public.academy_quiz_attempts;
create policy "academy attempts visible by scope"
on public.academy_quiz_attempts for select to authenticated
using (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
);

drop policy if exists "academy attempts inserted by owner" on public.academy_quiz_attempts;
create policy "academy attempts inserted by owner"
on public.academy_quiz_attempts for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "academy certificates visible by scope" on public.academy_certificates;
create policy "academy certificates visible by scope"
on public.academy_certificates for select to authenticated
using (
  user_id = auth.uid()
  or public.has_active_org_role(organization_id, array['owner','admin','hr'])
  or (public.active_org_role(organization_id) = 'manager' and public.is_supervised_org_user(organization_id, user_id))
);

revoke all on public.academy_courses from anon, authenticated;
revoke all on public.academy_quiz_questions from anon, authenticated;
revoke all on public.academy_enrollments from anon, authenticated;
revoke all on public.academy_quiz_attempts from anon, authenticated;
revoke all on public.academy_certificates from anon, authenticated;

grant select, insert, update, delete on public.academy_courses to authenticated;
-- Ne pas accorder SELECT sur academy_quiz_questions aux utilisateurs authentifies :
-- la colonne correct_option ne doit jamais etre exposee par l'API publique.
grant select on public.academy_enrollments to authenticated;
grant select on public.academy_quiz_attempts to authenticated;
grant select on public.academy_certificates to authenticated;

grant all on public.academy_courses to service_role;
grant all on public.academy_quiz_questions to service_role;
grant all on public.academy_enrollments to service_role;
grant all on public.academy_quiz_attempts to service_role;
grant all on public.academy_certificates to service_role;

commit;
notify pgrst, 'reload schema';
