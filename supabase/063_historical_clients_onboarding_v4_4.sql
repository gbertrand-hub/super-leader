-- Super Leader V4.4 - clients historiques, import auditable, aucun effet sur ventes/commissions
alter table public.crm_clients add column if not exists is_historical boolean not null default false;
alter table public.crm_clients add column if not exists historical_import_batch_id uuid;

create table if not exists public.crm_historical_client_import_batches (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  file_name text not null, total_rows integer not null, imported_rows integer not null default 0, duplicate_rows integer not null default 0,
  rejected_rows integer not null default 0, issues jsonb not null default '[]'::jsonb, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.crm_clients drop constraint if exists crm_clients_historical_import_batch_id_fkey;
alter table public.crm_clients add constraint crm_clients_historical_import_batch_id_fkey foreign key (historical_import_batch_id) references public.crm_historical_client_import_batches(id) on delete set null;

create table if not exists public.crm_historical_client_details (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null unique references public.crm_clients(id) on delete cascade, product_name text, original_sale_date date,
  total_amount numeric(14,2) check(total_amount is null or total_amount>=0), amount_paid numeric(14,2) not null default 0 check(amount_paid>=0),
  balance_amount numeric(14,2) check(balance_amount is null or balance_amount>=0), currency text not null default 'USD' check(currency in ('USD','EUR','GBP','XAF','CAD')),
  original_seller text, original_ambassador text, contract_reference text, last_interaction_at date, next_follow_up_at date, notes text,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists crm_historical_clients_org_idx on public.crm_clients(organization_id,is_historical,created_at desc) where is_historical;
create index if not exists crm_historical_details_follow_up_idx on public.crm_historical_client_details(organization_id,next_follow_up_at) where next_follow_up_at is not null;

alter table public.crm_historical_client_import_batches enable row level security;
alter table public.crm_historical_client_details enable row level security;
revoke all on public.crm_historical_client_import_batches,public.crm_historical_client_details from anon,authenticated;
grant select,insert,update,delete on public.crm_historical_client_import_batches,public.crm_historical_client_details to service_role;

-- Verrou serveur atomique : empêche deux créations simultanées avec le même téléphone ou e-mail.
create or replace function public.prevent_duplicate_crm_client_identity() returns trigger language plpgsql as $$
declare normalized_phone text; normalized_email text;
begin
  normalized_phone:=nullif(regexp_replace(coalesce(new.phone,new.whatsapp_phone,''),'[^0-9]','','g'),'');
  normalized_email:=nullif(lower(btrim(coalesce(new.email,''))),'');
  if normalized_phone is not null then perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||':phone:'||normalized_phone,0)); end if;
  if normalized_email is not null then perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||':email:'||normalized_email,0)); end if;
  if (normalized_phone is not null and exists(select 1 from public.crm_clients c where c.organization_id=new.organization_id and c.id<>new.id and (regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=normalized_phone or regexp_replace(coalesce(c.whatsapp_phone,''),'[^0-9]','','g')=normalized_phone)))
     or (normalized_email is not null and exists(select 1 from public.crm_clients c where c.organization_id=new.organization_id and c.id<>new.id and lower(btrim(coalesce(c.email,'')))=normalized_email)) then
    raise exception using errcode='23505',message='duplicate_crm_client_identity';
  end if;
  return new;
end $$;
drop trigger if exists prevent_duplicate_crm_client_identity_trigger on public.crm_clients;
create trigger prevent_duplicate_crm_client_identity_trigger before insert or update of email,phone,whatsapp_phone on public.crm_clients for each row execute function public.prevent_duplicate_crm_client_identity();

comment on table public.crm_historical_client_details is 'Données de reprise des clients antérieurs, volontairement séparées des ventes et commissions.';
