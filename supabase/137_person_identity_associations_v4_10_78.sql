-- Super Leader V4.10.78 - Associations d'identites confirmees et reversibles
-- Couche additive : aucun compte, dossier CRM ou inscription n'est modifie.

begin;

create table if not exists public.person_identity_associations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary_user_id uuid not null references auth.users(id) on delete cascade,
  crm_client_id uuid not null references public.crm_clients(id) on delete cascade,
  related_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active','revoked')),
  confirmation_reason text not null check (char_length(trim(confirmation_reason)) between 5 and 1000),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revocation_reason text check (revocation_reason is null or char_length(trim(revocation_reason)) between 5 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (primary_user_id is distinct from related_user_id)
);

create unique index if not exists person_identity_associations_active_client_idx
  on public.person_identity_associations (organization_id, crm_client_id)
  where status = 'active';
create index if not exists person_identity_associations_primary_idx
  on public.person_identity_associations (organization_id, primary_user_id, status);

alter table public.person_identity_associations enable row level security;
drop policy if exists "identity associations admin read" on public.person_identity_associations;
create policy "identity associations admin read"
on public.person_identity_associations for select to authenticated
using (public.has_org_role(organization_id, array['owner','admin']));

revoke all on public.person_identity_associations from anon, authenticated;
grant select on public.person_identity_associations to authenticated;
grant all on public.person_identity_associations to service_role;

commit;
