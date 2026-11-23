-- Super Leader v4.8.58 - QR public de vérification des documents financiers

alter table public.finance_documents
  add column if not exists verification_token uuid;

update public.finance_documents
set verification_token = gen_random_uuid()
where verification_token is null;

alter table public.finance_documents
  alter column verification_token set default gen_random_uuid(),
  alter column verification_token set not null;

create unique index if not exists finance_documents_verification_token_idx
  on public.finance_documents(verification_token);

comment on column public.finance_documents.verification_token is
  'Jeton public non séquentiel utilisé uniquement pour vérifier un document sans exposer les données privées du client.';

revoke all on table public.finance_documents from anon;
grant select, insert, update, delete on table public.finance_documents to service_role;
