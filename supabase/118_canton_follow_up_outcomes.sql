-- QA ONLY: record an explicit result before a Canton follow-up can be completed.
alter table public.canton_appointments
 add column if not exists follow_up_outcome text,
 add column if not exists follow_up_result_note text,
 add column if not exists follow_up_completed_by uuid;

alter table public.canton_appointments
 drop constraint if exists canton_follow_up_outcome_check;
alter table public.canton_appointments
 add constraint canton_follow_up_outcome_check
 check (follow_up_outcome is null or follow_up_outcome in
 ('contacted','appointment_scheduled','proposal_sent','sale_closed',
  'no_response','not_interested','other'));

-- A new follow-up must not inherit the outcome of an earlier assignment.
-- Historic completed rows are left untouched; this constraint applies only
-- to future completed statuses written by the new UI.
