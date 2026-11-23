-- Super Leader V4.8.73
-- iLEAD Global Institute - tarification heritee par programme/cohorte + rapprochement CRM
-- Prerequis: migrations 111 et 112.

begin;

-- 1) Le tarif de cohorte surcharge le tarif du programme sans modifier les inscriptions une par une.
create table if not exists public.academy_cohort_tariffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  program_id uuid references public.academy_programs(id) on delete cascade,
  cohort_id uuid not null references public.academy_cohorts(id) on delete cascade,
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
  unique (cohort_id, version),
  check (effective_until is null or effective_until >= effective_from)
);
create index if not exists academy_cohort_tariffs_lookup_idx
  on public.academy_cohort_tariffs(organization_id,cohort_id,status,effective_from desc);
create unique index if not exists academy_cohort_tariffs_one_active_idx
  on public.academy_cohort_tariffs(cohort_id)
  where status='active' and effective_until is null;

-- 2) Une inscription garde sa provenance. Les imports futurs pourront ecrire source_type='import'.
alter table public.academy_school_enrollments
  add column if not exists source_type text,
  add column if not exists source_reference text,
  add column if not exists source_detected_at timestamptz;

update public.academy_school_enrollments
set source_type = case
    when user_id is not null then 'internal'
    when crm_client_id is not null then 'crm'
    else 'manual'
  end,
  source_detected_at = coalesce(source_detected_at, now())
where source_type is null;

alter table public.academy_school_enrollments
  alter column source_type set default 'manual';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname='academy_school_enrollments_source_type_check'
  ) then
    alter table public.academy_school_enrollments
      add constraint academy_school_enrollments_source_type_check
      check (source_type in ('crm','import','internal','manual','web'));
  end if;
end $$;

-- 3) L'accord individuel peut memoriser le tarif de cohorte ayant servi de base.
alter table public.academy_student_financial_agreements
  add column if not exists cohort_tariff_id uuid references public.academy_cohort_tariffs(id) on delete set null;

-- 4) Le compte global accepte une provenance CRM/import explicite.
alter table public.academy_student_global_payments
  drop constraint if exists academy_student_global_payments_source_check;
alter table public.academy_student_global_payments
  add constraint academy_student_global_payments_source_check
  check (source in ('manual','legacy','finance','crm','import'));

-- 5) Audit de rapprochement CRM. Un paiement commercial ne peut etre importe qu'une fois.
create table if not exists public.academy_crm_payment_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.academy_student_accounts(id) on delete cascade,
  sales_payment_id uuid not null references public.sales_payments(id) on delete cascade,
  sales_record_id uuid not null references public.sales_records(id) on delete cascade,
  global_payment_id uuid not null references public.academy_student_global_payments(id) on delete cascade,
  matched_by text not null default 'email' check (matched_by in ('email','phone','manual')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (sales_payment_id)
);
create index if not exists academy_crm_payment_links_account_idx
  on public.academy_crm_payment_links(account_id,created_at desc);

-- Retourne le tarif officiel qui s'applique a une inscription: COHORTE > PROGRAMME.
create or replace function public.resolve_academy_enrollment_tariff(target_enrollment_id uuid)
returns table(
  pricing_source text,
  program_tariff_id uuid,
  cohort_tariff_id uuid,
  amount numeric,
  currency text
)
language plpgsql security definer set search_path=public as $$
declare e record; ct record; pt record;
begin
  select id,organization_id,school_id,program_id,cohort_id into e
  from public.academy_school_enrollments where id=target_enrollment_id;
  if not found then return; end if;

  if e.cohort_id is not null then
    select * into ct from public.academy_cohort_tariffs
      where organization_id=e.organization_id and cohort_id=e.cohort_id and status='active'
        and effective_from<=current_date and (effective_until is null or effective_until>=current_date)
      order by effective_from desc,version desc limit 1;
    if found then
      pricing_source := 'cohort'; program_tariff_id := null; cohort_tariff_id := ct.id;
      amount := ct.amount; currency := ct.currency; return next; return;
    end if;
  end if;

  if e.program_id is not null then
    select * into pt from public.academy_program_tariffs
      where organization_id=e.organization_id and program_id=e.program_id and status='active'
        and effective_from<=current_date and (effective_until is null or effective_until>=current_date)
      order by effective_from desc,version desc limit 1;
    if found then
      pricing_source := 'program'; program_tariff_id := pt.id; cohort_tariff_id := null;
      amount := pt.amount; currency := pt.currency; return next; return;
    end if;
  end if;

  pricing_source := 'none'; program_tariff_id := null; cohort_tariff_id := null;
  amount := 0; currency := 'USD'; return next;
end; $$;

grant execute on function public.resolve_academy_enrollment_tariff(uuid) to service_role;

-- Synchronise le prix herite dans academy_student_finance tant qu'aucun accord individuel actif n'existe.
create or replace function public.sync_academy_inherited_finance(target_enrollment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r record; active_id uuid;
begin
  select id into active_id from public.academy_student_financial_agreements
    where enrollment_id=target_enrollment_id and status='active' limit 1;
  if active_id is not null then return; end if;

  select * into r from public.resolve_academy_enrollment_tariff(target_enrollment_id) limit 1;
  if r.pricing_source is null or r.pricing_source='none' then return; end if;

  update public.academy_student_finance
    set list_price=r.amount, discount_amount=0, agreed_amount=r.amount,
        currency=r.currency, updated_at=now()
    where enrollment_id=target_enrollment_id;
end; $$;
grant execute on function public.sync_academy_inherited_finance(uuid) to service_role;

-- Applique les tarifs herites aux inscriptions existantes d'un programme/cohorte qui n'ont pas d'accord individuel.
create or replace function public.sync_academy_inherited_finance_scope(
  target_organization_id uuid,
  target_program_id uuid default null,
  target_cohort_id uuid default null
) returns integer language plpgsql security definer set search_path=public as $$
declare e record; count_rows integer:=0;
begin
  for e in
    select se.id from public.academy_school_enrollments se
    where se.organization_id=target_organization_id
      and (target_program_id is null or se.program_id=target_program_id)
      and (target_cohort_id is null or se.cohort_id=target_cohort_id)
  loop
    perform public.sync_academy_inherited_finance(e.id);
    count_rows := count_rows + 1;
  end loop;
  return count_rows;
end; $$;
grant execute on function public.sync_academy_inherited_finance_scope(uuid,uuid,uuid) to service_role;

-- Rapproche les paiements commerciaux deja CONFIRMES d'un client CRM.
-- Ils arrivent comme credit global NON AFFECTE: aucune ecole n'est choisie automatiquement.
create or replace function public.reconcile_academy_crm_payments(
  target_organization_id uuid,
  target_account_id uuid,
  target_actor_id uuid
) returns integer language plpgsql security definer set search_path=public as $$
declare a record; client record; rowp record; new_payment_id uuid; imported integer:=0; normalized_phone text;
begin
  select * into a from public.academy_student_accounts
    where id=target_account_id and organization_id=target_organization_id and subject_type='crm_client';
  if not found then raise exception 'Ce compte Academy n est pas rattache a un client CRM.'; end if;

  select id,email,phone into client from public.crm_clients
    where id=a.subject_id and organization_id=target_organization_id;
  if not found then raise exception 'Client CRM introuvable.'; end if;
  normalized_phone := regexp_replace(coalesce(client.phone,''),'[^0-9]','','g');

  for rowp in
    select sp.*, sr.id as sales_record_id, sr.customer_email, sr.customer_phone
    from public.sales_payments sp
    join public.sales_records sr on sr.id=sp.sale_id and sr.organization_id=sp.organization_id
    where sp.organization_id=target_organization_id
      and sp.status='confirmed'
      and not exists(select 1 from public.academy_crm_payment_links l where l.sales_payment_id=sp.id)
      and (
        (client.email is not null and btrim(client.email)<>'' and lower(btrim(sr.customer_email))=lower(btrim(client.email)))
        or
        (normalized_phone<>'' and regexp_replace(coalesce(sr.customer_phone,''),'[^0-9]','','g')=normalized_phone)
      )
    order by sp.payment_date,sp.created_at
  loop
    insert into public.academy_student_global_payments(
      organization_id,account_id,amount,currency,paid_on,payment_method,reference,notes,status,source,
      recorded_by,confirmed_by,confirmed_at
    ) values(
      target_organization_id,target_account_id,rowp.amount,rowp.currency,rowp.payment_date,
      case when rowp.payment_method='cheque' then 'check' else rowp.payment_method end,
      rowp.transaction_reference,
      concat('Rapprochement CRM automatique · Vente ',rowp.sales_record_id),
      'confirmed','crm',coalesce(rowp.recorded_by,target_actor_id),coalesce(rowp.confirmed_by,target_actor_id),coalesce(rowp.confirmed_at,now())
    ) returning id into new_payment_id;

    insert into public.academy_crm_payment_links(
      organization_id,account_id,sales_payment_id,sales_record_id,global_payment_id,matched_by,created_by
    ) values(
      target_organization_id,target_account_id,rowp.id,rowp.sales_record_id,new_payment_id,
      case when client.email is not null and lower(btrim(rowp.customer_email))=lower(btrim(client.email)) then 'email' else 'phone' end,
      target_actor_id
    );
    imported := imported + 1;
  end loop;
  return imported;
end; $$;
grant execute on function public.reconcile_academy_crm_payments(uuid,uuid,uuid) to service_role;

-- Existing finance rows adoptent maintenant le tarif herite lorsqu'elles n'ont aucun accord individuel.
do $$ declare e record; begin
  for e in select id from public.academy_school_enrollments loop
    perform public.sync_academy_inherited_finance(e.id);
  end loop;
end $$;

commit;
