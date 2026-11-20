-- QA email delivery worker state machine. Keeps existing simulation untouched.
-- Single claim; no automatic reclaim of 'sending' on provider ambiguity.
alter table public.canton_feedback_invitation_outbox
 drop constraint if exists canton_feedback_invitation_outbox_status_check;
alter table public.canton_feedback_invitation_outbox
 add constraint canton_feedback_invitation_outbox_status_check
 check(status in ('pending','cancelled','simulated','sending','sent','failed'));
alter table public.canton_feedback_invitation_outbox
 add column if not exists claim_token uuid,
 add column if not exists claimed_at timestamptz,
 add column if not exists provider_message_id text,
 add column if not exists provider_error_code text;
create unique index if not exists canton_feedback_unique_claim_token
 on public.canton_feedback_invitation_outbox(claim_token) where claim_token is not null;

-- Only the isolated QA project/organization and an explicit service-role caller may invoke.
-- Claims under lock; does not expose personal data to the client.
create or replace function public.canton_claim_email_invitation(
 p_organization_id uuid,p_appointment_id uuid,p_claim_token uuid
) returns table(id uuid,appointment_id uuid)
language plpgsql security invoker set search_path='' as $$
declare rec record;
begin
 if p_organization_id<>'021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid
    or p_claim_token is null then raise exception 'QA only'; end if;
 select o.id as outbox_id,o.appointment_id as apt_id,a.status as visit_status,
        a.check_out_at,v.email,v.feedback_email_opt_in,v.feedback_opt_in_at
 into rec
 from public.canton_feedback_invitation_outbox o
 join public.canton_appointments a on a.id=o.appointment_id and a.organization_id=o.organization_id
 join public.canton_visitors v on v.id=a.visitor_id and v.organization_id=a.organization_id
 where o.organization_id=p_organization_id
 and o.appointment_id=p_appointment_id and o.channel='email'
 and o.status='pending' and o.due_at<=now()
 for update of o skip locked;
 if not found then return; end if;
 if rec.visit_status<>'completed' or rec.check_out_at is null or
   not coalesce(rec.feedback_email_opt_in,false) or rec.feedback_opt_in_at is null or
   rec.email is null or position('@' in rec.email)<=1 or
   exists(select 1 from public.canton_visit_feedback f where f.appointment_id=p_appointment_id) then
   update public.canton_feedback_invitation_outbox
   set status='cancelled',reason='pre_send_validation_failed',processed_at=now()
   where public.canton_feedback_invitation_outbox.id=rec.outbox_id;
   return;
 end if;
 update public.canton_feedback_invitation_outbox o
 set status='sending',claim_token=p_claim_token,claimed_at=now(),
 last_attempt_at=now(),attempt_count=o.attempt_count+1,reason='provider_request_in_progress'
 where o.id=rec.outbox_id;
 id:=rec.outbox_id;appointment_id:=rec.apt_id;return next;
end $$;
revoke all on function public.canton_claim_email_invitation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.canton_claim_email_invitation(uuid,uuid,uuid) to service_role;

create or replace function public.canton_ack_email_invitation(
 p_organization_id uuid,p_appointment_id uuid,p_claim_token uuid,
 p_status text,p_provider_message_id text default null,p_error_code text default null
) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if p_organization_id<>'021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid
 or p_status not in ('sent','failed') then raise exception 'Invalid QA delivery acknowledgement'; end if;
 update public.canton_feedback_invitation_outbox o set
  status=p_status,processed_at=now(),
  provider_message_id=case when p_status='sent' then left(p_provider_message_id,160) else null end,
  provider_error_code=case when p_status='failed' then left(coalesce(p_error_code,'provider_failed'),100) else null end,
  reason=case when p_status='sent' then 'resend_accepted' else 'provider_failed_no_auto_retry' end
 where o.organization_id=p_organization_id and o.appointment_id=p_appointment_id
 and o.channel='email' and o.status='sending' and o.claim_token=p_claim_token;
 get diagnostics n=row_count;
 return n=1;
end $$;
revoke all on function public.canton_ack_email_invitation(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.canton_ack_email_invitation(uuid,uuid,uuid,text,text,text) to service_role;
