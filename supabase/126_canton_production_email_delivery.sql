-- V4.10.132 Canton production email delivery state.
-- Generic production-safe state machine; contains no QA organization id.

alter table public.canton_feedback_invitation_outbox
 drop constraint if exists canton_feedback_invitation_outbox_status_check;

alter table public.canton_feedback_invitation_outbox
 add constraint canton_feedback_invitation_outbox_status_check
 check(status in ('pending','cancelled','simulated','sending','sent','failed'));

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


create or replace function public.canton_claim_feedback_invitation(
 p_appointment_id uuid,p_claim_token uuid
) returns table(id uuid,organization_id uuid,appointment_id uuid)
language plpgsql security invoker set search_path='' as $$
declare rec record;
begin
 if p_claim_token is null then raise exception 'Claim token required'; end if;
 select o.id,o.organization_id,o.appointment_id
 into rec
 from public.canton_feedback_invitation_outbox o
 where o.appointment_id=p_appointment_id
   and o.channel='email'
   and o.status='pending'
   and o.due_at<=now()
 for update of o skip locked;
 if not found then return; end if;

 update public.canton_feedback_invitation_outbox
 set status='sending',claim_token=p_claim_token,claimed_at=now(),
     last_attempt_at=now(),attempt_count=attempt_count+1,
     reason='provider_request_in_progress'
 where public.canton_feedback_invitation_outbox.id=rec.id;

 id:=rec.id;organization_id:=rec.organization_id;appointment_id:=rec.appointment_id;
 return next;
end $$;

revoke all on function public.canton_claim_feedback_invitation(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.canton_claim_feedback_invitation(uuid,uuid)
 to service_role;

create or replace function public.canton_ack_feedback_invitation(
 p_appointment_id uuid,p_claim_token uuid,p_status text,
 p_provider_message_id text default null,p_error_code text default null
) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if p_status not in ('sent','failed') then raise exception 'Invalid delivery status'; end if;

 update public.canton_feedback_invitation_outbox
 set status=p_status,
     processed_at=now(),
     provider_message_id=case when p_status='sent' then left(p_provider_message_id,160) else null end,
     provider_error_code=case when p_status='failed' then left(coalesce(p_error_code,'provider_failed'),100) else null end,
     reason=case when p_status='sent' then 'provider_accepted' else 'provider_failed_no_auto_retry' end
 where appointment_id=p_appointment_id
   and channel='email'
   and status='sending'
   and claim_token=p_claim_token;

 get diagnostics n=row_count;
 return n=1;
end $$;

revoke all on function public.canton_ack_feedback_invitation(uuid,uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function public.canton_ack_feedback_invitation(uuid,uuid,text,text,text)
 to service_role;
