-- SUPER LEADER V4.8.56 - Pilotage post-cloture
-- Reprise du solde precedent et certificat prive d'arrete financier.
begin;

alter table public.finance_close_periods
  add column if not exists opening_source_period_id uuid references public.finance_close_periods(id) on delete set null,
  add column if not exists certificate_number text,
  add column if not exists certificate_hash text,
  add column if not exists certificate_issued_at timestamptz;

create unique index if not exists finance_close_certificate_number_uidx
  on public.finance_close_periods (organization_id, certificate_number)
  where certificate_number is not null;

create index if not exists finance_close_opening_source_idx
  on public.finance_close_periods (opening_source_period_id)
  where opening_source_period_id is not null;

-- Rend aussi les clôtures historiques imprimables après la migration.
create extension if not exists pgcrypto with schema extensions;
update public.finance_close_periods
set certificate_number = coalesce(
      certificate_number,
      'CLT-' || replace(period_end::text, '-', '') || '-' || upper(right(replace(id::text, '-', ''), 6))
    ),
    certificate_issued_at = coalesce(certificate_issued_at, closed_at, now()),
    certificate_hash = coalesce(
      certificate_hash,
      encode(extensions.digest(convert_to(concat_ws('|', id::text, organization_id::text, period_start::text,
        period_end::text, currency, opening_bank_balance::text, incoming_snapshot::text,
        outgoing_snapshot::text, calculated_closing_balance::text,
        coalesce(declared_closing_bank_balance::text, ''), coalesce(variance_snapshot::text, ''),
        coalesce(closed_at::text, ''), coalesce(closed_by::text, '')), 'UTF8'), 'sha256'), 'hex')
    )
where status = 'closed';

comment on column public.finance_close_periods.opening_source_period_id is
  'Periode cloturee dont le solde final a ete repris comme solde initial.';
comment on column public.finance_close_periods.certificate_number is
  'Numero interne du certificat prive de cloture.';
comment on column public.finance_close_periods.certificate_hash is
  'Empreinte SHA-256 des donnees certifiees lors de la cloture.';

commit;
notify pgrst, 'reload schema';
