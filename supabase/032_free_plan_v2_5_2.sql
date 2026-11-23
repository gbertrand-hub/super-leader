-- SUPER LEADER V2.5.2 - Plan Free, limite de 5 utilisateurs et demande de conversion
-- A executer apres 031_public_pricing_catalog_v2_5_1.sql
-- Aucun paiement reel n'est active.

begin;

alter table public.demo_requests
  add column if not exists requested_plan_code text;

alter table public.demo_requests
  drop constraint if exists demo_requests_status_check;

alter table public.demo_requests
  add constraint demo_requests_status_check
  check (status in (
    'new','contact_pending','demo_scheduled','demo_completed',
    'trial_approved','free_approved','client_active','rejected','archived'
  ));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'demo_requests_requested_plan_code_check'
      AND conrelid = 'public.demo_requests'::regclass
  ) THEN
    ALTER TABLE public.demo_requests
      ADD CONSTRAINT demo_requests_requested_plan_code_check
      CHECK (
        requested_plan_code IS NULL
        OR requested_plan_code IN ('free','starter','growth','enterprise')
      );
  END IF;
END;
$$;

insert into public.subscription_plans (
  code,
  name,
  description,
  status,
  is_public,
  is_internal,
  pricing_mode,
  currency,
  monthly_price,
  annual_price,
  default_trial_days,
  sort_order
)
values (
  'free',
  'Free',
  'Pour les organisations comptant jusqu a 5 utilisateurs actifs et souhaitant demarrer avec les fonctions essentielles de Super Leader.',
  'active',
  true,
  false,
  'free',
  'USD',
  0,
  0,
  0,
  5
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  status = 'active',
  is_public = true,
  is_internal = false,
  pricing_mode = 'free',
  currency = 'USD',
  monthly_price = 0,
  annual_price = 0,
  default_trial_days = 0,
  sort_order = 5,
  updated_at = now();

-- Le plan Free donne acces aux fonctions essentielles de collaboration,
-- performance, Academy et croissance, sans les modules commerciaux avances.
with free_plan as (
  select id from public.subscription_plans where code = 'free'
), feature_configuration as (
  select
    feature.feature_key,
    case
      when feature.feature_key in (
        'core_feedback',
        'recognition',
        'teams',
        'performance',
        'academy',
        'growth',
        'max_members'
      ) then true
      else false
    end as enabled,
    case when feature.feature_key = 'max_members' then 5 else null end as limit_value
  from public.subscription_features feature
)
insert into public.subscription_plan_features (
  plan_id,
  feature_key,
  enabled,
  limit_value,
  updated_at
)
select
  free_plan.id,
  feature_configuration.feature_key,
  feature_configuration.enabled,
  feature_configuration.limit_value,
  now()
from free_plan
cross join feature_configuration
on conflict (plan_id, feature_key) do update set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value,
  updated_at = now();

-- Le plan historique reste strictement interne.
update public.subscription_plans
set is_public = false, is_internal = true, updated_at = now()
where code = 'legacy_full_access';

commit;
notify pgrst, 'reload schema';
