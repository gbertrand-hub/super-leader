-- Visitor & Appointment Management - production bootstrap (prepare only)
-- TARGET: Super Leader production Supabase project jjbuxrlvxnlnrjcorpwt
-- ORGANIZATION: iLEAD Global (7681043d-2ce8-47e7-bb93-6dacef906875)
-- Run only AFTER the approved Canton/Visitor schema migrations have completed.

do $$
begin
  if not exists (
    select 1 from public.organizations
    where id='7681043d-2ce8-47e7-bb93-6dacef906875'::uuid
      and name='iLEAD Global'
  ) then
    raise exception 'Expected production organization not found';
  end if;
end $$;

insert into public.visitor_sites
 (organization_id,code,name,city,country_code,timezone,street_address,is_hq,is_active)
values
 ('7681043d-2ce8-47e7-bb93-6dacef906875'::uuid,
  'CANTON_HQ','Canton HQ','Canton','US','America/Chicago',
  '3540 Van Zandt County Road 2410, Canton, Texas 75103, United States',
  true,true)
on conflict(organization_id,code) do update set
 name=excluded.name,
 city=excluded.city,
 country_code=excluded.country_code,
 timezone=excluded.timezone,
 street_address=excluded.street_address,
 is_hq=true,
 is_active=true,
 updated_at=now();

-- Browser roles must not use server-only Canton/Visitor tables directly.
revoke all on table
 public.canton_visitors,
 public.canton_appointments,
 public.canton_visit_feedback,
 public.canton_qr_sites,
 public.canton_intake_requests,
 public.canton_reception_staff,
 public.canton_qr_feedback_attempts,
 public.canton_anonymous_feedback,
 public.canton_feedback_invitation_outbox,
 public.canton_next_actions,
 public.canton_arrival_alerts,
 public.canton_sla_recoveries,
 public.visitor_sites,
 public.visitor_site_staff
from anon, authenticated;

-- Server application access.
grant usage on schema public to service_role;
grant select,insert,update,delete on table
 public.canton_visitors,
 public.canton_appointments,
 public.canton_visit_feedback,
 public.canton_qr_sites,
 public.canton_intake_requests,
 public.canton_reception_staff,
 public.canton_qr_feedback_attempts,
 public.canton_anonymous_feedback,
 public.canton_feedback_invitation_outbox,
 public.canton_next_actions,
 public.canton_arrival_alerts,
 public.canton_sla_recoveries,
 public.visitor_sites,
 public.visitor_site_staff
to service_role;

grant usage,select on all sequences in schema public to service_role;

-- Harden Canton RPCs / trigger helpers.
revoke execute on function public.canton_find_feedback_visit(uuid,text,text) from public,anon,authenticated;
grant execute on function public.canton_find_feedback_visit(uuid,text,text) to service_role;

revoke execute on function public.canton_approve_qr_intake(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.canton_approve_qr_intake(uuid,uuid,uuid) to service_role;

revoke execute on function public.canton_cancel_feedback_invitation() from public,anon,authenticated;
grant execute on function public.canton_cancel_feedback_invitation() to service_role;

revoke execute on function public.canton_schedule_feedback_invitation() from public,anon,authenticated;
grant execute on function public.canton_schedule_feedback_invitation() to service_role;

revoke execute on function public.canton_create_arrival_alert() from public,anon,authenticated;
grant execute on function public.canton_create_arrival_alert() to service_role;

-- Verify expected HQ row.
do $$
declare n integer;
begin
 select count(*) into n
 from public.visitor_sites
 where organization_id='7681043d-2ce8-47e7-bb93-6dacef906875'::uuid
   and is_hq=true and is_active=true;
 if n<>1 then
   raise exception 'Expected exactly one active HQ, found %',n;
 end if;
end $$;


-- Seed the production Canton QR reception and bind it to the operational HQ site.
insert into public.canton_qr_sites(
 organization_id,label,enabled,street_address,visitor_site_id
)
select
 '7681043d-2ce8-47e7-bb93-6dacef906875'::uuid,
 'Canton Main Reception',
 true,
 '3540 Van Zandt County Road 2410, Canton, Texas 75103, United States',
 s.id
from public.visitor_sites s
where s.organization_id='7681043d-2ce8-47e7-bb93-6dacef906875'::uuid
  and s.code='CANTON_HQ'
  and s.is_active=true
  and not exists (
    select 1 from public.canton_qr_sites q
    where q.organization_id='7681043d-2ce8-47e7-bb93-6dacef906875'::uuid
      and q.visitor_site_id=s.id
      and q.enabled=true
  );
