begin;

-- Super Leader v4.10.12
-- Contract documents, immutable document register, formal amendments and version governance.

alter table public.service_contracts
  add column if not exists current_version integer not null default 1,
  add column if not exists last_amendment_at timestamptz;

create table if not exists public.service_contract_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  document_type text not null default 'other' check (document_type in ('original','amendment','annex','exhibit','nda','insurance','invoice','receipt','correspondence','other')),
  title text not null check (char_length(trim(title)) between 2 and 240),
  description text not null default '' check (char_length(description) <= 5000),
  document_date date,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  is_immutable boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists service_contract_documents_contract_idx
  on public.service_contract_documents (contract_id, document_date desc, created_at desc);
create index if not exists service_contract_documents_type_idx
  on public.service_contract_documents (organization_id, document_type, created_at desc);

create table if not exists public.service_contract_amendments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  amendment_number integer not null check (amendment_number > 0),
  title text not null check (char_length(trim(title)) between 2 and 240),
  reason text not null default '' check (char_length(reason) <= 5000),
  effective_date date not null,
  status text not null default 'draft' check (status in ('draft','ready','applied','cancelled')),
  changes jsonb not null default '{}'::jsonb,
  previous_version integer not null check (previous_version > 0),
  resulting_version integer not null check (resulting_version > previous_version),
  document_id uuid references public.service_contract_documents(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text not null default '' check (char_length(cancellation_reason) <= 3000)
);

create unique index if not exists service_contract_amendments_number_uq
  on public.service_contract_amendments (contract_id, amendment_number);
create index if not exists service_contract_amendments_contract_idx
  on public.service_contract_amendments (contract_id, status, effective_date desc);

alter table public.service_contract_documents enable row level security;
alter table public.service_contract_amendments enable row level security;

drop policy if exists service_contract_documents_select on public.service_contract_documents;
create policy service_contract_documents_select
on public.service_contract_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_documents.contract_id
      and sc.organization_id = service_contract_documents.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

drop policy if exists service_contract_amendments_select on public.service_contract_amendments;
create policy service_contract_amendments_select
on public.service_contract_amendments
for select
to authenticated
using (
  exists (
    select 1
    from public.service_contracts sc
    join public.organization_members om on om.organization_id = sc.organization_id
    where sc.id = service_contract_amendments.contract_id
      and sc.organization_id = service_contract_amendments.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (om.role in ('owner','admin','executive','hr') or sc.internal_owner_user_id = auth.uid())
  )
);

comment on column public.service_contracts.current_version is 'Current operational contract version. Version 1 is the original signed contract; each applied amendment increments it.';
comment on table public.service_contract_documents is 'Immutable private register of contractual documents and supporting legal/administrative records.';
comment on table public.service_contract_amendments is 'Formal amendments. Contract terms are updated only when a signed amendment is explicitly applied.';

commit;

notify pgrst, 'reload schema';
