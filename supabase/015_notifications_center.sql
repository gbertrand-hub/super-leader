-- SUPER LEADER - Centre de notifications, alertes et rappels automatiques V1
-- A executer apres les migrations 001 a 014.

begin;

create extension if not exists pgcrypto;

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  email_frequency text not null default 'daily' check (email_frequency in ('instant','daily','off')),
  locale text not null default 'fr' check (locale in ('fr','en')),
  report_reminders boolean not null default true,
  absence_updates boolean not null default true,
  meeting_reminders boolean not null default true,
  sales_updates boolean not null default true,
  collection_updates boolean not null default true,
  feedback_alerts boolean not null default true,
  performance_updates boolean not null default true,
  crm_updates boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  category text not null check (category in (
    'system','reports','absences','meetings','sales','collections','feedback','performance','crm'
  )),
  event_type text not null,
  priority text not null default 'info' check (priority in ('info','success','warning','urgent')),
  title_fr text not null,
  title_en text not null,
  body_fr text not null,
  body_en text not null,
  action_url text,
  requires_action boolean not null default false,
  status text not null default 'unread' check (status in ('unread','read','archived')),
  read_at timestamptz,
  archived_at timestamptz,
  email_requested boolean not null default true,
  email_status text not null default 'queued' check (email_status in ('queued','sent','failed','skipped')),
  email_attempts integer not null default 0 check (email_attempts >= 0),
  email_last_error text,
  email_sent_at timestamptz,
  scheduled_for timestamptz not null default now(),
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notifications_org_user_dedupe_unique
  on public.notifications (organization_id, user_id, dedupe_key)
  where dedupe_key is not null and btrim(dedupe_key) <> '';

create index if not exists notifications_user_status_idx
  on public.notifications (organization_id, user_id, status, created_at desc);

create index if not exists notifications_email_queue_idx
  on public.notifications (email_status, scheduled_for, created_at)
  where email_requested = true and email_status in ('queued','failed');

create index if not exists notifications_action_idx
  on public.notifications (organization_id, user_id, requires_action, priority, created_at desc);

create table if not exists public.notification_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notification_audit_org_created_idx
  on public.notification_audit_log (organization_id, created_at desc);

create or replace function public.notification_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_notification_preferences_updated_at on public.notification_preferences;
create trigger set_notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.notification_set_updated_at();

drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at
before update on public.notifications
for each row execute function public.notification_set_updated_at();

create or replace function public.ensure_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences (organization_id, user_id)
  values (new.organization_id, new.user_id)
  on conflict (organization_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ensure_member_notification_preferences on public.organization_members;
create trigger ensure_member_notification_preferences
after insert on public.organization_members
for each row execute function public.ensure_notification_preferences();

insert into public.notification_preferences (organization_id, user_id)
select organization_id, user_id
from public.organization_members
on conflict (organization_id, user_id) do nothing;

create or replace function public.notify_user(
  p_organization_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_category text,
  p_event_type text,
  p_title_fr text,
  p_title_en text,
  p_body_fr text,
  p_body_en text,
  p_action_url text default null,
  p_priority text default 'info',
  p_requires_action boolean default false,
  p_dedupe_key text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_email_requested boolean default true,
  p_scheduled_for timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and user_id = p_user_id
      and coalesce(is_active, true) = true
  ) then
    return null;
  end if;

  insert into public.notifications (
    organization_id, user_id, actor_id, category, event_type,
    title_fr, title_en, body_fr, body_en, action_url,
    priority, requires_action, dedupe_key, metadata,
    email_requested, email_status, scheduled_for
  ) values (
    p_organization_id, p_user_id, p_actor_id, p_category, p_event_type,
    p_title_fr, p_title_en, p_body_fr, p_body_en, p_action_url,
    p_priority, p_requires_action, nullif(btrim(p_dedupe_key), ''), coalesce(p_metadata, '{}'::jsonb),
    p_email_requested, case when p_email_requested then 'queued' else 'skipped' end, coalesce(p_scheduled_for, now())
  )
  on conflict (organization_id, user_id, dedupe_key)
  where dedupe_key is not null and btrim(dedupe_key) <> ''
  do nothing
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    return null;
end;
$$;

create or replace function public.notification_display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'Collaborateur')
  from public.profiles
  where id = p_user_id;
$$;

create or replace function public.notification_send_to_leaders(
  p_organization_id uuid,
  p_actor_id uuid,
  p_roles text[],
  p_category text,
  p_event_type text,
  p_title_fr text,
  p_title_en text,
  p_body_fr text,
  p_body_en text,
  p_action_url text,
  p_priority text,
  p_requires_action boolean,
  p_dedupe_prefix text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member record;
begin
  for v_member in
    select user_id
    from public.organization_members
    where organization_id = p_organization_id
      and coalesce(is_active, true) = true
      and role = any(p_roles)
  loop
    perform public.notify_user(
      p_organization_id,
      v_member.user_id,
      p_actor_id,
      p_category,
      p_event_type,
      p_title_fr,
      p_title_en,
      p_body_fr,
      p_body_en,
      p_action_url,
      p_priority,
      p_requires_action,
      case when p_dedupe_prefix is null then null else p_dedupe_prefix || ':' || v_member.user_id::text end,
      p_metadata,
      true,
      now()
    );
  end loop;
end;
$$;

create or replace function public.notify_leave_request_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := coalesce(public.notification_display_name(new.user_id), 'Collaborateur');
  v_supervisor uuid;
  v_actor uuid;
  v_month text := to_char(new.start_date, 'YYYY-MM');
begin
  if tg_op = 'INSERT' then
    select supervisor_id into v_supervisor
    from public.member_work_schedules
    where organization_id = new.organization_id
      and user_id = new.user_id
      and is_active = true
    limit 1;

    if v_supervisor is not null then
      perform public.notify_user(
        new.organization_id, v_supervisor, new.user_id,
        'absences', 'leave_submitted',
        'Nouvelle demande d’absence', 'New leave request',
        v_name || ' a soumis une demande d’absence du ' || to_char(new.start_date, 'DD/MM/YYYY') || ' au ' || to_char(new.end_date, 'DD/MM/YYYY') || '.',
        v_name || ' submitted a leave request from ' || to_char(new.start_date, 'DD/MM/YYYY') || ' to ' || to_char(new.end_date, 'DD/MM/YYYY') || '.',
        '/dashboard/performance?view=absences&month=' || v_month,
        'warning', true,
        'leave-submitted:' || new.id::text || ':' || v_supervisor::text,
        jsonb_build_object('leave_request_id', new.id, 'employee_id', new.user_id)
      );
    end if;

    perform public.notification_send_to_leaders(
      new.organization_id, new.user_id, array['owner','admin','hr'],
      'absences', 'leave_submitted',
      'Nouvelle demande d’absence', 'New leave request',
      v_name || ' a soumis une demande d’absence du ' || to_char(new.start_date, 'DD/MM/YYYY') || ' au ' || to_char(new.end_date, 'DD/MM/YYYY') || '.',
      v_name || ' submitted a leave request from ' || to_char(new.start_date, 'DD/MM/YYYY') || ' to ' || to_char(new.end_date, 'DD/MM/YYYY') || '.',
      '/dashboard/performance?view=absences&month=' || v_month,
      'warning', true,
      'leave-submitted:' || new.id::text,
      jsonb_build_object('leave_request_id', new.id, 'employee_id', new.user_id)
    );
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    v_actor := coalesce(new.reviewed_by, new.user_id);
    perform public.notify_user(
      new.organization_id, new.user_id, v_actor,
      'absences', 'leave_' || new.status,
      case new.status
        when 'approved' then 'Demande d’absence approuvée'
        when 'rejected' then 'Demande d’absence refusée'
        when 'cancelled' then 'Demande d’absence annulée'
        else 'Demande d’absence mise à jour'
      end,
      case new.status
        when 'approved' then 'Leave request approved'
        when 'rejected' then 'Leave request rejected'
        when 'cancelled' then 'Leave request cancelled'
        else 'Leave request updated'
      end,
      'Votre demande d’absence du ' || to_char(new.start_date, 'DD/MM/YYYY') || ' au ' || to_char(new.end_date, 'DD/MM/YYYY') || ' est maintenant : ' || new.status || '.',
      'Your leave request from ' || to_char(new.start_date, 'DD/MM/YYYY') || ' to ' || to_char(new.end_date, 'DD/MM/YYYY') || ' is now: ' || new.status || '.',
      '/dashboard/performance?view=absences&month=' || v_month,
      case when new.status = 'approved' then 'success' when new.status = 'rejected' then 'warning' else 'info' end,
      false,
      'leave-status:' || new.id::text || ':' || new.status,
      jsonb_build_object('leave_request_id', new.id, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_leave_request_changes_trigger on public.leave_requests;
create trigger notify_leave_request_changes_trigger
after insert or update of status on public.leave_requests
for each row execute function public.notify_leave_request_changes();

create or replace function public.notify_daily_report_reopening_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    perform public.notify_user(
      new.organization_id, new.user_id, new.opened_by,
      'reports', 'report_reopened',
      'Rapport journalier réouvert', 'Daily report reopened',
      'Votre rapport du ' || to_char(new.report_date, 'DD/MM/YYYY') || ' a été réouvert jusqu’au ' || to_char(new.expires_at, 'DD/MM/YYYY HH24:MI') || '.',
      'Your report for ' || to_char(new.report_date, 'DD/MM/YYYY') || ' has been reopened until ' || to_char(new.expires_at, 'DD/MM/YYYY HH24:MI') || '.',
      '/dashboard/performance?view=reports',
      'warning', true,
      'report-reopened:' || new.id::text,
      jsonb_build_object('reopening_id', new.id, 'report_date', new.report_date, 'expires_at', new.expires_at)
    );
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('revoked','expired') then
    perform public.notify_user(
      new.organization_id, new.user_id, coalesce(new.revoked_by, new.opened_by),
      'reports', 'report_reopening_' || new.status,
      case when new.status = 'revoked' then 'Réouverture révoquée' else 'Réouverture expirée' end,
      case when new.status = 'revoked' then 'Reopening revoked' else 'Reopening expired' end,
      'L’autorisation pour le rapport du ' || to_char(new.report_date, 'DD/MM/YYYY') || ' est maintenant ' || new.status || '.',
      'The permission for the report dated ' || to_char(new.report_date, 'DD/MM/YYYY') || ' is now ' || new.status || '.',
      '/dashboard/performance?view=reports',
      'warning', false,
      'report-reopening-status:' || new.id::text || ':' || new.status,
      jsonb_build_object('reopening_id', new.id, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_daily_report_reopening_changes_trigger on public.daily_report_reopenings;
create trigger notify_daily_report_reopening_changes_trigger
after insert or update of status on public.daily_report_reopenings
for each row execute function public.notify_daily_report_reopening_changes();

create or replace function public.notify_daily_report_review_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('validated','needs_revision','incomplete','supervisor_completed') then
    perform public.notify_user(
      new.organization_id, new.user_id, coalesce(new.reviewed_by, new.submitted_by),
      'reports', 'report_' || new.status,
      case new.status
        when 'validated' then 'Rapport journalier validé'
        when 'needs_revision' then 'Rapport à corriger'
        when 'incomplete' then 'Rapport incomplet'
        else 'Rapport complété par le superviseur'
      end,
      case new.status
        when 'validated' then 'Daily report validated'
        when 'needs_revision' then 'Report requires changes'
        when 'incomplete' then 'Report marked incomplete'
        else 'Report completed by supervisor'
      end,
      'Le statut de votre rapport du ' || to_char(new.report_date, 'DD/MM/YYYY') || ' a été mis à jour.',
      'The status of your report for ' || to_char(new.report_date, 'DD/MM/YYYY') || ' has been updated.',
      '/dashboard/performance?view=reports',
      case when new.status = 'validated' then 'success' when new.status = 'needs_revision' then 'urgent' else 'warning' end,
      new.status = 'needs_revision',
      'report-review:' || new.id::text || ':' || new.status,
      jsonb_build_object('daily_report_id', new.id, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_daily_report_review_changes_trigger on public.daily_reports;
create trigger notify_daily_report_review_changes_trigger
after update of status on public.daily_reports
for each row execute function public.notify_daily_report_review_changes();

create or replace function public.notify_meeting_invitation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.performance_meetings%rowtype;
begin
  if new.status <> 'invited' then return new; end if;
  select * into v_meeting from public.performance_meetings where id = new.meeting_id;
  if not found then return new; end if;

  perform public.notify_user(
    new.organization_id, new.user_id, v_meeting.created_by,
    'meetings', 'meeting_invitation',
    'Nouvelle réunion', 'New meeting',
    'Vous êtes invité à « ' || v_meeting.title || ' » le ' || to_char(v_meeting.starts_at, 'DD/MM/YYYY HH24:MI') || '.',
    'You are invited to “' || v_meeting.title || '” on ' || to_char(v_meeting.starts_at, 'DD/MM/YYYY HH24:MI') || '.',
    '/dashboard/performance?view=meetings',
    case when v_meeting.mandatory then 'warning' else 'info' end,
    v_meeting.mandatory,
    'meeting-invitation:' || new.meeting_id::text || ':' || new.user_id::text,
    jsonb_build_object('meeting_id', new.meeting_id, 'mandatory', v_meeting.mandatory, 'starts_at', v_meeting.starts_at)
  );
  return new;
end;
$$;

drop trigger if exists notify_meeting_invitation_trigger on public.performance_meeting_attendance;
create trigger notify_meeting_invitation_trigger
after insert on public.performance_meeting_attendance
for each row execute function public.notify_meeting_invitation();

create or replace function public.notify_sales_record_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_name text := coalesce(public.notification_display_name(new.seller_id), 'Vendeur');
  v_collector_name text;
begin
  if tg_op = 'INSERT' and new.workflow_status = 'submitted' then
    perform public.notification_send_to_leaders(
      new.organization_id, new.created_by, array['owner','admin','hr','manager'],
      'sales', 'sale_submitted',
      'Nouvelle vente à vérifier', 'New sale to review',
      v_seller_name || ' a enregistré une vente de ' || new.total_amount::text || ' ' || new.currency || ' pour ' || new.customer_name || '.',
      v_seller_name || ' recorded a sale of ' || new.total_amount::text || ' ' || new.currency || ' for ' || new.customer_name || '.',
      '/dashboard/sales',
      'warning', true,
      'sale-submitted:' || new.id::text,
      jsonb_build_object('sale_id', new.id, 'seller_id', new.seller_id, 'amount', new.total_amount, 'currency', new.currency)
    );
  end if;

  if tg_op = 'UPDATE' and new.workflow_status is distinct from old.workflow_status then
    perform public.notify_user(
      new.organization_id, new.seller_id, coalesce(new.approved_by, new.created_by),
      'sales', 'sale_' || new.workflow_status,
      case new.workflow_status
        when 'verified' then 'Vente vérifiée'
        when 'approved' then 'Vente approuvée'
        when 'rejected' then 'Vente refusée'
        when 'cancelled' then 'Vente annulée'
        when 'refunded' then 'Vente remboursée'
        else 'Vente mise à jour'
      end,
      case new.workflow_status
        when 'verified' then 'Sale verified'
        when 'approved' then 'Sale approved'
        when 'rejected' then 'Sale rejected'
        when 'cancelled' then 'Sale cancelled'
        when 'refunded' then 'Sale refunded'
        else 'Sale updated'
      end,
      'La vente de ' || new.total_amount::text || ' ' || new.currency || ' pour ' || new.customer_name || ' est maintenant : ' || new.workflow_status || '.',
      'The sale of ' || new.total_amount::text || ' ' || new.currency || ' for ' || new.customer_name || ' is now: ' || new.workflow_status || '.',
      '/dashboard/sales',
      case when new.workflow_status = 'approved' then 'success' when new.workflow_status in ('rejected','cancelled','refunded') then 'warning' else 'info' end,
      false,
      'sale-status:' || new.id::text || ':' || new.workflow_status,
      jsonb_build_object('sale_id', new.id, 'status', new.workflow_status)
    );
  end if;

  if tg_op = 'UPDATE' and new.commission_status is distinct from old.commission_status and new.commission_status in ('payable','paid','cancelled') then
    perform public.notify_user(
      new.organization_id, new.seller_id, coalesce(new.commission_paid_by, new.approved_by, new.created_by),
      'sales', 'commission_' || new.commission_status,
      case new.commission_status
        when 'payable' then 'Commission à payer'
        when 'paid' then 'Commission payée'
        else 'Commission annulée'
      end,
      case new.commission_status
        when 'payable' then 'Commission payable'
        when 'paid' then 'Commission paid'
        else 'Commission cancelled'
      end,
      'Commission de ' || new.commission_amount::text || ' ' || new.currency || ' liée à la vente pour ' || new.customer_name || '.',
      'Commission of ' || new.commission_amount::text || ' ' || new.currency || ' related to the sale for ' || new.customer_name || '.',
      '/dashboard/sales',
      case when new.commission_status = 'paid' then 'success' when new.commission_status = 'cancelled' then 'warning' else 'info' end,
      new.commission_status = 'payable',
      'commission-status:' || new.id::text || ':' || new.commission_status,
      jsonb_build_object('sale_id', new.id, 'commission_amount', new.commission_amount, 'currency', new.currency)
    );
  end if;

  if tg_op = 'UPDATE' and new.collection_owner_id is distinct from old.collection_owner_id and new.collection_owner_id is not null then
    v_collector_name := coalesce(public.notification_display_name(new.collection_owner_id), 'Agent de suivi');
    perform public.notify_user(
      new.organization_id, new.collection_owner_id, new.created_by,
      'collections', 'collection_assigned',
      'Nouveau dossier de recouvrement', 'New collection case',
      'Le dossier de ' || new.customer_name || ' vous a été attribué. Solde à recouvrer : ' || new.balance_amount::text || ' ' || new.currency || '.',
      'The case for ' || new.customer_name || ' has been assigned to you. Outstanding balance: ' || new.balance_amount::text || ' ' || new.currency || '.',
      '/dashboard/collections',
      'warning', true,
      'collection-assigned:' || new.id::text || ':' || new.collection_owner_id::text,
      jsonb_build_object('sale_id', new.id, 'collection_owner_id', new.collection_owner_id, 'balance_amount', new.balance_amount)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_sales_record_changes_trigger on public.sales_records;
create trigger notify_sales_record_changes_trigger
after insert or update of workflow_status, commission_status, collection_owner_id on public.sales_records
for each row execute function public.notify_sales_record_changes();

create or replace function public.notify_sales_payment_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales_records%rowtype;
  v_actor uuid;
begin
  select * into v_sale from public.sales_records where id = new.sale_id;
  if not found then return new; end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notification_send_to_leaders(
      new.organization_id, new.recorded_by, array['owner','admin','hr','manager'],
      'collections', 'payment_pending',
      'Paiement à confirmer', 'Payment to confirm',
      'Un paiement de ' || new.amount::text || ' ' || new.currency || ' a été enregistré pour ' || v_sale.customer_name || '.',
      'A payment of ' || new.amount::text || ' ' || new.currency || ' was recorded for ' || v_sale.customer_name || '.',
      '/dashboard/collections',
      'warning', true,
      'payment-pending:' || new.id::text,
      jsonb_build_object('payment_id', new.id, 'sale_id', new.sale_id, 'amount', new.amount, 'currency', new.currency)
    );
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    v_actor := coalesce(new.confirmed_by, new.recorded_by);
    perform public.notify_user(
      new.organization_id, new.recorded_by, v_actor,
      'collections', 'payment_' || new.status,
      case new.status
        when 'confirmed' then 'Paiement confirmé'
        when 'rejected' then 'Paiement refusé'
        when 'refunded' then 'Paiement remboursé'
        else 'Paiement mis à jour'
      end,
      case new.status
        when 'confirmed' then 'Payment confirmed'
        when 'rejected' then 'Payment rejected'
        when 'refunded' then 'Payment refunded'
        else 'Payment updated'
      end,
      'Le paiement de ' || new.amount::text || ' ' || new.currency || ' pour ' || v_sale.customer_name || ' est maintenant : ' || new.status || '.',
      'The payment of ' || new.amount::text || ' ' || new.currency || ' for ' || v_sale.customer_name || ' is now: ' || new.status || '.',
      '/dashboard/collections',
      case when new.status = 'confirmed' then 'success' else 'warning' end,
      false,
      'payment-status:' || new.id::text || ':' || new.status,
      jsonb_build_object('payment_id', new.id, 'sale_id', new.sale_id, 'status', new.status)
    );

    if v_sale.collection_owner_id is not null and v_sale.collection_owner_id <> new.recorded_by then
      perform public.notify_user(
        new.organization_id, v_sale.collection_owner_id, v_actor,
        'collections', 'payment_' || new.status,
        case when new.status = 'confirmed' then 'Paiement confirmé sur votre dossier' else 'Paiement mis à jour' end,
        case when new.status = 'confirmed' then 'Payment confirmed on your case' else 'Payment updated' end,
        'Paiement de ' || new.amount::text || ' ' || new.currency || ' pour ' || v_sale.customer_name || '.',
        'Payment of ' || new.amount::text || ' ' || new.currency || ' for ' || v_sale.customer_name || '.',
        '/dashboard/collections',
        case when new.status = 'confirmed' then 'success' else 'warning' end,
        false,
        'payment-owner-status:' || new.id::text || ':' || new.status,
        jsonb_build_object('payment_id', new.id, 'sale_id', new.sale_id, 'status', new.status)
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_sales_payment_changes_trigger on public.sales_payments;
create trigger notify_sales_payment_changes_trigger
after insert or update of status on public.sales_payments
for each row execute function public.notify_sales_payment_changes();

create or replace function public.notify_crm_task_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is null then return new; end if;
  if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
    perform public.notify_user(
      new.organization_id, new.assigned_to, new.created_by,
      'crm', 'task_assigned',
      'Nouvelle tâche CRM', 'New CRM task',
      'La tâche « ' || new.title || ' » vous a été attribuée' || case when new.due_at is not null then ' pour le ' || to_char(new.due_at, 'DD/MM/YYYY HH24:MI') else '' end || '.',
      'The task “' || new.title || '” has been assigned to you' || case when new.due_at is not null then ' for ' || to_char(new.due_at, 'DD/MM/YYYY HH24:MI') else '' end || '.',
      '/dashboard/crm',
      case when new.priority = 'urgent' then 'urgent' when new.priority = 'high' then 'warning' else 'info' end,
      true,
      'crm-task-assigned:' || new.id::text || ':' || new.assigned_to::text,
      jsonb_build_object('task_id', new.id, 'client_id', new.client_id, 'due_at', new.due_at, 'priority', new.priority)
    );
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'completed' then
    perform public.notify_user(
      new.organization_id, new.created_by, new.assigned_to,
      'crm', 'task_completed',
      'Tâche CRM terminée', 'CRM task completed',
      'La tâche « ' || new.title || ' » a été terminée.',
      'The task “' || new.title || '” has been completed.',
      '/dashboard/crm',
      'success', false,
      'crm-task-completed:' || new.id::text,
      jsonb_build_object('task_id', new.id, 'client_id', new.client_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_crm_task_changes_trigger on public.crm_follow_up_tasks;
create trigger notify_crm_task_changes_trigger
after insert or update of assigned_to, status on public.crm_follow_up_tasks
for each row execute function public.notify_crm_task_changes();

create or replace function public.notify_customer_feedback_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := coalesce(public.notification_display_name(new.employee_id), 'Collaborateur');
  v_supervisor uuid;
begin
  if new.rating <= 2 then
    select supervisor_id into v_supervisor
    from public.member_work_schedules
    where organization_id = new.organization_id
      and user_id = new.employee_id
      and is_active = true
    limit 1;

    if v_supervisor is not null then
      perform public.notify_user(
        new.organization_id, v_supervisor, new.employee_id,
        'feedback', 'negative_customer_feedback',
        'Alerte feedback client', 'Customer feedback alert',
        'Une note de ' || new.rating::text || '/5 a été reçue concernant ' || v_name || '.',
        'A rating of ' || new.rating::text || '/5 was received regarding ' || v_name || '.',
        '/dashboard/crm',
        'urgent', true,
        'negative-feedback:' || new.id::text || ':' || v_supervisor::text,
        jsonb_build_object('feedback_response_id', new.id, 'employee_id', new.employee_id, 'rating', new.rating)
      );
    end if;

    perform public.notification_send_to_leaders(
      new.organization_id, new.employee_id, array['owner','admin','hr'],
      'feedback', 'negative_customer_feedback',
      'Alerte feedback client', 'Customer feedback alert',
      'Une note de ' || new.rating::text || '/5 a été reçue concernant ' || v_name || '.',
      'A rating of ' || new.rating::text || '/5 was received regarding ' || v_name || '.',
      '/dashboard/crm',
      'urgent', true,
      'negative-feedback:' || new.id::text,
      jsonb_build_object('feedback_response_id', new.id, 'employee_id', new.employee_id, 'rating', new.rating)
    );
  elsif new.rating >= 4 then
    perform public.notify_user(
      new.organization_id, new.employee_id, null,
      'feedback', 'positive_customer_feedback',
      'Nouveau feedback client positif', 'New positive customer feedback',
      'Un client vous a attribué une note de ' || new.rating::text || '/5.',
      'A customer rated you ' || new.rating::text || '/5.',
      '/dashboard/crm',
      'success', false,
      'positive-feedback:' || new.id::text,
      jsonb_build_object('feedback_response_id', new.id, 'rating', new.rating)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_customer_feedback_response_trigger on public.crm_feedback_responses;
create trigger notify_customer_feedback_response_trigger
after insert on public.crm_feedback_responses
for each row execute function public.notify_customer_feedback_response();

create or replace function public.notify_performance_appeal_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := coalesce(public.notification_display_name(new.user_id), 'Collaborateur');
begin
  if tg_op = 'INSERT' then
    perform public.notification_send_to_leaders(
      new.organization_id, new.user_id, array['owner','admin','hr'],
      'performance', 'score_appeal_submitted',
      'Nouvelle contestation de score', 'New score appeal',
      v_name || ' a contesté son score du mois de ' || to_char(new.score_month, 'MM/YYYY') || '.',
      v_name || ' appealed their score for ' || to_char(new.score_month, 'MM/YYYY') || '.',
      '/dashboard/performance?view=ranking&month=' || to_char(new.score_month, 'YYYY-MM'),
      'warning', true,
      'score-appeal:' || new.id::text,
      jsonb_build_object('appeal_id', new.id, 'user_id', new.user_id, 'score_month', new.score_month)
    );
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.notify_user(
      new.organization_id, new.user_id, new.reviewed_by,
      'performance', 'score_appeal_' || new.status,
      case new.status
        when 'accepted' then 'Contestation acceptée'
        when 'rejected' then 'Contestation refusée'
        when 'cancelled' then 'Contestation annulée'
        else 'Contestation mise à jour'
      end,
      case new.status
        when 'accepted' then 'Appeal accepted'
        when 'rejected' then 'Appeal rejected'
        when 'cancelled' then 'Appeal cancelled'
        else 'Appeal updated'
      end,
      'Votre contestation du score de ' || to_char(new.score_month, 'MM/YYYY') || ' est maintenant : ' || new.status || '.',
      'Your score appeal for ' || to_char(new.score_month, 'MM/YYYY') || ' is now: ' || new.status || '.',
      '/dashboard/performance?view=ranking&month=' || to_char(new.score_month, 'YYYY-MM'),
      case when new.status = 'accepted' then 'success' else 'warning' end,
      false,
      'score-appeal-status:' || new.id::text || ':' || new.status,
      jsonb_build_object('appeal_id', new.id, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_performance_appeal_changes_trigger on public.performance_score_appeals;
create trigger notify_performance_appeal_changes_trigger
after insert or update of status on public.performance_score_appeals
for each row execute function public.notify_performance_appeal_changes();

create or replace function public.notify_employee_month_award()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := coalesce(public.notification_display_name(new.winner_id), 'Collaborateur');
  v_member record;
begin
  for v_member in
    select user_id from public.organization_members
    where organization_id = new.organization_id and coalesce(is_active, true) = true
  loop
    perform public.notify_user(
      new.organization_id, v_member.user_id, new.published_by,
      'performance', 'employee_month_published',
      'Employé du mois publié', 'Employee of the month published',
      v_name || ' est l’Employé du mois avec un score de ' || new.final_score::text || '/100.',
      v_name || ' is Employee of the Month with a score of ' || new.final_score::text || '/100.',
      '/dashboard/performance?view=ranking&month=' || to_char(new.award_month, 'YYYY-MM'),
      case when v_member.user_id = new.winner_id then 'success' else 'info' end,
      false,
      'employee-month-award:' || new.id::text || ':' || v_member.user_id::text,
      jsonb_build_object('award_id', new.id, 'winner_id', new.winner_id, 'score', new.final_score)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists notify_employee_month_award_trigger on public.employee_month_awards;
create trigger notify_employee_month_award_trigger
after insert on public.employee_month_awards
for each row execute function public.notify_employee_month_award();

insert into public.notifications (
  organization_id, user_id, category, event_type, priority,
  title_fr, title_en, body_fr, body_en, action_url,
  requires_action, email_requested, email_status, dedupe_key
)
select
  organization_id,
  user_id,
  'system',
  'notifications_center_enabled',
  'success',
  'Centre de notifications activé',
  'Notification centre enabled',
  'Les alertes, rappels et tâches importantes sont maintenant centralisés dans Super Leader.',
  'Important alerts, reminders and tasks are now centralised in Super Leader.',
  '/dashboard/notifications',
  false,
  false,
  'skipped',
  'notifications-center-welcome-v1'
from public.organization_members
where coalesce(is_active, true) = true
on conflict (organization_id, user_id, dedupe_key)
where dedupe_key is not null and btrim(dedupe_key) <> ''
do nothing;

alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_audit_log enable row level security;

revoke all on public.notification_preferences from anon, authenticated;
revoke all on public.notifications from anon, authenticated;
revoke all on public.notification_audit_log from anon, authenticated;

grant select, insert, update, delete on public.notification_preferences to service_role;
grant select, insert, update, delete on public.notifications to service_role;
grant select, insert on public.notification_audit_log to service_role;
revoke execute on function public.notify_user(uuid,uuid,uuid,text,text,text,text,text,text,text,text,boolean,text,jsonb,boolean,timestamptz) from public, anon, authenticated;
revoke execute on function public.notification_send_to_leaders(uuid,uuid,text[],text,text,text,text,text,text,text,text,boolean,text,jsonb) from public, anon, authenticated;

grant execute on function public.notify_user(uuid,uuid,uuid,text,text,text,text,text,text,text,text,boolean,text,jsonb,boolean,timestamptz) to service_role;
grant execute on function public.notification_send_to_leaders(uuid,uuid,text[],text,text,text,text,text,text,text,text,boolean,text,jsonb) to service_role;

commit;

notify pgrst, 'reload schema';
