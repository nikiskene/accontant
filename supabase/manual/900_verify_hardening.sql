-- READ ONLY. Run after 001–007.

select jsonb_build_object(
  'self_membership_policy_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_members'
      and policyname = 'insert own workspace membership'
  ),
  'duplicate_tx_insert_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'transactions'
      and policyname = 'tx insert'
  ),
  'duplicate_tx_read_exists', exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'transactions'
      and policyname = 'tx read'
  ),
  'unbalanced_posted', (
    select count(*) from public.transactions
    where status = 'posted'
      and not public.is_transaction_balanced(id)
  ),
  'unclassified_submitted_trip_expenses', (
    select count(*) from public.trip_expenses
    where status = 'submitted'
      and (account_id is null or vat_code_id is null)
  ),
  'trip_transaction_link_exists', exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_expenses'
      and column_name = 'transaction_id'
  ),
  'accounting_periods_exists', to_regclass('public.accounting_periods') is not null,
  'trip_posting_link_is_unique', exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'trip_expenses'
      and indexname = 'trip_expenses_transaction_id_unique'
  )
) as verification;
