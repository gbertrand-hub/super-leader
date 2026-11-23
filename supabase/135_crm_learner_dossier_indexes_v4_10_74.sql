-- Super Leader V4.10.74 - Index du dossier CRM apprenant
begin;

create index if not exists academy_enrollments_org_user_lookup_idx
  on public.academy_school_enrollments (organization_id, user_id, created_at desc)
  where user_id is not null;

create index if not exists academy_enrollments_org_crm_lookup_idx
  on public.academy_school_enrollments (organization_id, crm_client_id, created_at desc)
  where crm_client_id is not null;

create index if not exists academy_finance_enrollment_lookup_idx
  on public.academy_student_finance (enrollment_id);

create index if not exists academy_progress_enrollment_lookup_idx
  on public.academy_student_progress (enrollment_id);

commit;
