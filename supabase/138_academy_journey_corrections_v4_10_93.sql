begin;

-- SUPER LEADER V4.10.93 — suivi auditable des corrections du parcours étudiant.
-- Cette structure ne modifie aucune vente, aucun paiement et aucune inscription.

create table if not exists public.academy_journey_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  student_key text not null check (student_key ~ '^(crm|user):[0-9a-fA-F-]{36}$'),
  enrollment_id uuid references public.academy_school_enrollments(id) on delete cascade,
  issue_key text not null check (char_length(issue_key) between 3 and 180),
  step_key text not null check (step_key in ('sale','payment','receipt','finance','schedule','enrollment','followup','access')),
  school_name text,
  status text not null default 'open' check (status in ('open','resolved')),
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, student_key, issue_key),
  check ((status='resolved' and resolved_at is not null and resolved_by is not null and char_length(btrim(coalesce(resolution_note,'')))>=3) or status='open')
);

create index if not exists academy_journey_corrections_org_status_idx
  on public.academy_journey_corrections (organization_id,status,updated_at desc);
create index if not exists academy_journey_corrections_student_idx
  on public.academy_journey_corrections (organization_id,student_key,updated_at desc);

create table if not exists public.academy_journey_correction_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  correction_id uuid not null references public.academy_journey_corrections(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('resolved','reopened')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists academy_journey_correction_audit_correction_idx
  on public.academy_journey_correction_audit (correction_id,created_at desc);
create index if not exists academy_journey_correction_audit_org_idx
  on public.academy_journey_correction_audit (organization_id,created_at desc);

create or replace function public.record_academy_journey_correction(
  p_organization_id uuid,
  p_student_key text,
  p_enrollment_id uuid,
  p_issue_key text,
  p_step_key text,
  p_school_name text,
  p_status text,
  p_note text,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare correction_id uuid;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_id and is_active=true) then
    raise exception 'Action non autorisée dans cette organisation.';
  end if;
  if p_status not in ('open','resolved') or p_step_key not in ('sale','payment','receipt','finance','schedule','enrollment','followup','access') then
    raise exception 'Correction invalide.';
  end if;
  if p_status='resolved' and char_length(btrim(coalesce(p_note,'')))<3 then
    raise exception 'Une note de correction est obligatoire.';
  end if;
  insert into public.academy_journey_corrections(organization_id,student_key,enrollment_id,issue_key,step_key,school_name,status,resolution_note,resolved_by,resolved_at,reopened_by,reopened_at,updated_at)
  values(p_organization_id,p_student_key,p_enrollment_id,p_issue_key,p_step_key,p_school_name,p_status,case when p_status='resolved' then p_note end,case when p_status='resolved' then p_actor_id end,case when p_status='resolved' then now() end,case when p_status='open' then p_actor_id end,case when p_status='open' then now() end,now())
  on conflict(organization_id,student_key,issue_key) do update set enrollment_id=excluded.enrollment_id,step_key=excluded.step_key,school_name=excluded.school_name,status=excluded.status,resolution_note=excluded.resolution_note,resolved_by=excluded.resolved_by,resolved_at=excluded.resolved_at,reopened_by=excluded.reopened_by,reopened_at=excluded.reopened_at,updated_at=now()
  returning id into correction_id;
  insert into public.academy_journey_correction_audit(organization_id,correction_id,actor_id,action,note)
  values(p_organization_id,correction_id,p_actor_id,case when p_status='resolved' then 'resolved' else 'reopened' end,p_note);
  return correction_id;
end;
$$;

alter table public.academy_journey_corrections enable row level security;
alter table public.academy_journey_correction_audit enable row level security;
revoke all on public.academy_journey_corrections from anon,authenticated;
revoke all on public.academy_journey_correction_audit from anon,authenticated;
grant select,insert,update on public.academy_journey_corrections to service_role;
grant select,insert on public.academy_journey_correction_audit to service_role;
revoke all on function public.record_academy_journey_correction(uuid,text,uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_academy_journey_correction(uuid,text,uuid,text,text,text,text,text,uuid) to service_role;

comment on table public.academy_journey_corrections is 'Suivi manuel auditable des anomalies calculées par le contrôle du parcours Academy.';
comment on table public.academy_journey_correction_audit is 'Historique immuable des clôtures et réouvertures des corrections de parcours.';

commit;
notify pgrst,'reload schema';
