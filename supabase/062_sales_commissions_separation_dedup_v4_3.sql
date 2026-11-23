-- SUPER LEADER V4.3
-- Anti-doublon par téléphone OU e-mail et séparation fonctionnelle des commissions.
-- À exécuter après 061_sales_deduplication_commission_privacy_v4_2.sql.

begin;

-- Les anciennes lignes restent intactes. Les nouvelles lignes reçoivent deux clés
-- indépendantes, ce qui évite qu'un doublon historique bloque la migration.
alter table public.sales_records
  add column if not exists phone_deduplication_key text,
  add column if not exists email_deduplication_key text;

create unique index if not exists sales_records_active_phone_sale_unique
  on public.sales_records (organization_id, phone_deduplication_key)
  where phone_deduplication_key is not null
    and workflow_status not in ('rejected', 'cancelled', 'refunded');

create unique index if not exists sales_records_active_email_sale_unique
  on public.sales_records (organization_id, email_deduplication_key)
  where email_deduplication_key is not null
    and workflow_status not in ('rejected', 'cancelled', 'refunded');

comment on index sales_records_active_phone_sale_unique is
  'Bloque une même vente active par téléphone, produit, date, montant et devise.';
comment on index sales_records_active_email_sale_unique is
  'Bloque une même vente active par e-mail, produit, date, montant et devise.';

commit;

notify pgrst, 'reload schema';
