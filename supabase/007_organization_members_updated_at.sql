begin;

alter table public.organization_members
add column if not exists updated_at timestamptz;

update public.organization_members
set updated_at = coalesce(created_at, now())
where updated_at is null;

alter table public.organization_members
alter column updated_at set default now();

alter table public.organization_members
alter column updated_at set not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_organization_members_updated_at
on public.organization_members;

create trigger set_organization_members_updated_at
before update on public.organization_members
for each row
execute function public.set_updated_at();

commit;

notify pgrst, 'reload schema';
