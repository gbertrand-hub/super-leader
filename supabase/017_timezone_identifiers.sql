-- Super Leader - 017_timezone_identifiers.sql
-- Normalise les anciens libelles de fuseau horaire et empeche les valeurs invalides.

begin;

create or replace function public.super_leader_normalize_timezone_value(value text)
returns text
language plpgsql
stable
as $$
declare
  cleaned text := btrim(coalesce(value, ''));
  lowered text := lower(btrim(coalesce(value, '')));
begin
  if cleaned = '' then
    return 'Europe/Dublin';
  end if;

  if lowered in (
    'afrique centrale',
    'central africa',
    'central african time',
    'w. central africa standard time',
    'cameroun',
    'cameroon',
    'douala',
    'yaounde',
    'yaoundé'
  ) then
    return 'Africa/Douala';
  end if;

  if lowered in ('dublin', 'ireland', 'irlande') then
    return 'Europe/Dublin';
  end if;

  if lowered in ('dallas', 'texas') then
    return 'America/Chicago';
  end if;

  return cleaned;
end;
$$;

create or replace function public.super_leader_validate_timezone_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.timezone := public.super_leader_normalize_timezone_value(new.timezone);

  if not exists (
    select 1
    from pg_timezone_names
    where name = new.timezone
  ) then
    raise exception 'Invalid IANA time zone: %', new.timezone
      using errcode = '22023';
  end if;

  return new;
end;
$$;

-- Corrige les valeurs historiques connues.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'performance_settings',
    'member_work_schedules',
    'schedule_templates',
    'work_schedule_entries'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'update public.%I set timezone = public.super_leader_normalize_timezone_value(timezone)',
        table_name
      );

      execute format(
        'drop trigger if exists trg_validate_timezone on public.%I',
        table_name
      );

      execute format(
        'create trigger trg_validate_timezone before insert or update of timezone on public.%I for each row execute function public.super_leader_validate_timezone_trigger()',
        table_name
      );
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
