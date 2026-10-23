-- Schema fingerprint probe. Read-only: one select over the catalog, run
-- through scripts/delivery/fingerprint.mjs, which hashes and compares the
-- rows. Each row is one object in `public` as JSON text, so a definition that
-- spans lines still arrives as a single cell.
with relations as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         c.reloptions, c.relowner, c.relacl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm')
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e')
),
tables as (
  select * from relations where relkind in ('r', 'p')
),
functions as (
  select p.oid, p.proname, p.proowner, p.proacl
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind in ('f', 'p')
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e')
),
sequences as (
  select c.relowner, c.relacl,
         coalesce(owned.name, 'public.' || c.relname) as name,
         concat_ws(' ', format_type(s.seqtypid, null),
           'start ' || s.seqstart,
           'increment ' || s.seqincrement,
           'min ' || s.seqmin,
           'max ' || s.seqmax,
           case when s.seqcycle then 'cycle' end) as definition
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_sequence s on s.seqrelid = c.oid
    left join lateral (
      select tn.nspname || '.' || t.relname || '.' || a.attname as name
        from pg_depend d
        join pg_class t on t.oid = d.refobjid
        join pg_namespace tn on tn.oid = t.relnamespace
        join pg_attribute a
          on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
       where d.classid = 'pg_class'::regclass
         and d.objid = c.oid
         and d.refclassid = 'pg_class'::regclass
         and d.refobjsubid > 0
         and d.deptype in ('a', 'i')
       limit 1) owned on true
   where n.nspname = 'public'
     and c.relkind = 'S'
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e')
),
privileged as (
  select 'public.' || r.relname as object, r.relowner as owner,
         coalesce(r.relacl, acldefault('r', r.relowner)) as acl
    from relations r
  union all
  select s.name, s.relowner, coalesce(s.relacl, acldefault('s', s.relowner))
    from sequences s
  union all
  select 'public.' || f.proname
           || '(' || pg_get_function_identity_arguments(f.oid) || ')',
         f.proowner,
         coalesce(f.proacl, acldefault('f', f.proowner))
    from functions f
),
acl_entries as (
  select pr.object, x.grantee, x.privilege_type, x.is_grantable
    from privileged pr
   cross join lateral aclexplode(pr.acl) x
   where x.grantee <> pr.owner
),
objects as (
  select 'table' as kind,
         null::text as on_relation,
         'public.' || t.relname as name,
         concat_ws(' ', t.relkind,
           case when t.relrowsecurity then 'rls' end,
           case when t.relforcerowsecurity then 'force_rls' end) as definition
    from tables t

  union all
  select 'column',
         'public.' || t.relname,
         'public.' || t.relname || '.' || a.attname,
         concat_ws(' ', format_type(a.atttypid, a.atttypmod),
           case when a.attnotnull then 'not null' end,
           'default ' || pg_get_expr(ad.adbin, ad.adrelid),
           case when a.attidentity <> ''
                then 'identity ' || a.attidentity::text end,
           case when a.attgenerated <> ''
                then 'generated ' || a.attgenerated::text end,
           case when co.collname <> 'default' then 'collate ' || co.collname end)
    from tables t
    join pg_attribute a
      on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    left join pg_collation co on co.oid = a.attcollation

  union all
  select 'constraint',
         'public.' || t.relname,
         'public.' || t.relname || '.' || con.conname,
         con.contype::text || ' ' || pg_get_constraintdef(con.oid)
    from tables t
    join pg_constraint con on con.conrelid = t.oid
   where con.contype <> 'n'

  union all
  select 'index',
         'public.' || t.relname,
         'public.' || t.relname || '.' || ic.relname,
         pg_get_indexdef(i.indexrelid)
    from tables t
    join pg_index i on i.indrelid = t.oid
    join pg_class ic on ic.oid = i.indexrelid

  union all
  select 'policy',
         'public.' || t.relname,
         'public.' || t.relname || '.' || p.polname,
         concat_ws(' ', p.polcmd,
           case when p.polpermissive then 'permissive' else 'restrictive' end,
           (select string_agg(roles.role, ',' order by roles.role)
              from (select case when u.r = 0 then 'public'
                                else pg_get_userbyid(u.r) end as role
                      from unnest(p.polroles) as u(r)) roles),
           'using (' || pg_get_expr(p.polqual, p.polrelid) || ')',
           'check (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')')
    from tables t
    join pg_policy p on p.polrelid = t.oid

  union all
  select 'view',
         null,
         'public.' || v.relname,
         concat_ws(' ', v.relkind,
           array_to_string(v.reloptions, ','),
           pg_get_viewdef(v.oid, true))
    from relations v
   where v.relkind in ('v', 'm')

  union all
  select 'function',
         null,
         'public.' || f.proname
           || '(' || pg_get_function_identity_arguments(f.oid) || ')',
         pg_get_functiondef(f.oid)
    from functions f

  union all
  select 'trigger',
         'public.' || t.relname,
         'public.' || t.relname || '.' || tg.tgname,
         pg_get_triggerdef(tg.oid)
    from tables t
    join pg_trigger tg on tg.tgrelid = t.oid
   where not tg.tgisinternal

  union all
  select 'grant',
         null,
         pv.object || '.'
           || case when pv.grantee = 0 then 'public'
                   else pg_get_userbyid(pv.grantee) end
           || '.' || pv.privilege_type,
         case when bool_or(pv.is_grantable) then 'grantable' else '' end
    from acl_entries pv
   group by pv.object, pv.grantee, pv.privilege_type

  union all
  select 'type',
         null,
         'public.' || ty.typname,
         'enum (' || coalesce(
           (select string_agg(quote_literal(e.enumlabel), ','
                              order by e.enumsortorder)
              from pg_enum e
             where e.enumtypid = ty.oid), '') || ')'
    from pg_type ty
    join pg_namespace n on n.oid = ty.typnamespace
   where n.nspname = 'public'
     and ty.typtype = 'e'
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_type'::regclass
          and d.objid = ty.oid
          and d.deptype = 'e')

  union all
  select 'sequence', null, s.name, s.definition
    from sequences s
)
select json_build_object(
         'kind', kind,
         'on', on_relation,
         'name', name,
         'definition', definition)::text as object
  from objects
 order by kind, name, definition;
