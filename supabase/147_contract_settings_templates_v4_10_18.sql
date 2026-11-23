begin;

create table if not exists public.service_contract_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_currency text not null default 'USD' check (char_length(default_currency) between 3 and 8),
  default_performance_target numeric(5,2) not null default 80 check (default_performance_target between 0 and 100),
  default_renewal_notice_days integer not null default 90 check (default_renewal_notice_days between 0 and 730),
  renewal_stage_j90_days integer not null default 90 check (renewal_stage_j90_days between 1 and 730),
  renewal_stage_j60_days integer not null default 60 check (renewal_stage_j60_days between 1 and 730),
  renewal_stage_j30_days integer not null default 30 check (renewal_stage_j30_days between 1 and 730),
  default_non_renewal_notice_days integer not null default 30 check (default_non_renewal_notice_days between 0 and 730),
  default_termination_notice_days integer not null default 30 check (default_termination_notice_days between 0 and 730),
  require_source_document_before_activation boolean not null default true,
  require_internal_owner_before_activation boolean not null default true,
  require_performance_target_before_activation boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_contract_settings_renewal_order_ck check (
    renewal_stage_j90_days > renewal_stage_j60_days and renewal_stage_j60_days > renewal_stage_j30_days
  )
);

create table if not exists public.service_contract_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (char_length(trim(code)) between 2 and 60),
  name text not null check (char_length(trim(name)) between 2 and 140),
  description text not null default '' check (char_length(description) <= 3000),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_contract_types_org_code_uq
  on public.service_contract_types (organization_id, lower(code));
create unique index if not exists service_contract_types_org_name_uq
  on public.service_contract_types (organization_id, lower(name));

create table if not exists public.service_contract_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_type_id uuid references public.service_contract_types(id) on delete set null,
  name text not null check (char_length(trim(name)) between 2 and 180),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'active' check (status in ('active','archived')),
  current_version integer not null default 1 check (current_version >= 1),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_contract_templates_org_name_uq
  on public.service_contract_templates (organization_id, lower(name));
create index if not exists service_contract_templates_org_status_idx
  on public.service_contract_templates (organization_id, status, updated_at desc);

create table if not exists public.service_contract_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.service_contract_templates(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  snapshot jsonb not null default '{}'::jsonb,
  change_reason text not null default '' check (char_length(change_reason) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists service_contract_template_versions_uq
  on public.service_contract_template_versions (template_id, version_number);
create index if not exists service_contract_template_versions_org_idx
  on public.service_contract_template_versions (organization_id, template_id, version_number desc);

create table if not exists public.service_contract_clause_library (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 180),
  category text not null default 'general' check (char_length(category) between 2 and 80),
  clause_text text not null check (char_length(trim(clause_text)) between 10 and 12000),
  status text not null default 'active' check (status in ('active','archived')),
  version_number integer not null default 1 check (version_number >= 1),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_contract_clause_library_org_idx
  on public.service_contract_clause_library (organization_id, status, category, updated_at desc);

alter table public.service_contract_settings enable row level security;
alter table public.service_contract_types enable row level security;
alter table public.service_contract_templates enable row level security;
alter table public.service_contract_template_versions enable row level security;
alter table public.service_contract_clause_library enable row level security;

drop policy if exists service_contract_settings_select on public.service_contract_settings;
create policy service_contract_settings_select on public.service_contract_settings
for select to authenticated using (
  exists (select 1 from public.organization_members om where om.organization_id = service_contract_settings.organization_id and om.user_id = auth.uid() and om.is_active = true and om.role in ('owner','admin','executive','hr','manager'))
);

drop policy if exists service_contract_types_select on public.service_contract_types;
create policy service_contract_types_select on public.service_contract_types
for select to authenticated using (
  exists (select 1 from public.organization_members om where om.organization_id = service_contract_types.organization_id and om.user_id = auth.uid() and om.is_active = true and om.role in ('owner','admin','executive','hr','manager'))
);

drop policy if exists service_contract_templates_select on public.service_contract_templates;
create policy service_contract_templates_select on public.service_contract_templates
for select to authenticated using (
  exists (select 1 from public.organization_members om where om.organization_id = service_contract_templates.organization_id and om.user_id = auth.uid() and om.is_active = true and om.role in ('owner','admin','executive','hr','manager'))
);

drop policy if exists service_contract_template_versions_select on public.service_contract_template_versions;
create policy service_contract_template_versions_select on public.service_contract_template_versions
for select to authenticated using (
  exists (select 1 from public.organization_members om where om.organization_id = service_contract_template_versions.organization_id and om.user_id = auth.uid() and om.is_active = true and om.role in ('owner','admin','executive','hr','manager'))
);

drop policy if exists service_contract_clause_library_select on public.service_contract_clause_library;
create policy service_contract_clause_library_select on public.service_contract_clause_library
for select to authenticated using (
  exists (select 1 from public.organization_members om where om.organization_id = service_contract_clause_library.organization_id and om.user_id = auth.uid() and om.is_active = true and om.role in ('owner','admin','executive','hr','manager'))
);

comment on table public.service_contract_templates is 'Reusable contract blueprints. Updating a template never mutates existing contracts.';
comment on table public.service_contract_template_versions is 'Immutable versioned JSON snapshots used to create new draft contracts.';
comment on table public.service_contract_clause_library is 'Approved reusable clause blocks. This library is not a legal drafting engine.';

commit;
