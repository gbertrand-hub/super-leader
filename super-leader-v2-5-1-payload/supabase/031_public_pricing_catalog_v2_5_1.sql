-- SUPER LEADER V2.5.1 - Catalogue public des plans et tarifs provisoires
-- A executer apres 030_subscriptions_feature_control_v2_5.sql
-- Les paiements reels restent desactives. Ces tarifs sont provisoires et modifiables.

begin;

update public.subscription_plans
set
  name = 'Starter',
  description = 'Pour les petites organisations qui structurent le feedback, les equipes et la performance.',
  status = 'active',
  is_public = true,
  is_internal = false,
  pricing_mode = 'fixed',
  currency = 'USD',
  monthly_price = 49.00,
  annual_price = 490.00,
  default_trial_days = 14,
  sort_order = 10,
  updated_at = now()
where code = 'starter';

update public.subscription_plans
set
  name = 'Growth',
  description = 'Pour developper la performance, la formation, les ventes et la croissance des equipes.',
  status = 'active',
  is_public = true,
  is_internal = false,
  pricing_mode = 'fixed',
  currency = 'USD',
  monthly_price = 99.00,
  annual_price = 990.00,
  default_trial_days = 14,
  sort_order = 20,
  updated_at = now()
where code = 'growth';

update public.subscription_plans
set
  name = 'Enterprise',
  description = 'Pour les organisations ayant besoin de personnalisation, d integrations et d un accompagnement avance.',
  status = 'active',
  is_public = true,
  is_internal = false,
  pricing_mode = 'custom',
  currency = 'USD',
  monthly_price = null,
  annual_price = null,
  default_trial_days = 30,
  sort_order = 30,
  updated_at = now()
where code = 'enterprise';

-- Confirmer les limites de collaborateurs publiees.
update public.subscription_plan_features feature
set limit_value = 25, enabled = true, updated_at = now()
from public.subscription_plans plan
where feature.plan_id = plan.id
  and plan.code = 'starter'
  and feature.feature_key = 'max_members';

update public.subscription_plan_features feature
set limit_value = 100, enabled = true, updated_at = now()
from public.subscription_plans plan
where feature.plan_id = plan.id
  and plan.code = 'growth'
  and feature.feature_key = 'max_members';

update public.subscription_plan_features feature
set limit_value = null, enabled = true, updated_at = now()
from public.subscription_plans plan
where feature.plan_id = plan.id
  and plan.code = 'enterprise'
  and feature.feature_key = 'max_members';

-- Le plan de transition interne ne doit jamais apparaitre sur la page publique.
update public.subscription_plans
set is_public = false, is_internal = true, updated_at = now()
where code = 'legacy_full_access';

commit;

notify pgrst, 'reload schema';
