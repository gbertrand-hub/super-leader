-- SUPER LEADER V4.6.9 - Vente verifiee par Finance, puis Prospect -> Client
-- A executer apres 067_finance_commission_decisions_v4_6_8.sql
begin;

alter table public.sales_records drop constraint if exists sales_records_workflow_status_check;
alter table public.sales_records add constraint sales_records_workflow_status_check
  check (workflow_status in ('draft','submitted','correction_requested','verified','approved','rejected','cancelled','refunded'));

create index if not exists sales_records_finance_verification_queue_idx
  on public.sales_records(organization_id,workflow_status,created_at desc)
  where workflow_status in ('submitted','correction_requested');

comment on column public.sales_records.workflow_status is
  'submitted/correction_requested are awaiting Finance; approved confirms the purchase and allows Prospect-to-Client conversion.';

create or replace function public.enforce_approved_sale_evidence()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.workflow_status='approved' and old.workflow_status is distinct from new.workflow_status then
    if new.proof_storage_path is null then raise exception 'A private uploaded receipt is required before Finance approval'; end if;
    if not exists(select 1 from public.sales_payments p where p.sale_id=new.id and p.organization_id=new.organization_id and p.status='confirmed') then
      raise exception 'A confirmed payment is required before Finance approval';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists enforce_approved_sale_evidence_trigger on public.sales_records;
create trigger enforce_approved_sale_evidence_trigger before update of workflow_status on public.sales_records
for each row execute function public.enforce_approved_sale_evidence();

commit;
notify pgrst,'reload schema';
