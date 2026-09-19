-- READ ONLY — current chart/VAT schema and proven configuration inventory.
-- Run after 061. It reads only the two existing owner workspaces to design
-- reusable AT and AE templates; it changes no data.
with my_workspaces as (
  select w.id, w.legal_name, w.country, w.base_currency
  from public.workspaces w
  join public.workspace_members wm on wm.workspace_id = w.id
  where wm.user_id = 'c0a1df38-31e5-4feb-9c31-82ad11cc9af0'::uuid
    and wm.role = 'owner'
    and w.country in ('AT', 'AE')
), column_shapes as (
  select table_name, jsonb_agg(jsonb_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable) order by ordinal_position) as columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('accounts','vat_codes','workspace_settings','tax_years','document_sequences','company_legal_profiles')
  group by table_name
)
select jsonb_build_object(
  'schema', coalesce((select jsonb_object_agg(table_name, columns) from column_shapes), '{}'::jsonb),
  'workspaces', coalesce((select jsonb_agg(jsonb_build_object(
    'workspace_id', mw.id, 'legal_name', mw.legal_name, 'country', mw.country, 'base_currency', mw.base_currency,
    'accounts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.code), '[]'::jsonb) from public.accounts a where a.workspace_id = mw.id),
    'vat_codes', (select coalesce(jsonb_agg(to_jsonb(v) order by v.code), '[]'::jsonb) from public.vat_codes v where v.workspace_id = mw.id),
    'settings', (select to_jsonb(s) from public.workspace_settings s where s.workspace_id = mw.id),
    'document_sequences', (select coalesce(jsonb_agg(to_jsonb(ds) order by ds.document_type, ds.fiscal_year), '[]'::jsonb) from public.document_sequences ds where ds.workspace_id = mw.id)
  ) order by mw.country) from my_workspaces mw), '[]'::jsonb)
) as samly_chart_template_preflight;
