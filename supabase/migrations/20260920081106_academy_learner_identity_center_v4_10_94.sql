begin;

-- SUPER LEADER V4.10.94 — audit du Centre d'identité apprenant.
-- Aucun compte collaborateur et aucune donnée financière ne sont créés ici.

create table if not exists public.academy_learner_identity_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  crm_client_id uuid not null references public.crm_clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('account_invited','existing_account_linked','enrollments_synchronized')),
  actor_id uuid not null references auth.users(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists academy_learner_identity_audit_client_idx
  on public.academy_learner_identity_audit (organization_id,crm_client_id,created_at desc);
create index if not exists academy_learner_identity_audit_actor_idx
  on public.academy_learner_identity_audit (organization_id,actor_id,created_at desc);

alter table public.academy_learner_identity_audit enable row level security;
revoke all on public.academy_learner_identity_audit from anon,authenticated;
grant select,insert on public.academy_learner_identity_audit to service_role;

comment on table public.academy_learner_identity_audit is 'Journal immuable des invitations et rattachements de comptes apprenants aux dossiers CRM et inscriptions Academy.';

commit;
notify pgrst,'reload schema';
