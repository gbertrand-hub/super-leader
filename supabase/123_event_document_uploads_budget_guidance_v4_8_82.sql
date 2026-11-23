-- Super Leader V4.8.82
-- Event document uploads + secure private storage metadata.
-- Existing external links remain valid.

alter table public.event_documents
  alter column document_url drop not null;

alter table public.event_documents
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_documents_size_bytes_check'
  ) then
    alter table public.event_documents
      add constraint event_documents_size_bytes_check
      check (size_bytes is null or (size_bytes > 0 and size_bytes <= 20971520));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'event_documents_source_check'
  ) then
    alter table public.event_documents
      add constraint event_documents_source_check
      check (
        nullif(btrim(coalesce(document_url, '')), '') is not null
        or nullif(btrim(coalesce(storage_path, '')), '') is not null
      );
  end if;
end $$;

create index if not exists event_documents_storage_path_idx
  on public.event_documents (organization_id, storage_path)
  where storage_path is not null;

comment on column public.event_documents.storage_path is
  'Private Supabase Storage path for an uploaded event document.';
comment on column public.event_documents.document_url is
  'Optional external document URL. A private storage_path may be used instead.';
