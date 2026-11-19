-- Canton Visitor & Appointment Management V1 (draft; apply only after review)
create table if not exists public.canton_visitors (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 full_name text not null check (length(trim(full_name)) > 0),
 phone text,
 email text,
 created_at timestamptz not null default now(),
 created_by uuid references auth.users(id)
);
create unique index if not exists canton_visitors_org_phone_unique
 on public.canton_visitors (organization_id,phone) where phone is not null;
create unique index if not exists canton_visitors_org_email_without_phone_unique
 on public.canton_visitors (organization_id,lower(email)) where phone is null and email is not null;
create table if not exists public.canton_appointments (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 visitor_id uuid not null references public.canton_visitors(id),
 department text not null check (department in ('DIG','TCF','DIRECTION','OTHER')),
 purpose text not null default 'other',
 scheduled_local timestamp without time zone,
 -- scheduled_local is interpreted in America/Chicago, never the employee's time zone.
 status text not null default 'announced'
   check (status in ('announced','scheduled','arrived','in_progress','completed','cancelled','no_show')),
 host_name text,
 notes text,
 announced_by uuid references auth.users(id),
 check_in_at timestamptz,
 check_out_at timestamptz,
 follow_up_required boolean,
 feedback_token uuid not null default gen_random_uuid() unique,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists canton_appointments_org_schedule_idx on public.canton_appointments(organization_id,scheduled_local);
create index if not exists canton_appointments_visitor_idx on public.canton_appointments(visitor_id);
create unique index if not exists canton_appointments_duplicate_scheduled_idx
 on public.canton_appointments(visitor_id,scheduled_local,department,purpose)
 where scheduled_local is not null and status not in ('cancelled','no_show');
create table if not exists public.canton_visit_feedback (
 id uuid primary key default gen_random_uuid(),
 appointment_id uuid not null unique references public.canton_appointments(id) on delete cascade,
 rating integer not null check (rating between 1 and 5),
 welcome_rating text check (welcome_rating in ('very_satisfied','satisfied','neutral','dissatisfied')),
 expectations text check (expectations in ('yes','partially','no')),
 contact_requested boolean not null default false,
 comment text,
 submitted_at timestamptz not null default now()
);
-- No direct browser/database access. Actions authenticate, authorize and scope via server.
alter table public.canton_visitors enable row level security;
alter table public.canton_appointments enable row level security;
alter table public.canton_visit_feedback enable row level security;
revoke all on public.canton_visitors, public.canton_appointments, public.canton_visit_feedback from anon, authenticated;
