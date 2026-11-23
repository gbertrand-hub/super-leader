-- SUPER LEADER V4.10.63 - Acces configurable aux dossiers financiers clients
begin;

alter table public.finance_settings
  add column if not exists customer_account_access_mode text not null default 'finance_team',
  add column if not exists customer_account_user_ids uuid[] not null default '{}'::uuid[];

alter table public.finance_settings
  drop constraint if exists finance_settings_customer_account_access_mode_check,
  add constraint finance_settings_customer_account_access_mode_check
    check (customer_account_access_mode in ('finance_team','selected_users'));

comment on column public.finance_settings.customer_account_access_mode is
  'finance_team autorise automatiquement tous les membres actifs des equipes Finance; selected_users utilise la liste explicite.';
comment on column public.finance_settings.customer_account_user_ids is
  'Utilisateurs explicitement autorises lorsque customer_account_access_mode vaut selected_users.';

revoke all on table public.finance_settings from anon, authenticated;
grant select, insert, update, delete on table public.finance_settings to service_role;

commit;
notify pgrst, 'reload schema';
