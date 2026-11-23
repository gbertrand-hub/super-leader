begin;

alter table public.organization_members
add column if not exists disabled_at timestamptz null;

comment on column public.organization_members.disabled_at
is 'Date de désactivation du collaborateur. NULL signifie que le membre est actif.';

update public.organization_members
set disabled_at = now()
where is_active = false
  and disabled_at is null;

commit;

notify pgrst, 'reload schema';
