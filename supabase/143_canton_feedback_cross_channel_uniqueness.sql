-- SUPER LEADER V4.10.141 R3-C3A
--
-- Cross-channel invitation uniqueness.
--
-- PREPARATION ONLY.
-- Test on compatible QA database before production.
--
-- This migration does not:
-- - send messages
-- - enable WhatsApp
-- - modify CRM tables
-- - delete historical invitations
--
-- Existing email delivery remains unchanged.

begin;

-- Reject the migration if existing records already violate
-- the intended cross-channel uniqueness rule.
do $$
declare
  duplicate_count integer;
begin
  select count(*)
  into duplicate_count
  from (
    select appointment_id
    from public.canton_feedback_invitation_outbox
    where status in (
      'pending',
      'sending',
      'sent',
      'failed'
    )
    group by appointment_id
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    raise exception
      'Cannot enable cross-channel uniqueness: % conflicting appointments',
      duplicate_count;
  end if;
end $$;

-- Only one non-cancelled delivery lifecycle per visit.
-- Historical cancelled rows remain available for auditing.
-- QA simulated records are excluded because they never
-- represent external delivery.

create unique index if not exists
  canton_feedback_one_delivery_per_visit_idx
on public.canton_feedback_invitation_outbox (
  appointment_id
)
where status in (
  'pending',
  'sending',
  'sent',
  'failed'
);

comment on index public.canton_feedback_one_delivery_per_visit_idx
is 'Prevents simultaneous email and WhatsApp feedback delivery lifecycles for one Canton visit.';

commit;