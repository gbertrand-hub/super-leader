-- Super Leader B2/B3: PUBLIC SCHEMA ONLY, READ-ONLY STRUCTURAL FINGERPRINT.
-- Returns definitions as MD5 fingerprints, never table rows or function source.
-- This query does NOT dump a database and cannot recreate one.
-- Compare reports from separate connections with the SAME SQL and PG version.
WITH base AS (
 SELECT c.oid, c.relname AS name, c.relkind, c.relrowsecurity AS rls,
        c.relforcerowsecurity AS force_rls, COALESCE(c.relacl::text,'') AS grants
 FROM pg_class c
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
), item AS (
 SELECT b.name, b.relkind, b.rls, b.force_rls, md5(b.grants) AS grants_hash,
  (SELECT count(*) FROM pg_attribute a
    WHERE a.attrelid=b.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns_count,
  (SELECT md5(COALESCE(string_agg(
      a.attnum::text||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||
      a.attnotnull::text||':'||COALESCE(pg_get_expr(d.adbin,d.adrelid),'')||':'||
      a.attidentity::text||':'||a.attgenerated::text,
      '|' ORDER BY a.attnum),''))
   FROM pg_attribute a
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid=b.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns_hash,
  (SELECT count(*) FROM pg_constraint co WHERE co.conrelid=b.oid) AS constraints_count,
  (SELECT md5(COALESCE(string_agg(
      co.contype::text||':'||co.conname||':'||pg_get_constraintdef(co.oid,true),
      '|' ORDER BY co.conname),''))
   FROM pg_constraint co WHERE co.conrelid=b.oid) AS constraints_hash,
  (SELECT count(*) FROM pg_policy po WHERE po.polrelid=b.oid) AS policies_count,
  (SELECT md5(COALESCE(string_agg(
      po.polname||':'||po.polcmd::text||':'||po.polpermissive::text||':'||
      array_to_string(ARRAY(
        SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE COALESCE(r.rolname,'UNRESOLVED_ROLE') END
        FROM unnest(po.polroles) AS role_oid
        LEFT JOIN pg_roles r ON r.oid=role_oid
        ORDER BY 1
      ),',')||':'||COALESCE(pg_get_expr(po.polqual,po.polrelid),'')||':'||
      COALESCE(pg_get_expr(po.polwithcheck,po.polrelid),''),
      '|' ORDER BY po.polname),''))
   FROM pg_policy po WHERE po.polrelid=b.oid) AS policies_hash,
  (SELECT count(*) FROM pg_index ix WHERE ix.indrelid=b.oid) AS indexes_count,
  (SELECT md5(COALESCE(string_agg(pg_get_indexdef(ix.indexrelid),
      '|' ORDER BY pg_get_indexdef(ix.indexrelid)),''))
   FROM pg_index ix WHERE ix.indrelid=b.oid) AS indexes_hash,
  (SELECT count(*) FROM pg_trigger tg
   WHERE tg.tgrelid=b.oid AND NOT tg.tgisinternal) AS triggers_count,
  (SELECT md5(COALESCE(string_agg(pg_get_triggerdef(tg.oid,true),
      '|' ORDER BY tg.tgname),''))
   FROM pg_trigger tg WHERE tg.tgrelid=b.oid AND NOT tg.tgisinternal) AS triggers_hash
 FROM base b
)
SELECT jsonb_build_object(
 'schema','public',
 'tables',(SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY name),'[]'::jsonb) FROM item),
 'routines',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
       'identity',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
       'kind',p.prokind,
       'security_definer',p.prosecdef,
       'definition_hash',md5(pg_get_functiondef(p.oid)),
       'grants_hash',md5(COALESCE(p.proacl::text,''))
   ) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind IN ('f','p')),
 'views',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
       'name',v.relname,
       'definition_hash',md5(pg_get_viewdef(v.oid,true)),
       'grants_hash',md5(COALESCE(v.relacl::text,'')),
       'options',v.reloptions
   ) ORDER BY v.relname),'[]'::jsonb)
   FROM pg_class v JOIN pg_namespace n ON n.oid=v.relnamespace
   WHERE n.nspname='public' AND v.relkind IN ('v','m')),
 'extensions',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
       'name',e.extname,'version',e.extversion,'schema',en.nspname
   ) ORDER BY e.extname),'[]'::jsonb)
   FROM pg_extension e JOIN pg_namespace en ON en.oid=e.extnamespace)
) AS fingerprint;
