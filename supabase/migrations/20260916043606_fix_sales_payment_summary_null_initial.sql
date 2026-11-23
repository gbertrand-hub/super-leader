-- Prevent a payment summary refresh from assigning NULL to the mandatory
-- sales_payments.is_initial_payment flag when no trigger payment exists yet.
create or replace function public.refresh_sales_payment_summary(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales_records%rowtype;
  v_trigger_payment public.sales_payments%rowtype;
  v_total_paid numeric(14,2) := 0;
  v_balance numeric(14,2) := 0;
  v_payment_status text := 'unpaid';
  v_collection_status text := 'not_started';
  v_commission numeric(14,2) := 0;
  v_commission_status text := 'pending';
begin
  select * into v_sale
  from public.sales_records
  where id = p_sale_id
  for update;

  if not found then
    return;
  end if;

  if v_sale.commission_trigger_payment_id is null then
    select * into v_trigger_payment
    from public.sales_payments
    where sale_id = p_sale_id and status = 'confirmed'
    order by payment_date asc, created_at asc
    limit 1;

    if found then
      update public.sales_records
      set commission_trigger_payment_id = v_trigger_payment.id,
          commission_locked_at = coalesce(commission_locked_at, now())
      where id = p_sale_id;
    end if;
  else
    select * into v_trigger_payment
    from public.sales_payments
    where id = v_sale.commission_trigger_payment_id;
  end if;

  update public.sales_payments
  set is_initial_payment = coalesce(
    id = (select commission_trigger_payment_id from public.sales_records where id = p_sale_id),
    false
  )
  where sale_id = p_sale_id
    and is_initial_payment is distinct from coalesce(
      id = (select commission_trigger_payment_id from public.sales_records where id = p_sale_id),
      false
    );

  select coalesce(sum(amount), 0) into v_total_paid
  from public.sales_payments
  where sale_id = p_sale_id and status = 'confirmed';

  v_balance := greatest(v_sale.total_amount - v_total_paid, 0);

  if v_total_paid <= 0 then
    v_payment_status := 'unpaid';
  elsif v_total_paid >= v_sale.total_amount then
    v_payment_status := 'paid';
  else
    v_payment_status := 'partial';
  end if;

  if v_trigger_payment.id is not null and v_trigger_payment.status = 'confirmed' then
    if v_sale.commission_type = 'percentage' then
      v_commission := round(v_trigger_payment.amount * (v_sale.commission_value / 100.0), 2);
    else
      v_commission := round(v_sale.commission_value * v_sale.quantity, 2);
    end if;
  else
    v_commission := 0;
  end if;

  if v_sale.workflow_status in ('rejected','cancelled','refunded') then
    v_commission_status := 'cancelled';
  elsif v_trigger_payment.id is not null and v_trigger_payment.status in ('rejected','refunded') then
    v_commission_status := 'cancelled';
  elsif v_trigger_payment.id is null or v_trigger_payment.status <> 'confirmed' or v_commission <= 0 then
    v_commission_status := 'pending';
  elsif v_sale.commission_status = 'paid' then
    v_commission_status := 'paid';
  elsif v_sale.workflow_status = 'approved' then
    v_commission_status := 'payable';
  elsif v_sale.workflow_status = 'verified' then
    v_commission_status := 'validated';
  else
    v_commission_status := 'pending';
  end if;

  if v_balance <= 0 then
    v_collection_status := 'completed';
  elsif v_sale.collection_status = 'suspended' then
    v_collection_status := 'suspended';
  elsif v_sale.next_payment_due_date is not null and v_sale.next_payment_due_date < current_date then
    v_collection_status := 'overdue';
  elsif v_sale.collection_owner_id is not null and v_total_paid > 0 then
    v_collection_status := 'in_progress';
  elsif v_sale.collection_owner_id is not null then
    v_collection_status := 'assigned';
  elsif v_total_paid > 0 then
    v_collection_status := 'not_started';
  else
    v_collection_status := v_sale.collection_status;
  end if;

  update public.sales_records
  set first_payment_amount = case when v_trigger_payment.status = 'confirmed' then v_trigger_payment.amount else 0 end,
      first_payment_received_at = case when v_trigger_payment.status = 'confirmed' then coalesce(v_trigger_payment.confirmed_at, v_trigger_payment.created_at) else null end,
      paid_amount = v_total_paid,
      balance_amount = v_balance,
      payment_status = v_payment_status,
      commission_basis_amount = case when v_trigger_payment.status = 'confirmed' then v_trigger_payment.amount else 0 end,
      commission_amount = v_commission,
      commission_status = v_commission_status,
      collection_status = v_collection_status
  where id = p_sale_id;
end;
$$;

revoke all on function public.refresh_sales_payment_summary(uuid) from public, anon, authenticated;
grant execute on function public.refresh_sales_payment_summary(uuid) to service_role;

notify pgrst, 'reload schema';
