-- Super Leader V4.10.30
-- Evaluation : Roue d'equilibre et plan d'action du Coach
begin;

do $$
declare
  school_record record;
  target_program_id uuid;
  target_cohort_id uuid;
  target_assessment_id uuid;
  target_actor_id uuid;
  matched_school_count integer := 0;
begin
  if to_regclass('public.academy_assessments') is null
     or to_regclass('public.academy_assessment_quiz_questions') is null
     or to_regclass('public.academy_assessment_results') is null then
    raise exception 'Le module Evaluations Academy doit etre installe avant la V4.10.30.';
  end if;

  for school_record in
    select school.id, school.organization_id, school.created_by
    from public.academy_schools school
    where school.is_active = true
      and (
        school.code = 'school_coaches'
        or lower(school.name) like '%coach%'
      )
  loop
    matched_school_count := matched_school_count + 1;

    select cohort.id, cohort.program_id
      into target_cohort_id, target_program_id
    from public.academy_cohorts cohort
    where cohort.school_id = school_record.id
      and cohort.status <> 'archived'
      and lower(cohort.name) like '%2026%'
      and lower(cohort.name) like '%2027%'
    order by
      case when cohort.status = 'active' then 0 when cohort.status = 'open' then 1 else 2 end,
      cohort.created_at desc
    limit 1;

    if target_cohort_id is null then
      raise exception 'Cohorte 2026-2027 introuvable pour l''Ecole des Coachs (%).', school_record.id;
    end if;

    if target_program_id is null then
      select program.id
        into target_program_id
      from public.academy_programs program
      where program.school_id = school_record.id
        and program.status = 'active'
      order by program.created_at
      limit 1;
    end if;

    select coalesce(
      school_record.created_by,
      organization.created_by,
      (
        select member.user_id
        from public.organization_members member
        where member.organization_id = school_record.organization_id
          and member.role in ('owner', 'admin')
        order by case when member.role = 'owner' then 0 else 1 end, member.created_at
        limit 1
      )
    )
      into target_actor_id
    from public.organizations organization
    where organization.id = school_record.organization_id;

    if target_actor_id is null then
      raise exception 'Aucun administrateur disponible pour creer l''evaluation.';
    end if;

    select assessment.id
      into target_assessment_id
    from public.academy_assessments assessment
    where assessment.organization_id = school_record.organization_id
      and assessment.school_id = school_record.id
      and assessment.title = 'Roue d''équilibre et plan d''action du Coach'
    order by assessment.created_at
    limit 1;

    if target_assessment_id is null then
      insert into public.academy_assessments (
        organization_id,
        school_id,
        program_id,
        cohort_id,
        title,
        description,
        assessment_type,
        max_score,
        passing_score,
        status,
        created_by
      )
      values (
        school_record.organization_id,
        school_record.id,
        target_program_id,
        target_cohort_id,
        'Roue d''équilibre et plan d''action du Coach',
        'Évaluation diagnostique adaptée de la fiche Roue d''équilibre. L''étudiant évalue dix domaines de sa vie et de sa pratique, analyse ses priorités puis construit un plan d''action concret. Les notes de 1 à 10 sont validées automatiquement; les réponses de réflexion sont corrigées manuellement.',
        'quiz',
        100,
        60,
        'draft',
        target_actor_id
      )
      returning id into target_assessment_id;
    else
      update public.academy_assessments
      set program_id = target_program_id,
          cohort_id = target_cohort_id,
          max_score = 100,
          passing_score = 60,
          updated_at = now()
      where id = target_assessment_id;
    end if;

    insert into public.academy_assessment_quiz_questions
      (organization_id, assessment_id, prompt, question_type, points, position, required, accepted_answers, explanation)
    select
      school_record.organization_id,
      target_assessment_id,
      question.prompt,
      question.question_type,
      question.points,
      question.position,
      true,
      question.accepted_answers,
      question.explanation
    from (
      values
        (1, 'De 1 à 10, comment évaluez-vous la clarté de votre vision et de votre mission personnelle ?', 'short_answer', 2::numeric, '["1","2","3","4","5","6","7","8","9","10"]'::jsonb, 'Toute note entière comprise entre 1 et 10 est acceptée.'),
        (2, 'De 1 à 10, comment évaluez-vous votre développement personnel et votre connaissance de vous-même ?', 'short_answer', 2::numeric, '["1","2","3","4","5","6","7","8","9","10"]'::jsonb, 'Toute note entière comprise entre 1 et 10 est acceptée.'),
        (3, 'De 1 à 10, comment évaluez-vous votre discipline et votre gestion du temps ?', 'short_answer', 2::numeric, '["1","2","3","4","5","6","7","8","9","10"]'::jsonb, 'Toute note entière comprise entre 1 et 10 est acceptée.'),
        (4, 'De 1 à 10, comment évaluez-vous votre équilibre et votre organisation financière ?', 'short_answer', 2::numeric, '["1","2","3","4","5","6","7","8","9","10"]'::jsonb, 'Toute note entière comprise entre 1 et 10 est acceptée.'),
        (5, 'De 1 à 10, comment évaluez-vous la qualité de vos relations familiales et sociales ?', 'short_answer', 2::numeric, '["1","2","3","4","5","6","7","8","9","10"]'::jsonb, 'Toute note entière comprise entre 1 et 10 est acceptée.'),
        (6, 'De 1 à 10, comment évaluez-vous votre santé, votre énergie et votre bien-être ?', 'short_answer', 2::numeric, '["1","2","3","4","5","6","7","8","9","10"]'::jsonb, 'Toute note entière comprise entre 1 et 10 est acceptée.'),
        (7, 'De 1 à 10, comment évaluez-vous votre posture, votre écoute et votre communication comme coach ?', 'short_answer', 2::numeric, '["1","2","3","4","5","6","7","8","9","10"]'::jsonb, 'Toute note entière comprise entre 1 et 10 est acceptée.'),
        (8, 'De 1 à 10, comment évaluez-vous votre apprentissage continu et le développement de vos compétences ?', 'short_answer', 2::numeric, '["1","2","3","4","5","6","7","8","9","10"]'::jsonb, 'Toute note entière comprise entre 1 et 10 est acceptée.'),
        (9, 'De 1 à 10, comment évaluez-vous l''avancement de votre projet professionnel ou de votre activité de coaching ?', 'short_answer', 2::numeric, '["1","2","3","4","5","6","7","8","9","10"]'::jsonb, 'Toute note entière comprise entre 1 et 10 est acceptée.'),
        (10, 'De 1 à 10, comment évaluez-vous votre impact, votre éthique et votre contribution aux autres ?', 'short_answer', 2::numeric, '["1","2","3","4","5","6","7","8","9","10"]'::jsonb, 'Toute note entière comprise entre 1 et 10 est acceptée.'),
        (11, 'Après avoir observé vos dix notes, quels sont les deux domaines qui demandent le plus d''attention ? Expliquez ce que vous constatez.', 'long_answer', 10::numeric, '[]'::jsonb, 'Barème : domaines clairement identifiés (4), analyse honnête et précise (4), lien avec la situation actuelle (2).'),
        (12, 'Choisissez un objectif prioritaire de votre plan de vie. Pourquoi cet objectif est-il important pour vous et pour votre développement comme coach ?', 'long_answer', 10::numeric, '[]'::jsonb, 'Barème : objectif précis (3), importance personnelle (3), lien avec la posture ou la mission du coach (4).'),
        (13, 'Quels obstacles internes et externes pourraient vous empêcher d''atteindre cet objectif ? Expliquez comment ils peuvent se manifester.', 'long_answer', 10::numeric, '[]'::jsonb, 'Barème : obstacles réalistes (4), distinction interne/externe (3), qualité de l''analyse (3).'),
        (14, 'Présentez trois actions concrètes et mesurables que vous réaliserez pour atteindre cet objectif. Pour chaque action, indiquez quoi faire, quand le faire et le résultat attendu.', 'long_answer', 20::numeric, '[]'::jsonb, 'Barème : trois actions (6), caractère concret et mesurable (6), échéances (4), cohérence avec l''objectif (4).'),
        (15, 'Quel engagement précis prendrez-vous au cours des sept prochains jours pour commencer immédiatement ?', 'long_answer', 10::numeric, '[]'::jsonb, 'Barème : engagement précis (4), réalisable en sept jours (3), première étape clairement formulée (3).'),
        (16, 'Quels indicateurs utiliserez-vous pour mesurer vos progrès au cours des trente prochains jours, et à quelle fréquence ferez-vous le point ?', 'long_answer', 10::numeric, '[]'::jsonb, 'Barème : indicateurs mesurables (4), fréquence de suivi (3), méthode de vérification (3).'),
        (17, 'Qui peut vous accompagner ou vous demander des comptes ? Expliquez comment vous solliciterez ce soutien tout en respectant l''éthique et la confidentialité du coaching.', 'long_answer', 10::numeric, '[]'::jsonb, 'Barème : personne ou dispositif identifié (3), méthode de redevabilité (3), respect de l''éthique et de la confidentialité (4).')
    ) as question(position, prompt, question_type, points, accepted_answers, explanation)
    where not exists (
      select 1
      from public.academy_assessment_quiz_questions existing
      where existing.assessment_id = target_assessment_id
        and existing.position = question.position
        and existing.is_active = true
    );

    insert into public.academy_assessment_results
      (organization_id, assessment_id, enrollment_id, result_status)
    select
      enrollment.organization_id,
      target_assessment_id,
      enrollment.id,
      'ungraded'
    from public.academy_school_enrollments enrollment
    where enrollment.organization_id = school_record.organization_id
      and enrollment.school_id = school_record.id
      and enrollment.cohort_id = target_cohort_id
      and enrollment.academic_status in ('admitted', 'enrolled', 'active')
    on conflict (assessment_id, enrollment_id) do nothing;

    raise notice 'Evaluation creee/prete : %, cohorte %, evaluation %', school_record.id, target_cohort_id, target_assessment_id;

    target_program_id := null;
    target_cohort_id := null;
    target_assessment_id := null;
    target_actor_id := null;
  end loop;

  if matched_school_count = 0 then
    raise exception 'Aucune Ecole des Coachs active n''a ete trouvee.';
  end if;
end
$$;

commit;
