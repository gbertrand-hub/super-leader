-- SUPER LEADER V4.10.141 R3-C3B
-- Canton visitor feedback channel scheduling.
--
-- PREPARATION ONLY.
-- DO NOT APPLY BEFORE QA VALIDATION.
--
-- Dependencies:
--   142_canton_feedback_consent_timestamps.sql
--   143_canton_feedback_cross_channel_uniqueness.sql
--
-- WhatsApp is DISABLED BY DEFAULT.
-- This migration does not send messages.
-- Existing CRM communication remains unchanged.

begin;

-- Independent organization-level configuration.
create table if not exists public.canton_feedback_delivery_settings (
 organization_id uuid primary key
   references public.organizations(id) on delete cascade,
 whatsapp_enabled boolean not null default false,
 whatsapp_template_ready boolean not null default false,
 updated_at timestamptz not null default now()
);

alter table public.canton_feedback_delivery_settings
 enable row level security;

revoke all on public.canton_feedback_delivery_settings
 from anon, authenticated;

grant select,insert,update
 on public.canton_feedback_delivery_settings
 to service_role;

comment on table public.canton_feedback_delivery_settings
is 'Visitor feedback delivery configuration. WhatsApp disabled by default.';

-- Replace only the Canton feedback invitation scheduler.
-- Existing email and CRM delivery functions are not modified.

create or replace function public.canton_schedule_feedback_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
 v record;
 v_whatsapp_enabled boolean := false;
 v_template_ready boolean := false;
 v_channel text := null;
begin

 if new.status <> 'completed'
    or old.status is not distinct from 'completed'
    or new.check_out_at is null
 then
  return new;
 end if;

 -- Never schedule another invitation if feedback already exists.
 if exists (
  select 1
  from public.canton_visit_feedback f
  where f.appointment_id = new.id
 ) then
  return new;
 end if;

 -- Do not create another active or previously processed invitation.
 if exists (
  select 1
  from public.canton_feedback_invitation_outbox o
  where o.appointment_id = new.id
    and o.status in ('pending','sending','sent','failed')
 ) then
  return new;
 end if;

 -- Disabled unless explicitly configured by authorized administration.
 select
  coalesce(s.whatsapp_enabled,false),
  coalesce(s.whatsapp_template_ready,false)
 into v_whatsapp_enabled,v_template_ready
 from public.canton_feedback_delivery_settings s
 where s.organization_id = new.organization_id;

 v_whatsapp_enabled := coalesce(v_whatsapp_enabled,false);

 select
  email,
  phone,
  feedback_email_opt_in,
  feedback_whatsapp_opt_in,
  feedback_opt_in_at,
  feedback_whatsapp_opt_in_at
 into v
 from public.canton_visitors
 where id = new.visitor_id
   and organization_id = new.organization_id;

 if not found then
  return new;
 end if;

 -- WhatsApp priority only when the organization has enabled it.
 if v_whatsapp_enabled and v_template_ready
    and coalesce(v.feedback_whatsapp_opt_in,false)
    and v.feedback_whatsapp_opt_in_at is not null
    and v.phone ~ '^\+[1-9][0-9]{7,14}$'
 then
  v_channel := 'whatsapp';

 -- Otherwise preserve the existing authorized email channel.
 elsif coalesce(v.feedback_email_opt_in,false)
    and v.feedback_opt_in_at is not null
    and v.email is not null
    and position('@' in v.email) > 1
 then
  v_channel := 'email';
 end if;

 if v_channel is null then
  return new;
 end if;

 insert into public.canton_feedback_invitation_outbox (
  organization_id,
  appointment_id,
  channel,
  status,
  due_at
 )
 values (
  new.organization_id,
  new.id,
  v_channel,
  'pending',
  new.check_out_at + interval '15 minutes'
 )
 on conflict do nothing;

 return new;
end
$$;

-- Preserve existing trigger wiring.
-- CREATE OR REPLACE FUNCTION updates its implementation.

revoke execute on function
 public.canton_schedule_feedback_invitation()
 from public, anon, authenticated;

grant execute on function
 public.canton_schedule_feedback_invitation()
 to service_role;

commit;