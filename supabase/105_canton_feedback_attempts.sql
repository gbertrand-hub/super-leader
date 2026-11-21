-- Rate limit public feedback QR attempts, including guesses of non-existing receipt codes.
-- The application stores only a server-keyed IP hash; never raw IPs.
create table if not exists public.canton_qr_feedback_attempts(
 id bigint generated always as identity primary key,
 ip_hash text not null,
 submitted_at timestamptz not null default now()
);
create index if not exists canton_feedback_attempts_by_ip_time
 on public.canton_qr_feedback_attempts(ip_hash,submitted_at desc);
alter table public.canton_qr_feedback_attempts enable row level security;
revoke all on public.canton_qr_feedback_attempts from anon,authenticated;
-- Scheduled operational cleanup should delete attempt records older than 7 days.
