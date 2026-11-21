-- QA migration: public QR responses no longer require a reception-issued visit code.
-- Anonymous comments are kept outside named visit feedback to avoid false linkage.
create table if not exists public.canton_anonymous_feedback (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 department text not null check(department in ('DIG','TCF','OTHER')),
 rating integer not null check(rating between 1 and 5),
 comment text,
 submitted_at timestamptz not null default now(),
 check(length(coalesce(comment,''))<=1000)
);
create index if not exists canton_anonymous_feedback_org_time_idx on public.canton_anonymous_feedback(organization_id,submitted_at desc);
alter table public.canton_anonymous_feedback enable row level security;
revoke all on public.canton_anonymous_feedback from anon,authenticated;
grant select,insert on public.canton_anonymous_feedback to service_role;
