begin;

create table if not exists public.crm_sectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name_fr text not null,
  name_en text not null,
  fulfillment_destination text not null default 'other',
  is_active boolean not null default true,
  is_system boolean not null default false,
  sort_order integer not null default 100,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  constraint crm_sectors_code_check check (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  constraint crm_sectors_name_fr_check check (char_length(trim(name_fr)) between 2 and 120),
  constraint crm_sectors_name_en_check check (char_length(trim(name_en)) between 2 and 120),
  constraint crm_sectors_fulfillment_check check (fulfillment_destination in ('real_estate','academy','livestock_operations','collections','other'))
);

create index if not exists crm_sectors_org_active_idx
  on public.crm_sectors (organization_id, is_active, sort_order, name_fr);

-- Replace legacy fixed-sector checks with safe slug checks so organizations can add sectors.
alter table public.sales_products drop constraint if exists sales_products_sector_check;
alter table public.sales_products
  add constraint sales_products_sector_check
  check (sector is null or sector ~ '^[a-z0-9][a-z0-9_-]{1,39}$');

alter table public.crm_pipeline_stages drop constraint if exists crm_pipeline_stages_sector_check;
alter table public.crm_pipeline_stages
  add constraint crm_pipeline_stages_sector_check
  check (sector ~ '^[a-z0-9][a-z0-9_-]{1,39}$');

alter table public.crm_opportunities drop constraint if exists crm_opportunities_sector_check;
alter table public.crm_opportunities
  add constraint crm_opportunities_sector_check
  check (sector ~ '^[a-z0-9][a-z0-9_-]{1,39}$');

alter table public.crm_sales_targets drop constraint if exists crm_sales_targets_sector_check;
alter table public.crm_sales_targets
  add constraint crm_sales_targets_sector_check
  check (sector is null or sector ~ '^[a-z0-9][a-z0-9_-]{1,39}$');

create or replace function public.crm_sector_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_crm_sectors_updated_at on public.crm_sectors;
create trigger set_crm_sectors_updated_at
before update on public.crm_sectors
for each row execute function public.crm_sector_set_updated_at();

create or replace function public.seed_crm_generic_pipeline_for_sector(
  p_organization_id uuid,
  p_sector text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.crm_pipeline_stages
    (organization_id, sector, stage_key, name_fr, name_en, position, probability, stage_kind, color_key)
  values
    (p_organization_id,p_sector,'new_lead','Nouveau prospect','New lead',10,10,'open','blue'),
    (p_organization_id,p_sector,'qualified','Prospect qualifié','Qualified',20,25,'open','indigo'),
    (p_organization_id,p_sector,'presentation','Présentation réalisée','Presentation completed',30,45,'open','violet'),
    (p_organization_id,p_sector,'offer_sent','Offre envoyée','Offer sent',40,65,'open','amber'),
    (p_organization_id,p_sector,'decision','Décision / négociation','Decision / negotiation',50,80,'open','orange'),
    (p_organization_id,p_sector,'first_payment_received','Premier paiement reçu','First payment received',60,100,'won','emerald'),
    (p_organization_id,p_sector,'lost','Vente perdue','Lost',100,0,'lost','red')
  on conflict (organization_id, sector, stage_key) do nothing;
end;
$$;

create or replace function public.seed_crm_default_sectors_for_organization(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.crm_sectors
    (organization_id, code, name_fr, name_en, fulfillment_destination, is_active, is_system, sort_order)
  values
    (p_organization_id,'house','Maisons','Houses','real_estate',true,true,10),
    (p_organization_id,'land','Terrains','Land','real_estate',true,true,20),
    (p_organization_id,'training','Formations','Training','academy',true,true,30),
    (p_organization_id,'livestock','Élevage','Livestock','livestock_operations',true,true,40),
    (p_organization_id,'vip','Super Leader VIP','Super Leader VIP','other',true,true,50)
  on conflict (organization_id, code) do update
  set name_fr = excluded.name_fr,
      name_en = excluded.name_en,
      fulfillment_destination = excluded.fulfillment_destination,
      is_system = true;

  perform public.seed_crm_pipeline_for_organization(p_organization_id);
  perform public.seed_crm_generic_pipeline_for_sector(p_organization_id, 'vip');
end;
$$;

create or replace function public.crm_seed_pipeline_after_sector_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code not in ('house','land','training','livestock') then
    perform public.seed_crm_generic_pipeline_for_sector(new.organization_id, new.code);
  end if;
  return new;
end;
$$;

drop trigger if exists crm_seed_pipeline_on_sector_insert on public.crm_sectors;
create trigger crm_seed_pipeline_on_sector_insert
after insert on public.crm_sectors
for each row execute function public.crm_seed_pipeline_after_sector_insert();

-- Ensure the organization bootstrap also creates sector records.
create or replace function public.seed_crm_pipeline_on_organization_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_crm_default_sectors_for_organization(new.id);
  return new;
end;
$$;

-- Seed every existing organization.
do $$
declare
  org record;
begin
  for org in select id from public.organizations loop
    perform public.seed_crm_default_sectors_for_organization(org.id);
  end loop;
end;
$$;

-- Preserve any sector codes that may already exist in business data.
insert into public.crm_sectors (organization_id, code, name_fr, name_en, fulfillment_destination, is_active, is_system, sort_order)
select distinct x.organization_id,
       x.sector,
       initcap(replace(replace(x.sector, '_', ' '), '-', ' ')),
       initcap(replace(replace(x.sector, '_', ' '), '-', ' ')),
       'other', true, false, 100
from (
  select organization_id, sector from public.sales_products where sector is not null
  union
  select organization_id, sector from public.crm_opportunities
  union
  select organization_id, sector from public.crm_pipeline_stages
  union
  select organization_id, sector from public.crm_sales_targets where sector is not null
) x
where x.sector ~ '^[a-z0-9][a-z0-9_-]{1,39}$'
on conflict (organization_id, code) do nothing;

alter table public.crm_sectors enable row level security;
revoke all on public.crm_sectors from anon, authenticated;
grant select, insert, update, delete on public.crm_sectors to service_role;

revoke all on function public.seed_crm_generic_pipeline_for_sector(uuid, text) from public, anon, authenticated;
revoke all on function public.seed_crm_default_sectors_for_organization(uuid) from public, anon, authenticated;
revoke all on function public.crm_seed_pipeline_after_sector_insert() from public, anon, authenticated;
grant execute on function public.seed_crm_generic_pipeline_for_sector(uuid, text) to service_role;
grant execute on function public.seed_crm_default_sectors_for_organization(uuid) to service_role;

comment on table public.crm_sectors is 'Organization-managed commercial sectors used by products, prospects, pipeline and targets.';
comment on column public.crm_sectors.code is 'Stable slug used by CRM relations; display names can be edited independently.';

commit;

notify pgrst, 'reload schema';
