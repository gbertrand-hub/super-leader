-- Super Leader V4.10.39 - Completion du Centre des Documents RH

alter table public.hr_documents
  add column if not exists issued_on date;

alter table public.hr_documents
  drop constraint if exists hr_documents_status_check;

update public.hr_documents
set status = case
  when status = 'published' and acknowledgement_required then 'to_acknowledge'
  when status = 'published' then 'active'
  else status
end
where status = 'published';

alter table public.hr_documents
  add constraint hr_documents_status_check
  check (status in ('draft','to_review','to_acknowledge','active','expired','archived'));

create table if not exists public.hr_document_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  category text not null check (category in ('handbook','policy','contract','amendment','job_description','identity','diploma','certificate','evaluation','disciplinary','leave_support','other')),
  applicable_roles text[] not null default array['executive','hr','manager','employee']::text[],
  expiry_required boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, title)
);

create index if not exists hr_document_requirements_org_active_idx
  on public.hr_document_requirements (organization_id, is_active, category);

alter table public.hr_document_requirements enable row level security;

-- Reassert the read-only browser model even when V4.10.38 was installed earlier.
drop policy if exists "hr_documents_manage_hr" on public.hr_documents;
drop policy if exists "hr_document_recipients_acknowledge_own" on public.hr_document_recipients;
drop policy if exists "hr_document_recipients_manage_hr" on public.hr_document_recipients;
revoke all on public.hr_documents from authenticated;
revoke all on public.hr_document_recipients from authenticated;
revoke all on public.hr_document_audit_log from authenticated;
grant select on public.hr_documents to authenticated;
grant select on public.hr_document_recipients to authenticated;
grant select on public.hr_document_audit_log to authenticated;

drop policy if exists "hr_document_requirements_select_hr" on public.hr_document_requirements;
create policy "hr_document_requirements_select_hr" on public.hr_document_requirements
for select to authenticated
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = hr_document_requirements.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and om.role in ('owner','admin','hr')
  )
);

revoke all on public.hr_document_requirements from authenticated;
grant select on public.hr_document_requirements to authenticated;

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
          and hr_documents.status in ('to_acknowledge','active')
          and hr_documents.confidential = false
          and exists (
            select 1 from public.hr_document_recipients hdr
            where hdr.document_id = hr_documents.id
              and hdr.organization_id = hr_documents.organization_id
              and hdr.employee_user_id = (select auth.uid())
          )
        )
      )
  )
);

comment on column public.hr_documents.issued_on is 'Date printed or formally issued on the source HR document.';
comment on table public.hr_document_requirements is 'Configurable required employee document types used to calculate missing HR records.';
