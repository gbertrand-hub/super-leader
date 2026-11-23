begin;

create table if not exists public.academy_staff_training_module_quizzes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  module_label text not null check (char_length(trim(module_label)) between 1 and 120),
  title text not null check (char_length(trim(title)) between 3 and 180),
  passing_score numeric(5,2) not null default 70 check (passing_score between 0 and 100),
  max_attempts integer not null default 2 check (max_attempts between 1 and 20),
  is_required boolean not null default true,
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, module_label, title)
);

create index if not exists academy_staff_training_module_quizzes_course_idx
  on public.academy_staff_training_module_quizzes (organization_id, course_id, module_label, created_at);

create table if not exists public.academy_staff_training_module_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  quiz_id uuid not null references public.academy_staff_training_module_quizzes(id) on delete cascade,
  question_text text not null check (char_length(trim(question_text)) between 3 and 1000),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option integer not null check (correct_option between 0 and 3),
  points numeric(7,2) not null default 1 check (points > 0),
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  unique (quiz_id, position)
);

create index if not exists academy_staff_training_module_quiz_questions_idx
  on public.academy_staff_training_module_quiz_questions (quiz_id, position);

create table if not exists public.academy_staff_training_module_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  quiz_id uuid not null references public.academy_staff_training_module_quizzes(id) on delete cascade,
  enrollment_id uuid not null references public.academy_enrollments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  score numeric(5,2) not null check (score between 0 and 100),
  passed boolean not null,
  attempt_no integer not null check (attempt_no > 0),
  attempted_at timestamptz not null default now(),
  unique (quiz_id, user_id, attempt_no)
);

create index if not exists academy_staff_training_module_quiz_attempts_user_idx
  on public.academy_staff_training_module_quiz_attempts (organization_id, course_id, user_id, attempted_at desc);
create index if not exists academy_staff_training_module_quiz_attempts_quiz_idx
  on public.academy_staff_training_module_quiz_attempts (quiz_id, passed, attempted_at desc);

alter table public.academy_staff_training_module_quizzes enable row level security;
alter table public.academy_staff_training_module_quiz_questions enable row level security;
alter table public.academy_staff_training_module_quiz_attempts enable row level security;

drop policy if exists academy_staff_training_module_quizzes_select on public.academy_staff_training_module_quizzes;
create policy academy_staff_training_module_quizzes_select
on public.academy_staff_training_module_quizzes
for select to authenticated
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = academy_staff_training_module_quizzes.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (
        om.role in ('owner','admin','hr')
        or (
          academy_staff_training_module_quizzes.is_published = true
          and exists (
            select 1 from public.academy_enrollments ae
            where ae.organization_id = academy_staff_training_module_quizzes.organization_id
              and ae.course_id = academy_staff_training_module_quizzes.course_id
              and ae.user_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists academy_staff_training_module_quiz_questions_select on public.academy_staff_training_module_quiz_questions;
create policy academy_staff_training_module_quiz_questions_select
on public.academy_staff_training_module_quiz_questions
for select to authenticated
using (
  exists (
    select 1
    from public.academy_staff_training_module_quizzes q
    join public.organization_members om on om.organization_id = q.organization_id
    where q.id = academy_staff_training_module_quiz_questions.quiz_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (
        om.role in ('owner','admin','hr')
        or (
          q.is_published = true
          and exists (
            select 1 from public.academy_enrollments ae
            where ae.organization_id = q.organization_id
              and ae.course_id = q.course_id
              and ae.user_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists academy_staff_training_module_quiz_attempts_select on public.academy_staff_training_module_quiz_attempts;
create policy academy_staff_training_module_quiz_attempts_select
on public.academy_staff_training_module_quiz_attempts
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.organization_members om
    where om.organization_id = academy_staff_training_module_quiz_attempts.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and om.role in ('owner','admin','hr')
  )
);

revoke all on public.academy_staff_training_module_quizzes from anon, authenticated;
revoke all on public.academy_staff_training_module_quiz_questions from anon, authenticated;
revoke all on public.academy_staff_training_module_quiz_attempts from anon, authenticated;
grant select on public.academy_staff_training_module_quizzes to authenticated;
-- Correct answers stay server-side: authenticated users receive no direct SELECT grant on question rows.
grant select on public.academy_staff_training_module_quiz_attempts to authenticated;
grant all on public.academy_staff_training_module_quizzes to service_role;
grant all on public.academy_staff_training_module_quiz_questions to service_role;
grant all on public.academy_staff_training_module_quiz_attempts to service_role;

-- Seed the September 2026 Day 1 evaluation into the single Staff Training course.
do $$
declare
  v_match_count integer;
  v_course_id uuid;
  v_org_id uuid;
  v_created_by uuid;
  v_quiz_id uuid;
  v_attempt_count integer;
begin
  select count(*)
  into v_match_count
  from public.academy_courses c
  where c.is_staff_training = true
    and c.training_month = date '2026-09-01'
    and lower(trim(c.title)) = 'staff training';

  if v_match_count = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'STAFF_TRAINING_SEPTEMBER_2026_NOT_FOUND',
      detail = 'Expected exactly one staff training course titled Staff Training for 2026-09-01.';
  elsif v_match_count > 1 then
    raise exception using
      errcode = 'P0001',
      message = 'STAFF_TRAINING_SEPTEMBER_2026_AMBIGUOUS',
      detail = format('Found %s matching staff training courses. Narrow the seed target before retrying.', v_match_count);
  end if;

  select c.id, c.organization_id, c.created_by
  into v_course_id, v_org_id, v_created_by
  from public.academy_courses c
  where c.is_staff_training = true
    and c.training_month = date '2026-09-01'
    and lower(trim(c.title)) = 'staff training'
  limit 1;

  insert into public.academy_staff_training_module_quizzes (
    organization_id, course_id, module_label, title, passing_score, max_attempts,
    is_required, is_published, published_at, created_by
  ) values (
    v_org_id,
    v_course_id,
    'Jour 1',
    'Évaluation Jour 1 — Leader de soi-même',
    70,
    2,
    true,
    true,
    now(),
    v_created_by
  )
  on conflict (course_id, module_label, title) do update
  set passing_score = excluded.passing_score,
      max_attempts = excluded.max_attempts,
      is_required = true,
      is_published = true,
      published_at = coalesce(public.academy_staff_training_module_quizzes.published_at, now()),
      updated_at = now()
  returning id into v_quiz_id;

  select count(*) into v_attempt_count
  from public.academy_staff_training_module_quiz_attempts
  where quiz_id = v_quiz_id;

  if v_attempt_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'STAFF_TRAINING_DAY1_QUIZ_ALREADY_ATTEMPTED',
      detail = 'The Day 1 quiz already has attempts, so its question bank was not replaced.';
  end if;

  delete from public.academy_staff_training_module_quiz_questions
  where quiz_id = v_quiz_id;

  insert into public.academy_staff_training_module_quiz_questions
    (organization_id, course_id, quiz_id, question_text, options, correct_option, points, position)
  values
    (v_org_id, v_course_id, v_quiz_id,
      'Dans la formation « Leader de soi-même », qu’est-ce qui distingue principalement l’influence de la simple position hiérarchique ?',
      '["Les personnes suivent parce qu’elles font confiance au leader, comprennent la direction et voient sa cohérence.","Les personnes suivent uniquement parce que le leader possède un titre officiel.","Les personnes suivent parce que le leader contrôle toutes les décisions de l’équipe.","Les personnes suivent parce que le leader travaille plus longtemps que tous les autres."]'::jsonb,
      0, 1, 1),
    (v_org_id, v_course_id, v_quiz_id,
      'Laquelle des propositions suivantes fait partie des cinq sources d’influence du leader enseignées au Jour 1 ?',
      '["Compétence","Ancienneté","Popularité","Autorité administrative"]'::jsonb,
      0, 1, 2),
    (v_org_id, v_course_id, v_quiz_id,
      'Quel enchaînement décrit correctement la manière dont le comportement d’un leader peut devenir une culture d’équipe ?',
      '["Le leader agit → l’équipe observe → l’équipe imite → cela devient normal → la culture se forme.","Le leader donne une règle → l’équipe mémorise → le règlement change → la culture apparaît immédiatement.","Le leader contrôle → l’équipe obéit → les résultats arrivent → la culture n’a plus d’importance.","Le leader délègue → l’équipe décide → le leader se retire → la culture devient automatique."]'::jsonb,
      0, 1, 3),
    (v_org_id, v_course_id, v_quiz_id,
      'Face à un problème, quelle question correspond le mieux à une mentalité de responsabilité du leader ?',
      '["Quelle action dépend de moi et quelle solution puis-je proposer ?","Qui doit être blâmé pour ce qui s’est passé ?","Pourquoi les autres n’ont-ils pas fait leur travail ?","Comment puis-je démontrer que le problème ne dépend pas de moi ?"]'::jsonb,
      0, 1, 4),
    (v_org_id, v_course_id, v_quiz_id,
      'Quel ordre correspond au cycle de responsabilité en cinq étapes enseigné pendant le Jour 1 ?',
      '["Voir les faits → Assumer ma part → Créer des options → Décider et agir → Suivre le résultat","Décider → Chercher un responsable → Agir → Expliquer → Clôturer","Observer → Attendre → Demander une autorisation → Agir → Oublier","Créer des options → Blâmer → Mesurer → Décider → Reporter"]'::jsonb,
      0, 1, 5),
    (v_org_id, v_course_id, v_quiz_id,
      'Parmi les propositions suivantes, laquelle fait partie des quatre questions de direction qu’un leader doit pouvoir clarifier pour son équipe ?',
      '["Comment saurons-nous que nous avons réussi ?","Qui mérite le plus de reconnaissance dans l’équipe ?","Quel collaborateur doit travailler le plus longtemps ?","Combien de réunions devons-nous organiser chaque semaine ?"]'::jsonb,
      0, 1, 6),
    (v_org_id, v_course_id, v_quiz_id,
      'Quelle chaîne traduit correctement la vision en exécution opérationnelle dans le Jour 1 ?',
      '["Mission → Vision → Objectifs → KPI → Actions","Actions → KPI → Mission → Vision → Objectifs","Vision → Actions → Mission → KPI → Objectifs","KPI → Mission → Actions → Objectifs → Vision"]'::jsonb,
      0, 1, 7),
    (v_org_id, v_course_id, v_quiz_id,
      'Dans la chaîne Mission → Vision → Objectifs → KPI → Actions, quelles parties sont principalement soutenues par le software selon la formation ?',
      '["KPI et Actions","Mission et Vision","Vision et Objectifs uniquement","Mission et culture uniquement"]'::jsonb,
      0, 1, 8),
    (v_org_id, v_course_id, v_quiz_id,
      'Quelles sont les six dimensions du Personal Leadership Scorecard du Jour 1 ?',
      '["Crédibilité, discipline, communication, confiance, résultats et exemplarité","Autorité, ancienneté, popularité, contrôle, ambition et statut","Vision, salaire, compétence technique, ancienneté, réseau et influence","Motivation, créativité, stratégie, finance, marketing et opérations"]'::jsonb,
      0, 1, 9),
    (v_org_id, v_course_id, v_quiz_id,
      'Selon la formation, comment doivent être formulés les trois standards personnels de leadership pour les 30 prochains jours ?',
      '["Ils doivent être simples, visibles et vérifiables par des comportements observables.","Ils doivent rester généraux afin de pouvoir être interprétés librement.","Ils doivent être secrets afin de ne pas créer de pression personnelle.","Ils doivent porter uniquement sur des résultats financiers mensuels."]'::jsonb,
      0, 1, 10);
end;
$$;

commit;
