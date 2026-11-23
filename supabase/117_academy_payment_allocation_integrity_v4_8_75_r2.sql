-- Super Leader V4.8.75 R2
-- Academy payment allocation integrity
-- Canonical rule: a real payment exists once at account level and only reduces an enrollment balance through an explicit confirmed allocation.

begin;

-- 1) Canonical read model. Legacy academy_student_payments remains for backward compatibility only.
create or replace view public.academy_student_confirmed_allocations
with (security_invoker = true) as
select
  a.organization_id,
  a.payment_id,
  a.enrollment_id,
  a.amount,
  p.currency,
  p.paid_on,
  p.reference,
  p.source,
  p.status
from public.academy_student_payment_allocations a
join public.academy_student_global_payments p on p.id = a.payment_id
where p.status = 'confirmed';
revoke all on public.academy_student_confirmed_allocations from public, authenticated;
grant select on public.academy_student_confirmed_allocations to service_role;

-- 2) Repair one CRM payment when old Academy representations caused the same real payment
--    to be counted against more than one enrollment. The operation deliberately returns
--    the canonical CRM payment to UNALLOCATED CREDIT so Finance can allocate it explicitly.
create or replace function public.repair_academy_crm_payment_duplicate(
  target_organization_id uuid,
  target_payment_id uuid,
  target_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_payment record;
  sales_ref text := '';
  normalized_ref text := '';
  candidate_ids uuid[] := array[]::uuid[];
  candidate_count integer := 0;
  removed_allocated numeric := 0;
  target_allocated numeric := 0;
begin
  select p.* into target_payment
  from public.academy_student_global_payments p
  where p.id = target_payment_id
    and p.organization_id = target_organization_id
    and p.status = 'confirmed'
    and p.source = 'crm'
  for update;

  if not found then
    raise exception 'Paiement CRM confirme introuvable.';
  end if;

  select coalesce(sp.transaction_reference, '') into sales_ref
  from public.academy_crm_payment_links l
  join public.sales_payments sp on sp.id = l.sales_payment_id
  where l.organization_id = target_organization_id
    and l.global_payment_id = target_payment_id
  limit 1;

  normalized_ref := regexp_replace(lower(coalesce(nullif(btrim(target_payment.reference), ''), nullif(btrim(sales_ref), ''), '')), '[^a-z0-9]', '', 'g');

  select coalesce(array_agg(p.id order by p.created_at), array[]::uuid[]), count(*)
    into candidate_ids, candidate_count
  from public.academy_student_global_payments p
  where p.organization_id = target_organization_id
    and p.account_id = target_payment.account_id
    and p.id <> target_payment.id
    and p.status = 'confirmed'
    and p.source = 'legacy'
    and p.amount = target_payment.amount
    and p.currency = target_payment.currency
    and p.paid_on = target_payment.paid_on
    and (
      normalized_ref = ''
      or regexp_replace(lower(coalesce(p.reference, '')), '[^a-z0-9]', '', 'g') = ''
      or regexp_replace(lower(coalesce(p.reference, '')), '[^a-z0-9]', '', 'g') = normalized_ref
    );

  if candidate_count = 0 then
    return jsonb_build_object(
      'removed_global_payments', 0,
      'removed_allocated_amount', 0,
      'canonical_payment_id', target_payment.id
    );
  end if;

  -- Because multiple historical representations exist, the safe state is one global payment
  -- with no school chosen. Existing allocations are intentionally removed and become credit.
  select coalesce(sum(amount), 0) into target_allocated
  from public.academy_student_payment_allocations
  where payment_id = target_payment.id;

  select target_allocated + coalesce(sum(a.amount), 0) into removed_allocated
  from public.academy_student_payment_allocations a
  where a.payment_id = any(candidate_ids);

  -- Remove synced legacy rows first, then allocations/global duplicates.
  delete from public.academy_student_payments
  where global_payment_id = target_payment.id
     or global_payment_id = any(candidate_ids);

  delete from public.academy_student_payment_allocations
  where payment_id = target_payment.id
     or payment_id = any(candidate_ids);

  delete from public.academy_student_global_payments
  where id = any(candidate_ids);

  insert into public.academy_pricing_audit_log(
    organization_id, actor_id, entity_type, entity_id, action, before_data, after_data
  ) values (
    target_organization_id,
    target_actor_id,
    'student_global_payment',
    target_payment.id,
    'duplicate_payment_representations_consolidated',
    jsonb_build_object(
      'duplicate_global_payment_ids', to_jsonb(candidate_ids),
      'allocated_amount_removed', removed_allocated
    ),
    jsonb_build_object(
      'canonical_payment_id', target_payment.id,
      'canonical_amount', target_payment.amount,
      'currency', target_payment.currency,
      'allocation_state', 'unallocated_credit'
    )
  );

  return jsonb_build_object(
    'removed_global_payments', candidate_count,
    'removed_allocated_amount', removed_allocated,
    'canonical_payment_id', target_payment.id
  );
end;
$$;

-- 3) Future CRM reconciliation: if the same confirmed payment already exists as a legacy global
--    payment with the same strong fingerprint, link it instead of creating another payment.
create or replace function public.reconcile_academy_crm_payments(
  target_organization_id uuid,
  target_account_id uuid,
  target_actor_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  client record;
  rowp record;
  existing_payment_id uuid;
  new_payment_id uuid;
  imported integer := 0;
  normalized_phone text;
  normalized_sales_ref text;
begin
  select * into a from public.academy_student_accounts
    where id = target_account_id
      and organization_id = target_organization_id
      and subject_type = 'crm_client';
  if not found then raise exception 'Ce compte Academy n est pas rattache a un client CRM.'; end if;

  select id,email,phone into client from public.crm_clients
    where id = a.subject_id and organization_id = target_organization_id;
  if not found then raise exception 'Client CRM introuvable.'; end if;
  normalized_phone := regexp_replace(coalesce(client.phone,''),'[^0-9]','','g');

  for rowp in
    select sp.*, sr.id as sales_record_id, sr.customer_email, sr.customer_phone
    from public.sales_payments sp
    join public.sales_records sr on sr.id = sp.sale_id and sr.organization_id = sp.organization_id
    where sp.organization_id = target_organization_id
      and sp.status = 'confirmed'
      and not exists(select 1 from public.academy_crm_payment_links l where l.sales_payment_id = sp.id)
      and (
        (client.email is not null and btrim(client.email) <> '' and lower(btrim(sr.customer_email)) = lower(btrim(client.email)))
        or
        (normalized_phone <> '' and regexp_replace(coalesce(sr.customer_phone,''),'[^0-9]','','g') = normalized_phone)
      )
    order by sp.payment_date, sp.created_at
  loop
    existing_payment_id := null;
    normalized_sales_ref := regexp_replace(lower(coalesce(rowp.transaction_reference, '')), '[^a-z0-9]', '', 'g');

    -- Reuse an exact legacy representation only when a transaction reference is available.
    if normalized_sales_ref <> '' then
      select p.id into existing_payment_id
      from public.academy_student_global_payments p
      where p.organization_id = target_organization_id
        and p.account_id = target_account_id
        and p.status = 'confirmed'
        and p.source = 'legacy'
        and p.amount = rowp.amount
        and p.currency = rowp.currency
        and p.paid_on = rowp.payment_date
        and regexp_replace(lower(coalesce(p.reference, '')), '[^a-z0-9]', '', 'g') = normalized_sales_ref
      order by p.created_at
      limit 1;
    end if;

    if existing_payment_id is not null then
      update public.academy_student_global_payments
      set source = 'crm',
          reference = coalesce(nullif(reference, ''), rowp.transaction_reference),
          confirmed_by = coalesce(confirmed_by, rowp.confirmed_by, target_actor_id),
          confirmed_at = coalesce(confirmed_at, rowp.confirmed_at, now()),
          updated_at = now()
      where id = existing_payment_id;
      new_payment_id := existing_payment_id;
    else
      insert into public.academy_student_global_payments(
        organization_id,account_id,amount,currency,paid_on,payment_method,reference,notes,status,source,
        recorded_by,confirmed_by,confirmed_at
      ) values(
        target_organization_id,target_account_id,rowp.amount,rowp.currency,rowp.payment_date,
        case when rowp.payment_method = 'cheque' then 'check' else rowp.payment_method end,
        rowp.transaction_reference,
        concat('Rapprochement CRM automatique · Vente ',rowp.sales_record_id),
        'confirmed','crm',coalesce(rowp.recorded_by,target_actor_id),coalesce(rowp.confirmed_by,target_actor_id),coalesce(rowp.confirmed_at,now())
      ) returning id into new_payment_id;
    end if;

    insert into public.academy_crm_payment_links(
      organization_id,account_id,sales_payment_id,sales_record_id,global_payment_id,matched_by,created_by
    ) values(
      target_organization_id,target_account_id,rowp.id,rowp.sales_record_id,new_payment_id,
      case when client.email is not null and lower(btrim(rowp.customer_email)) = lower(btrim(client.email)) then 'email' else 'phone' end,
      target_actor_id
    );
    imported := imported + 1;
  end loop;
  return imported;
end;
$$;

revoke all on function public.repair_academy_crm_payment_duplicate(uuid,uuid,uuid) from public, authenticated;
grant execute on function public.repair_academy_crm_payment_duplicate(uuid,uuid,uuid) to service_role;
revoke all on function public.reconcile_academy_crm_payments(uuid,uuid,uuid) from public, authenticated;
grant execute on function public.reconcile_academy_crm_payments(uuid,uuid,uuid) to service_role;

commit;
