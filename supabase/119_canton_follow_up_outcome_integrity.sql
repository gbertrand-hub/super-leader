-- QA only defense in depth: a follow-up cannot be marked complete without a recorded outcome.
-- Scope to the isolated Canton test organization; other organizations remain unaffected.
alter table public.canton_appointments
 drop constraint if exists canton_qa_follow_up_completion_requires_result;
alter table public.canton_appointments
 add constraint canton_qa_follow_up_completion_requires_result
 check(
  organization_id<>'021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid
  or follow_up_status is distinct from 'completed'
  or (
   follow_up_outcome is not null
   and length(btrim(coalesce(follow_up_result_note,'')))>=5
   and follow_up_completed_by is not null
   and follow_up_completed_at is not null
  )
 );
