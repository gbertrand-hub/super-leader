-- Super Leader V4.10.38 - Centre des documents RH

create table if not exists public.hr_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 240),
  description text,
  category text not null check (category in ('handbook','policy','contract','amendment','job_description','identity','diploma','certificate','evaluation','disciplinary','leave_support','other')),
  document_scope text not null default 'collective' check (document_scope in ('collective','individual')),
  employee_user_id uuid,
  confidential boolean not null default false,
  acknowledgement_required boolean not null default false,
  version_label text,
  effective_date date,
  expires_on date,
  review_due_on date,
  status text not null default 'draft' check (status in ('draft','published','expired','archived')),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 31457280),
  created_by uuid not null,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_documents_scope_employee_check check (
    (document_scope = 'collective' and employee_user_id is null)
    or (document_scope = 'individual' and employee_user_id is not null)
  ),
  constraint hr_documents_dates_check check (
    expires_on is null or effective_date is null or expires_on >= effective_date
  )
);

create table if not exists public.hr_document_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.hr_documents(id) on delete cascade,
  employee_user_id uuid not null,
  assigned_at timestamptz not null default now(),
  acknowledgement_due_on date,
  acknowledged_at timestamptz,
  acknowledgement_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, employee_user_id)
);

create table if not exists public.hr_document_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid references public.hr_documents(id) on delete set null,
  employee_user_id uuid,
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists hr_documents_org_status_idx on public.hr_documents (organization_id, status, created_at desc);
create index if not exists hr_documents_employee_idx on public.hr_documents (organization_id, employee_user_id, status);
create index if not exists hr_documents_expiry_idx on public.hr_documents (organization_id, expires_on) where status = 'published';
create index if not exists hr_document_recipients_employee_idx on public.hr_document_recipients (organization_id, employee_user_id, acknowledged_at);
create index if not exists hr_document_recipients_document_idx on public.hr_document_recipients (document_id, acknowledged_at);
create index if not exists hr_document_audit_document_idx on public.hr_document_audit_log (document_id, created_at desc);

alter table public.hr_documents enable row level security;
alter table public.hr_document_recipients enable row level security;
alter table public.hr_document_audit_log enable row level security;

drop policy if exists "hr_documents_select_authorized" on public.hr_documents;
create policy "hr_documents_select_authorized" on public.hr_documents
for select to authenticated
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = hr_documents.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and (
        om.role in ('owner','admin','hr')
        or (
          om.role in ('executive','manager','employee')
          and hr_documents.status = 'published'
          and (
            hr_documents.document_scope = 'collective'
            or hr_documents.employee_user_id = (select auth.uid())
          )
        )
      )
  )
);

drop policy if exists "hr_documents_manage_hr" on public.hr_documents;

drop policy if exists "hr_document_recipients_select" on public.hr_document_recipients;
create policy "hr_document_recipients_select" on public.hr_document_recipients
for select to authenticated
using (
  employee_user_id = (select auth.uid())
  or exists (
    select 1 from public.organization_members om
    where om.organization_id = hr_document_recipients.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and om.role in ('owner','admin','hr')
  )
);

drop policy if exists "hr_document_recipients_acknowledge_own" on public.hr_document_recipients;
drop policy if exists "hr_document_recipients_manage_hr" on public.hr_document_recipients;

drop policy if exists "hr_document_audit_select_hr" on public.hr_document_audit_log;
create policy "hr_document_audit_select_hr" on public.hr_document_audit_log
for select to authenticated
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = hr_document_audit_log.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and om.role in ('owner','admin','hr')
  )
);

-- All mutations pass through authenticated Server Actions using the service role.
-- Browser sessions receive read-only access, constrained by the policies above.
revoke all on public.hr_documents from authenticated;
revoke all on public.hr_document_recipients from authenticated;
revoke all on public.hr_document_audit_log from authenticated;
grant select on public.hr_documents to authenticated;
grant select on public.hr_document_recipients to authenticated;
grant select on public.hr_document_audit_log to authenticated;

comment on table public.hr_documents is 'Versioned collective and individual HR documents stored in the private attachments bucket.';
comment on table public.hr_document_recipients is 'Per-employee HR document assignments and acknowledgements.';
comment on table public.hr_document_audit_log is 'Immutable application audit events for HR documents.';
