begin;

alter table public.academy_schools
  add column if not exists attendance_enrollment_scope text not null default 'program_cohort';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'academy_schools_attendance_enrollment_scope_check'
      and conrelid = 'public.academy_schools'::regclass
  ) then
    alter table public.academy_schools
      add constraint academy_schools_attendance_enrollment_scope_check
      check (attendance_enrollment_scope in ('program_cohort', 'school_wide'));
  end if;
end $$;

-- Règle métier iLEAD : dans ces quatre grandes écoles, une inscription active
-- à l'école donne accès à tous les programmes et à toutes les séances de l'école.
update public.academy_schools
set attendance_enrollment_scope = 'school_wide'
where is_active = true
  and (
    lower(name) like '%experts%'
    or lower(name) like '%affaires%'
    or lower(name) like '%coachs%'
    or lower(name) like '%leveurs%'
  );

commit;
