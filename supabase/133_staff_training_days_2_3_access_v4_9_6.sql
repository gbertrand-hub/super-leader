begin;

-- V4.9.6: allow True/False module questions while keeping MCQ support.
alter table public.academy_staff_training_module_quiz_questions
  drop constraint if exists academy_staff_training_module_quiz_questions_options_check;

alter table public.academy_staff_training_module_quiz_questions
  add constraint academy_staff_training_module_quiz_questions_options_check
  check (
    jsonb_typeof(options) = 'array'
    and jsonb_array_length(options) between 2 and 4
  );

-- Seed the September 2026 Day 2 and Day 3 assessments into the single Staff Training course.
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

  -- JOUR 2 ---------------------------------------------------
  insert into public.academy_staff_training_module_quizzes (
    organization_id, course_id, module_label, title, passing_score, max_attempts,
    is_required, is_published, published_at, created_by
  ) values (
    v_org_id,
    v_course_id,
    'Jour 2',
    'Évaluation Jour 2 — Diriger une équipe',
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

  if v_attempt_count = 0 then
    delete from public.academy_staff_training_module_quiz_questions where quiz_id = v_quiz_id;
    insert into public.academy_staff_training_module_quiz_questions
      (organization_id, course_id, quiz_id, question_text, options, correct_option, points, position)
    values
    (v_org_id, v_course_id, v_quiz_id, 'Une vraie équipe se distingue principalement par :', jsonb_build_array('Le nombre de personnes', 'Un objectif commun, des rôles clairs et des résultats mesurés', 'Le fait d’être dans le même bureau', 'Le titre du manager'), 1, 1, 1),
    (v_org_id, v_course_id, v_quiz_id, 'Une instruction claire doit répondre à :', jsonb_build_array('Quoi, pourquoi, qui, quand, comment mesurer', 'Qui, salaire, ancienneté, lieu, humeur', 'Temps, budget et permission uniquement', 'Une seule consigne générale'), 0, 1, 2),
    (v_org_id, v_course_id, v_quiz_id, 'La délégation efficace consiste à :', jsonb_build_array('Se débarrasser des tâches ennuyeuses', 'Confier un résultat avec délai, ressources, autorité et suivi', 'Donner un ordre sans explication', 'Laisser la personne se débrouiller seule'), 1, 1, 3),
    (v_org_id, v_course_id, v_quiz_id, 'Le software Super Leader sert surtout à :', jsonb_build_array('Remplacer le leadership', 'Éviter de parler à l’équipe', 'Rendre visibles les priorités, responsabilités, échéances et suivis', 'Donner plus de travail au staff'), 2, 1, 4),
    (v_org_id, v_course_id, v_quiz_id, 'Un collaborateur motivé par la progression a surtout besoin de :', jsonb_build_array('Nouvelles compétences et opportunités d’apprentissage', 'Silence total', 'Moins de responsabilité', 'Aucun feedback'), 0, 1, 5),
    (v_org_id, v_course_id, v_quiz_id, 'Si une équipe ne connaît pas ses KPI, le risque principal est :', jsonb_build_array('Elle ne sait pas mesurer sa progression', 'Elle devient automatiquement plus rapide', 'Elle n’a plus besoin de suivi', 'Elle comprend mieux la vision'), 0, 1, 6),
    (v_org_id, v_course_id, v_quiz_id, 'Le niveau 2 de délégation signifie :', jsonb_build_array('Exécute comme indiqué', 'Analyse et propose', 'Décide puis informe', 'Prends tout en charge sans rendre compte'), 1, 1, 7),
    (v_org_id, v_course_id, v_quiz_id, 'Une bonne communication de leader doit réduire :', jsonb_build_array('La clarté', 'La responsabilité', 'Les interprétations et les ambiguïtés', 'Les résultats'), 2, 1, 8),
    (v_org_id, v_course_id, v_quiz_id, 'Le Team Alignment Meeting sert à :', jsonb_build_array('Parler sans sortie concrète', 'Clarifier vision, priorités, rôles, obstacles et suivi', 'Faire uniquement des annonces générales', 'Remplacer tout reporting'), 1, 1, 9),
    (v_org_id, v_course_id, v_quiz_id, 'Une équipe durablement performante combine :', jsonb_build_array('Confiance forte et responsabilité claire', 'Pression seule', 'Confort sans résultat', 'Absence de direction'), 0, 1, 10),
    (v_org_id, v_course_id, v_quiz_id, 'Un groupe de personnes devient automatiquement une équipe parce qu’elles travaillent dans le même département.', jsonb_build_array('Vrai', 'Faux'), 1, 1, 11),
    (v_org_id, v_course_id, v_quiz_id, 'Déléguer veut dire abandonner le suivi.', jsonb_build_array('Vrai', 'Faux'), 1, 1, 12),
    (v_org_id, v_course_id, v_quiz_id, 'Une instruction incomplète peut produire une exécution incomplète.', jsonb_build_array('Vrai', 'Faux'), 0, 1, 13),
    (v_org_id, v_course_id, v_quiz_id, 'Tous les collaborateurs sont motivés exactement par les mêmes choses.', jsonb_build_array('Vrai', 'Faux'), 1, 1, 14),
    (v_org_id, v_course_id, v_quiz_id, 'Les rôles flous peuvent créer des conflits, des retards et des responsabilités non assumées.', jsonb_build_array('Vrai', 'Faux'), 0, 1, 15);
  else
    raise notice 'Jour 2 quiz already has attempts; existing question bank preserved.';
  end if;

  -- JOUR 3 ---------------------------------------------------
  insert into public.academy_staff_training_module_quizzes (
    organization_id, course_id, module_label, title, passing_score, max_attempts,
    is_required, is_published, published_at, created_by
  ) values (
    v_org_id,
    v_course_id,
    'Jour 3',
    'Évaluation Jour 3 — Développer les autres & produire des résultats',
    75,
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

  if v_attempt_count = 0 then
    delete from public.academy_staff_training_module_quiz_questions where quiz_id = v_quiz_id;
    insert into public.academy_staff_training_module_quiz_questions
      (organization_id, course_id, quiz_id, question_text, options, correct_option, points, position)
    values
    (v_org_id, v_course_id, v_quiz_id, 'Quel comportement correspond le mieux à un leader qui développe les autres ?', jsonb_build_array('Faire les tâches critiques à leur place pour éviter les erreurs', 'Transférer progressivement une vraie responsabilité avec coaching et suivi', 'Attendre qu’ils demandent eux-mêmes une promotion', 'Donner uniquement des formations théoriques'), 1, 1, 1),
    (v_org_id, v_course_id, v_quiz_id, 'Lequel de ces éléments NE fait PAS partie du diagnostic proposé du potentiel ?', jsonb_build_array('Compétence', 'Attitude', 'Fiabilité', 'Ancienneté'), 3, 1, 2),
    (v_org_id, v_course_id, v_quiz_id, 'Quelle question appartient au coaching du manager ?', jsonb_build_array('Qui est responsable de cette erreur ?', 'Pourquoi n’as-tu pas fait exactement comme moi ?', 'Quelles options vois-tu ?', 'Quand vas-tu arrêter de poser des questions ?'), 2, 1, 3),
    (v_org_id, v_course_id, v_quiz_id, 'Quand le mode “manager” est-il particulièrement approprié ?', jsonb_build_array('Quand le risque est élevé et le standard non négociable', 'Quand l’objectif est uniquement de faire émerger plusieurs options', 'Quand on veut éviter toute instruction claire', 'Quand la personne doit décider d’une question stratégique hors de son autorité'), 0, 1, 4),
    (v_org_id, v_course_id, v_quiz_id, 'Quel est l’ordre du feedback constructif présenté dans la formation ?', jsonb_build_array('Action → Fait → Impact → Attente', 'Fait → Impact → Attente → Action', 'Impact → Action → Fait → Attente', 'Attente → Fait → Action → Impact'), 1, 1, 5),
    (v_org_id, v_course_id, v_quiz_id, 'Quelle formulation est la plus proche d’un feedback factuel ?', jsonb_build_array('Tu es toujours négligent', 'Tout le monde sait que tu n’es pas fiable', 'J’ai observé que le rapport de vendredi n’a pas été remis', 'Tu ne changeras jamais'), 2, 1, 6),
    (v_org_id, v_course_id, v_quiz_id, 'Une décision opérationnelle devrait généralement être prise…', jsonb_build_array('Au niveau le plus proche du problème, dans les limites de l’autorité', 'Toujours par la direction exécutive', 'Par le collaborateur le plus ancien, quel que soit son rôle', 'Uniquement après un vote de toute l’équipe'), 0, 1, 7),
    (v_org_id, v_course_id, v_quiz_id, 'Dans le cadre de décision, que doit-on préciser après la décision ?', jsonb_build_array('Le responsable, le délai et le suivi', 'Seulement le budget', 'Uniquement le nom du manager', 'Une nouvelle mission organisationnelle'), 0, 1, 8),
    (v_org_id, v_course_id, v_quiz_id, 'Avant d’escalader un problème, quelle approche est recommandée ?', jsonb_build_array('Présenter le problème sans proposer de solution pour rester neutre', 'Présenter les faits, les options et une recommandation', 'Attendre que le problème devienne urgent', 'Contourner le responsable concerné'), 1, 1, 9),
    (v_org_id, v_course_id, v_quiz_id, 'Quelle séquence correspond à la méthode de gestion des conflits ?', jsonb_build_array('Écouter → Clarifier → Identifier → Décider → Suivre', 'Décider → Accuser → Corriger → Fermer → Oublier', 'Écouter → Éviter → Reporter → Escalader → Sanctionner', 'Identifier → Punir → Décider → Expliquer → Fermer'), 0, 1, 10),
    (v_org_id, v_course_id, v_quiz_id, 'Quand peut-on dire que le leadership commence réellement à se multiplier ?', jsonb_build_array('Quand le leader peut faire davantage de tâches lui-même', 'Quand la personne développée devient capable de développer une autre personne', 'Quand l’équipe ne pose plus aucune question', 'Quand tous les collaborateurs ont le même style de travail'), 1, 1, 11),
    (v_org_id, v_course_id, v_quiz_id, 'Quel est le livrable central de l’atelier du Jour 3 ?', jsonb_build_array('Une liste générale de qualités du leader', 'Un plan de développement 30 jours pour un collaborateur réel', 'Un nouveau règlement intérieur', 'Une présentation marketing pour les clients'), 1, 1, 12);
  else
    raise notice 'Jour 3 quiz already has attempts; existing question bank preserved.';
  end if;
end $$;

commit;
