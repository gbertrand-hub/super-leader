begin;

-- Super Leader v4.10.17-r3
-- Mandatory first-login password setup for external service-provider accounts.

alter table public.service_provider_portal_users
  add column if not exists password_setup_required boolean not null default true;

alter table public.service_provider_portal_users
  add column if not exists password_set_at timestamptz;

-- Existing active portal accounts intentionally enter the first-login password flow once.
-- Accounts that have already been migrated by this patch keep their completed state.
update public.service_provider_portal_users
set password_setup_required = true
where status = 'active'
  and password_set_at is null;

comment on column public.service_provider_portal_users.password_setup_required is
  'When true, the external provider must create a personal password before the contract portal can be used.';

comment on column public.service_provider_portal_users.password_set_at is
  'Timestamp at which the provider completed the mandatory personal-password setup.';

commit;
