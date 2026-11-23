-- SUPER LEADER V4.8.57 - Factures et recus modernes
begin;

alter table public.finance_documents
  add column if not exists counterparty_email text,
  add column if not exists counterparty_phone text,
  add column if not exists counterparty_address text,
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists payment_terms text,
  add column if not exists payment_instructions text,
  add column if not exists generated_document boolean not null default false;

create table if not exists public.finance_document_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null,
  fiscal_year integer not null,
  last_value integer not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, document_type, fiscal_year)
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
    when 'proforma' then 'PRO'
    when 'credit_note' then 'AVO'
    when 'expense_receipt' then 'JUS'
    else 'DOC'
  end into v_prefix
  from public.finance_settings where organization_id=p_organization_id;
  v_prefix := coalesce(v_prefix,case p_document_type when 'invoice' then 'FAC' when 'receipt' then 'REC' when 'proforma' then 'PRO' when 'credit_note' then 'AVO' when 'expense_receipt' then 'JUS' else 'DOC' end);
  return v_prefix || '-' || v_year::text || '-' || lpad(v_value::text,5,'0');
end;
$$;

alter table public.finance_document_sequences enable row level security;
revoke all on public.finance_document_sequences from anon,authenticated;
grant select,insert,update,delete on public.finance_document_sequences to service_role;
revoke all on function public.finance_next_document_number(uuid,text,date) from public,anon,authenticated;
grant execute on function public.finance_next_document_number(uuid,text,date) to service_role;

comment on column public.finance_documents.line_items is 'Lignes commerciales figees du document genere.';
comment on function public.finance_next_document_number(uuid,text,date) is 'Genere un numero annuel concurrent-safe selon le type et les prefixes Finance.';

commit;
notify pgrst, 'reload schema';
