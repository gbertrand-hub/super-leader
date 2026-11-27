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
