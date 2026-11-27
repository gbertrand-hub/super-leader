-- SUPER LEADER V4.10.141 R3-C3C
--
-- WhatsApp feedback invitation claim and acknowledgement.
--
-- CANDIDATE ONLY - DO NOT APPLY TO PRODUCTION.
--
-- Requires migrations 142, 143 and 144.
--
-- No provider calls.
-- No external messages.
-- No CRM changes.
--
-- The WhatsApp delivery worker is NOT enabled by this migration.

begin;

create or replace function public.canton_claim_whatsapp_feedback_invitation(
 p_appointment_id uuid,
 p_claim_token uuid
)
returns table(
 id uuid,
 organization_id uuid,
 appointment_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
 rec record;
begin

 if p_appointment_id is null or p_claim_token is null then
  raise exception 'Appointment and claim token required';
 end if;

 select
  o.id,
  o.organization_id,
  o.appointment_id
 into rec
 from public.canton_feedback_invitation_outbox o

 join public.canton_appointments a
   on a.id = o.appointment_id
  and a.organization_id = o.organization_id

 join public.canton_visitors v
   on v.id = a.visitor_id
  and v.organization_id = a.organization_id

 join public.canton_feedback_delivery_settings s
   on s.organization_id = o.organization_id

 where o.appointment_id = p_appointment_id
   and o.channel = 'whatsapp'
   and o.status = 'pending'
   and o.due_at <= now()

   and a.status = 'completed'
   and a.check_out_at is not null

   and s.whatsapp_enabled = true
   and s.whatsapp_template_ready = true

   and v.feedback_whatsapp_opt_in = true
   and v.feedback_whatsapp_opt_in_at is not null
   and v.feedback_whatsapp_consent_phone = v.phone
   and v.phone ~ '^\+[1-9][0-9]{7,14}$'

   and not exists (
    select 1
    from public.canton_visit_feedback f
    where f.appointment_id = a.id
   )

   and not exists (
    select 1
    from public.canton_feedback_invitation_outbox other
    where other.appointment_id = o.appointment_id
      and other.id <> o.id
      and other.status in (
       'pending','sending','sent','failed'
      )
   )

 for update of o skip locked;

 if not found then
  return;
 end if;

 update public.canton_feedback_invitation_outbox o
 set
  status = 'sending',
  claim_token = p_claim_token,
  claimed_at = now(),
  last_attempt_at = now(),
  attempt_count = o.attempt_count + 1,
  reason = 'whatsapp_provider_request_in_progress'
 where o.id = rec.id
   and o.status = 'pending';

 id := rec.id;
 organization_id := rec.organization_id;
 appointment_id := rec.appointment_id;

 return next;

end
$$;

revoke all on function
 public.canton_claim_whatsapp_feedback_invitation(uuid,uuid)
 from public,anon,authenticated;

grant execute on function
 public.canton_claim_whatsapp_feedback_invitation(uuid,uuid)
 to service_role;


-- Acknowledge a claimed WhatsApp delivery.
-- A cancelled invitation cannot be marked as sent.

create or replace function public.canton_ack_whatsapp_feedback_invitation(
 p_appointment_id uuid,
 p_claim_token uuid,
 p_status text,
 p_provider_message_id text default null,
 p_error_code text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
 affected integer;
begin

 if p_status not in ('sent','failed') then
  raise exception 'Invalid WhatsApp delivery status';
 end if;

 if p_claim_token is null then
  raise exception 'Claim token required';
 end if;
 if p_status = 'sent' and nullif(trim(p_provider_message_id),'') is null then
  raise exception 'Provider message id required for accepted WhatsApp send';
 end if;

 update public.canton_feedback_invitation_outbox
 set
  status = p_status,
  processed_at = now(),

  provider_message_id =
   case
    when p_status = 'sent'
    then left(p_provider_message_id,160)
    else null
   end,

  provider_error_code =
   case
    when p_status = 'failed'
    then left(coalesce(p_error_code,'provider_failed'),100)
    else null
   end,

  reason =
   case
    when p_status = 'sent'
    then 'whatsapp_provider_accepted'
    else 'whatsapp_failed_no_auto_retry'
   end

 where appointment_id = p_appointment_id
   and channel = 'whatsapp'
   and status = 'sending'
   and claim_token = p_claim_token;

 get diagnostics affected = row_count;

 return affected = 1;

end
$$;

revoke all on function
 public.canton_ack_whatsapp_feedback_invitation(
  uuid,uuid,text,text,text
 )
 from public,anon,authenticated;

grant execute on function
 public.canton_ack_whatsapp_feedback_invitation(
  uuid,uuid,text,text,text
 )
 to service_role;

commit;