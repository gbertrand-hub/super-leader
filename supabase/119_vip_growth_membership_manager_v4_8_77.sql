begin;

-- V4.8.77 — VIP Growth & Membership Governance
-- Adds a dedicated commercial growth responsibility without changing the
-- person's organization role, and gives that responsibility its own VIP
-- operations category.

alter table if exists public.vip_program_settings
  add column if not exists vip_growth_membership_manager_user_id uuid;

comment on column public.vip_program_settings.vip_growth_membership_manager_user_id is
  'User responsible for VIP commercial growth, acquisition, conversion, renewals and membership expansion.';

-- Extend the VIP operations taxonomy so the Growth & Membership Manager can
-- own tasks in a dedicated perimeter while preserving the existing categories.
do $$
begin
  if to_regclass('public.vip_operational_tasks') is not null then
    alter table public.vip_operational_tasks
      drop constraint if exists vip_operational_tasks_category_check;

    alter table public.vip_operational_tasks
      add constraint vip_operational_tasks_category_check
      check (category in (
        'communications',
        'events_travel',
        'benefits_partners',
        'membership_concierge',
        'growth_membership',
        'general'
      ));
  end if;
end
$$;

commit;
