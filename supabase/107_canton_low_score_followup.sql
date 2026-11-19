-- Automatically open a Canton follow-up when a visitor is dissatisfied or requests contact.
-- Only triggers from real completed visits; feedback is inserted through server-side actions.
create or replace function public.canton_escalate_feedback()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.rating <= 2 or new.contact_requested then
   update public.canton_appointments
   set follow_up_required = true,
       follow_up_status = case when follow_up_status='completed' then 'completed' else 'open' end,
       follow_up_due_date = coalesce(follow_up_due_date, (now() at time zone 'America/Chicago')::date + 1),
       follow_up_note = coalesce(nullif(follow_up_note,''), 'Visitor feedback requires manager review'),
       updated_at = now()
   where id=new.appointment_id and status='completed';
 end if;
 return new;
end $$;
drop trigger if exists canton_escalate_feedback_after_insert on public.canton_visit_feedback;
create trigger canton_escalate_feedback_after_insert
after insert on public.canton_visit_feedback
for each row execute function public.canton_escalate_feedback();
revoke all on function public.canton_escalate_feedback() from public,anon,authenticated;
