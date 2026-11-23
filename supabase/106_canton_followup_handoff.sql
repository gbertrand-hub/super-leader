-- Minimal follow-up ownership for Canton reception handoff.
-- The receptionist confirms departure; a manager assigns next action and owner.
alter table public.canton_appointments
 add column if not exists follow_up_owner_id uuid references auth.users(id),
 add column if not exists follow_up_note text,
 add column if not exists follow_up_due_date date,
 add column if not exists follow_up_status text not null default 'none'
   check (follow_up_status in ('none','open','completed')),
 add column if not exists follow_up_completed_at timestamptz;
create index if not exists canton_followup_org_status_due_idx
 on public.canton_appointments(organization_id,follow_up_status,follow_up_due_date)
 where follow_up_status='open';
alter table public.canton_appointments
 add constraint canton_followup_complete_consistency
 check (follow_up_status <> 'completed' or follow_up_completed_at is not null);
