-- V4.10.132 appointments use local wall time scoped by operational site.
-- The legacy unique index predates multi-site and can incorrectly collide across timezones.
drop index if exists public.canton_appointments_duplicate_scheduled_idx;

create unique index if not exists canton_appointments_site_duplicate_scheduled_idx
 on public.canton_appointments(site_id,visitor_id,scheduled_local,department,purpose)
 where site_id is not null
   and scheduled_local is not null
   and status not in ('cancelled','no_show');

-- Legacy rows without site_id remain protected separately until backfilled.
create unique index if not exists canton_appointments_legacy_duplicate_scheduled_idx
 on public.canton_appointments(visitor_id,scheduled_local,department,purpose)
 where site_id is null
   and scheduled_local is not null
   and status not in ('cancelled','no_show');
