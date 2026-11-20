-- QA-only code-free QR matching, without public read grants.
-- Requires exact case-insensitive name plus the final four digits of the phone.
-- Returns at most two candidates: when ambiguous the server rejects rather than guessing.
create or replace function public.canton_find_feedback_visit(
 p_organization_id uuid,p_name text,p_last4 text
) returns table(appointment_id uuid)
language sql security invoker set search_path='' as $$
 select a.id
 from public.canton_appointments a
 join public.canton_visitors v
   on v.id=a.visitor_id and v.organization_id=a.organization_id
 where a.organization_id=p_organization_id
   and a.status='completed'
   and a.check_out_at is not null
   and a.check_out_at>=now()-interval '7 days'
   and lower(regexp_replace(btrim(v.full_name),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim(p_name),'[[:space:]]+',' ','g'))
   and right(regexp_replace(coalesce(v.phone,''),'[^0-9]','','g'),4)=p_last4
   and length(p_last4)=4
   and not exists (select 1 from public.canton_visit_feedback f where f.appointment_id=a.id)
 order by a.check_out_at desc
 limit 2
$$;
revoke all on function public.canton_find_feedback_visit(uuid,text,text) from public,anon,authenticated;
grant execute on function public.canton_find_feedback_visit(uuid,text,text) to service_role;
