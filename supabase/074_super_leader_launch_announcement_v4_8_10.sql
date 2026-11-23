-- Super Leader V4.8.10 — annonce officielle de mise en application
-- Publication idempotente dans chaque organisation active.

do $$
declare
  organization_record record;
  publisher_id uuid;
  new_announcement_id uuid;
begin
  for organization_record in select id from public.organizations loop
    select om.user_id into publisher_id
    from public.organization_members om
    where om.organization_id = organization_record.id
      and om.is_active = true
      and om.role in ('owner', 'admin', 'hr')
    order by case om.role when 'owner' then 1 when 'admin' then 2 else 3 end, om.created_at
    limit 1;

    if publisher_id is null then
      continue;
    end if;

    select oa.id into new_announcement_id
    from public.official_announcements oa
    where oa.organization_id = organization_record.id
      and oa.title = 'Mise en application officielle de Super Leader — 15 août 2026'
    limit 1;

    if new_announcement_id is null then
      insert into public.official_announcements (
        organization_id, title, body, category, priority, audience_scope,
        audience_values, acknowledgement_required, status, publish_at,
        published_at, created_by, updated_by
      ) values (
        organization_record.id,
        'Mise en application officielle de Super Leader — 15 août 2026',
        E'À compter du 15 août 2026 à 00 h 00, Super Leader entre officiellement en application et devient la plateforme obligatoire de travail de l’organisation.\n\nToutes les activités professionnelles, missions, tâches, suivis et résultats doivent être renseignés dans Super Leader. Tout travail qui ne figure pas dans le rapport journalier ne sera pas considéré comme effectué.\n\nDurant la période de transition, l’envoi des rapports par WhatsApp sera d’abord limité. Il sera ensuite définitivement interdit à compter d’une date qui sera communiquée officiellement.\n\nChaque collaborateur est tenu d’utiliser Super Leader quotidiennement, de tenir ses informations à jour et de soumettre son rapport journalier dans le délai prévu. Merci de cliquer sur « J’ai lu et compris » pour confirmer la prise de connaissance de cette directive.',
        'direction', 'urgent', 'organization', '{}', true, 'published', now(), now(), publisher_id, publisher_id
      ) returning id into new_announcement_id;
    end if;

    insert into public.official_announcement_recipients (announcement_id, organization_id, user_id)
    select new_announcement_id, organization_record.id, om.user_id
    from public.organization_members om
    where om.organization_id = organization_record.id and om.is_active = true
    on conflict (announcement_id, user_id) do nothing;

    insert into public.official_announcement_audit_log (organization_id, announcement_id, actor_id, action, details)
    select organization_record.id, new_announcement_id, publisher_id, 'published_by_migration', jsonb_build_object('version', '4.8.10')
    where not exists (
      select 1 from public.official_announcement_audit_log log
      where log.announcement_id = new_announcement_id and log.action = 'published_by_migration'
    );
  end loop;
end $$;
