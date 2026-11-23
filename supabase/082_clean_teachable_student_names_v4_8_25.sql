-- Super Leader V4.8.25 - Nettoyage sûr des numéros de ligne importés
begin;

update public.crm_clients
set full_name = trim(regexp_replace(full_name, '^\s*[0-9]+\s*[.)-]\s+', '')),
    updated_at = now()
where full_name ~ '^\s*[0-9]+\s*[.)-]\s+';

commit;
