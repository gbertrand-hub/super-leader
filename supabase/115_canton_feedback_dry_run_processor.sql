-- QA ONLY: atomic, repeat-safe feedback invitation simulation. No external provider calls.
-- The status 'simulated' is explicitly NOT an email sent.
alter table public.canton_feedback_invitation_outbox
 drop constraint if exists canton_feedback_invitation_outbox_status_check;
alter table public.canton_feedback_invitation_outbox
 add constraint canton_feedback_invitation_outbox_status_check
 check (status in ('pending','cancelled','simulated','sent','failed'));

alter table public.canton_feedback_invitation_outbox
 add column if not exists attempt_count integer not null default 0,
 add column if not exists last_attempt_at timestamptz;

create or replace function public.canton_simulate_feedback_invitations(
 p_organization_id uuid, p_limit integer default 20
) returns table(simulated integer,cancelled integer)
language plpgsql security invoker set search_path='' as $$
declare r record; n_sent integer:=0; n_cancelled integer:=0; reason_text text;
begin
 -- Never allow this QA diagnostic procedure against another organization.
 if p_organization_id <> '021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid then
  raise exception 'Canton QA organization only';
 end if;
 if p_limit is null or p_limit<1 or p_limit>50 then
  raise exception 'Invalid batch size';
 end if;
 for r in
  select o.id,o.appointment_id,o.channel,o.due_at,
         a.status as visit_status,a.check_out_at,a.organization_id as visit_org,
         v.email,v.feedback_email_opt_in,v.feedback_opt_in_at
  from public.canton_feedback_invitation_outbox o
  left join public.canton_appointments a on a.id=o.appointment_id and a.organization_id=o.organization_id
  left join public.canton_visitors v on v.id=a.visitor_id and v.organization_id=a.organization_id
  where o.organization_id=p_organization_id and o.status='pending' and o.due_at<=now()
  order by o.due_at asc,o.id
  limit p_limit
  for update of o skip locked
 loop
  reason_text:=null;
  if exists(select 1 from public.canton_visit_feedback f where f.appointment_id=r.appointment_id) then
   reason_text:='feedback_already_received';
  elsif r.visit_status is distinct from 'completed' or r.check_out_at is null or r.visit_org is distinct from p_organization_id then
   reason_text:='visit_not_completed';
  elsif r.channel <> 'email' then
   reason_text:='whatsapp_not_enabled';
  elsif not coalesce(r.feedback_email_opt_in,false) or r.email is null or position('@' in r.email)<=1 or r.feedback_opt_in_at is null then
   reason_text:='missing_current_email_consent';
  end if;
  if reason_text is null then
   update public.canton_feedback_invitation_outbox
   set status='simulated',reason='QA_DRY_RUN_NO_EXTERNAL_SEND',
       processed_at=now(),last_attempt_at=now(),attempt_count=attempt_count+1
   where id=r.id and status='pending';
   n_sent:=n_sent+1;
  else
   update public.canton_feedback_invitation_outbox
   set status='cancelled',reason=reason_text,
       processed_at=now(),last_attempt_at=now(),attempt_count=attempt_count+1
   where id=r.id and status='pending';
   n_cancelled:=n_cancelled+1;
  end if;
 end loop;
 simulated:=n_sent;cancelled:=n_cancelled;
 return next;
end $$;
revoke all on function public.canton_simulate_feedback_invitations(uuid,integer) from public,anon,authenticated;
grant execute on function public.canton_simulate_feedback_invitations(uuid,integer) to service_role;
