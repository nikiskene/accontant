-- READ ONLY — Samly public tenant-isolation preflight.
-- Run in the Supabase SQL editor. It changes no data and returns the live shape
-- needed for the account-isolation migration.
with public_tables as (
  select c.oid, n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
), table_columns as (
  select table_name, array_agg(column_name order by column_name) filter (where column_name in ('id','workspace_id','account_id','owner_user_id','user_id','mailbox_id','email_id')) as tenant_columns
  from information_schema.columns
  where table_schema = 'public'
  group by table_name
), policies as (
  select schemaname, tablename, count(*) as policy_count,
         array_agg(policyname order by policyname) as policy_names
  from pg_policies
  where schemaname = 'public'
  group by schemaname, tablename
), functions as (
  select p.proname,
         pg_get_function_identity_arguments(p.oid) as arguments,
         p.prosecdef as security_definer,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
select jsonb_build_object(
  'generated_at', now(),
  'tables', coalesce((select jsonb_agg(jsonb_build_object(
    'table', t.table_name,
    'rls_enabled', t.rls_enabled,
    'tenant_columns', coalesce(c.tenant_columns, array[]::text[]),
    'policy_count', coalesce(p.policy_count, 0),
    'policies', coalesce(p.policy_names, array[]::text[])
  ) order by t.table_name)
  from public_tables t
  left join table_columns c on c.table_name = t.table_name
  left join policies p on p.schemaname = t.schema_name and p.tablename = t.table_name), '[]'::jsonb),
  'functions', coalesce((select jsonb_agg(jsonb_build_object(
    'name', proname,
    'arguments', arguments,
    'security_definer', security_definer,
    'authenticated_can_execute', authenticated_can_execute
  ) order by proname, arguments) from functions), '[]'::jsonb),
  'storage_buckets', coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'public', public, 'file_size_limit', file_size_limit
  ) order by id) from storage.buckets), '[]'::jsonb),
  'owner_memberships', coalesce((select jsonb_agg(jsonb_build_object(
    'workspace_id', wm.workspace_id,
    'legal_name', w.legal_name,
    'country', w.country,
    'role', wm.role
  ) order by w.legal_name)
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = 'c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid), '[]'::jsonb)
) as samly_public_tenant_preflight;
