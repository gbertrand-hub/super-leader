-- Super Leader V4.8.62 — correctif annonces officielles bilingues FR / EN
-- Les colonnes historiques title/body restent en place pour compatibilite.
-- Les nouvelles annonces ecrivent title/body en francais et stockent aussi les deux versions localisees.

alter table public.official_announcements
  add column if not exists title_fr text,
  add column if not exists body_fr text,
  add column if not exists title_en text,
  add column if not exists body_en text;

-- Les annonces historiques sont considerees comme francaises.
update public.official_announcements
set
  title_fr = coalesce(nullif(title_fr, ''), title),
  body_fr = coalesce(nullif(body_fr, ''), body)
where title_fr is null
   or body_fr is null
   or title_fr = ''
   or body_fr = '';

alter table public.official_announcements
  drop constraint if exists official_announcements_title_fr_length_check,
  drop constraint if exists official_announcements_body_fr_length_check,
  drop constraint if exists official_announcements_title_en_length_check,
  drop constraint if exists official_announcements_body_en_length_check;

alter table public.official_announcements
  add constraint official_announcements_title_fr_length_check
    check (title_fr is null or char_length(title_fr) between 3 and 220),
  add constraint official_announcements_body_fr_length_check
    check (body_fr is null or char_length(body_fr) between 10 and 12000),
  add constraint official_announcements_title_en_length_check
    check (title_en is null or char_length(title_en) between 3 and 220),
  add constraint official_announcements_body_en_length_check
    check (body_en is null or char_length(body_en) between 10 and 12000);

comment on column public.official_announcements.title_fr is 'Titre officiel francais';
comment on column public.official_announcements.body_fr is 'Contenu officiel francais';
comment on column public.official_announcements.title_en is 'Official English title';
comment on column public.official_announcements.body_en is 'Official English content';
