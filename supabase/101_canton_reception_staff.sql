-- Canton receptionist assignments. Add only on stage until build and access tests pass.
create table if not exists public.canton_reception_staff (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 granted_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 primary key (organization_id,user_id)
);
alter table public.canton_reception_staff enable row level security;
revoke all on public.canton_reception_staff from anon,authenticated;
