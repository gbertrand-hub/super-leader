-- Super Leader V4.10.72 - Identite unifiee Ventes, CRM et Academie
-- Idempotent. Relie automatiquement chaque vente a un dossier CRM et les produits scolaires a une inscription.

begin;

create table if not exists public.crm_identity_review_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales_records(id) on delete cascade,
  reason text not null check (reason in ('multiple_matches','manual_review')),
  candidate_client_ids uuid[] not null default '{}',
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  resolved_client_id uuid references public.crm_clients(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sale_id)
);

create index if not exists crm_identity_review_queue_org_status_idx
  on public.crm_identity_review_queue (organization_id, status, created_at desc);

create table if not exists public.academy_sales_product_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.sales_products(id) on delete cascade,
  school_id uuid not null references public.academy_schools(id) on delete cascade,
  program_id uuid references public.academy_programs(id) on delete set null,
  cohort_id uuid not null references public.academy_cohorts(id) on delete cascade,
  academic_status text not null default 'admitted' check (academic_status in ('candidate','admitted','enrolled','active')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_id),
  unique (organization_id, product_id, school_id, cohort_id)
);

create index if not exists academy_sales_product_mappings_lookup_idx
  on public.academy_sales_product_mappings (organization_id, product_id, is_active);

alter table public.crm_identity_review_queue enable row level security;
alter table public.academy_sales_product_mappings enable row level security;

drop policy if exists "crm identity leaders read" on public.crm_identity_review_queue;
create policy "crm identity leaders read" on public.crm_identity_review_queue for select to authenticated
using (public.has_org_role(organization_id, array['owner','admin','executive','manager','finance']));

drop policy if exists "academy sales mappings leaders read" on public.academy_sales_product_mappings;
create policy "academy sales mappings leaders read" on public.academy_sales_product_mappings for select to authenticated
using (public.has_org_role(organization_id, array['owner','admin','executive','manager','finance','academy']));

revoke all on public.crm_identity_review_queue, public.academy_sales_product_mappings from anon, authenticated;
grant select on public.crm_identity_review_queue, public.academy_sales_product_mappings to authenticated;
grant all on public.crm_identity_review_queue, public.academy_sales_product_mappings to service_role;

create or replace function public.normalize_crm_identity_email(value text)
returns text language sql immutable parallel safe as $$
  select nullif(lower(btrim(coalesce(value, ''))), '');
$$;

create or replace function public.normalize_crm_identity_phone(value text)
returns text language sql immutable parallel safe as $$
  select nullif(regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g'), '');
$$;

create or replace function public.resolve_sale_crm_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  matched_ids uuid[] := '{}';
  matched_id uuid;
  normalized_email text;
  normalized_phone text;
begin
  if new.crm_client_id is not null then
    if not exists (
      select 1 from public.crm_clients c
      where c.id = new.crm_client_id and c.organization_id = new.organization_id
    ) then
      new.crm_client_id := null;
    else
      return new;
    end if;
  end if;

  normalized_email := public.normalize_crm_identity_email(new.customer_email);
  normalized_phone := public.normalize_crm_identity_phone(new.customer_phone);

  select coalesce(array_agg(id order by id), '{}') into matched_ids
  from (
    select distinct c.id
    from public.crm_clients c
    where c.organization_id = new.organization_id
      and (
        (normalized_email is not null and public.normalize_crm_identity_email(c.email) = normalized_email)
        or
        (normalized_phone is not null and (
          public.normalize_crm_identity_phone(c.phone) = normalized_phone
          or public.normalize_crm_identity_phone(c.whatsapp_phone) = normalized_phone
        ))
      )
    limit 3
  ) matches;

  if coalesce(array_length(matched_ids, 1), 0) = 1 then
    new.crm_client_id := matched_ids[1];
    return new;
  end if;

  if coalesce(array_length(matched_ids, 1), 0) > 1 then
    return new;
  end if;

  insert into public.crm_clients (
    organization_id, reference, full_name, email, phone,
    preferred_language, preferred_feedback_channel, feedback_opt_in,
    owner_id, follow_up_owner_id, source, status, created_by
  ) values (
    new.organization_id,
    'SALE-' || upper(substr(replace(new.id::text, '-', ''), 1, 12)),
    new.customer_name,
    normalized_email,
    nullif(btrim(coalesce(new.customer_phone, '')), ''),
    'fr',
    case when normalized_email is not null then 'email' when normalized_phone is not null then 'whatsapp' else 'web' end,
    false,
    new.seller_id,
    new.collection_owner_id,
    'sale_import',
    case when new.workflow_status in ('verified','approved') then 'active' else 'prospect' end,
    coalesce(new.created_by, new.seller_id)
  ) returning id into matched_id;

  new.crm_client_id := matched_id;
  return new;
exception
  when unique_violation then
    select c.id into matched_id
    from public.crm_clients c
    where c.organization_id = new.organization_id
      and (
        (normalized_email is not null and public.normalize_crm_identity_email(c.email) = normalized_email)
        or
        (normalized_phone is not null and (
          public.normalize_crm_identity_phone(c.phone) = normalized_phone
          or public.normalize_crm_identity_phone(c.whatsapp_phone) = normalized_phone
        ))
      )
    order by c.created_at
    limit 1;
    new.crm_client_id := matched_id;
    return new;
end;
$$;

create or replace function public.finalize_sale_crm_academy_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mapping public.academy_sales_product_mappings%rowtype;
  candidates uuid[] := '{}';
  normalized_email text;
  normalized_phone text;
begin
  if new.crm_client_id is null then
    normalized_email := public.normalize_crm_identity_email(new.customer_email);
    normalized_phone := public.normalize_crm_identity_phone(new.customer_phone);
    select coalesce(array_agg(id order by id), '{}') into candidates
    from (
      select distinct c.id from public.crm_clients c
      where c.organization_id = new.organization_id
        and (
          (normalized_email is not null and public.normalize_crm_identity_email(c.email) = normalized_email)
          or (normalized_phone is not null and (
            public.normalize_crm_identity_phone(c.phone) = normalized_phone
            or public.normalize_crm_identity_phone(c.whatsapp_phone) = normalized_phone
          ))
        )
      limit 10
    ) matches;
    if coalesce(array_length(candidates, 1), 0) > 1 then
      insert into public.crm_identity_review_queue (organization_id, sale_id, reason, candidate_client_ids)
      values (new.organization_id, new.id, 'multiple_matches', candidates)
      on conflict (sale_id) do update set candidate_client_ids = excluded.candidate_client_ids, status = 'open', updated_at = now();
    end if;
    return new;
  end if;

  update public.crm_identity_review_queue
  set status = 'resolved', resolved_client_id = new.crm_client_id, resolved_at = now(), updated_at = now()
  where sale_id = new.id and status = 'open';

  if new.workflow_status <> 'approved' or new.product_id is null then return new; end if;

  select * into mapping
  from public.academy_sales_product_mappings m
  where m.organization_id = new.organization_id and m.product_id = new.product_id and m.is_active
  limit 1;

  if mapping.id is null then return new; end if;

  insert into public.academy_school_enrollments (
    organization_id, school_id, program_id, cohort_id, crm_client_id,
    academic_status, source, enrolled_on, assigned_follow_up_user_id, notes, created_by
  ) values (
    new.organization_id, mapping.school_id, mapping.program_id, mapping.cohort_id, new.crm_client_id,
    mapping.academic_status, 'crm_conversion', coalesce(new.sale_date, current_date), new.collection_owner_id,
    'Inscription créée automatiquement depuis la vente ' || new.id::text, coalesce(new.approved_by, new.created_by, new.seller_id)
  )
  on conflict (school_id, cohort_id, crm_client_id) where crm_client_id is not null
  do update set
    program_id = excluded.program_id,
    assigned_follow_up_user_id = coalesce(public.academy_school_enrollments.assigned_follow_up_user_id, excluded.assigned_follow_up_user_id),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists resolve_sale_crm_identity_trigger on public.sales_records;
create trigger resolve_sale_crm_identity_trigger
before insert or update of customer_name, customer_email, customer_phone, crm_client_id, workflow_status
on public.sales_records for each row execute function public.resolve_sale_crm_identity();

drop trigger if exists finalize_sale_crm_academy_identity_trigger on public.sales_records;
create trigger finalize_sale_crm_academy_identity_trigger
after insert or update of customer_name, customer_email, customer_phone, crm_client_id, workflow_status, product_id
on public.sales_records for each row execute function public.finalize_sale_crm_academy_identity();

-- Préconfigure les produits dont le nom correspond clairement à une école et choisit sa cohorte active la plus récente.
insert into public.academy_sales_product_mappings (
  organization_id, product_id, school_id, program_id, cohort_id, academic_status, created_by
)
select
  product.organization_id,
  product.id,
  school.id,
  cohort.program_id,
  cohort.id,
  'admitted',
  product.created_by
from public.sales_products product
join public.academy_schools school
  on school.organization_id = product.organization_id
 and regexp_replace(lower(translate(product.name, 'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', '', 'g')
     = regexp_replace(lower(translate(school.name, 'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', '', 'g')
join lateral (
  select c.id, c.program_id from public.academy_cohorts c
  where c.school_id = school.id and c.status in ('active','open','planned')
  order by case c.status when 'active' then 1 when 'open' then 2 else 3 end, c.starts_on desc nulls last, c.created_at desc
  limit 1
) cohort on true
on conflict (organization_id, product_id) do nothing;

-- Rattrape les ventes existantes. Le trigger crée/relie le CRM puis l'inscription si le produit est configuré.
update public.sales_records
set customer_name = customer_name
where crm_client_id is null;

-- Inscrit aussi les ventes scolaires déjà reliées au CRM avant cette migration.
update public.sales_records sale
set product_id = sale.product_id
where sale.crm_client_id is not null
  and sale.workflow_status = 'approved'
  and exists (
    select 1 from public.academy_sales_product_mappings mapping
    where mapping.organization_id = sale.organization_id
      and mapping.product_id = sale.product_id
      and mapping.is_active
  );

revoke all on function public.normalize_crm_identity_email(text) from public, anon, authenticated;
revoke all on function public.normalize_crm_identity_phone(text) from public, anon, authenticated;
revoke all on function public.resolve_sale_crm_identity() from public, anon, authenticated;
revoke all on function public.finalize_sale_crm_academy_identity() from public, anon, authenticated;
grant execute on function public.normalize_crm_identity_email(text) to service_role;
grant execute on function public.normalize_crm_identity_phone(text) to service_role;

commit;

notify pgrst, 'reload schema';
