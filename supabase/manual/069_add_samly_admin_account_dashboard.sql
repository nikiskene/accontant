-- Samly administrator account/subscription overview. No customer ledger data is exposed.
begin;
create or replace function public.samly_admin_accounts()
returns table(account_id uuid, display_name text, billing_email text, language_code text, plan_code text, subscription_status text, subscription_current_period_end timestamptz, created_at timestamptz, workspace_id uuid, country text, legal_name text)
language sql stable security definer set search_path = public as $$
  select a.id,a.display_name,a.billing_email,a.language_code,a.plan_code,a.subscription_status,a.subscription_current_period_end,a.created_at,w.id,w.country,w.legal_name
  from public.samly_accounts a join public.samly_account_workspaces aw on aw.account_id=a.id join public.workspaces w on w.id=aw.workspace_id
  where public.is_samly_admin() order by a.created_at desc;
$$;
revoke all on function public.samly_admin_accounts() from public;
grant execute on function public.samly_admin_accounts() to authenticated;
commit;
select to_regprocedure('public.samly_admin_accounts()') is not null as samly_admin_dashboard_ready;
