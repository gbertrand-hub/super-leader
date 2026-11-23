-- Super Leader V4.8.8
-- Distinguishes events organized internally from third-party events where the organization is invited.

alter table public.events
  add column if not exists ownership_type text not null default 'internal',
  add column if not exists external_organizer text,
  add column if not exists external_url text,
  add column if not exists invitation_role text;

alter table public.events drop constraint if exists events_ownership_type_check;
alter table public.events
  add constraint events_ownership_type_check
  check (ownership_type in ('internal', 'external_invitation'));

create index if not exists events_upcoming_dashboard_idx
  on public.events (organization_id, start_at)
  where status not in ('cancelled', 'archived', 'completed');

comment on column public.events.ownership_type is
  'internal: organized by the organization; external_invitation: organized by a third party and attended by invitation.';
