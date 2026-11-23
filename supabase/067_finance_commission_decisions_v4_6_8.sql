-- SUPER LEADER V4.6.8 REVISEE - Decisions de commission reservees a Finance
-- A executer apres 066_general_settings_timezone_v4_6.sql
begin;

alter table public.sales_records
  add column if not exists commission_review_status text not null default 'not_reviewed',
  add column if not exists commission_beneficiary_id uuid references auth.users(id),
  add column if not exists commission_policy_reference text,
  add column if not exists commission_justification text,
  add column if not exists commission_reviewed_by uuid references auth.users(id),
  add column if not exists commission_reviewed_at timestamptz,
  add column if not exists commission_payment_reference text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='sales_records_finance_commission_review_check') then
    alter table public.sales_records add constraint sales_records_finance_commission_review_check
      check (commission_review_status in ('not_reviewed','ineligible','eligible','paid'));
  end if;
end $$;

create index if not exists sales_records_finance_commission_queue_idx
  on public.sales_records(organization_id,commission_review_status,sale_date desc)
  where workflow_status='approved';

create or replace function public.enforce_finance_commission_decision()
returns trigger language plpgsql set search_path=public as $$
begin
  -- Legacy payment-summary refreshes must never calculate or expose a commission.
  if new.commission_review_status='not_reviewed' then
    new.commission_amount:=0; new.commission_status:='pending';
    new.commission_beneficiary_id:=null; new.commission_policy_reference:=null;
  elsif new.commission_review_status='ineligible' then
    if nullif(btrim(coalesce(new.commission_justification,'')),'') is null then raise exception 'Finance justification is required'; end if;
    new.commission_amount:=0; new.commission_status:='cancelled'; new.commission_beneficiary_id:=null;
  elsif new.commission_review_status='eligible' then
    if new.commission_amount<=0 or new.commission_beneficiary_id is null or nullif(btrim(coalesce(new.commission_policy_reference,'')),'') is null or nullif(btrim(coalesce(new.commission_justification,'')),'') is null or new.commission_reviewed_by is null or new.commission_reviewed_at is null then
      raise exception 'Complete Finance decision, beneficiary, policy, amount and justification are required';
    end if;
    new.commission_status:='payable';
  elsif new.commission_review_status='paid' then
    if old.commission_review_status<>'eligible' or new.commission_paid_by is null or new.commission_paid_at is null or nullif(btrim(coalesce(new.commission_payment_reference,'')),'') is null then raise exception 'Only an eligible commission can be paid with a payment reference'; end if;
    new.commission_status:='paid';
  end if;
  if old.commission_review_status in ('ineligible','paid') and new.commission_review_status is distinct from old.commission_review_status then raise exception 'Final Finance commission decisions cannot be reopened'; end if;
  return new;
end $$;

drop trigger if exists enforce_finance_commission_decision on public.sales_records;
create trigger enforce_finance_commission_decision before insert or update on public.sales_records
for each row execute function public.enforce_finance_commission_decision();

-- Retire l'ancien automatisme ambassadeur : aucune commission n'est creee a partir d'un paiement.
drop trigger if exists enforce_ambassador_commission_workflow on public.crm_ambassador_commissions;
drop function if exists public.enforce_ambassador_commission_workflow();

comment on column public.sales_records.commission_review_status is 'Finance-only decision; a beneficiary can only view their own eligible or paid commission through the secured server page.';

-- Les notifications de commission vont exclusivement au bénéficiaire choisi par
-- Finance, et uniquement après validation ou paiement. Une vente non éligible ne
-- révèle aucune information de commission au vendeur.
drop trigger if exists notify_sales_record_changes_trigger on public.sales_records;
create trigger notify_sales_record_changes_trigger
after insert or update of workflow_status, collection_owner_id on public.sales_records
for each row execute function public.notify_sales_record_changes();

create or replace function public.notify_validated_sale_commission()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.commission_beneficiary_id is not null
     and new.commission_review_status in ('eligible','paid')
     and new.commission_review_status is distinct from old.commission_review_status then
    perform public.notify_user(
      new.organization_id,
      new.commission_beneficiary_id,
      coalesce(new.commission_paid_by,new.commission_reviewed_by,new.approved_by,new.created_by),
      'sales',
      case when new.commission_review_status='paid' then 'commission_paid' else 'commission_validated' end,
      case when new.commission_review_status='paid' then 'Commission payée' else 'Commission validée' end,
      case when new.commission_review_status='paid' then 'Commission paid' else 'Commission approved' end,
      'Une commission de '||new.commission_amount::text||' '||new.currency||' t''a été attribuée par Finance.',
      'Finance has awarded you a commission of '||new.commission_amount::text||' '||new.currency||'.',
      '/dashboard/commissions',
      case when new.commission_review_status='paid' then 'success' else 'info' end,
      new.commission_review_status='eligible',
      'finance-commission:'||new.id::text||':'||new.commission_review_status||':'||new.commission_beneficiary_id::text,
      jsonb_build_object('sale_id',new.id,'commission_amount',new.commission_amount,'currency',new.currency)
    );
  end if;
  return new;
end $$;

drop trigger if exists notify_validated_sale_commission_trigger on public.sales_records;
create trigger notify_validated_sale_commission_trigger
after update of commission_review_status on public.sales_records
for each row execute function public.notify_validated_sale_commission();
commit;
notify pgrst,'reload schema';
