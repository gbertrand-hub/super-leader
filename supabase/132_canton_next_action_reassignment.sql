-- Audited reassignment of open Canton commercial next actions.
create table if not exists public.canton_next_action_reassignments (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 action_id uuid not null references public.canton_next_actions(id) on delete cascade,
 appointment_id uuid not null references public.canton_appointments(id) on delete cascade,
 previous_assigned_to uuid not null,
 new_assigned_to uuid not null,
 reassigned_by uuid not null,
 reason text not null check (length(btrim(reason)) >= 5),
 created_at timestamptz not null default now(),
 constraint canton_next_action_reassignment_different_owner
   check (previous_assigned_to <> new_assigned_to)
);

create index if not exists canton_next_action_reassignments_action_created
 on public.canton_next_action_reassignments(action_id,created_at desc);

create index if not exists canton_next_action_reassignments_org_created
 on public.canton_next_action_reassignments(organization_id,created_at desc);

alter table public.canton_next_action_reassignments enable row level security;
revoke all on public.canton_next_action_reassignments from anon,authenticated;
grant select,insert on public.canton_next_action_reassignments to service_role;

create or replace function public.canton_reassign_next_action(
 p_organization_id uuid,
 p_action_id uuid,
 p_new_assigned_to uuid,
 p_reassigned_by uuid,
 p_reason text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
 v_action public.canton_next_actions%rowtype;
begin
 if length(btrim(coalesce(p_reason,''))) < 5 then
  raise exception 'reassignment reason is required';
 end if;

 select *
 into v_action
 from public.canton_next_actions
 where id = p_action_id
   and organization_id = p_organization_id
   and status = 'open'
 for update;

 if not found then
  raise exception 'next action is not open or not found';
 end if;

 if v_action.assigned_to = p_new_assigned_to then
  raise exception 'new assignee must be different';
 end if;

 update public.canton_next_actions
 set assigned_to = p_new_assigned_to
 where id = p_action_id
   and organization_id = p_organization_id
   and status = 'open';

 if not found then
  raise exception 'next action changed concurrently';
 end if;

 insert into public.canton_next_action_reassignments(
  organization_id,action_id,appointment_id,previous_assigned_to,new_assigned_to,reassigned_by,reason
 ) values (
  p_organization_id,p_action_id,v_action.appointment_id,v_action.assigned_to,p_new_assigned_to,p_reassigned_by,btrim(p_reason)
 );
end;
$$;

revoke all on function public.canton_reassign_next_action(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.canton_reassign_next_action(uuid,uuid,uuid,uuid,text) to service_role;
