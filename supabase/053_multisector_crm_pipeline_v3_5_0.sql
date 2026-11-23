-- Super Leader V3.5.0
-- Multisector CRM: product catalogue, opportunities, sector pipelines and sales cockpit.
-- Run after 010_crm_clients_feedback.sql and 052_daily_execution_cycle_v3_4_2.sql.

begin;

alter table public.sales_products
  add column if not exists sector text,
  add column if not exists product_type text not null default 'standard',
  add column if not exists name_en text,
  add column if not exists description_en text,
  add column if not exists minimum_first_payment_type text not null default 'percentage',
  add column if not exists minimum_first_payment_value numeric(14,2) not null default 10,
  add column if not exists fulfillment_destination text not null default 'collections',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_by uuid references auth.users(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_products_sector_check') then
    alter table public.sales_products
      add constraint sales_products_sector_check
      check (sector is null or sector in ('house','land','training','livestock'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_products_product_type_check') then
    alter table public.sales_products
      add constraint sales_products_product_type_check
      check (char_length(trim(product_type)) between 2 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_products_name_en_check') then
    alter table public.sales_products
      add constraint sales_products_name_en_check
      check (name_en is null or char_length(trim(name_en)) between 2 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_products_description_en_check') then
    alter table public.sales_products
      add constraint sales_products_description_en_check
      check (description_en is null or char_length(trim(description_en)) <= 3000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_products_minimum_first_payment_type_check') then
    alter table public.sales_products
      add constraint sales_products_minimum_first_payment_type_check
      check (minimum_first_payment_type in ('percentage','fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_products_minimum_first_payment_value_check') then
    alter table public.sales_products
      add constraint sales_products_minimum_first_payment_value_check
      check (minimum_first_payment_value >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_products_fulfillment_destination_check') then
    alter table public.sales_products
      add constraint sales_products_fulfillment_destination_check
      check (fulfillment_destination in ('real_estate','academy','livestock_operations','collections','other'));
  end if;
end $$;

create index if not exists sales_products_org_sector_idx
  on public.sales_products (organization_id, sector, is_active, name);

create table if not exists public.crm_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sector text not null check (sector in ('house','land','training','livestock')),
  stage_key text not null,
  name_fr text not null,
  name_en text not null,
  position integer not null check (position between 1 and 1000),
  probability smallint not null default 0 check (probability between 0 and 100),
  stage_kind text not null default 'open' check (stage_kind in ('open','won','lost')),
  color_key text not null default 'slate' check (color_key in ('slate','blue','indigo','violet','amber','orange','emerald','red','cyan')),
  is_active boolean not null default true,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sector, stage_key)
);

create index if not exists crm_pipeline_stages_org_sector_idx
  on public.crm_pipeline_stages (organization_id, sector, is_active, position);

create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference text not null,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  product_id uuid references public.sales_products(id) on delete set null,
  sector text not null check (sector in ('house','land','training','livestock')),
  title text not null check (char_length(trim(title)) between 2 and 220),
  owner_id uuid not null references auth.users(id) on delete restrict,
  stage_id uuid not null references public.crm_pipeline_stages(id) on delete restrict,
  status text not null default 'open' check (status in ('open','won','lost','on_hold')),
  source text not null default 'manual' check (source in ('manual','website','referral','event','campaign','social_media','partner','walk_in','other')),
  value_amount numeric(14,2) not null default 0 check (value_amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  probability smallint not null default 10 check (probability between 0 and 100),
  expected_close_date date,
  need_summary text check (need_summary is null or char_length(trim(need_summary)) <= 3000),
  budget_amount numeric(14,2) check (budget_amount is null or budget_amount >= 0),
  first_payment_expected numeric(14,2) check (first_payment_expected is null or first_payment_expected >= 0),
  first_payment_due_date date,
  first_payment_confirmed_at timestamptz,
  next_action text,
  next_action_at timestamptz,
  loss_reason text check (loss_reason is null or loss_reason in ('price','financing','postponed','no_response','product_fit','competitor','trust','timing','unqualified','other')),
  loss_notes text check (loss_notes is null or char_length(trim(loss_notes)) <= 3000),
  sector_details jsonb not null default '{}'::jsonb,
  handoff_status text not null default 'not_ready' check (handoff_status in ('not_ready','ready','transferred')),
  handoff_destination text check (handoff_destination is null or handoff_destination in ('real_estate','academy','livestock_operations','collections','other')),
  handoff_at timestamptz,
  sale_id uuid references public.sales_records(id) on delete set null,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_opportunities_open_next_action_check check (status <> 'open' or (next_action is not null and next_action_at is not null)),
  constraint crm_opportunities_won_payment_check check (status <> 'won' or first_payment_confirmed_at is not null),
  constraint crm_opportunities_lost_reason_check check (status <> 'lost' or loss_reason is not null),
  unique (organization_id, reference)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_opportunities_open_next_action_check') then
    alter table public.crm_opportunities
      add constraint crm_opportunities_open_next_action_check
      check (status <> 'open' or (next_action is not null and next_action_at is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_opportunities_won_payment_check') then
    alter table public.crm_opportunities
      add constraint crm_opportunities_won_payment_check
      check (status <> 'won' or first_payment_confirmed_at is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_opportunities_lost_reason_check') then
    alter table public.crm_opportunities
      add constraint crm_opportunities_lost_reason_check
      check (status <> 'lost' or loss_reason is not null);
  end if;
end $$;

create index if not exists crm_opportunities_org_sector_stage_idx
  on public.crm_opportunities (organization_id, sector, stage_id, status, expected_close_date);
create index if not exists crm_opportunities_owner_next_action_idx
  on public.crm_opportunities (organization_id, owner_id, status, next_action_at);
create index if not exists crm_opportunities_client_idx
  on public.crm_opportunities (client_id, created_at desc);
create index if not exists crm_opportunities_handoff_idx
  on public.crm_opportunities (organization_id, handoff_status, handoff_destination, updated_at desc);

create table if not exists public.crm_opportunity_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  from_stage_id uuid references public.crm_pipeline_stages(id) on delete set null,
  to_stage_id uuid not null references public.crm_pipeline_stages(id) on delete restrict,
  changed_by uuid not null references auth.users(id),
  note text check (note is null or char_length(trim(note)) <= 1500),
  created_at timestamptz not null default now()
);

create index if not exists crm_opportunity_history_idx
  on public.crm_opportunity_stage_history (opportunity_id, created_at desc);

alter table public.crm_interactions
  add column if not exists opportunity_id uuid references public.crm_opportunities(id) on delete set null;
alter table public.crm_follow_up_tasks
  add column if not exists opportunity_id uuid references public.crm_opportunities(id) on delete set null;
alter table public.crm_contracts
  add column if not exists opportunity_id uuid references public.crm_opportunities(id) on delete set null;

create index if not exists crm_interactions_opportunity_idx on public.crm_interactions (opportunity_id, occurred_at desc);
create index if not exists crm_tasks_opportunity_idx on public.crm_follow_up_tasks (opportunity_id, status, due_at);
create index if not exists crm_contracts_opportunity_idx on public.crm_contracts (opportunity_id, created_at desc);

create or replace function public.crm_pipeline_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_crm_pipeline_stages_updated_at on public.crm_pipeline_stages;
create trigger set_crm_pipeline_stages_updated_at
before update on public.crm_pipeline_stages
for each row execute function public.crm_pipeline_set_updated_at();

drop trigger if exists set_crm_opportunities_updated_at on public.crm_opportunities;
create trigger set_crm_opportunities_updated_at
before update on public.crm_opportunities
for each row execute function public.crm_pipeline_set_updated_at();

create or replace function public.seed_crm_pipeline_for_organization(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.crm_pipeline_stages
    (organization_id, sector, stage_key, name_fr, name_en, position, probability, stage_kind, color_key)
  values
    -- Houses
    (p_organization_id,'house','new_lead','Nouveau prospect','New lead',10,10,'open','blue'),
    (p_organization_id,'house','needs_identified','Besoins identifiés','Needs identified',20,20,'open','indigo'),
    (p_organization_id,'house','finance_checked','Capacité financière vérifiée','Financial capacity checked',30,35,'open','violet'),
    (p_organization_id,'house','properties_presented','Propriétés proposées','Properties presented',40,45,'open','cyan'),
    (p_organization_id,'house','visit_scheduled','Visite programmée','Visit scheduled',50,55,'open','amber'),
    (p_organization_id,'house','visit_completed','Visite réalisée','Visit completed',60,65,'open','orange'),
    (p_organization_id,'house','offer_reservation','Offre ou réservation','Offer or reservation',70,75,'open','violet'),
    (p_organization_id,'house','contract_signed','Contrat signé','Contract signed',80,90,'open','indigo'),
    (p_organization_id,'house','first_payment_received','Premier paiement reçu','First payment received',90,100,'won','emerald'),
    (p_organization_id,'house','lost','Vente perdue','Lost',100,0,'lost','red'),
    -- Land
    (p_organization_id,'land','new_lead','Nouveau prospect','New lead',10,10,'open','blue'),
    (p_organization_id,'land','needs_identified','Budget et besoin identifiés','Budget and need identified',20,20,'open','indigo'),
    (p_organization_id,'land','lots_presented','Lots disponibles présentés','Available lots presented',30,35,'open','violet'),
    (p_organization_id,'land','lot_selected','Lot sélectionné','Lot selected',40,50,'open','cyan'),
    (p_organization_id,'land','visit_presentation','Visite ou présentation réalisée','Visit or presentation completed',50,60,'open','amber'),
    (p_organization_id,'land','reservation_proposed','Réservation proposée','Reservation proposed',60,70,'open','orange'),
    (p_organization_id,'land','contract_sent','Contrat envoyé','Contract sent',70,80,'open','violet'),
    (p_organization_id,'land','contract_signed','Contrat signé','Contract signed',80,90,'open','indigo'),
    (p_organization_id,'land','first_payment_received','Premier paiement reçu','First payment received',90,100,'won','emerald'),
    (p_organization_id,'land','lost','Vente perdue','Lost',100,0,'lost','red'),
    -- Training
    (p_organization_id,'training','new_lead','Nouveau prospect','New lead',10,10,'open','blue'),
    (p_organization_id,'training','needs_identified','Besoin de formation identifié','Training need identified',20,20,'open','indigo'),
    (p_organization_id,'training','program_recommended','Programme recommandé','Program recommended',30,35,'open','violet'),
    (p_organization_id,'training','presentation_completed','Présentation ou entretien réalisé','Presentation or interview completed',40,50,'open','cyan'),
    (p_organization_id,'training','offer_sent','Offre d''inscription envoyée','Enrollment offer sent',50,65,'open','amber'),
    (p_organization_id,'training','follow_up','Relance commerciale','Commercial follow-up',60,75,'open','orange'),
    (p_organization_id,'training','registration_completed','Inscription complétée','Registration completed',70,90,'open','indigo'),
    (p_organization_id,'training','first_payment_received','Premier paiement reçu','First payment received',80,100,'won','emerald'),
    (p_organization_id,'training','lost','Vente perdue','Lost',100,0,'lost','red'),
    -- Livestock
    (p_organization_id,'livestock','new_lead','Nouveau prospect','New lead',10,10,'open','blue'),
    (p_organization_id,'livestock','needs_identified','Besoin et budget identifiés','Need and budget identified',20,20,'open','indigo'),
    (p_organization_id,'livestock','pack_recommended','Pack recommandé','Pack recommended',30,35,'open','violet'),
    (p_organization_id,'livestock','model_presented','Modèle d''élevage présenté','Livestock model presented',40,50,'open','cyan'),
    (p_organization_id,'livestock','proposal_sent','Proposition financière envoyée','Financial proposal sent',50,65,'open','amber'),
    (p_organization_id,'livestock','contract_sent','Contrat transmis','Contract sent',60,80,'open','orange'),
    (p_organization_id,'livestock','first_payment_received','Premier paiement reçu','First payment received',70,100,'won','emerald'),
    (p_organization_id,'livestock','lost','Vente perdue','Lost',100,0,'lost','red')
  on conflict (organization_id, sector, stage_key) do update
  set name_fr = excluded.name_fr,
      name_en = excluded.name_en,
      position = excluded.position,
      probability = excluded.probability,
      stage_kind = excluded.stage_kind,
      color_key = excluded.color_key,
      is_active = true;
end;
$$;

create or replace function public.seed_crm_pipeline_on_organization_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_crm_pipeline_for_organization(new.id);
  return new;
end;
$$;

drop trigger if exists seed_crm_pipeline_after_organization_insert on public.organizations;
create trigger seed_crm_pipeline_after_organization_insert
after insert on public.organizations
for each row execute function public.seed_crm_pipeline_on_organization_insert();

do $$
declare
  org record;
begin
  for org in select id from public.organizations loop
    perform public.seed_crm_pipeline_for_organization(org.id);
  end loop;
end;
$$;


revoke all on function public.seed_crm_pipeline_for_organization(uuid) from public, anon, authenticated;
revoke all on function public.seed_crm_pipeline_on_organization_insert() from public, anon, authenticated;
grant execute on function public.seed_crm_pipeline_for_organization(uuid) to service_role;

alter table public.crm_pipeline_stages enable row level security;
alter table public.crm_opportunities enable row level security;
alter table public.crm_opportunity_stage_history enable row level security;

revoke all on public.crm_pipeline_stages from anon, authenticated;
revoke all on public.crm_opportunities from anon, authenticated;
revoke all on public.crm_opportunity_stage_history from anon, authenticated;

grant select, insert, update, delete on public.crm_pipeline_stages to service_role;
grant select, insert, update, delete on public.crm_opportunities to service_role;
grant select, insert on public.crm_opportunity_stage_history to service_role;

comment on column public.sales_products.sector is 'Commercial sector used by the multisector CRM pipeline.';
comment on table public.crm_opportunities is 'Sales opportunities managed from prospect to confirmed first payment.';
comment on column public.crm_opportunities.handoff_status is 'Operational transfer after first payment; sales commission remains based on the first payment only.';

commit;

notify pgrst, 'reload schema';
