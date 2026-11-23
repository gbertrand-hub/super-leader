-- SUPER LEADER V4.6.9 - Paiement integral ou echelonne
-- A executer apres 067_finance_commission_decisions_v4_6_8.sql
begin;

-- Les colonnes historiques portent encore le nom "initial_payment" pour garder
-- la compatibilite. payment_plan_type devient la source de verite du mode choisi.
update public.sales_records
set payment_plan_type = case
  when coalesce(first_payment_amount, 0) >= total_amount and total_amount > 0 then 'full'
  when coalesce(first_payment_amount, 0) > 0 then 'installments'
  else 'installments'
end
where payment_plan_type not in ('full', 'installments');

update public.sales_records
set payment_plan_type = 'installments'
where payment_plan_type = 'full'
  and paid_amount > 0
  and paid_amount < total_amount;

create or replace function public.enforce_sale_settlement_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payment_plan_type not in ('full', 'installments') then
    raise exception 'Settlement mode must be full or installments';
  end if;

  if new.payment_plan_type = 'full' and new.paid_amount > 0 and new.paid_amount < new.total_amount then
    raise exception 'A confirmed full payment must equal the sale total';
  end if;

  if new.payment_plan_type = 'installments' and new.paid_amount >= new.total_amount and new.total_amount > 0 then
    -- Une vente echelonnee devient integralement payee quand son solde arrive a zero.
    new.payment_status := 'paid';
    new.collection_status := 'completed';
  end if;

  new.balance_amount := greatest(new.total_amount - new.paid_amount, 0);
  return new;
end $$;

drop trigger if exists enforce_sale_settlement_consistency_trigger on public.sales_records;
create trigger enforce_sale_settlement_consistency_trigger
before insert or update of payment_plan_type, total_amount, paid_amount
on public.sales_records
for each row execute function public.enforce_sale_settlement_consistency();

comment on column public.sales_records.payment_plan_type is
  'V4.6.9 settlement mode selected at sale entry: full or installments.';

commit;
notify pgrst, 'reload schema';
