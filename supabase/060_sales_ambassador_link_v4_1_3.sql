-- SUPER LEADER V4.1.3 - Rattachement direct d'un ambassadeur a une vente
-- A executer apres 059_crm_ambassador_edit_whatsapp_v4_1_1.sql
begin;

alter table public.sales_records
  add column if not exists ambassador_id uuid
  references public.crm_ambassadors(id) on delete set null;

create index if not exists sales_records_org_ambassador_idx
  on public.sales_records(organization_id, ambassador_id)
  where ambassador_id is not null;

commit;
