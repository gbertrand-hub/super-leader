-- SUPER LEADER V4.2
-- Protection atomique contre les doubles ventes et confidentialité des commissions.
-- À exécuter après 060_sales_ambassador_link_v4_1_3.sql.

begin;

alter table public.sales_records
  add column if not exists deduplication_key text;

comment on column public.sales_records.deduplication_key is
  'SHA-256 calculé côté serveur à partir du client, produit, date, montant et devise.';

create unique index if not exists sales_records_active_deduplication_unique
  on public.sales_records (organization_id, deduplication_key)
  where deduplication_key is not null
    and workflow_status not in ('rejected', 'cancelled', 'refunded');

create index if not exists sales_records_org_deduplication_idx
  on public.sales_records (organization_id, deduplication_key);

-- Les accès directs restent interdits. Les Server Actions appliquent la visibilité :
-- vendeur = sa commission ; Finance/RH/Admin autorisés = toutes les commissions.
revoke all on public.sales_records from anon, authenticated;
grant select, insert, update, delete on public.sales_records to service_role;

commit;

notify pgrst, 'reload schema';
