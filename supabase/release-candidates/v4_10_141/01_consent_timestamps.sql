-- Super Leader V4.10.141 R3-C2B
-- Independent Canton visitor feedback consent timestamps.
--
-- PREPARATION ONLY.
-- Do not apply to production before QA validation.
--
-- Existing email consent must be preserved.
-- No historical WhatsApp consent is inferred.

alter table public.canton_visitors
 add column if not exists feedback_email_opt_in_at timestamptz,
 add column if not exists feedback_whatsapp_opt_in_at timestamptz;

-- Preserve previously recorded email consent timestamps.
-- This is a historical backfill, not a new consent.

update public.canton_visitors
set feedback_email_opt_in_at = feedback_opt_in_at
where feedback_email_opt_in = true
  and feedback_opt_in_at is not null
  and feedback_email_opt_in_at is null;

-- Do not automatically populate WhatsApp consent timestamps.
-- Explicit channel-specific consent must be recorded separately.

comment on column public.canton_visitors.feedback_email_opt_in_at
is 'Timestamp of explicit visitor feedback email consent.';

comment on column public.canton_visitors.feedback_whatsapp_opt_in_at
is 'Timestamp of explicit visitor feedback WhatsApp consent.';

-- Record the provenance of explicit WhatsApp feedback consent.
-- Existing visitors remain opted out unless consent was recorded.

alter table public.canton_visitors
 add column if not exists feedback_whatsapp_opt_in_source text;

comment on column public.canton_visitors.feedback_whatsapp_opt_in_source
is 'Source of explicit WhatsApp feedback consent.';

-- Lock a WhatsApp consent to the number for which it was recorded.
-- Existing opted-in visitors without this value remain ineligible for WhatsApp.
alter table public.canton_visitors
 add column if not exists feedback_whatsapp_consent_phone text;

-- Revoke pending/sending delivery when explicit permission is withdrawn.
-- Already accepted provider messages remain in the audit history.
create or replace function public.canton_cancel_feedback_on_consent_revoke()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if old.feedback_email_opt_in and not new.feedback_email_opt_in then
  update public.canton_feedback_invitation_outbox o
  set status='cancelled', processed_at=now(), reason='email_consent_revoked'
  from public.canton_appointments a
  where a.id=o.appointment_id and a.organization_id=new.organization_id
    and a.visitor_id=new.id and o.organization_id=new.organization_id
    and o.channel='email' and o.status in ('pending','sending');
 end if;
 if old.feedback_whatsapp_opt_in and not new.feedback_whatsapp_opt_in then
  update public.canton_feedback_invitation_outbox o
  set status='cancelled', processed_at=now(), reason='whatsapp_consent_revoked'
  from public.canton_appointments a
  where a.id=o.appointment_id and a.organization_id=new.organization_id
    and a.visitor_id=new.id and o.organization_id=new.organization_id
    and o.channel='whatsapp' and o.status in ('pending','sending');
 end if;
 return new;
end $$;
drop trigger if exists canton_feedback_consent_revoke on public.canton_visitors;
create trigger canton_feedback_consent_revoke
 after update of feedback_email_opt_in,feedback_whatsapp_opt_in
 on public.canton_visitors for each row
 execute function public.canton_cancel_feedback_on_consent_revoke();
revoke execute on function public.canton_cancel_feedback_on_consent_revoke()
 from public,anon,authenticated;
