-- Canton QA feedback invitation outbox: no external communication is sent by this migration.
-- Default opt-out, explicit consent required to queue.
alter table public.canton_visitors
 add column if not exists feedback_email_opt_in boolean not null default false,
 add column if not exists feedback_whatsapp_opt_in boolean not null default false,
 add column if not exists feedback_opt_in_source text,
 add column if not exists feedback_opt_in_at timestamptz;

create table if not exists public.canton_feedback_invitation_outbox (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 appointment_id uuid not null references public.canton_appointments(id) on delete cascade,
 channel text not null check (channel in ('email','whatsapp')),
 status text not null default 'pending' check (status in ('pending','cancelled','sent','failed')),
 due_at timestamptz not null,
 created_at timestamptz not null default now(),
 processed_at timestamptz,
 reason text,
 unique(appointment_id,channel)
);
create index if not exists canton_feedback_invitation_pending_idx
 on public.canton_feedback_invitation_outbox(due_at) where status='pending';
alter table public.canton_feedback_invitation_outbox enable row level security;
revoke all on public.canton_feedback_invitation_outbox from anon,authenticated;
grant select,insert,update on public.canton_feedback_invitation_outbox to service_role;

-- Can create pending email invitations ONLY for a visitor who specifically opted in.
-- WhatsApp remains disabled until opt-in, provider and approved template are verified.
create or replace function public.canton_schedule_feedback_invitation()
returns trigger language plpgsql security definer set search_path='' as $$
declare v record;
begin
 if new.status='completed' and old.status is distinct from 'completed' and new.check_out_at is not null then
  select email,feedback_email_opt_in into v
  from public.canton_visitors where id=new.visitor_id and organization_id=new.organization_id;
  if v.feedback_email_opt_in and v.email is not null and position('@' in v.email)>1 then
   insert into public.canton_feedback_invitation_outbox
    (organization_id,appointment_id,channel,status,due_at)
   values(new.organization_id,new.id,'email','pending',new.check_out_at+interval '15 minutes')
   on conflict(appointment_id,channel) do nothing;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists canton_feedback_invitation_after_checkout on public.canton_appointments;
create trigger canton_feedback_invitation_after_checkout
 after update of status,check_out_at on public.canton_appointments
 for each row execute function public.canton_schedule_feedback_invitation();

create or replace function public.canton_cancel_feedback_invitation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.canton_feedback_invitation_outbox
 set status='cancelled',processed_at=now(),reason='feedback_submitted'
 where appointment_id=new.appointment_id and status='pending';
 return new;
end $$;
drop trigger if exists canton_feedback_cancel_after_response on public.canton_visit_feedback;
create trigger canton_feedback_cancel_after_response
 after insert on public.canton_visit_feedback
 for each row execute function public.canton_cancel_feedback_invitation();
