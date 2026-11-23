-- Super Leader V4.8.15 - CRM academique, paiements et progression
begin;

create table if not exists public.academy_student_finance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null unique references public.academy_school_enrollments(id) on delete cascade,
  is_internal_training boolean not null default false,
  list_price numeric(14,2) not null default 0 check (list_price >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  agreed_amount numeric(14,2) not null default 0 check (agreed_amount >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  payment_status text not null default 'not_started' check (payment_status in ('not_required','not_started','partial','paid','overdue','cancelled')),
  first_payment_due_on date,
  notes text check (notes is null or char_length(notes) <= 5000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_amount <= list_price or list_price = 0),
  check (not is_internal_training or agreed_amount = 0)
);

create table if not exists public.academy_student_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  due_on date not null,
  amount_due numeric(14,2) not null check (amount_due > 0),
  status text not null default 'pending' check (status in ('pending','partial','paid','overdue','waived','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, installment_number)
);

create table if not exists public.academy_student_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
  installment_id uuid references public.academy_student_installments(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  paid_on date not null default current_date,
  payment_method text not null default 'other' check (payment_method in ('cash','bank_transfer','card','mobile_money','check','other')),
  reference text,
  notes text check (notes is null or char_length(notes) <= 2000),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.academy_student_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null unique references public.academy_school_enrollments(id) on delete cascade,
  progress_percent numeric(5,2) not null default 0 check (progress_percent between 0 and 100),
  current_module text,
  last_activity_on date,
  expected_completion_on date,
  training_status text not null default 'not_started' check (training_status in ('not_started','active','paused','at_risk','completed','withdrawn')),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  blocker_notes text check (blocker_notes is null or char_length(blocker_notes) <= 5000),
  next_action text,
  next_action_on date,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.academy_student_followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null references public.academy_school_enrollments(id) on delete cascade,
  employee_id uuid not null references auth.users(id) on delete restrict,
  channel text not null default 'phone' check (channel in ('phone','whatsapp','email','meeting','video','other')),
  outcome text not null default 'follow_up' check (outcome in ('resolved','follow_up','payment_promise','no_answer','escalated','other')),
  summary text not null check (char_length(trim(summary)) between 2 and 5000),
  next_action text,
  next_action_on date,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists academy_student_installments_due_idx on public.academy_student_installments (organization_id, due_on, status);
create index if not exists academy_student_payments_enrollment_idx on public.academy_student_payments (enrollment_id, paid_on desc);
create index if not exists academy_student_progress_risk_idx on public.academy_student_progress (organization_id, risk_level, next_action_on);
create index if not exists academy_student_followups_enrollment_idx on public.academy_student_followups (enrollment_id, occurred_at desc);

create or replace function public.refresh_academy_student_finance(target_enrollment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare total_paid numeric(14,2); target_amount numeric(14,2); internal_training boolean; first_due date; overdue_exists boolean;
begin
  select coalesce(sum(amount),0) into total_paid from public.academy_student_payments where enrollment_id=target_enrollment_id;
  select agreed_amount,is_internal_training,first_payment_due_on into target_amount,internal_training,first_due from public.academy_student_finance where enrollment_id=target_enrollment_id;
  if not found then return; end if;
  update public.academy_student_installments installment set status = case
    when installment.status in ('waived','cancelled','paid') then installment.status
    when installment.due_on < current_date then 'overdue'
    else installment.status end
  where installment.enrollment_id=target_enrollment_id;
  select exists(select 1 from public.academy_student_installments where enrollment_id=target_enrollment_id and status='overdue') into overdue_exists;
  update public.academy_student_finance set payment_status=case
    when internal_training then 'not_required'
    when target_amount > 0 and total_paid >= target_amount then 'paid'
    when overdue_exists or (first_due is not null and first_due < current_date and total_paid < target_amount) then 'overdue'
    when total_paid > 0 then 'partial'
    else 'not_started' end, updated_at=now()
  where enrollment_id=target_enrollment_id;
end;
$$;

create or replace function public.on_academy_student_payment_changed()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then perform public.refresh_academy_student_finance(old.enrollment_id); return old; end if;
  perform public.refresh_academy_student_finance(new.enrollment_id); return new;
end; $$;
drop trigger if exists academy_student_payment_refresh on public.academy_student_payments;
create trigger academy_student_payment_refresh after insert or update or delete on public.academy_student_payments
for each row execute function public.on_academy_student_payment_changed();

do $$ declare table_name text; begin
  foreach table_name in array array['academy_student_finance','academy_student_installments','academy_student_payments','academy_student_progress','academy_student_followups'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists "academy tracking member read" on public.%I',table_name);
    execute format('create policy "academy tracking member read" on public.%I for select to authenticated using (public.is_org_member(organization_id))',table_name);
    execute format('drop policy if exists "academy tracking leaders write" on public.%I',table_name);
    execute format('create policy "academy tracking leaders write" on public.%I for all to authenticated using (public.has_org_role(organization_id,array[''owner'',''admin'',''hr'',''manager''])) with check (public.has_org_role(organization_id,array[''owner'',''admin'',''hr'',''manager'']))',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
    execute format('grant all on public.%I to service_role',table_name);
  end loop;
end $$;

-- Le staff déjà inscrit reçoit un dossier interne gratuit.
insert into public.academy_student_finance (organization_id,enrollment_id,is_internal_training,agreed_amount,payment_status,created_by)
select enrollment.organization_id,enrollment.id,true,0,'not_required',enrollment.created_by
from public.academy_school_enrollments enrollment where enrollment.source='staff_automatic'
on conflict (enrollment_id) do nothing;
insert into public.academy_student_progress (organization_id,enrollment_id,training_status,risk_level)
select enrollment.organization_id,enrollment.id,'not_started','low'
from public.academy_school_enrollments enrollment
on conflict (enrollment_id) do nothing;

commit;
