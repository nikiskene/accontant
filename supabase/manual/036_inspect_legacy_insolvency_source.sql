-- READ ONLY. Run this in the OLD insolvency Supabase project:
-- https://qednxzolyqzthukqzooh.supabase.co
-- It inventories the live source before any migration is designed or executed.
select jsonb_build_object(
  'tables',(
    select jsonb_agg(jsonb_build_object(
      'name',t.table_name,
      'estimated_rows',coalesce(s.n_live_tup,0),
      'rls_enabled',coalesce(c.relrowsecurity,false),
      'columns',(
        select jsonb_agg(jsonb_build_object(
          'name',col.column_name,'type',col.data_type,'nullable',col.is_nullable,
          'default',col.column_default
        )order by col.ordinal_position)
        from information_schema.columns col
        where col.table_schema='public'and col.table_name=t.table_name
      )
    )order by t.table_name)
    from information_schema.tables t
    left join pg_stat_user_tables s on s.schemaname='public'and s.relname=t.table_name
    left join pg_class c on c.oid=to_regclass(format('public.%I',t.table_name))
    where t.table_schema='public'and t.table_type='BASE TABLE'
  ),
  'views',(
    select jsonb_agg(jsonb_build_object('name',viewname,'definition',definition)order by viewname)
    from pg_views where schemaname='public'
  ),
  'functions',(
    select jsonb_agg(jsonb_build_object(
      'name',p.proname,
      'arguments',pg_get_function_identity_arguments(p.oid),
      'definition',pg_get_functiondef(p.oid)
    )order by p.proname,pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
  ),
  'policies',(
    select jsonb_agg(jsonb_build_object(
      'table',tablename,'name',policyname,'command',cmd,'roles',roles,
      'using',qual,'check',with_check
    )order by tablename,policyname)
    from pg_policies where schemaname='public'
  ),
  'triggers',(
    select jsonb_agg(jsonb_build_object(
      'table',event_object_table,'name',trigger_name,'timing',action_timing,
      'event',event_manipulation,'statement',action_statement
    )order by event_object_table,trigger_name,event_manipulation)
    from information_schema.triggers where trigger_schema='public'
  )
)as insolvency_source_inventory;
