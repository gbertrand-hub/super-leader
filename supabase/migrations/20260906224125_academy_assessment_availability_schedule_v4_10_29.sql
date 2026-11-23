-- Super Leader V4.10.29 - scheduled opening and closing of Academy assessments
begin;

alter table public.academy_assessments
  add column if not exists opens_at timestamptz,
  add column if not exists closes_at timestamptz,
  add column if not exists schedule_time_zone text not null default 'UTC';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'academy_assessments_valid_availability_window'
      and conrelid = 'public.academy_assessments'::regclass
  ) then
    alter table public.academy_assessments
      add constraint academy_assessments_valid_availability_window
      check (opens_at is null or closes_at is null or closes_at > opens_at);
  end if;
end
$$;

create index if not exists academy_assessments_availability_idx
  on public.academy_assessments (organization_id, status, opens_at, closes_at)
  where status = 'open';

commit;
