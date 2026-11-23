-- Super Leader V4.5.1 - Visibilite stricte des dossiers attribues
-- A executer apres 064_confidential_customer_portfolios_v4_5.sql.
begin;

create or replace function public.can_access_customer_portfolio(target_client_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1
    from public.crm_clients c
    join public.organization_members om
      on om.organization_id=c.organization_id
     and om.user_id=auth.uid()
     and om.is_active=true
    where c.id=target_client_id
      and (
        om.role in ('owner','admin')
        or (
          c.status='prospect'
          and (
            c.owner_id=auth.uid()
            or c.follow_up_owner_id=auth.uid()
            or (
              om.role='manager'
              and (
                c.owner_id in (
                select tm.user_id
                from public.teams t
                join public.team_members tm on tm.team_id=t.id
                where t.organization_id=c.organization_id
                  and t.is_active=true
                  and t.manager_id=auth.uid()
                union
                select mws.user_id
                from public.member_work_schedules mws
                where mws.organization_id=c.organization_id
                  and mws.is_active=true
                  and mws.supervisor_id=auth.uid()
                )
                or c.follow_up_owner_id in (
                  select tm.user_id
                  from public.teams t
                  join public.team_members tm on tm.team_id=t.id
                  where t.organization_id=c.organization_id
                    and t.is_active=true
                    and t.manager_id=auth.uid()
                  union
                  select mws.user_id
                  from public.member_work_schedules mws
                  where mws.organization_id=c.organization_id
                    and mws.is_active=true
                    and mws.supervisor_id=auth.uid()
                )
              )
            )
          )
        )
        or (
          c.status<>'prospect'
          and (
            c.customer_service_owner_id=auth.uid()
            or (
              om.role='manager'
              and c.customer_service_owner_id in (
                select tm.user_id
                from public.teams t
                join public.team_members tm on tm.team_id=t.id
                where t.organization_id=c.organization_id
                  and t.is_active=true
                  and t.manager_id=auth.uid()
                union
                select mws.user_id
                from public.member_work_schedules mws
                where mws.organization_id=c.organization_id
                  and mws.is_active=true
                  and mws.supervisor_id=auth.uid()
              )
            )
          )
        )
      )
  )
$$;

revoke all on function public.can_access_customer_portfolio(uuid) from public;
grant execute on function public.can_access_customer_portfolio(uuid) to authenticated,service_role;

comment on function public.can_access_customer_portfolio(uuid) is
  'Owner/Admin: organisation. Manager: equipe attribuee. Agent: dossiers attribues. Les dossiers non attribues restent hors des portefeuilles.';

commit;
notify pgrst, 'reload schema';
