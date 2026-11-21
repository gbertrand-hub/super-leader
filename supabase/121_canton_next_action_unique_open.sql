-- QA: protect against two concurrent next-action submissions for the same appointment.
create unique index if not exists canton_next_action_one_open_per_appointment
 on public.canton_next_actions(appointment_id)
 where status='open';
