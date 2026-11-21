-- Atomic QR arrival approval to avoid orphaned or multiply approved requests.
-- This function executes with the caller's rights (service-role-only server action).
create or replace function public.canton_approve_qr_intake(p_request_id uuid,p_organization_id uuid,p_actor_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
 req record;
 visitor uuid;
 crm uuid;
 candidates uuid[];
 visit uuid;
begin
 select * into req from public.canton_intake_requests
 where id=p_request_id and organization_id=p_organization_id and status='pending' for update;
 if not found then raise exception 'QR request not pending'; end if;
 if req.email is not null then
  select id into visitor from public.canton_visitors
  where organization_id=p_organization_id and email=req.email limit 1;
 end if;
 if req.phone is not null then
  if exists(select 1 from public.canton_visitors where organization_id=p_organization_id and phone=req.phone
    and visitor is not null and id<>visitor) then
   raise exception 'Visitor phone/email identity mismatch';
  end if;
  if visitor is null then
   select id into visitor from public.canton_visitors
   where organization_id=p_organization_id and phone=req.phone limit 1;
  end if;
 end if;
 if visitor is null then
  select array_agg(distinct id) into candidates from public.crm_clients
   where organization_id=p_organization_id and
    ((req.email is not null and email=req.email) or (req.phone is not null and phone=req.phone));
  if coalesce(array_length(candidates,1),0)>1 then
   raise exception 'Multiple CRM identities require manual review';
  end if;
  crm:=candidates[1];
  insert into public.canton_visitors(organization_id,full_name,email,phone,crm_client_id,created_by)
  values(p_organization_id,req.full_name,req.email,req.phone,crm,p_actor_id)
  returning id into visitor;
 end if;
 insert into public.canton_appointments(organization_id,visitor_id,department,purpose,status,check_in_at,announced_by)
 values(p_organization_id,visitor,req.department,req.purpose,'arrived',now(),p_actor_id)
 returning id into visit;
 update public.canton_intake_requests
 set status='approved',reviewed_by=p_actor_id,reviewed_at=now(),appointment_id=visit
 where id=p_request_id and organization_id=p_organization_id and status='pending';
 return visit;
end $$;
revoke all on function public.canton_approve_qr_intake(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.canton_approve_qr_intake(uuid,uuid,uuid) to service_role;
