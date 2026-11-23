begin;

alter table public.academy_staff_training_module_quizzes
  add column if not exists available_from timestamptz,
  add column if not exists available_until timestamptz;

alter table public.academy_staff_training_module_quizzes
  drop constraint if exists academy_staff_training_module_quizzes_availability_check;

alter table public.academy_staff_training_module_quizzes
  add constraint academy_staff_training_module_quizzes_availability_check
  check (
    available_until is null
    or available_from is null
    or available_until > available_from
  );

create index if not exists academy_staff_training_module_quizzes_availability_idx
  on public.academy_staff_training_module_quizzes
  (organization_id, course_id, is_published, available_from, available_until);

-- V4.9.8 safety default for the September 2026 staff training:
-- lock all day/module quizzes until the trainer explicitly opens the relevant day.
-- Existing questions and attempts are preserved.
update public.academy_staff_training_module_quizzes q
set
  is_published = false,
  published_at = null,
  available_from = null,
  available_until = null,
  updated_at = now()
where exists (
  select 1
  from public.academy_courses c
  where c.id = q.course_id
    and c.organization_id = q.organization_id
    and c.is_staff_training = true
    and c.training_month = date '2026-09-01'
    and lower(trim(c.title)) = 'staff training'
)
and lower(trim(q.module_label)) in ('jour 1', 'jour 2', 'jour 3');

-- Keep direct authenticated reads aligned with the release window.
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
          and (academy_staff_training_module_quizzes.available_from is null or now() >= academy_staff_training_module_quizzes.available_from)
          and (academy_staff_training_module_quizzes.available_until is null or now() <= academy_staff_training_module_quizzes.available_until)
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
          and (q.available_from is null or now() >= q.available_from)
          and (q.available_until is null or now() <= q.available_until)
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

commit;
