begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('super-leader-private', 'super-leader-private', false, 31457280)
on conflict (id) do update
set public = false,
    file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, 0), excluded.file_size_limit);

alter table public.academy_courses
  add column if not exists is_staff_training boolean not null default false;

create index if not exists academy_courses_staff_training_idx
  on public.academy_courses (organization_id, is_staff_training, training_month desc);

create table if not exists public.academy_staff_training_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  module_label text not null check (char_length(trim(module_label)) between 1 and 120),
  title text not null check (char_length(trim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 1200),
  resource_type text not null default 'document' check (resource_type in ('document','presentation','worksheet','guide','template','spreadsheet','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 31457280),
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academy_staff_training_resources_course_idx
  on public.academy_staff_training_resources (organization_id, course_id, module_label, sort_order, created_at);
create index if not exists academy_staff_training_resources_published_idx
  on public.academy_staff_training_resources (organization_id, course_id, is_published);

create table if not exists public.academy_staff_training_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  course_id uuid references public.academy_courses(id) on delete set null,
  resource_id uuid references public.academy_staff_training_resources(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists academy_staff_training_audit_org_idx
  on public.academy_staff_training_audit_log (organization_id, created_at desc);
create index if not exists academy_staff_training_audit_course_idx
  on public.academy_staff_training_audit_log (course_id, created_at desc);

alter table public.academy_staff_training_resources enable row level security;
alter table public.academy_staff_training_audit_log enable row level security;

-- Read access is restricted to active organization members who are either Academy administrators
-- or enrolled in the matching staff training course. Application writes use the service-role server client.
drop policy if exists academy_staff_training_resources_select on public.academy_staff_training_resources;
create policy academy_staff_training_resources_select
on public.academy_staff_training_resources
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = academy_staff_training_resources.organization_id
      and om.user_id = auth.uid()
      and om.is_active = true
      and (
        om.role in ('owner','admin','hr')
        or (
          academy_staff_training_resources.is_published = true
          and exists (
            select 1
            from public.academy_enrollments ae
            where ae.organization_id = academy_staff_training_resources.organization_id
              and ae.course_id = academy_staff_training_resources.course_id
              and ae.user_id = auth.uid()
          )
        )
      )
  )
);

-- Audit logs are intentionally not exposed through direct client reads.
drop policy if exists academy_staff_training_audit_none on public.academy_staff_training_audit_log;
create policy academy_staff_training_audit_none
on public.academy_staff_training_audit_log
for select
to authenticated
using (false);

commit;
