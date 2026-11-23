-- Super Leader V4.6 - Parametres generaux et fuseau horaire
-- Les timestamps existants restent en UTC. Le fuseau ne sert qu'a l'interpretation et l'affichage.

create table if not exists public.organization_general_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  timezone text not null default 'America/Chicago',
  date_format text not null default 'MM/DD/YYYY' check (date_format in ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD')),
  time_format text not null default '12h' check (time_format in ('12h','24h')),
  default_locale text not null default 'fr' check (default_locale in ('fr','en')),
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  week_starts_on smallint not null default 1 check (week_starts_on in (0,1,6)),
  work_days smallint[] not null default array[1,2,3,4,5]::smallint[],
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(work_days) > 0 and work_days <@ array[0,1,2,3,4,5,6]::smallint[])
);

alter table public.organization_general_settings enable row level security;

drop policy if exists organization_general_settings_read on public.organization_general_settings;
create policy organization_general_settings_read on public.organization_general_settings
for select to authenticated using (
  exists (select 1 from public.organization_members m where m.organization_id = organization_general_settings.organization_id and m.user_id = auth.uid() and m.is_active = true)
);

drop policy if exists organization_general_settings_admin_write on public.organization_general_settings;
create policy organization_general_settings_admin_write on public.organization_general_settings
for all to authenticated using (
  exists (select 1 from public.organization_members m where m.organization_id = organization_general_settings.organization_id and m.user_id = auth.uid() and m.is_active = true and m.role in ('owner','admin'))
) with check (
  exists (select 1 from public.organization_members m where m.organization_id = organization_general_settings.organization_id and m.user_id = auth.uid() and m.is_active = true and m.role in ('owner','admin'))
);

insert into public.organization_general_settings (organization_id, timezone)
select o.id, coalesce(ps.timezone, 'America/Chicago')
from public.organizations o
left join public.performance_settings ps on ps.organization_id = o.id
on conflict (organization_id) do nothing;

create or replace function public.sync_organization_timezone_to_performance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid IANA time zone: %', new.timezone;
  end if;
  insert into public.performance_settings (organization_id, timezone, updated_at)
  values (new.organization_id, new.timezone, now())
  on conflict (organization_id) do update set timezone = excluded.timezone, updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sync_organization_timezone on public.organization_general_settings;
create trigger trg_sync_organization_timezone after insert or update of timezone on public.organization_general_settings
for each row execute function public.sync_organization_timezone_to_performance();
