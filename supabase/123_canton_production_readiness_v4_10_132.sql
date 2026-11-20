-- Super Leader V4.10.132 - Canton production readiness
-- Apply AFTER 100..122 Canton migrations.
-- This migration captures the QA-proven workflow without QA-specific organization rules.
-- DO NOT apply automatically to production; review and execute during the controlled release window.

-- 1) Host / visit lifecycle / commercial debrief / CRM referral bridge.
alter table public.canton_appointments
  add column if not exists host_user_id uuid,
  add column if not exists visit_started_at timestamptz,
  add column if not exists commercial_interest text,
  add column if not exists visit_outcome text,
  add column if not exists debrief_note text,
  add column if not exists debriefed_by uuid,
  add column if not exists debriefed_at timestamptz,
  add column if not exists commercial_qualified_at timestamptz,
  add column if not exists commercial_qualified_by uuid,
  add column if not exists visit_origin text not null default 'direct',
  add column if not exists crm_referred_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='canton_visit_start_after_checkin') then
    alter table public.canton_appointments
      add constraint canton_visit_start_after_checkin
      check (visit_started_at is null or (check_in_at is not null and visit_started_at >= check_in_at));
  end if;

  if not exists (select 1 from pg_constraint where conname='canton_commercial_interest_check') then
    alter table public.canton_appointments
      add constraint canton_commercial_interest_check
      check (commercial_interest is null or commercial_interest in ('hot','warm','cold','non_commercial'));
  end if;

  if not exists (select 1 from pg_constraint where conname='canton_visit_outcome_check') then
    alter table public.canton_appointments
      add constraint canton_visit_outcome_check
      check (visit_outcome is null or visit_outcome in (
        'information_only','follow_up_requested','proposal_requested',
        'next_appointment','ready_to_buy','not_interested','other'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname='canton_debrief_consistency') then
    alter table public.canton_appointments
      add constraint canton_debrief_consistency
      check (
        debriefed_at is null
        or (
          debriefed_by is not null
          and commercial_interest is not null
          and visit_outcome is not null
          and length(btrim(coalesce(debrief_note,''))) >= 5
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname='canton_visit_origin_check') then
    alter table public.canton_appointments
      add constraint canton_visit_origin_check
      check (visit_origin in ('direct','crm_referral','qr','walk_in'));
  end if;
end $$;

create index if not exists canton_appointments_host_user_idx
  on public.canton_appointments(organization_id,host_user_id)
  where host_user_id is not null;

create index if not exists canton_appointments_active_host_idx
  on public.canton_appointments(organization_id,host_user_id,status)
  where host_user_id is not null
    and status in ('scheduled','announced','arrived','in_progress');

create index if not exists canton_appointments_debrief_pending_idx
  on public.canton_appointments(organization_id,department,status,debriefed_at)
  where status='completed' and department in ('DIG','TCF');

create index if not exists canton_appointments_commercial_sla_idx
  on public.canton_appointments(organization_id,commercial_interest,commercial_qualified_at)
  where commercial_interest in ('hot','warm','cold');

create index if not exists canton_appointments_crm_referral_idx
  on public.canton_appointments(organization_id,crm_referred_by,created_at desc)
  where visit_origin='crm_referral';

-- 2) Strong generic integrity for completed commercial follow-up.
alter table public.canton_appointments
  drop constraint if exists canton_qa_follow_up_completion_requires_result;

alter table public.canton_appointments
  drop constraint if exists canton_follow_up_completion_requires_result;

alter table public.canton_appointments
  add constraint canton_follow_up_completion_requires_result
  check (
    follow_up_status is distinct from 'completed'
    or (
      follow_up_outcome is not null
      and length(btrim(coalesce(follow_up_result_note,''))) >= 5
      and follow_up_completed_by is not null
      and follow_up_completed_at is not null
    )
  );

-- 3) Internal arrival notification.
create table if not exists public.canton_arrival_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null references public.canton_appointments(id) on delete cascade,
  recipient_user_id uuid not null,
  visitor_name text not null,
  department text not null,
  host_name text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(appointment_id,recipient_user_id)
);

create index if not exists canton_arrival_alerts_recipient_idx
  on public.canton_arrival_alerts(organization_id,recipient_user_id,read_at,created_at desc);

alter table public.canton_arrival_alerts enable row level security;
revoke all on public.canton_arrival_alerts from anon,authenticated;
grant select,insert,update on public.canton_arrival_alerts to service_role;

create or replace function public.canton_create_arrival_alert()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_name text;
begin
  if new.status='arrived'
     and old.status is distinct from 'arrived'
     and new.host_user_id is not null then
    select full_name into v_name
    from public.canton_visitors
    where id=new.visitor_id
      and organization_id=new.organization_id;

    insert into public.canton_arrival_alerts(
      organization_id,appointment_id,recipient_user_id,
      visitor_name,department,host_name
    )
    values(
      new.organization_id,new.id,new.host_user_id,
      coalesce(v_name,'Visitor'),new.department,new.host_name
    )
    on conflict(appointment_id,recipient_user_id) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists canton_arrival_alert_after_checkin on public.canton_appointments;
create trigger canton_arrival_alert_after_checkin
after update of status on public.canton_appointments
for each row execute function public.canton_create_arrival_alert();

-- Trigger function is internal only.
revoke all on function public.canton_create_arrival_alert() from public,anon,authenticated;
grant execute on function public.canton_create_arrival_alert() to service_role;

-- 4) SLA manager recovery plan.
create table if not exists public.canton_sla_recoveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null references public.canton_appointments(id) on delete cascade,
  assigned_to uuid not null,
  created_by uuid not null,
  action_text text not null check(length(btrim(action_text))>=5),
  due_date date not null,
  status text not null default 'open' check(status in ('open','completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid,
  completion_note text,
  constraint canton_sla_recoveries_completion_check check(
    (status='open' and completed_at is null and completed_by is null)
    or
    (status='completed' and completed_at is not null and completed_by is not null
      and length(btrim(coalesce(completion_note,'')))>=5)
  )
);

create unique index if not exists canton_sla_recoveries_one_open_idx
  on public.canton_sla_recoveries(appointment_id)
  where status='open';

create index if not exists canton_sla_recoveries_assignee_idx
  on public.canton_sla_recoveries(organization_id,assigned_to,status,due_date);

alter table public.canton_sla_recoveries enable row level security;
revoke all on public.canton_sla_recoveries from anon,authenticated;
grant select,insert,update on public.canton_sla_recoveries to service_role;

-- 5) CRM bridge uses the existing production CRM tables.
-- No CRM tables are created or replaced here.
grant select,insert,update on public.crm_interactions to service_role;
grant select,insert,update on public.crm_follow_up_tasks to service_role;

-- 6) Harden internal feedback trigger functions created in migration 113.
revoke all on function public.canton_schedule_feedback_invitation() from public,anon,authenticated;
revoke all on function public.canton_cancel_feedback_invitation() from public,anon,authenticated;
grant execute on function public.canton_schedule_feedback_invitation() to service_role;
grant execute on function public.canton_cancel_feedback_invitation() to service_role;

-- 7) Backend access required by server-only Canton architecture.
grant select,insert,update on public.canton_visitors to service_role;
grant select,insert,update on public.canton_appointments to service_role;
grant select,insert,update on public.canton_visit_feedback to service_role;
grant select,insert,update on public.canton_reception_staff to service_role;
grant select,insert,update on public.canton_qr_sites to service_role;
grant select,insert,update on public.canton_intake_requests to service_role;
grant select,insert,update on public.canton_feedback_invitation_outbox to service_role;
grant select,insert,update on public.canton_next_actions to service_role;

-- End V4.10.132 production readiness migration.


-- 6) Performance readiness: cover Canton/Visitor foreign keys used at production volume.
create index if not exists canton_appointments_org_visitor_fk_idx
  on public.canton_appointments(organization_id,visitor_id);
create index if not exists canton_appointments_announced_by_fk_idx
  on public.canton_appointments(announced_by) where announced_by is not null;
create index if not exists canton_appointments_follow_up_owner_fk_idx
  on public.canton_appointments(follow_up_owner_id) where follow_up_owner_id is not null;
create index if not exists canton_appointments_site_fk_idx
  on public.canton_appointments(site_id) where site_id is not null;
create index if not exists canton_feedback_outbox_org_fk_idx
  on public.canton_feedback_invitation_outbox(organization_id);
create index if not exists canton_intake_appointment_fk_idx
  on public.canton_intake_requests(appointment_id) where appointment_id is not null;
create index if not exists canton_intake_reviewed_by_fk_idx
  on public.canton_intake_requests(reviewed_by) where reviewed_by is not null;
create index if not exists canton_intake_org_site_fk_idx
  on public.canton_intake_requests(organization_id,site_id);
create index if not exists canton_qr_sites_created_by_fk_idx
  on public.canton_qr_sites(created_by) where created_by is not null;
create index if not exists canton_qr_sites_visitor_site_fk_idx
  on public.canton_qr_sites(visitor_site_id) where visitor_site_id is not null;
create index if not exists canton_reception_staff_granted_by_fk_idx
  on public.canton_reception_staff(granted_by) where granted_by is not null;
create index if not exists canton_reception_staff_user_fk_idx
  on public.canton_reception_staff(user_id);
create index if not exists canton_visitors_created_by_fk_idx
  on public.canton_visitors(created_by) where created_by is not null;
