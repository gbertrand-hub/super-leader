-- Super Leader V4.8.74 - Academy Enrollment Integrity & School Data Analyst
begin;

-- Add the school Data Analyst role without changing organization roles.
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
    'data_analyst',
    'observer'
  ));

-- Helpful index for Academy data-quality queues.
create index if not exists academy_school_enrollments_incomplete_scope_idx
  on public.academy_school_enrollments(organization_id, school_id, program_id, cohort_id);

commit;
