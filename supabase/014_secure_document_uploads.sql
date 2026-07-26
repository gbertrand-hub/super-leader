-- SUPER LEADER - Performance & Sales V1.2
-- Televersement securise des justificatifs d'absence et des preuves de vente/paiement
-- A executer apres 008, 009, 012 et 013

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'super-leader-private',
  'super-leader-private',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.leave_requests
  add column if not exists document_storage_path text,
  add column if not exists document_file_name text,
  add column if not exists document_mime_type text,
  add column if not exists document_size_bytes bigint,
  add column if not exists document_uploaded_at timestamptz;

alter table public.sales_records
  add column if not exists proof_storage_path text,
  add column if not exists proof_file_name text,
  add column if not exists proof_mime_type text,
  add column if not exists proof_size_bytes bigint,
  add column if not exists proof_uploaded_at timestamptz;

alter table public.sales_payments
  add column if not exists proof_storage_path text,
  add column if not exists proof_file_name text,
  add column if not exists proof_mime_type text,
  add column if not exists proof_size_bytes bigint,
  add column if not exists proof_uploaded_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_document_size_check') then
    alter table public.leave_requests
      add constraint leave_document_size_check
      check (document_size_bytes is null or document_size_bytes between 1 and 10485760);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sales_proof_size_check') then
    alter table public.sales_records
      add constraint sales_proof_size_check
      check (proof_size_bytes is null or proof_size_bytes between 1 and 10485760);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sales_payment_proof_size_check') then
    alter table public.sales_payments
      add constraint sales_payment_proof_size_check
      check (proof_size_bytes is null or proof_size_bytes between 1 and 10485760);
  end if;
end $$;

create index if not exists leave_requests_document_storage_idx
  on public.leave_requests (organization_id, document_uploaded_at desc)
  where document_storage_path is not null;

create index if not exists sales_records_proof_storage_idx
  on public.sales_records (organization_id, proof_uploaded_at desc)
  where proof_storage_path is not null;

create index if not exists sales_payments_proof_storage_idx
  on public.sales_payments (organization_id, proof_uploaded_at desc)
  where proof_storage_path is not null;

notify pgrst, 'reload schema';
