-- Super Leader V4.8.24 - Photo d'étudiant et snapshot sur la carte
begin;
alter table public.crm_clients add column if not exists student_photo_storage_path text;

create or replace function public.issue_academy_student_card(p_enrollment_id uuid,p_actor_id uuid,p_valid_from date,p_valid_until date,p_reason text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare e record; person_name text; person_photo text; prior record; next_issue int; seq int; new_id uuid; new_number text;
begin
 if p_valid_from is null or p_valid_until is null or p_valid_until<p_valid_from then raise exception 'Invalid validity period'; end if;
 select enrollment.*,school.name school_name,school.logo_storage_path,program.name program_name,cohort.name cohort_name,coalesce(finance.is_internal_training,false) internal_training
 into e from public.academy_school_enrollments enrollment join public.academy_schools school on school.id=enrollment.school_id
 left join public.academy_programs program on program.id=enrollment.program_id left join public.academy_cohorts cohort on cohort.id=enrollment.cohort_id
 left join public.academy_student_finance finance on finance.enrollment_id=enrollment.id where enrollment.id=p_enrollment_id;
 if not found then raise exception 'Enrollment not found'; end if;
 if e.user_id is not null then select coalesce(full_name,email,'Etudiant'),avatar_storage_path into person_name,person_photo from public.profiles where id=e.user_id;
 else select full_name,student_photo_storage_path into person_name,person_photo from public.crm_clients where id=e.crm_client_id and organization_id=e.organization_id; end if;
 if person_name is null then raise exception 'Student identity not found'; end if;
 select * into prior from public.academy_student_cards where enrollment_id=p_enrollment_id and status in ('active','suspended') for update;
 select coalesce(max(issue_number),0)+1 into next_issue from public.academy_student_cards where enrollment_id=p_enrollment_id;
 insert into public.academy_student_card_counters(organization_id,card_year,last_number) values(e.organization_id,extract(year from p_valid_from)::int,1)
 on conflict(organization_id,card_year) do update set last_number=academy_student_card_counters.last_number+1 returning last_number into seq;
 new_number:='ILEAD-STU-'||extract(year from p_valid_from)::int||'-'||lpad(seq::text,6,'0');
 if prior.id is not null then update public.academy_student_cards set status='replaced',updated_at=now() where id=prior.id; end if;
 insert into public.academy_student_cards(organization_id,enrollment_id,card_number,issue_number,valid_from,valid_until,issued_by,full_name_snapshot,school_name_snapshot,program_name_snapshot,cohort_name_snapshot,academic_status_snapshot,internal_training_snapshot,school_logo_storage_path_snapshot,photo_url_snapshot)
 values(e.organization_id,p_enrollment_id,new_number,next_issue,p_valid_from,p_valid_until,p_actor_id,person_name,e.school_name,e.program_name,e.cohort_name,e.academic_status,e.internal_training,e.logo_storage_path,person_photo) returning id into new_id;
 if prior.id is not null then update public.academy_student_cards set replaced_by_card_id=new_id where id=prior.id; end if;
 insert into public.academy_student_card_audit_log(organization_id,enrollment_id,card_id,actor_id,action,details) values(e.organization_id,p_enrollment_id,new_id,p_actor_id,case when prior.id is null then 'issued' else 'reissued' end,jsonb_build_object('reason',p_reason));return new_id;
end $$;
grant execute on function public.issue_academy_student_card(uuid,uuid,date,date,text) to service_role;
commit;
