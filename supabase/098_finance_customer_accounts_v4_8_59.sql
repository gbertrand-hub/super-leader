-- SUPER LEADER V4.8.59 — comptes clients et rapprochement documentaire
-- À exécuter après 097_finance_receivables_v4_8_58.sql

begin;

alter table public.finance_documents
  add column if not exists sale_id uuid references public.sales_records(id) on delete set null;

create index if not exists finance_documents_sale_idx
  on public.finance_documents (organization_id, sale_id, document_type, issue_date desc)
  where sale_id is not null;

create table if not exists public.finance_reconciliation_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid references public.finance_documents(id) on delete set null,
  sale_id uuid references public.sales_records(id) on delete set null,
  previous_sale_id uuid references public.sales_records(id) on delete set null,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('linked','relinked','unlinked')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists finance_reconciliation_audit_org_idx
  on public.finance_reconciliation_audit_log (organization_id, created_at desc);

alter table public.finance_reconciliation_audit_log enable row level security;
revoke all on public.finance_reconciliation_audit_log from anon, authenticated;
grant select, insert on public.finance_reconciliation_audit_log to service_role;

commit;
