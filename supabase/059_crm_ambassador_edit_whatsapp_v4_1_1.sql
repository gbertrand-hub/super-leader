-- SUPER LEADER V4.1.1 - Modification des ambassadeurs et numero WhatsApp
-- A executer apres 058_crm_ambassadors_secure_v4_1.sql
begin;

alter table public.crm_ambassadors
  add column if not exists whatsapp_phone text;

commit;
