-- Super Leader V4.8.72
-- iLEAD Global Institute - gouvernance tarifaire, contrats financiers et paiements consolides
-- Migration idempotente. Conserve les tables historiques academy_student_finance / academy_student_payments.

begin;

create table if not exists public.academy_pricing_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  delegated_discount_percent numeric(5,2) not null default 15 check (delegated_discount_percent between 0 and 100),
  commission_required_percent numeric(5,2) not null default 30 check (commission_required_percent between 0 and 100),
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (delegated_discount_percent <= commission_required_percent)
);

create table if not exists public.academy_pricing_commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null default 'Commission de fixation et d''homologation des frais',
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists academy_pricing_one_active_commission_idx
  on public.academy_pricing_commissions(organization_id)
  where status='active';

create table if not exists public.academy_pricing_commission_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  commission_id uuid not null references public.academy_pricing_commissions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('chair','secretary','member')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (commission_id,user_id)
);

create table if not exists public.academy_program_tariffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  program_id uuid not null references public.academy_programs(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check (status in ('draft','submitted','active','replaced','archived')),
  effective_from date not null default current_date,
  effective_until date,
  notes text check (notes is null or char_length(notes) <= 5000),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id,version),
  check (effective_until is null or effective_until >= effective_from)
);
create index if not exists academy_program_tariffs_lookup_idx
  on public.academy_program_tariffs(organization_id,program_id,status,effective_from desc);
create unique index if not exists academy_program_tariffs_one_active_idx
  on public.academy_program_tariffs(program_id)
  where status='active' and effective_until is null;

create table if not exists public.academy_pricing_promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  scope_type text not null default 'program' check (scope_type in ('organization','school','program','cohort')),
  school_id uuid references public.academy_schools(id) on delete cascade,
  program_id uuid references public.academy_programs(id) on delete cascade,
  cohort_id uuid references public.academy_cohorts(id) on delete cascade,
  discount_type text not null check (discount_type in ('percent','fixed','final_price')),
  discount_value numeric(14,2) not null check (discount_value >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  valid_from date not null default current_date,
  valid_until date,
  status text not null default 'draft' check (status in ('draft','active','suspended','archived')),
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  notes text check (notes is null or char_length(notes) <= 5000),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);
create index if not exists academy_pricing_promotions_lookup_idx
  on public.academy_pricing_promotions(organization_id,status,valid_from,valid_until);

create table if not exists public.academy_student_financial_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
  tariff_id uuid references public.academy_program_tariffs(id) on delete set null,
  promotion_id uuid references public.academy_pricing_promotions(id) on delete set null,
  list_price numeric(14,2) not null default 0 check (list_price >= 0),
  promotion_discount_amount numeric(14,2) not null default 0 check (promotion_discount_amount >= 0),
  individual_adjustment_amount numeric(14,2) not null default 0 check (individual_adjustment_amount >= 0),
  agreed_amount numeric(14,2) not null default 0 check (agreed_amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check (status in ('draft','pending_approval','active','rejected','superseded','cancelled')),
  adjustment_reason text check (adjustment_reason is null or char_length(adjustment_reason) <= 2000),
  approval_note text check (approval_note is null or char_length(approval_note) <= 2000),
  source text not null default 'manual' check (source in ('manual','legacy','promotion','bundle')),
  supersedes_agreement_id uuid references public.academy_student_financial_agreements(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (promotion_discount_amount + individual_adjustment_amount <= list_price or list_price = 0),
  check (agreed_amount = greatest(0::numeric, list_price - promotion_discount_amount - individual_adjustment_amount))
);
create unique index if not exists academy_student_financial_agreements_one_active_idx
  on public.academy_student_financial_agreements(enrollment_id)
  where status='active';
create index if not exists academy_student_financial_agreements_pending_idx
  on public.academy_student_financial_agreements(organization_id,status,created_at desc);

alter table public.academy_student_finance
  add column if not exists current_agreement_id uuid references public.academy_student_financial_agreements(id) on delete set null;

create table if not exists public.academy_student_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null check (subject_type in ('crm_client','user')),
  subject_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,subject_type,subject_id)
);

create table if not exists public.academy_student_global_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.academy_student_accounts(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  paid_on date not null default current_date,
  payment_method text not null default 'other' check (payment_method in ('cash','bank_transfer','card','mobile_money','check','other')),
  reference text,
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'declared' check (status in ('declared','confirmed','rejected','cancelled')),
  source text not null default 'manual' check (source in ('manual','legacy','finance')),
  recorded_by uuid references auth.users(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists academy_student_global_payments_account_idx
  on public.academy_student_global_payments(account_id,paid_on desc,created_at desc);

create table if not exists public.academy_student_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.academy_student_global_payments(id) on delete cascade,
  enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id,enrollment_id)
);
create index if not exists academy_student_payment_allocations_enrollment_idx
  on public.academy_student_payment_allocations(enrollment_id,created_at desc);

alter table public.academy_student_payments
  add column if not exists global_payment_id uuid references public.academy_student_global_payments(id) on delete set null,
  add column if not exists global_allocation_id uuid references public.academy_student_payment_allocations(id) on delete set null;
create unique index if not exists academy_student_payments_global_allocation_uidx
  on public.academy_student_payments(global_allocation_id)
  where global_allocation_id is not null;

create table if not exists public.academy_pricing_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists academy_pricing_audit_log_idx
  on public.academy_pricing_audit_log(organization_id,created_at desc);

-- Cree ou retrouve le compte financier consolide correspondant a une inscription.
create or replace function public.ensure_academy_student_account(target_organization_id uuid,target_enrollment_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare e record; result_id uuid;
begin
  select crm_client_id,user_id into e
  from public.academy_school_enrollments
  where id=target_enrollment_id and organization_id=target_organization_id;
  if not found then raise exception 'Inscription introuvable.'; end if;
  if e.crm_client_id is not null then
    insert into public.academy_student_accounts(organization_id,subject_type,subject_id)
    values(target_organization_id,'crm_client',e.crm_client_id)
    on conflict(organization_id,subject_type,subject_id) do update set updated_at=now()
    returning id into result_id;
  elsif e.user_id is not null then
    insert into public.academy_student_accounts(organization_id,subject_type,subject_id)
    values(target_organization_id,'user',e.user_id)
    on conflict(organization_id,subject_type,subject_id) do update set updated_at=now()
    returning id into result_id;
  else
    raise exception 'Inscription sans identite etudiante.';
  end if;
  return result_id;
end; $$;

-- Active transactionnellement un accord financier approuve et synchronise la table historique.
create or replace function public.activate_academy_financial_agreement(target_agreement_id uuid,target_actor_id uuid,target_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare a record; old_id uuid;
begin
  select * into a from public.academy_student_financial_agreements where id=target_agreement_id for update;
  if not found then raise exception 'Accord financier introuvable.'; end if;
  select id into old_id from public.academy_student_financial_agreements
    where enrollment_id=a.enrollment_id and status='active' and id<>a.id limit 1;
  if old_id is not null then
    update public.academy_student_financial_agreements set status='superseded',updated_at=now() where id=old_id;
  end if;
  update public.academy_student_financial_agreements
    set status='active',approved_by=target_actor_id,approved_at=now(),approval_note=coalesce(target_note,approval_note),updated_at=now()
    where id=a.id;
  update public.academy_student_finance
    set list_price=a.list_price,
        discount_amount=a.promotion_discount_amount+a.individual_adjustment_amount,
        agreed_amount=a.agreed_amount,
        currency=a.currency,
        current_agreement_id=a.id,
        updated_at=now()
    where enrollment_id=a.enrollment_id;
  perform public.refresh_academy_student_finance(a.enrollment_id);
end; $$;

-- Synchronise une allocation confirmee vers academy_student_payments pour conserver toutes les vues historiques.
create or replace function public.sync_academy_global_allocation_to_legacy()
returns trigger language plpgsql security definer set search_path=public as $$
declare p record; legacy_id uuid;
begin
  if tg_op='DELETE' then
    delete from public.academy_student_payments where global_allocation_id=old.id;
    return old;
  end if;
  select * into p from public.academy_student_global_payments where id=new.payment_id;
  if p.status='confirmed' then
    select id into legacy_id from public.academy_student_payments where global_allocation_id=new.id limit 1;
    if legacy_id is null then
      insert into public.academy_student_payments(
        organization_id,enrollment_id,amount,currency,paid_on,payment_method,reference,notes,recorded_by,global_payment_id,global_allocation_id
      ) values(
        new.organization_id,new.enrollment_id,new.amount,p.currency,p.paid_on,p.payment_method,p.reference,p.notes,p.recorded_by,p.id,new.id
      );
    else
      update public.academy_student_payments set
        enrollment_id=new.enrollment_id,amount=new.amount,currency=p.currency,paid_on=p.paid_on,payment_method=p.payment_method,
        reference=p.reference,notes=p.notes,global_payment_id=p.id
      where id=legacy_id;
    end if;
  else
    delete from public.academy_student_payments where global_allocation_id=new.id;
  end if;
  return new;
end; $$;
drop trigger if exists academy_global_allocation_sync_legacy on public.academy_student_payment_allocations;
create trigger academy_global_allocation_sync_legacy
  after insert or update or delete on public.academy_student_payment_allocations
  for each row execute function public.sync_academy_global_allocation_to_legacy();

create or replace function public.sync_academy_global_payment_status_to_legacy()
returns trigger language plpgsql security definer set search_path=public as $$
declare allocation record;
begin
  if new.status is distinct from old.status or new.amount is distinct from old.amount or new.currency is distinct from old.currency
     or new.paid_on is distinct from old.paid_on or new.payment_method is distinct from old.payment_method
     or new.reference is distinct from old.reference or new.notes is distinct from old.notes then
    if new.status='confirmed' then
      for allocation in select * from public.academy_student_payment_allocations where payment_id=new.id loop
        if not exists(select 1 from public.academy_student_payments where global_allocation_id=allocation.id) then
          insert into public.academy_student_payments(
            organization_id,enrollment_id,amount,currency,paid_on,payment_method,reference,notes,recorded_by,global_payment_id,global_allocation_id
          ) values(
            allocation.organization_id,allocation.enrollment_id,allocation.amount,new.currency,new.paid_on,new.payment_method,new.reference,new.notes,new.recorded_by,new.id,allocation.id
          );
        else
          update public.academy_student_payments set amount=allocation.amount,currency=new.currency,paid_on=new.paid_on,
            payment_method=new.payment_method,reference=new.reference,notes=new.notes,global_payment_id=new.id
          where global_allocation_id=allocation.id;
        end if;
      end loop;
    else
      delete from public.academy_student_payments where global_payment_id=new.id;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists academy_global_payment_status_sync_legacy on public.academy_student_global_payments;
create trigger academy_global_payment_status_sync_legacy
  after update on public.academy_student_global_payments
  for each row execute function public.sync_academy_global_payment_status_to_legacy();

-- Tout ancien paiement enregistre par les ecrans historiques rejoint automatiquement le compte consolide.
create or replace function public.sync_academy_legacy_payment_to_global()
returns trigger language plpgsql security definer set search_path=public as $$
declare account_id uuid; payment_id uuid; allocation_id uuid;
begin
  if new.global_payment_id is not null then return new; end if;
  account_id := public.ensure_academy_student_account(new.organization_id,new.enrollment_id);
  -- On cree d'abord le paiement comme declare pour eviter que le trigger d'allocation
  -- ne cree une seconde ligne historique avant d'avoir rattache la ligne courante.
  insert into public.academy_student_global_payments(
    organization_id,account_id,amount,currency,paid_on,payment_method,reference,notes,status,source,recorded_by
  ) values(
    new.organization_id,account_id,new.amount,new.currency,new.paid_on,new.payment_method,new.reference,new.notes,'declared','legacy',new.recorded_by
  ) returning id into payment_id;
  insert into public.academy_student_payment_allocations(organization_id,payment_id,enrollment_id,amount,created_by)
  values(new.organization_id,payment_id,new.enrollment_id,new.amount,new.recorded_by)
  returning id into allocation_id;
  update public.academy_student_payments set global_payment_id=payment_id,global_allocation_id=allocation_id where id=new.id;
  update public.academy_student_global_payments
    set status='confirmed',confirmed_by=new.recorded_by,confirmed_at=coalesce(new.created_at,now()),updated_at=now()
    where id=payment_id;
  return new;
end; $$;
drop trigger if exists academy_legacy_payment_sync_global on public.academy_student_payments;
create trigger academy_legacy_payment_sync_global
  after insert on public.academy_student_payments
  for each row when (new.global_payment_id is null)
  execute function public.sync_academy_legacy_payment_to_global();

-- Enregistre un paiement unique, eventuellement reparti sur plusieurs inscriptions.
create or replace function public.record_academy_consolidated_payment(
  target_organization_id uuid,
  target_account_id uuid,
  payment_amount numeric,
  payment_currency text,
  payment_paid_on date,
  payment_method_value text,
  payment_reference text,
  payment_notes text,
  payment_status_value text,
  payment_allocations jsonb,
  target_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare payment_id uuid; item jsonb; target_enrollment_id uuid; allocation_amount numeric; total_allocated numeric:=0; account record; enrollment record; finance_currency text;
begin
  if payment_amount<=0 then raise exception 'Le montant doit etre superieur a zero.'; end if;
  if payment_currency !~ '^[A-Z]{3}$' then raise exception 'Devise invalide.'; end if;
  if payment_status_value not in ('declared','confirmed') then raise exception 'Statut de paiement invalide.'; end if;
  select * into account from public.academy_student_accounts where id=target_account_id and organization_id=target_organization_id;
  if not found then raise exception 'Compte etudiant introuvable.'; end if;
  for item in select * from jsonb_array_elements(coalesce(payment_allocations,'[]'::jsonb)) loop
    target_enrollment_id := (item->>'enrollment_id')::uuid;
    allocation_amount := coalesce((item->>'amount')::numeric,0);
    if allocation_amount<=0 then continue; end if;
    select * into enrollment from public.academy_school_enrollments
      where id=target_enrollment_id and organization_id=target_organization_id;
    if not found then raise exception 'Inscription invalide.'; end if;
    if account.subject_type='crm_client' and enrollment.crm_client_id is distinct from account.subject_id then raise exception 'Inscription hors du compte etudiant.'; end if;
    if account.subject_type='user' and enrollment.user_id is distinct from account.subject_id then raise exception 'Inscription hors du compte etudiant.'; end if;
    select currency into finance_currency from public.academy_student_finance where enrollment_id=target_enrollment_id;
    if finance_currency is not null and finance_currency<>payment_currency then raise exception 'Devise incompatible pour une allocation.'; end if;
    total_allocated := total_allocated + allocation_amount;
  end loop;
  if total_allocated>payment_amount then raise exception 'Les allocations depassent le paiement.'; end if;
  insert into public.academy_student_global_payments(
    organization_id,account_id,amount,currency,paid_on,payment_method,reference,notes,status,source,recorded_by,confirmed_by,confirmed_at
  ) values(
    target_organization_id,target_account_id,payment_amount,payment_currency,coalesce(payment_paid_on,current_date),payment_method_value,
    nullif(trim(payment_reference),''),nullif(trim(payment_notes),''),payment_status_value,'manual',target_actor_id,
    case when payment_status_value='confirmed' then target_actor_id else null end,
    case when payment_status_value='confirmed' then now() else null end
  ) returning id into payment_id;
  for item in select * from jsonb_array_elements(coalesce(payment_allocations,'[]'::jsonb)) loop
    target_enrollment_id := (item->>'enrollment_id')::uuid;
    allocation_amount := coalesce((item->>'amount')::numeric,0);
    if allocation_amount>0 then
      insert into public.academy_student_payment_allocations(organization_id,payment_id,enrollment_id,amount,created_by)
      values(target_organization_id,payment_id,target_enrollment_id,allocation_amount,target_actor_id);
    end if;
  end loop;
  return payment_id;
end; $$;

create or replace function public.add_academy_payment_allocations(
  target_organization_id uuid,target_payment_id uuid,payment_allocations jsonb,target_actor_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare p record; account record; item jsonb; target_enrollment_id uuid; allocation_amount numeric; existing_total numeric; new_total numeric:=0; enrollment record; finance_currency text;
begin
  select * into p from public.academy_student_global_payments where id=target_payment_id and organization_id=target_organization_id for update;
  if not found then raise exception 'Paiement introuvable.'; end if;
  select * into account from public.academy_student_accounts where id=p.account_id;
  select coalesce(sum(amount),0) into existing_total from public.academy_student_payment_allocations where payment_id=p.id;
  for item in select * from jsonb_array_elements(coalesce(payment_allocations,'[]'::jsonb)) loop
    target_enrollment_id := (item->>'enrollment_id')::uuid;
    allocation_amount := coalesce((item->>'amount')::numeric,0);
    if allocation_amount<=0 then continue; end if;
    select * into enrollment from public.academy_school_enrollments where id=target_enrollment_id and organization_id=target_organization_id;
    if not found then raise exception 'Inscription invalide.'; end if;
    if account.subject_type='crm_client' and enrollment.crm_client_id is distinct from account.subject_id then raise exception 'Inscription hors du compte etudiant.'; end if;
    if account.subject_type='user' and enrollment.user_id is distinct from account.subject_id then raise exception 'Inscription hors du compte etudiant.'; end if;
    select currency into finance_currency from public.academy_student_finance where enrollment_id=target_enrollment_id;
    if finance_currency is not null and finance_currency<>p.currency then raise exception 'Devise incompatible.'; end if;
    new_total:=new_total+allocation_amount;
  end loop;
  if existing_total+new_total>p.amount then raise exception 'Les allocations depassent le credit disponible.'; end if;
  for item in select * from jsonb_array_elements(coalesce(payment_allocations,'[]'::jsonb)) loop
    target_enrollment_id := (item->>'enrollment_id')::uuid;
    allocation_amount := coalesce((item->>'amount')::numeric,0);
    if allocation_amount>0 then
      insert into public.academy_student_payment_allocations(organization_id,payment_id,enrollment_id,amount,created_by)
      values(target_organization_id,p.id,target_enrollment_id,allocation_amount,target_actor_id)
      on conflict(payment_id,enrollment_id) do update set amount=public.academy_student_payment_allocations.amount+excluded.amount,updated_at=now();
    end if;
  end loop;
end; $$;

-- Comptes et accords historiques.
insert into public.academy_student_accounts(organization_id,subject_type,subject_id)
select distinct organization_id,'crm_client',crm_client_id from public.academy_school_enrollments where crm_client_id is not null
on conflict(organization_id,subject_type,subject_id) do nothing;
insert into public.academy_student_accounts(organization_id,subject_type,subject_id)
select distinct organization_id,'user',user_id from public.academy_school_enrollments where user_id is not null
on conflict(organization_id,subject_type,subject_id) do nothing;

insert into public.academy_student_financial_agreements(
  organization_id,enrollment_id,list_price,promotion_discount_amount,individual_adjustment_amount,agreed_amount,currency,status,source,created_by,approved_by,approved_at
)
select f.organization_id,f.enrollment_id,f.list_price,f.discount_amount,0,f.agreed_amount,f.currency,'active','legacy',f.created_by,f.created_by,coalesce(f.updated_at,f.created_at)
from public.academy_student_finance f
where not exists(select 1 from public.academy_student_financial_agreements a where a.enrollment_id=f.enrollment_id and a.status='active');

update public.academy_student_finance f set current_agreement_id=a.id
from public.academy_student_financial_agreements a
where a.enrollment_id=f.enrollment_id and a.status='active' and f.current_agreement_id is null;

-- Migre chaque paiement historique vers un paiement global entierement alloue.
do $$
declare p record; account_id uuid; payment_id uuid; allocation_id uuid;
begin
  for p in select * from public.academy_student_payments where global_payment_id is null loop
    account_id:=public.ensure_academy_student_account(p.organization_id,p.enrollment_id);
    insert into public.academy_student_global_payments(
      organization_id,account_id,amount,currency,paid_on,payment_method,reference,notes,status,source,recorded_by
    ) values(
      p.organization_id,account_id,p.amount,p.currency,p.paid_on,p.payment_method,p.reference,p.notes,'declared','legacy',p.recorded_by
    ) returning id into payment_id;
    insert into public.academy_student_payment_allocations(organization_id,payment_id,enrollment_id,amount,created_by)
    values(p.organization_id,payment_id,p.enrollment_id,p.amount,p.recorded_by)
    returning id into allocation_id;
    update public.academy_student_payments set global_payment_id=payment_id,global_allocation_id=allocation_id where id=p.id;
    update public.academy_student_global_payments
      set status='confirmed',confirmed_by=p.recorded_by,confirmed_at=coalesce(p.created_at,now()),updated_at=now()
      where id=payment_id;
  end loop;
end $$;

-- RLS : lecture pour membres de l'organisation. Les ecritures passent par les actions serveur/service_role.
do $$ declare t text; begin
  foreach t in array array[
    'academy_pricing_settings','academy_pricing_commissions','academy_pricing_commission_members','academy_program_tariffs',
    'academy_pricing_promotions','academy_student_financial_agreements','academy_student_accounts','academy_student_global_payments',
    'academy_student_payment_allocations','academy_pricing_audit_log'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists "academy finance org read" on public.%I',t);
    execute format('create policy "academy finance org read" on public.%I for select to authenticated using (public.is_org_member(organization_id))',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

revoke all on function public.ensure_academy_student_account(uuid,uuid) from public,authenticated;
revoke all on function public.activate_academy_financial_agreement(uuid,uuid,text) from public,authenticated;
revoke all on function public.record_academy_consolidated_payment(uuid,uuid,numeric,text,date,text,text,text,text,jsonb,uuid) from public,authenticated;
revoke all on function public.add_academy_payment_allocations(uuid,uuid,jsonb,uuid) from public,authenticated;
grant execute on function public.ensure_academy_student_account(uuid,uuid) to service_role;
grant execute on function public.activate_academy_financial_agreement(uuid,uuid,text) to service_role;
grant execute on function public.record_academy_consolidated_payment(uuid,uuid,numeric,text,date,text,text,text,text,jsonb,uuid) to service_role;
grant execute on function public.add_academy_payment_allocations(uuid,uuid,jsonb,uuid) to service_role;

commit;
