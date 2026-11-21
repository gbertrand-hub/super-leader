-- Stage-only: distinguish a dry-run from an actually delivered message.
-- No provider is connected in this release.
alter table public.canton_feedback_invitation_outbox
 drop constraint if exists canton_feedback_invitation_outbox_status_check;
alter table public.canton_feedback_invitation_outbox
 add constraint canton_feedback_invitation_outbox_status_check
 check (status in ('pending','cancelled','simulated','sent','failed'));
-- Historical and future real sends must use a separately approved provider integration.
