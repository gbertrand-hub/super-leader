-- QA-only bilingual feedback invitation preference; independent of employee UI locale.
alter table public.canton_visitors
 add column if not exists feedback_preferred_locale text not null default 'en';
alter table public.canton_visitors
 drop constraint if exists canton_feedback_preferred_locale_check;
alter table public.canton_visitors
 add constraint canton_feedback_preferred_locale_check check(feedback_preferred_locale in ('fr','en'));
