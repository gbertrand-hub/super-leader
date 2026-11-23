begin;

-- V4.8.75 R1
-- Harmonise un ancien accord financier herite avec le tarif homologue actif
-- sans ecraser les promotions, remises individuelles ou accords manuels.

alter table public.academy_student_financial_agreements
  drop constraint if exists academy_student_financial_agreements_source_check;

alter table public.academy_student_financial_agreements
  add constraint academy_student_financial_agreements_source_check
  check (source in ('manual','legacy','promotion','bundle','inherited'));

create or replace function public.harmonize_academy_inherited_agreement(
  target_enrollment_id uuid,
  target_actor_id uuid
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  e record;
  r record;
  a record;
  new_agreement_id uuid;
  same_currency boolean;
  safe_inherited boolean;
begin
  select id, organization_id
    into e
  from public.academy_school_enrollments
  where id = target_enrollment_id
  for update;

  if not found then
    raise exception 'Inscription Academy introuvable.';
  end if;

  select * into r
  from public.resolve_academy_enrollment_tariff(target_enrollment_id)
  limit 1;

  if r.pricing_source is null or r.pricing_source = 'none' or coalesce(r.amount, 0) <= 0 then
    return 'no_tariff';
  end if;

  select * into a
  from public.academy_student_financial_agreements
  where enrollment_id = target_enrollment_id
    and status = 'active'
  order by approved_at desc nulls last, created_at desc
  limit 1
  for update;

  if found then
    same_currency := upper(coalesce(a.currency, 'USD')) = upper(coalesce(r.currency, 'USD'));
    safe_inherited :=
      a.source in ('legacy', 'inherited')
      and a.promotion_id is null
      and coalesce(a.promotion_discount_amount, 0) = 0
      and coalesce(a.individual_adjustment_amount, 0) = 0;

    if safe_inherited
       and coalesce(a.list_price, 0) = coalesce(r.amount, 0)
       and coalesce(a.agreed_amount, 0) = coalesce(r.amount, 0)
       and same_currency then
      update public.academy_student_finance
      set list_price = r.amount,
          discount_amount = 0,
          agreed_amount = r.amount,
          currency = r.currency,
          current_agreement_id = a.id,
          updated_at = now()
      where enrollment_id = target_enrollment_id;
      perform public.refresh_academy_student_finance(target_enrollment_id);
      return 'already_harmonized';
    end if;

    if not safe_inherited then
      return 'review_required';
    end if;
  end if;

  insert into public.academy_student_financial_agreements(
    organization_id,
    enrollment_id,
    tariff_id,
    cohort_tariff_id,
    promotion_id,
    list_price,
    promotion_discount_amount,
    individual_adjustment_amount,
    agreed_amount,
    currency,
    status,
    adjustment_reason,
    approval_note,
    source,
    supersedes_agreement_id,
    created_by
  ) values (
    e.organization_id,
    target_enrollment_id,
    r.program_tariff_id,
    r.cohort_tariff_id,
    null,
    r.amount,
    0,
    0,
    r.amount,
    r.currency,
    'draft',
    null,
    'Harmonisation automatique avec le tarif homologue herite.',
    'inherited',
    case when a.id is not null then a.id else null end,
    target_actor_id
  ) returning id into new_agreement_id;

  perform public.activate_academy_financial_agreement(
    new_agreement_id,
    target_actor_id,
    'Harmonisation automatique avec le tarif homologue herite.'
  );

  return 'harmonized';
end;
$$;

revoke all on function public.harmonize_academy_inherited_agreement(uuid,uuid) from public, authenticated;
grant execute on function public.harmonize_academy_inherited_agreement(uuid,uuid) to service_role;

commit;
