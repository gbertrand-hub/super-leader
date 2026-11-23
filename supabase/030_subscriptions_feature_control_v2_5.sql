-- SUPER LEADER V2.5 - Plans, abonnements et controle des fonctionnalites
-- A executer apres 029_acquisition_and_internal_access_v2_4.sql
-- Les paiements restent en mode manuel/test. Aucun prestataire de paiement reel n'est active.

begin;

create extension if not exists pgcrypto;

create table if not exists public.subscription_features (
  feature_key text primary key,
  name_fr text not null,
  name_en text not null,
  description_fr text,
  description_en text,
  category text not null default 'module',
  value_type text not null default 'boolean' check (value_type in ('boolean','limit')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  is_public boolean not null default false,
  is_internal boolean not null default false,
  pricing_mode text not null default 'fixed' check (pricing_mode in ('fixed','custom','free')),
  currency text not null default 'USD' check (char_length(currency) = 3),
  monthly_price numeric(12,2),
  annual_price numeric(12,2),
  default_trial_days integer not null default 14 check (default_trial_days between 0 and 365),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_plan_features (
  plan_id uuid not null references public.subscription_plans(id) on delete cascade,
  feature_key text not null references public.subscription_features(feature_key) on delete cascade,
  enabled boolean not null default false,
  limit_value integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, feature_key),
  check (limit_value is null or limit_value >= 0)
);

create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  status text not null default 'draft' check (status in (
    'draft','trialing','active','past_due','scheduled_cancel',
    'canceled','suspended','expired'
  )),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly','annual','custom')),
  currency text not null default 'USD' check (char_length(currency) = 3),
  provider text not null default 'manual' check (provider in ('manual','test','stripe','other')),
  provider_customer_id text,
  provider_subscription_id text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  suspended_at timestamptz,
  suspension_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organization_subscriptions_one_current_idx
  on public.organization_subscriptions (organization_id)
  where status in ('draft','trialing','active','past_due','scheduled_cancel','suspended');
create index if not exists organization_subscriptions_status_idx
  on public.organization_subscriptions (status, trial_ends_at, current_period_ends_at);
create index if not exists organization_subscriptions_plan_idx
  on public.organization_subscriptions (plan_id, status);

create table if not exists public.organization_feature_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null references public.subscription_features(feature_key) on delete cascade,
  enabled boolean,
  limit_value integer,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, feature_key),
  check (limit_value is null or limit_value >= 0)
);

create table if not exists public.subscription_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_percent numeric(5,2),
  discount_amount numeric(12,2),
  currency text check (currency is null or char_length(currency) = 3),
  applies_to_plan_id uuid references public.subscription_plans(id) on delete set null,
  max_redemptions integer,
  redemption_count integer not null default 0,
  valid_from timestamptz,
  valid_until timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (discount_type = 'percent' and discount_percent is not null and discount_percent > 0 and discount_percent <= 100 and discount_amount is null)
    or
    (discount_type = 'fixed' and discount_amount is not null and discount_amount > 0 and discount_percent is null)
  ),
  check (max_redemptions is null or max_redemptions > 0),
  check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create table if not exists public.subscription_coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.subscription_coupons(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.organization_subscriptions(id) on delete set null,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (coupon_id, organization_id)
);

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.organization_subscriptions(id) on delete set null,
  invoice_number text not null unique,
  status text not null default 'draft' check (status in ('draft','open','paid','void','uncollectible')),
  currency text not null default 'USD' check (char_length(currency) = 3),
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  period_started_at timestamptz,
  period_ends_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  provider text not null default 'manual',
  provider_invoice_id text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subtotal >= 0 and discount_total >= 0 and tax_total >= 0 and total >= 0 and amount_paid >= 0)
);

create index if not exists subscription_invoices_org_status_idx
  on public.subscription_invoices (organization_id, status, created_at desc);

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  subscription_id uuid references public.organization_subscriptions(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists subscription_events_org_idx
  on public.subscription_events (organization_id, created_at desc);
create index if not exists subscription_events_subscription_idx
  on public.subscription_events (subscription_id, created_at desc);

create or replace function public.subscription_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'subscription_features','subscription_plans','subscription_plan_features',
    'organization_subscriptions','organization_feature_overrides',
    'subscription_coupons','subscription_invoices'
  ]
  LOOP
    EXECUTE format('drop trigger if exists %I on public.%I', 'touch_' || table_name, table_name);
    EXECUTE format(
      'create trigger %I before update on public.%I for each row execute function public.subscription_touch_updated_at()',
      'touch_' || table_name,
      table_name
    );
  END LOOP;
END;
$$;

insert into public.subscription_features
  (feature_key,name_fr,name_en,description_fr,description_en,category,value_type,sort_order)
values
  ('core_feedback','Feedback continu','Continuous feedback','Feedback entre collègues et clients.','Peer and customer feedback.','core','boolean',10),
  ('recognition','Reconnaissance','Recognition','Reconnaissance des contributions.','Recognition of contributions.','core','boolean',20),
  ('teams','Équipes et rôles','Teams and roles','Structure, équipes, rôles et affectations.','Structure, teams, roles and assignments.','core','boolean',30),
  ('performance','Performance','Performance','Présences, rapports, KPI et Employé du mois.','Attendance, reports, KPIs and Employee of the Month.','performance','boolean',40),
  ('academy','Super Leader Academy','Super Leader Academy','Formations, quiz, présences et certificats.','Courses, quizzes, attendance and certificates.','growth','boolean',50),
  ('growth','Plans de croissance','Growth plans','Plans de croissance et contributions d’impact.','Growth plans and impact contributions.','growth','boolean',60),
  ('crm_sales','CRM, ventes et recouvrement','CRM, sales and collections','CRM clients, ventes, commissions et recouvrement.','Client CRM, sales, commissions and collections.','commercial','boolean',70),
  ('feedback_automation','Automatisation du feedback','Feedback automation','Demandes et relances automatiques multicanal.','Automated multi-channel feedback requests and reminders.','automation','boolean',80),
  ('reports_advanced','Rapports avancés','Advanced reports','Analyses et exports avancés.','Advanced analytics and exports.','analytics','boolean',90),
  ('custom_branding','Personnalisation de la marque','Custom branding','Logo, domaine et apparence personnalisés.','Custom logo, domain and appearance.','enterprise','boolean',100),
  ('api_integrations','Intégrations API','API integrations','Zoom et intégrations externes.','Zoom and external integrations.','enterprise','boolean',110),
  ('priority_support','Support prioritaire','Priority support','Assistance prioritaire et accompagnement.','Priority support and onboarding.','enterprise','boolean',120),
  ('max_members','Nombre maximal de collaborateurs','Maximum members','Limite de collaborateurs actifs.','Active member limit.','limits','limit',130)
on conflict (feature_key) do update set
  name_fr = excluded.name_fr,
  name_en = excluded.name_en,
  description_fr = excluded.description_fr,
  description_en = excluded.description_en,
  category = excluded.category,
  value_type = excluded.value_type,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.subscription_plans
  (code,name,description,status,is_public,is_internal,pricing_mode,currency,monthly_price,annual_price,default_trial_days,sort_order)
values
  ('legacy_full_access','Accès complet historique','Accès complet conservé pour les organisations existantes pendant la transition V2.5.','active',false,true,'free','USD',0,0,0,0),
  ('starter','Starter','Pour les petites organisations qui structurent le feedback et la performance.','draft',false,false,'fixed','USD',null,null,14,10),
  ('growth','Growth','Pour développer la performance, la formation et la croissance des équipes.','draft',false,false,'fixed','USD',null,null,14,20),
  ('enterprise','Enterprise','Pour les organisations ayant besoin de personnalisation, d’intégrations et d’un accompagnement avancé.','draft',false,false,'custom','USD',null,null,30,30)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_internal = excluded.is_internal,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Configuration provisoire et entièrement modifiable depuis l’administration.
with plans as (select id,code from public.subscription_plans),
features as (select feature_key from public.subscription_features)
insert into public.subscription_plan_features (plan_id,feature_key,enabled,limit_value)
select
  plans.id,
  features.feature_key,
  case
    when plans.code = 'legacy_full_access' then true
    when plans.code = 'starter' then features.feature_key in ('core_feedback','recognition','teams','performance','max_members')
    when plans.code = 'growth' then features.feature_key in ('core_feedback','recognition','teams','performance','academy','growth','crm_sales','feedback_automation','reports_advanced','max_members')
    when plans.code = 'enterprise' then true
    else false
  end,
  case
    when features.feature_key <> 'max_members' then null
    when plans.code = 'starter' then 25
    when plans.code = 'growth' then 100
    else null
  end
from plans cross join features
on conflict (plan_id,feature_key) do nothing;

-- Les organisations existantes conservent toutes leurs fonctions jusqu’à attribution explicite d’un plan.
insert into public.organization_subscriptions (
  organization_id,plan_id,status,billing_interval,currency,provider,
  current_period_started_at,metadata
)
select
  organization.id,
  plan.id,
  'active',
  'custom',
  plan.currency,
  'manual',
  now(),
  jsonb_build_object('migration','v2.5','legacy_access',true)
from public.organizations organization
join public.subscription_plans plan on plan.code = 'legacy_full_access'
where not exists (
  select 1 from public.organization_subscriptions subscription
  where subscription.organization_id = organization.id
    and subscription.status in ('draft','trialing','active','past_due','scheduled_cancel','suspended')
);

create or replace function public.subscription_current(org_id uuid)
returns table (
  subscription_id uuid,
  plan_id uuid,
  plan_code text,
  plan_name text,
  subscription_status text,
  billing_interval text,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    subscription.id,
    plan.id,
    plan.code,
    plan.name,
    subscription.status,
    subscription.billing_interval,
    subscription.trial_ends_at,
    subscription.current_period_ends_at,
    subscription.cancel_at_period_end
  from public.organization_subscriptions subscription
  join public.subscription_plans plan on plan.id = subscription.plan_id
  where subscription.organization_id = org_id
    and subscription.status in ('draft','trialing','active','past_due','scheduled_cancel','suspended')
  order by subscription.created_at desc
  limit 1;
$$;

create or replace function public.subscription_has_feature(org_id uuid, requested_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_subscription as (
    select subscription.plan_id
    from public.organization_subscriptions subscription
    where subscription.organization_id = org_id
      and subscription.status in ('trialing','active','past_due','scheduled_cancel')
      and (subscription.trial_ends_at is null or subscription.status <> 'trialing' or subscription.trial_ends_at >= now())
      and (subscription.current_period_ends_at is null or subscription.current_period_ends_at >= now() or subscription.status = 'past_due')
    order by subscription.created_at desc
    limit 1
  ), override_value as (
    select feature_override.enabled
    from public.organization_feature_overrides feature_override
    where feature_override.organization_id = org_id
      and feature_override.feature_key = requested_feature
  )
  select coalesce(
    (select enabled from override_value),
    (
      select plan_feature.enabled
      from current_subscription current
      join public.subscription_plan_features plan_feature on plan_feature.plan_id = current.plan_id
      where plan_feature.feature_key = requested_feature
    ),
    false
  );
$$;

create or replace function public.subscription_feature_limit(org_id uuid, requested_feature text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with current_subscription as (
    select subscription.plan_id
    from public.organization_subscriptions subscription
    where subscription.organization_id = org_id
      and subscription.status in ('trialing','active','past_due','scheduled_cancel')
      and (subscription.trial_ends_at is null or subscription.status <> 'trialing' or subscription.trial_ends_at >= now())
      and (subscription.current_period_ends_at is null or subscription.current_period_ends_at >= now() or subscription.status = 'past_due')
    order by subscription.created_at desc
    limit 1
  ), override_value as (
    select feature_override.limit_value
    from public.organization_feature_overrides feature_override
    where feature_override.organization_id = org_id
      and feature_override.feature_key = requested_feature
  )
  select coalesce(
    (select limit_value from override_value),
    (
      select plan_feature.limit_value
      from current_subscription current
      join public.subscription_plan_features plan_feature on plan_feature.plan_id = current.plan_id
      where plan_feature.feature_key = requested_feature
    )
  );
$$;

create or replace function public.subscription_active_member_count(org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.organization_members membership
  where membership.organization_id = org_id
    and coalesce(membership.is_active,true) = true;
$$;

create or replace function public.subscription_enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  configured_limit integer;
  current_count integer;
begin
  if coalesce(new.is_active,true) <> true then
    return new;
  end if;

  if tg_op = 'UPDATE' and coalesce(old.is_active,true) = true then
    return new;
  end if;

  configured_limit := public.subscription_feature_limit(new.organization_id,'max_members');
  if configured_limit is null then
    return new;
  end if;

  current_count := public.subscription_active_member_count(new.organization_id);
  if current_count >= configured_limit then
    raise exception 'SUBSCRIPTION_MEMBER_LIMIT_REACHED:%/%', current_count, configured_limit;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_subscription_member_limit on public.organization_members;
create trigger enforce_subscription_member_limit
before insert or update of is_active on public.organization_members
for each row execute function public.subscription_enforce_member_limit();

alter table public.subscription_features enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscription_plan_features enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.organization_feature_overrides enable row level security;
alter table public.subscription_coupons enable row level security;
alter table public.subscription_coupon_redemptions enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.subscription_events enable row level security;

drop policy if exists "subscription features readable" on public.subscription_features;
create policy "subscription features readable"
  on public.subscription_features for select to authenticated using (true);

drop policy if exists "public plans readable" on public.subscription_plans;
create policy "public plans readable"
  on public.subscription_plans for select to authenticated using (is_public = true or is_internal = true);

drop policy if exists "public plan features readable" on public.subscription_plan_features;
create policy "public plan features readable"
  on public.subscription_plan_features for select to authenticated using (
    exists (
      select 1 from public.subscription_plans plan
      where plan.id = subscription_plan_features.plan_id and (plan.is_public = true or plan.is_internal = true)
    )
  );

drop policy if exists "organization subscriptions readable by org" on public.organization_subscriptions;
create policy "organization subscriptions readable by org"
  on public.organization_subscriptions for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists "organization invoices readable by org" on public.subscription_invoices;
create policy "organization invoices readable by org"
  on public.subscription_invoices for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists "organization events readable by org leaders" on public.subscription_events;
create policy "organization events readable by org leaders"
  on public.subscription_events for select to authenticated using (
    organization_id is not null and public.has_org_role(organization_id,array['owner','admin'])
  );

-- Toutes les mutations sont realisees par les actions serveur service_role.
revoke all on public.organization_feature_overrides from anon, authenticated;
revoke all on public.subscription_coupons from anon, authenticated;
revoke all on public.subscription_coupon_redemptions from anon, authenticated;

grant select,insert,update,delete on table
  public.subscription_features,
  public.subscription_plans,
  public.subscription_plan_features,
  public.organization_subscriptions,
  public.organization_feature_overrides,
  public.subscription_coupons,
  public.subscription_coupon_redemptions,
  public.subscription_invoices,
  public.subscription_events
to service_role;

grant execute on function public.subscription_current(uuid) to service_role;
grant execute on function public.subscription_has_feature(uuid,text) to service_role;
grant execute on function public.subscription_feature_limit(uuid,text) to service_role;
grant execute on function public.subscription_active_member_count(uuid) to service_role;

commit;
notify pgrst, 'reload schema';
