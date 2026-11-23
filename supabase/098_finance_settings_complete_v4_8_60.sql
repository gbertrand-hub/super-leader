-- SUPER LEADER V4.8.60 - Parametres Finance complets
begin;

alter table public.finance_settings
  add column if not exists legal_name text,
  add column if not exists registration_number text,
  add column if not exists tax_identifier text,
  add column if not exists billing_address text,
  add column if not exists finance_email text,
  add column if not exists finance_phone text,
  add column if not exists default_tax_label text not null default 'Taxes',
  add column if not exists default_tax_rate numeric(5,2) not null default 0,
  add column if not exists default_payment_terms text,
  add column if not exists default_payment_instructions text,
  add column if not exists document_footer text,
  add column if not exists proforma_prefix text not null default 'PRO',
  add column if not exists credit_note_prefix text not null default 'AVO',
  add column if not exists allowed_payment_methods text[] not null default array['bank_transfer','card','mobile_money']::text[],
  add column if not exists reminders_enabled boolean not null default true,
  add column if not exists reminder_days_before_due integer not null default 3,
  add column if not exists reminder_days_after_due integer[] not null default array[1,7,15,30]::integer[],
  add column if not exists email_reminders_enabled boolean not null default true,
  add column if not exists in_app_reminders_enabled boolean not null default true;

alter table public.finance_settings
  drop constraint if exists finance_settings_default_tax_rate_check,
  add constraint finance_settings_default_tax_rate_check
    check (default_tax_rate between 0 and 100),
  drop constraint if exists finance_settings_reminder_days_before_due_check,
  add constraint finance_settings_reminder_days_before_due_check
    check (reminder_days_before_due between 0 and 90),
  drop constraint if exists finance_settings_allowed_payment_methods_check,
  add constraint finance_settings_allowed_payment_methods_check
    check (
      cardinality(allowed_payment_methods) > 0
      and allowed_payment_methods <@ array['bank_transfer','card','cash','mobile_money','check','online']::text[]
    );

create or replace function public.finance_next_document_number(
  p_organization_id uuid,
  p_document_type text,
  p_issue_date date default current_date
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from p_issue_date)::integer;
  v_value integer;
  v_prefix text;
begin
  if p_document_type not in ('proforma','invoice','receipt','credit_note','expense_receipt','other') then
    raise exception 'Invalid finance document type';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_organization_id::text || ':' || p_document_type || ':' || v_year::text));
  insert into public.finance_document_sequences(organization_id,document_type,fiscal_year,last_value)
  values(p_organization_id,p_document_type,v_year,1)
  on conflict(organization_id,document_type,fiscal_year)
  do update set last_value=public.finance_document_sequences.last_value+1,updated_at=now()
  returning last_value into v_value;

  select case p_document_type
    when 'invoice' then coalesce(nullif(invoice_prefix,''),'FAC')
    when 'receipt' then coalesce(nullif(receipt_prefix,''),'REC')
    when 'proforma' then coalesce(nullif(proforma_prefix,''),'PRO')
    when 'credit_note' then coalesce(nullif(credit_note_prefix,''),'AVO')
    when 'expense_receipt' then coalesce(nullif(expense_prefix,''),'DEP')
    else 'DOC'
  end into v_prefix
  from public.finance_settings where organization_id=p_organization_id;

  v_prefix := coalesce(v_prefix,case p_document_type when 'invoice' then 'FAC' when 'receipt' then 'REC' when 'proforma' then 'PRO' when 'credit_note' then 'AVO' when 'expense_receipt' then 'DEP' else 'DOC' end);
  return v_prefix || '-' || v_year::text || '-' || lpad(v_value::text,5,'0');
end;
$$;

revoke all on function public.finance_next_document_number(uuid,text,date) from public,anon,authenticated;
grant execute on function public.finance_next_document_number(uuid,text,date) to service_role;

comment on column public.finance_settings.tax_identifier is 'Identifiant fiscal prive, visible uniquement sur les documents financiers autorises.';
comment on column public.finance_settings.allowed_payment_methods is 'Moyens de paiement autorises pour les nouveaux documents.';
comment on column public.finance_settings.reminder_days_after_due is 'Jours de relance apres echeance; preparation des automatisations de recouvrement.';

commit;
notify pgrst, 'reload schema';
