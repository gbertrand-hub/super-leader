begin;

-- Super Leader v4.10.6
-- Renewal workflow calendar: provisional orientation, D-90 / D-60 / D-30
-- checkpoints, final decision window, and contract-review reminders.

alter table public.service_contract_renewal_reviews
  add column if not exists review_stage text,
  add column if not exists review_kind text,
  add column if not exists days_remaining integer,
  add column if not exists is_final boolean not null default false;

-- Preserve earlier renewal decisions as historical orientations while deriving
-- the number of days that remained when the decision was recorded.
update public.service_contract_renewal_reviews rr
set days_remaining = (sc.end_date - rr.decided_at::date)
from public.service_contracts sc
where sc.id = rr.contract_id
  and rr.days_remaining is null;

update public.service_contract_renewal_reviews
set review_stage = case
  when days_remaining is null then 'orientation'
  when days_remaining <= 30 then 'j30'
  when days_remaining <= 60 then 'j60'
  when days_remaining <= 90 then 'j90'
  else 'orientation'
end
where review_stage is null;

update public.service_contract_renewal_reviews
set review_kind = case
  when review_stage in ('j90','j60','j30') then 'checkpoint'
  when review_stage = 'final' then 'final'
  when review_stage = 'urgent' then 'urgent'
  else 'orientation'
end
where review_kind is null;

alter table public.service_contract_renewal_reviews
  alter column review_stage set default 'orientation',
  alter column review_stage set not null,
  alter column review_kind set default 'orientation',
  alter column review_kind set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contract_renewal_reviews_stage_ck'
      and conrelid = 'public.service_contract_renewal_reviews'::regclass
  ) then
    alter table public.service_contract_renewal_reviews
      add constraint service_contract_renewal_reviews_stage_ck
      check (review_stage in ('orientation','j90','j60','j30','final','urgent'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_contract_renewal_reviews_kind_ck'
      and conrelid = 'public.service_contract_renewal_reviews'::regclass
  ) then
    alter table public.service_contract_renewal_reviews
      add constraint service_contract_renewal_reviews_kind_ck
      check (review_kind in ('orientation','checkpoint','final','urgent'));
  end if;
end
$$;

create index if not exists service_contract_renewal_reviews_stage_idx
  on public.service_contract_renewal_reviews (contract_id, review_stage, decided_at desc);

create index if not exists service_contract_renewal_reviews_final_idx
  on public.service_contract_renewal_reviews (organization_id, is_final, decided_at desc);

comment on column public.service_contract_renewal_reviews.review_stage is
  'Renewal workflow stage: orientation, j90, j60, j30, final, urgent.';
comment on column public.service_contract_renewal_reviews.review_kind is
  'Business classification of the review: orientation, checkpoint, final, urgent.';
comment on column public.service_contract_renewal_reviews.days_remaining is
  'Contract days remaining when the review or decision was recorded.';
comment on column public.service_contract_renewal_reviews.is_final is
  'True only when the record is a final end-of-contract decision.';

commit;
