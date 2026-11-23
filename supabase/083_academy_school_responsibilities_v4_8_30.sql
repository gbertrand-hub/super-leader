-- Super Leader V4.8.30 - Fonctions Communication et Marketing
begin;

alter table public.academy_staff_assignments
  drop constraint if exists academy_staff_assignments_assignment_role_check;

alter table public.academy_staff_assignments
  add constraint academy_staff_assignments_assignment_role_check
  check (assignment_role in (
    'director',
    'academic_coordinator',
    'instructor',
    'follow_up',
    'finance',
    'communication',
    'marketing',
    'observer'
  ));

commit;
