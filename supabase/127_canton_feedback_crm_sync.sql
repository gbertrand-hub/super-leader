-- V4.10.132 Visitor feedback -> CRM idempotency.
alter table public.canton_visit_feedback
 add column if not exists crm_interaction_id uuid references public.crm_interactions(id);

create index if not exists canton_visit_feedback_crm_interaction_idx
 on public.canton_visit_feedback(crm_interaction_id)
 where crm_interaction_id is not null;
