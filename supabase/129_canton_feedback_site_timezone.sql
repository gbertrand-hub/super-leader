-- V4.10.132 feedback escalation must use the appointment site's timezone.
create or replace function public.canton_escalate_feedback()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
 v_timezone text;
 v_due_date date;
begin
 if new.rating<=2 or new.contact_requested then
  select s.timezone
  into v_timezone
  from public.canton_appointments a
  left join public.visitor_sites s
    on s.id=a.site_id
   and s.organization_id=a.organization_id
   and s.is_active=true
  where a.id=new.appointment_id;

  -- Legacy fallback only. New production visits should always have site_id.
  v_timezone:=coalesce(v_timezone,'America/Chicago');
  v_due_date:=(now() at time zone v_timezone)::date+1;

  update public.canton_appointments
  set follow_up_required=true,
      follow_up_status=case when follow_up_status='completed' then 'completed' else 'open' end,
      follow_up_due_date=coalesce(follow_up_due_date,v_due_date),
      follow_up_note=coalesce(nullif(follow_up_note,''),'Visitor feedback requires manager review'),
      updated_at=now()
  where id=new.appointment_id
    and status='completed';
 end if;
 return new;
end $$;

revoke all on function public.canton_escalate_feedback()
 from public,anon,authenticated;
grant execute on function public.canton_escalate_feedback()
 to service_role;
