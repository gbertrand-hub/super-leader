-- Super Leader V4.10.73 - Apprenants Academie vers CRM
-- Conserve l'identite de connexion (user_id) et rattache un dossier CRM unique.

begin;

alter table public.crm_clients
  add column if not exists linked_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists crm_clients_org_linked_user_unique_idx
  on public.crm_clients (organization_id, linked_user_id)
  where linked_user_id is not null;

alter table public.crm_clients drop constraint if exists crm_clients_source_check;
alter table public.crm_clients add constraint crm_clients_source_check
  check (source in ('manual','sale_import','academy_import','website','referral','event','other'));

create table if not exists public.academy_crm_identity_review_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('multiple_matches','client_already_linked','missing_profile')),
  candidate_client_ids uuid[] not null default '{}',
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  resolved_client_id uuid references public.crm_clients(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id)
);

create index if not exists academy_crm_identity_review_org_status_idx
  on public.academy_crm_identity_review_queue (organization_id, status, created_at desc);

alter table public.academy_crm_identity_review_queue enable row level security;
drop policy if exists "academy crm identity leaders read" on public.academy_crm_identity_review_queue;
create policy "academy crm identity leaders read"
on public.academy_crm_identity_review_queue for select to authenticated
using (public.has_org_role(organization_id, array['owner','admin','executive','manager','finance','academy']));

revoke all on public.academy_crm_identity_review_queue from anon, authenticated;
grant select on public.academy_crm_identity_review_queue to authenticated;
grant all on public.academy_crm_identity_review_queue to service_role;

create or replace function public.ensure_academy_learner_crm_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  learner public.profiles%rowtype;
  candidates uuid[] := '{}';
  candidate_id uuid;
  normalized_email text;
  normalized_phone text;
  learner_name text;
begin
  if new.user_id is null then return new; end if;

  select * into learner from public.profiles where id = new.user_id;
  if learner.id is null then
    insert into public.academy_crm_identity_review_queue
      (organization_id, enrollment_id, user_id, reason, candidate_client_ids)
    values (new.organization_id, new.id, new.user_id, 'missing_profile', '{}')
    on conflict (enrollment_id) do update
      set reason = excluded.reason, status = 'open', updated_at = now();
    return new;
  end if;

  select c.id into candidate_id
  from public.crm_clients c
  where c.organization_id = new.organization_id and c.linked_user_id = new.user_id
  limit 1;

  if candidate_id is not null then
    update public.academy_crm_identity_review_queue
      set status='resolved', resolved_client_id=candidate_id, resolved_at=now(), updated_at=now()
      where enrollment_id=new.id and status='open';
    return new;
  end if;

  normalized_email := public.normalize_crm_identity_email(learner.email);
  normalized_phone := public.normalize_crm_identity_phone(learner.phone);
  learner_name := coalesce(nullif(btrim(learner.full_name), ''), normalized_email,
    'Apprenant ' || upper(substr(replace(new.user_id::text, '-', ''), 1, 8)));

  select coalesce(array_agg(id order by id), '{}') into candidates
  from (
    select distinct c.id
    from public.crm_clients c
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

  if coalesce(array_length(candidates, 1), 0) = 1 then
    candidate_id := candidates[1];
    if exists (select 1 from public.crm_clients where id=candidate_id and linked_user_id is not null and linked_user_id<>new.user_id) then
      insert into public.academy_crm_identity_review_queue
        (organization_id,enrollment_id,user_id,reason,candidate_client_ids)
      values (new.organization_id,new.id,new.user_id,'client_already_linked',candidates)
      on conflict (enrollment_id) do update
        set reason=excluded.reason,candidate_client_ids=excluded.candidate_client_ids,status='open',updated_at=now();
      return new;
    end if;
    update public.crm_clients set linked_user_id=new.user_id, updated_at=now() where id=candidate_id;
  elsif coalesce(array_length(candidates, 1), 0) > 1 then
    insert into public.academy_crm_identity_review_queue
      (organization_id,enrollment_id,user_id,reason,candidate_client_ids)
    values (new.organization_id,new.id,new.user_id,'multiple_matches',candidates)
    on conflict (enrollment_id) do update
      set reason=excluded.reason,candidate_client_ids=excluded.candidate_client_ids,status='open',updated_at=now();
    return new;
  else
    insert into public.crm_clients (
      organization_id, reference, full_name, email, phone, country, city,
      preferred_language, preferred_feedback_channel, feedback_opt_in,
      source, status, linked_user_id, created_by
    ) values (
      new.organization_id,
      'ACA-' || upper(substr(replace(new.user_id::text, '-', ''), 1, 12)),
      learner_name, normalized_email, nullif(btrim(coalesce(learner.phone,'')), ''),
      learner.country, learner.city,
      case when learner.preferred_locale in ('fr','en') then learner.preferred_locale else 'fr' end,
      case when normalized_email is not null then 'email' when normalized_phone is not null then 'whatsapp' else 'web' end,
      false, 'academy_import', 'active', new.user_id, coalesce(new.created_by,new.user_id)
    ) returning id into candidate_id;
  end if;

  update public.academy_crm_identity_review_queue
    set status='resolved',resolved_client_id=candidate_id,resolved_at=now(),updated_at=now()
    where enrollment_id=new.id and status='open';
  return new;
exception when unique_violation then
  insert into public.academy_crm_identity_review_queue
    (organization_id,enrollment_id,user_id,reason,candidate_client_ids)
  values (new.organization_id,new.id,new.user_id,'multiple_matches',candidates)
  on conflict (enrollment_id) do update
    set reason=excluded.reason,candidate_client_ids=excluded.candidate_client_ids,status='open',updated_at=now();
  return new;
end;
$$;

drop trigger if exists ensure_academy_learner_crm_identity_trigger on public.academy_school_enrollments;
create trigger ensure_academy_learner_crm_identity_trigger
after insert or update of user_id, organization_id
on public.academy_school_enrollments
for each row execute function public.ensure_academy_learner_crm_identity();

-- Rattrape toutes les inscriptions internes existantes sans changer leur inscription.
update public.academy_school_enrollments
set user_id = user_id
where user_id is not null;

revoke all on function public.ensure_academy_learner_crm_identity() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
