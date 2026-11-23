-- V4.10.132 validate visitor site timezone names against PostgreSQL's timezone catalog.
create or replace function public.canton_validate_visitor_site_timezone()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
 if new.timezone is null or btrim(new.timezone)='' then
  raise exception 'Visitor site timezone is required';
 end if;

 if not exists (
  select 1
  from pg_catalog.pg_timezone_names t
  where t.name=new.timezone
 ) then
  raise exception 'Invalid visitor site timezone: %',new.timezone;
 end if;

 return new;
end $$;

drop trigger if exists canton_validate_visitor_site_timezone_trg on public.visitor_sites;
create trigger canton_validate_visitor_site_timezone_trg
before insert or update of timezone on public.visitor_sites
for each row execute function public.canton_validate_visitor_site_timezone();

revoke all on function public.canton_validate_visitor_site_timezone()
 from public,anon,authenticated;
grant execute on function public.canton_validate_visitor_site_timezone()
 to service_role;
