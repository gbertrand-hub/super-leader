begin;

-- Super Leader v4.10.17
-- External provider portal access and private evidence metadata.
-- Portal users are authenticated Supabase users but are NOT organization members.
-- Access to contract data is enforced in server-side portal actions/pages through
-- service_provider_portal_users; existing contract-table RLS is intentionally left unchanged.

create table if not exists public.service_provider_portal_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_id uuid not null references public.service_providers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  status text not null default 'active' check (status in ('active','revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_provider_portal_users_provider_email_uq
  on public.service_provider_portal_users (organization_id, provider_id, email);
create unique index if not exists service_provider_portal_users_provider_user_uq
  on public.service_provider_portal_users (organization_id, provider_id, user_id);
create index if not exists service_provider_portal_users_user_idx
  on public.service_provider_portal_users (user_id, status, organization_id);
create index if not exists service_provider_portal_users_provider_idx
  on public.service_provider_portal_users (provider_id, status, updated_at desc);

create table if not exists public.service_provider_portal_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_id uuid not null references public.service_providers(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  resource_type text not null check (resource_type in ('obligation_occurrence','deliverable','report')),
  resource_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists service_provider_portal_attachments_contract_idx
  on public.service_provider_portal_attachments (contract_id, created_at desc);
create index if not exists service_provider_portal_attachments_resource_idx
  on public.service_provider_portal_attachments (resource_type, resource_id, created_at desc);
create index if not exists service_provider_portal_attachments_provider_idx
  on public.service_provider_portal_attachments (provider_id, created_at desc);

alter table public.service_provider_portal_users enable row level security;
alter table public.service_provider_portal_attachments enable row level security;

-- Provider users may inspect only their own active portal links. All management writes
-- continue through server actions using the service-role client.
drop policy if exists service_provider_portal_users_self_select on public.service_provider_portal_users;
create policy service_provider_portal_users_self_select
on public.service_provider_portal_users
for select
to authenticated
using (user_id = auth.uid());

-- A provider may inspect attachment metadata only for providers to which the account is actively linked.
-- Internal organization users may inspect attachment metadata for contracts already inside their scope.
drop policy if exists service_provider_portal_attachments_select on public.service_provider_portal_attachments;
create policy service_provider_portal_attachments_select
on public.service_provider_portal_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.service_provider_portal_users ppu
    where ppu.organization_id = service_provider_portal_attachments.organization_id
      and ppu.provider_id = service_provider_portal_attachments.provider_id
      and ppu.user_id = auth.uid()
      and ppu.status = 'active'
  )
  or exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_provider_portal_attachments.contract_id
      and sc.organization_id = service_provider_portal_attachments.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

comment on table public.service_provider_portal_users is
  'Authenticated external provider accounts linked to one or more service providers. These users are deliberately not organization_members.';
comment on table public.service_provider_portal_attachments is
  'Private proof/document metadata uploaded through the external provider portal. Binary objects remain in the private Super Leader storage bucket.';

commit;
