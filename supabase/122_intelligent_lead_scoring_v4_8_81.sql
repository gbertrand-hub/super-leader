-- SUPER LEADER V4.8.81 - Intelligent Lead Scoring
-- Explainable 0-100 scoring for CRM prospects.
-- Run after 121_dynamic_crm_sectors_v4_8_79.sql.

begin;

alter table public.crm_clients
  add column if not exists qualification_need text not null default 'unknown',
  add column if not exists purchase_timeline text not null default 'unknown',
  add column if not exists decision_role text not null default 'unknown',
  add column if not exists budget_confirmed boolean not null default false,
  add column if not exists lead_score smallint not null default 0,
  add column if not exists lead_score_band text not null default 'cold',
  add column if not exists lead_score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists lead_score_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_qualification_need_check') then
    alter table public.crm_clients add constraint crm_clients_qualification_need_check
      check (qualification_need in ('unknown','exploring','clear','urgent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_purchase_timeline_check') then
    alter table public.crm_clients add constraint crm_clients_purchase_timeline_check
      check (purchase_timeline in ('unknown','within_30_days','31_90_days','91_180_days','later'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_decision_role_check') then
    alter table public.crm_clients add constraint crm_clients_decision_role_check
      check (decision_role in ('unknown','decision_maker','influencer','representative'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_lead_score_check') then
    alter table public.crm_clients add constraint crm_clients_lead_score_check
      check (lead_score between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_lead_score_band_check') then
    alter table public.crm_clients add constraint crm_clients_lead_score_band_check
      check (lead_score_band in ('hot','warm','nurture','cold','converted','disqualified'));
  end if;
end $$;

create index if not exists crm_clients_lead_score_idx
  on public.crm_clients (organization_id, status, lead_score desc, lead_score_band, created_at desc);

create or replace function public.crm_refresh_lead_score(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.crm_clients%rowtype;
  interaction_count integer := 0;
  inbound_count integer := 0;
  meeting_count integer := 0;
  no_answer_count integer := 0;
  last_interaction_at timestamptz := null;
  status_points integer := 0;
  engagement_points integer := 0;
  need_points integer := 0;
  timing_points integer := 0;
  budget_points integer := 0;
  authority_points integer := 0;
  source_points integer := 0;
  total_score integer := 0;
  score_band text := 'cold';
  score_breakdown jsonb := '{}'::jsonb;
begin
  select * into c from public.crm_clients where id = p_client_id;
  if not found then return; end if;

  select
    count(*)::integer,
    count(*) filter (where direction = 'inbound')::integer,
    count(*) filter (where channel in ('meeting','video'))::integer,
    count(*) filter (where outcome = 'no_answer')::integer,
    max(occurred_at)
  into interaction_count, inbound_count, meeting_count, no_answer_count, last_interaction_at
  from public.crm_interactions
  where organization_id = c.organization_id and client_id = c.id;

  if c.status <> 'prospect' or c.do_not_contact or c.lead_status in ('unqualified','lost') then
    total_score := 0;
    score_band := 'disqualified';
  elsif c.lead_status = 'converted' then
    total_score := 100;
    score_band := 'converted';
  else
    status_points := case c.lead_status
      when 'new' then 2
      when 'uncontacted' then 0
      when 'contact_attempt' then 4
      when 'contacted' then 8
      when 'follow_up' then 10
      when 'qualified' then 18
      when 'appointment' then 22
      else 0
    end;

    engagement_points := least(8, interaction_count * 2);
    if inbound_count > 0 then engagement_points := engagement_points + 5; end if;
    if meeting_count > 0 then engagement_points := engagement_points + 6; end if;
    if last_interaction_at is not null and last_interaction_at >= now() - interval '7 days' then
      engagement_points := engagement_points + 6;
    elsif last_interaction_at is not null and last_interaction_at >= now() - interval '30 days' then
      engagement_points := engagement_points + 3;
    end if;
    if no_answer_count >= 3 and inbound_count = 0 then
      engagement_points := greatest(0, engagement_points - 3);
    end if;
    engagement_points := least(25, engagement_points);

    need_points := (case when nullif(btrim(coalesce(c.product_interest,'')), '') is not null then 3 else 0 end)
      + case c.qualification_need
          when 'exploring' then 4
          when 'clear' then 8
          when 'urgent' then 12
          else 0
        end;
    need_points := least(15, need_points);

    timing_points := case c.purchase_timeline
      when 'within_30_days' then 15
      when '31_90_days' then 10
      when '91_180_days' then 5
      when 'later' then 2
      else 0
    end;

    budget_points := (case when c.estimated_budget is not null and c.estimated_budget > 0 then 5 else 0 end)
      + (case when c.budget_confirmed then 5 else 0 end);

    authority_points := case c.decision_role
      when 'decision_maker' then 5
      when 'influencer' then 3
      when 'representative' then 2
      else 0
    end;

    source_points := case lower(coalesce(c.source_detail,''))
      when 'referral' then 5
      when 'ambassador' then 5
      when 'event' then 4
      when 'call' then 4
      when 'website' then 3
      when 'campaign' then 3
      when 'facebook_ads' then 3
      when 'google_ads' then 3
      when 'manual' then 1
      when 'import' then 1
      when 'other' then 1
      else 1
    end;

    total_score := least(100, greatest(0,
      status_points + engagement_points + need_points + timing_points + budget_points + authority_points + source_points
    ));

    score_band := case
      when total_score >= 80 then 'hot'
      when total_score >= 60 then 'warm'
      when total_score >= 40 then 'nurture'
      else 'cold'
    end;
  end if;

  score_breakdown := jsonb_build_object(
    'model', 'SL-LEAD-V1',
    'status', jsonb_build_object('points', status_points, 'max', 25),
    'engagement', jsonb_build_object('points', engagement_points, 'max', 25),
    'need', jsonb_build_object('points', need_points, 'max', 15),
    'timing', jsonb_build_object('points', timing_points, 'max', 15),
    'budget', jsonb_build_object('points', budget_points, 'max', 10),
    'authority', jsonb_build_object('points', authority_points, 'max', 5),
    'source', jsonb_build_object('points', source_points, 'max', 5),
    'signals', jsonb_build_object(
      'interaction_count', interaction_count,
      'inbound_count', inbound_count,
      'meeting_count', meeting_count,
      'no_answer_count', no_answer_count,
      'last_interaction_at', last_interaction_at
    )
  );

  update public.crm_clients
  set lead_score = total_score,
      lead_score_band = score_band,
      lead_score_breakdown = score_breakdown,
      lead_score_updated_at = now()
  where id = c.id;
end;
$$;

create or replace function public.crm_refresh_lead_score_client_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.crm_refresh_lead_score(new.id);
  return new;
end;
$$;

create or replace function public.crm_refresh_lead_score_interaction_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.crm_refresh_lead_score(old.client_id);
    return old;
  end if;
  perform public.crm_refresh_lead_score(new.client_id);
  if tg_op = 'UPDATE' and old.client_id is distinct from new.client_id then
    perform public.crm_refresh_lead_score(old.client_id);
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_crm_client_lead_score on public.crm_clients;
create trigger refresh_crm_client_lead_score
after insert or update of
  status, do_not_contact, lead_status, source_detail, product_interest,
  estimated_budget, qualification_need, purchase_timeline, decision_role, budget_confirmed
on public.crm_clients
for each row execute function public.crm_refresh_lead_score_client_trigger();

drop trigger if exists refresh_crm_interaction_lead_score on public.crm_interactions;
create trigger refresh_crm_interaction_lead_score
after insert or delete or update of client_id, direction, channel, outcome, occurred_at
on public.crm_interactions
for each row execute function public.crm_refresh_lead_score_interaction_trigger();

do $$
declare
  r record;
begin
  for r in select id from public.crm_clients where status = 'prospect' loop
    perform public.crm_refresh_lead_score(r.id);
  end loop;
end $$;

revoke all on function public.crm_refresh_lead_score(uuid) from public, anon, authenticated;
grant execute on function public.crm_refresh_lead_score(uuid) to service_role;

comment on column public.crm_clients.lead_score is 'Explainable 0-100 prospect score calculated by Super Leader model SL-LEAD-V1.';
comment on column public.crm_clients.lead_score_breakdown is 'Point-by-point score explanation and engagement signals.';
comment on column public.crm_clients.qualification_need is 'Commercial qualification of need: unknown, exploring, clear, urgent.';
comment on column public.crm_clients.purchase_timeline is 'Expected purchase horizon used for lead scoring.';
comment on column public.crm_clients.decision_role is 'Prospect role in the buying decision.';

commit;
