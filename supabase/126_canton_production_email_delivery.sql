-- V4.10.132 Canton production email delivery state.
-- Generic production-safe state machine; contains no QA organization id.

alter table public.canton_feedback_invitation_outbox
 drop constraint if exists canton_feedback_invitation_outbox_status_check;

alter table public.canton_feedback_invitation_outbox
 add constraint canton_feedback_invitation_outbox_status_check
 check(status in ('pending','cancelled','sending','sent','failed'));

alter table public.canton_feedback_invitation_outbox
 add column if not exists attempt_count integer not null default 0,
 add column if not exists last_attempt_at timestamptz,
 add column if not exists claim_token uuid,
 add column if not exists claimed_at timestamptz,
 add column if not exists provider_message_id text,
 add column if not exists provider_error_code text;

create unique index if not exists canton_feedback_unique_claim_token
 on public.canton_feedback_invitation_outbox(claim_token)
 where claim_token is not null;

-- If feedback arrives while an invitation is still queued or claimed,
-- cancel it before any later worker can send another message.
create or replace function public.canton_cancel_feedback_invitation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
 update public.canton_feedback_invitation_outbox
 set status='cancelled',
     processed_at=now(),
     reason='feedback_submitted'
 where appointment_id=new.appointment_id
   and status in ('pending','sending');
 return new;
end $$;

revoke execute on function public.canton_cancel_feedback_invitation()
 from public,anon,authenticated;
grant execute on function public.canton_cancel_feedback_invitation()
 to service_role;
