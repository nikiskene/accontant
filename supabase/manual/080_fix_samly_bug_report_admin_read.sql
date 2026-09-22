-- Allows authenticated users to read only through the existing admin-only RLS policy.
begin;
grant select on public.samly_bug_reports to authenticated;
commit;

select jsonb_build_object(
  'authenticated_select_granted',has_table_privilege('authenticated','public.samly_bug_reports','select'),
  'admin_only_rls_policy',exists(select 1 from pg_policies where schemaname='public' and tablename='samly_bug_reports' and policyname='samly_bug_reports_admin_read')
) as samly_bug_report_admin_read_fix_verification;
