begin;

-- v4.10.2 - KPI result review workflow.
-- Existing v4.10.1 KPI results are preserved as accepted so the score
-- already visible before this migration does not disappear unexpectedly.
alter table public.service_contract_kpi_results
  add column if not exists status text,
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

update public.service_contract_kpi_results
set status = 'accepted'
where status is null;

update public.service_contract_kpi_results
set review_note = ''
where review_note is null;

alter table public.service_contract_kpi_results
  alter column status set default 'submitted',
  alter column status set not null,
  alter column review_note set default '',
  alter column review_note set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'service_contract_kpi_results_status_ck'
      and conrelid = 'public.service_contract_kpi_results'::regclass
  ) then
    alter table public.service_contract_kpi_results
      add constraint service_contract_kpi_results_status_ck
      check (status in ('submitted','accepted','rejected'));
  end if;
end
$$;

create index if not exists service_contract_kpi_results_review_idx
  on public.service_contract_kpi_results (contract_id, status, period_end desc, created_at desc);

commit;
