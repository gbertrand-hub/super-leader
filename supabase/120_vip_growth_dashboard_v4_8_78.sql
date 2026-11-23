begin;

-- SUPER LEADER V4.8.78 — VIP Growth Dashboard
-- Commercial & marketing steering for the paid Super Leader VIP programme.
-- CRM remains the identity/prospect source of truth and Finance/Sales remains
-- the payment source of truth. These tables only add VIP-specific growth context.

alter table if exists public.vip_program_settings
  add column if not exists vip_membership_product_id uuid references public.sales_products(id) on delete set null,
  add column if not exists vip_growth_target_members_month integer not null default 10,
  add column if not exists vip_growth_target_revenue_month numeric(14,2) not null default 0,
  add column if not exists vip_growth_default_currency text not null default 'USD';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vip_program_settings_growth_target_members_check') then
    alter table public.vip_program_settings
      add constraint vip_program_settings_growth_target_members_check
      check (vip_growth_target_members_month between 0 and 100000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vip_program_settings_growth_target_revenue_check') then
    alter table public.vip_program_settings
      add constraint vip_program_settings_growth_target_revenue_check
      check (vip_growth_target_revenue_month >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vip_program_settings_growth_currency_check') then
    alter table public.vip_program_settings
      add constraint vip_program_settings_growth_currency_check
      check (vip_growth_default_currency ~ '^[A-Z]{3}$');
  end if;
end $$;

create table if not exists public.vip_growth_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 180),
  objective text,
  channel text not null default 'other' check (channel in (
    'referral','private_event','masterclass','meta','linkedin','whatsapp',
    'partner','ambassador','sales','personal_invitation','other'
  )),
  country text,
  segment text,
  budget_amount numeric(14,2) not null default 0 check (budget_amount >= 0),
  spent_amount numeric(14,2) not null default 0 check (spent_amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  target_leads integer not null default 0 check (target_leads between 0 and 1000000),
  target_members integer not null default 0 check (target_members between 0 and 1000000),
  starts_on date,
  ends_on date,
  status text not null default 'planned' check (status in ('planned','active','paused','completed','cancelled')),
  owner_user_id uuid references auth.users(id) on delete set null,
  notes text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index if not exists vip_growth_campaigns_org_status_idx
  on public.vip_growth_campaigns (organization_id, status, starts_on desc, created_at desc);
create index if not exists vip_growth_campaigns_org_channel_idx
  on public.vip_growth_campaigns (organization_id, channel, created_at desc);

create table if not exists public.vip_growth_prospects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  crm_client_id uuid not null references public.crm_clients(id) on delete cascade,
  campaign_id uuid references public.vip_growth_campaigns(id) on delete set null,
  source_channel text not null default 'other' check (source_channel in (
    'referral','private_event','masterclass','meta','linkedin','whatsapp',
    'partner','ambassador','sales','personal_invitation','other'
  )),
  stage text not null default 'new' check (stage in (
    'new','qualified','invited','application','approved','payment_pending','member','lost'
  )),
  referred_by_member_id uuid references public.vip_members(id) on delete set null,
  nomination_id uuid references public.vip_nominations(id) on delete set null,
  member_id uuid references public.vip_members(id) on delete set null,
  sale_id uuid references public.sales_records(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  expected_value numeric(14,2) not null default 0 check (expected_value >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  next_action text,
  next_action_at timestamptz,
  invited_at timestamptz,
  application_at timestamptz,
  approved_at timestamptz,
  converted_at timestamptz,
  lost_reason text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, crm_client_id)
);

create index if not exists vip_growth_prospects_org_stage_idx
  on public.vip_growth_prospects (organization_id, stage, updated_at desc);
create index if not exists vip_growth_prospects_org_campaign_idx
  on public.vip_growth_prospects (organization_id, campaign_id, stage);
create index if not exists vip_growth_prospects_org_owner_idx
  on public.vip_growth_prospects (organization_id, owner_user_id, stage, next_action_at);

create table if not exists public.vip_growth_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid not null references public.vip_growth_prospects(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  changed_by uuid not null references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists vip_growth_stage_history_prospect_idx
  on public.vip_growth_stage_history (prospect_id, created_at desc);
create index if not exists vip_growth_stage_history_org_idx
  on public.vip_growth_stage_history (organization_id, created_at desc);

create table if not exists public.vip_growth_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  entity_type text not null check (entity_type in ('campaign','prospect','settings')),
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vip_growth_audit_org_idx
  on public.vip_growth_audit_log (organization_id, created_at desc);

-- Keep updated_at consistent with the existing VIP module.
drop trigger if exists vip_growth_campaigns_updated_at_trigger on public.vip_growth_campaigns;
create trigger vip_growth_campaigns_updated_at_trigger
before update on public.vip_growth_campaigns
for each row execute function public.vip_set_updated_at();

drop trigger if exists vip_growth_prospects_updated_at_trigger on public.vip_growth_prospects;
create trigger vip_growth_prospects_updated_at_trigger
before update on public.vip_growth_prospects
for each row execute function public.vip_set_updated_at();

alter table public.vip_growth_campaigns enable row level security;
alter table public.vip_growth_prospects enable row level security;
alter table public.vip_growth_stage_history enable row level security;
alter table public.vip_growth_audit_log enable row level security;

revoke all on public.vip_growth_campaigns from anon, authenticated;
revoke all on public.vip_growth_prospects from anon, authenticated;
revoke all on public.vip_growth_stage_history from anon, authenticated;
revoke all on public.vip_growth_audit_log from anon, authenticated;

grant select, insert, update, delete on public.vip_growth_campaigns to service_role;
grant select, insert, update, delete on public.vip_growth_prospects to service_role;
grant select, insert on public.vip_growth_stage_history to service_role;
grant select, insert on public.vip_growth_audit_log to service_role;

comment on table public.vip_growth_campaigns is 'Commercial and marketing campaigns for paid Super Leader VIP membership growth.';
comment on table public.vip_growth_prospects is 'VIP-specific funnel context linked one-to-one to the canonical CRM prospect/client.';
comment on column public.vip_program_settings.vip_membership_product_id is 'Sales catalogue product used as the Finance/Sales source of truth for VIP membership revenue.';

commit;

notify pgrst, 'reload schema';
