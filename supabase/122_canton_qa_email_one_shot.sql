-- QA-only one-shot dispatch tokens for controlled real email tests.
create table if not exists public.canton_qa_email_dispatch_tokens(
 token uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 appointment_id uuid not null references public.canton_appointments(id) on delete cascade,
 expires_at timestamptz not null default (now()+interval '30 minutes'),
 consumed_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.canton_qa_email_dispatch_tokens enable row level security;
revoke all on public.canton_qa_email_dispatch_tokens from public,anon,authenticated;
grant select,insert,update on public.canton_qa_email_dispatch_tokens to service_role;

create or replace function public.canton_consume_qa_email_dispatch_token(p_token uuid)
returns table(appointment_id uuid)
language plpgsql security invoker set search_path='' as $$
declare rec record;
begin
 select t.appointment_id into rec
 from public.canton_qa_email_dispatch_tokens t
 where t.token=p_token
   and t.organization_id='021cdbb8-af4d-412e-8ec7-e7bba08d1349'::uuid
   and t.consumed_at is null
   and t.expires_at>now()
 for update skip locked;
 if not found then return; end if;
 update public.canton_qa_email_dispatch_tokens
 set consumed_at=now()
 where token=p_token;
 appointment_id:=rec.appointment_id;
 return next;
end $$;
revoke all on function public.canton_consume_qa_email_dispatch_token(uuid) from public,anon,authenticated;
grant execute on function public.canton_consume_qa_email_dispatch_token(uuid) to service_role;
