-- Replaces five conflicting trip workflows with the lifecycle used by the UI:
-- draft -> submitted -> filed.
--
-- This file does not classify or repair existing rows. The 33 submitted source
-- expenses and 16 incomplete transaction headers remain unchanged.

begin;

-- File 006 originally created a unique index before the deployed consolidated
-- workflow was fully inspected. A trip transaction must link to many expenses.
drop index if exists public.trip_expenses_transaction_id_unique;
create index if not exists trip_expenses_transaction_id_idx
  on public.trip_expenses(transaction_id)
  where transaction_id is not null;

create or replace function public.prepare_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_status text;
  v_expense_count integer;
  v_missing_classification integer;
  v_missing_aed integer;
begin
  select workspace_id, status
  into v_workspace_id, v_status
  from public.trips
  where id = p_trip_id
  for update;

  if not found then
    raise exception 'Trip not found: %', p_trip_id;
  end if;

  if not public.can_write(v_workspace_id) then
    raise exception 'Not authorized to prepare trip %', p_trip_id;
  end if;

  if v_status <> 'draft' then
    raise exception 'Trip % must be draft to prepare; current status is %',
      p_trip_id, v_status;
  end if;

  select
    count(*),
    count(*) filter (where account_id is null or vat_code_id is null),
    count(*) filter (where amount_aed is null)
  into v_expense_count, v_missing_classification, v_missing_aed
  from public.trip_expenses
  where trip_id = p_trip_id;

  if v_expense_count = 0 then
    raise exception 'Trip % has no expenses', p_trip_id;
  end if;

  if v_missing_classification > 0 then
    raise exception 'Trip % has % expense(s) missing account or VAT classification',
      p_trip_id, v_missing_classification;
  end if;

  if v_missing_aed > 0 then
    raise exception 'Trip % has % expense(s) missing AED conversion',
      p_trip_id, v_missing_aed;
  end if;

  update public.trip_expenses
  set status = 'submitted'
  where trip_id = p_trip_id
    and status in ('draft', 'reviewed');

  update public.trips
  set status = 'submitted'
  where id = p_trip_id;

  insert into public.audit_events (
    workspace_id, entity_type, entity_id, action, details, created_by
  ) values (
    v_workspace_id,
    'trip',
    p_trip_id,
    'prepared',
    jsonb_build_object('expense_count', v_expense_count),
    auth.uid()
  );
end;
$$;

create or replace function public.prepare_trip_for_submission(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.prepare_trip(p_trip_id);
end;
$$;

create or replace function public.submit_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_trip_status text;
  v_trip_end_date date;
  v_trip_name text;
  v_clearing_account_id uuid;
  v_input_vat_account_id uuid;
  v_transaction_id uuid;
  v_expense_count integer;
  v_missing_classification integer;
  v_missing_aed integer;
  v_line_no integer := 0;
  v_total_aed numeric := 0;
  v_gross_aed numeric;
  v_net_aed numeric;
  v_vat_aed numeric;
  v_expense record;
begin
  select workspace_id, status, end_date, name
  into v_workspace_id, v_trip_status, v_trip_end_date, v_trip_name
  from public.trips
  where id = p_trip_id
  for update;

  if not found then
    raise exception 'Trip not found: %', p_trip_id;
  end if;

  if not public.can_write(v_workspace_id) then
    raise exception 'Not authorized to file trip %', p_trip_id;
  end if;

  if v_trip_status <> 'submitted' then
    raise exception 'Trip % must be submitted to file; current status is %',
      p_trip_id, v_trip_status;
  end if;

  if exists (
    select 1
    from public.accounting_periods ap
    where ap.workspace_id = v_workspace_id
      and ap.status = 'locked'
      and v_trip_end_date between ap.period_start and ap.period_end
  ) then
    raise exception 'Trip % ends in a locked accounting period', p_trip_id;
  end if;

  if exists (
    select 1
    from public.trip_expenses
    where trip_id = p_trip_id
      and transaction_id is not null
  ) or exists (
    select 1
    from public.transactions
    where workspace_id = v_workspace_id
      and source = 'trip'
      and description = 'TRIP:' || p_trip_id::text
  ) then
    raise exception 'Trip % is already linked to a posting', p_trip_id;
  end if;

  select
    count(*),
    count(*) filter (where account_id is null or vat_code_id is null),
    count(*) filter (where amount_aed is null)
  into v_expense_count, v_missing_classification, v_missing_aed
  from public.trip_expenses
  where trip_id = p_trip_id;

  if v_expense_count = 0 then
    raise exception 'Trip % has no expenses', p_trip_id;
  end if;

  if v_missing_classification > 0 then
    raise exception 'Trip % has % expense(s) missing account or VAT classification',
      p_trip_id, v_missing_classification;
  end if;

  if v_missing_aed > 0 then
    raise exception 'Trip % has % expense(s) missing AED conversion',
      p_trip_id, v_missing_aed;
  end if;

  select default_trip_clearing_account_id
  into v_clearing_account_id
  from public.workspace_settings
  where workspace_id = v_workspace_id;

  if v_clearing_account_id is null or not exists (
    select 1 from public.accounts
    where id = v_clearing_account_id
      and workspace_id = v_workspace_id
      and is_active
  ) then
    raise exception 'Workspace % has no valid trip clearing account', v_workspace_id;
  end if;

  if exists (
    select 1
    from public.trip_expenses te
    join public.vat_codes vc on vc.id = te.vat_code_id
    where te.trip_id = p_trip_id
      and vc.vat_rate > 0
  ) then
    select id into v_input_vat_account_id
    from public.accounts
    where workspace_id = v_workspace_id
      and code = '2210'
      and is_active
    limit 1;

    if v_input_vat_account_id is null then
      raise exception 'Workspace % requires active input VAT account 2210', v_workspace_id;
    end if;
  end if;

  insert into public.transactions (
    workspace_id,
    txn_date,
    txn_type,
    description,
    currency,
    status,
    source
  ) values (
    v_workspace_id,
    v_trip_end_date,
    'journal',
    'TRIP:' || p_trip_id::text,
    'AED',
    'draft',
    'trip'
  ) returning id into v_transaction_id;

  for v_expense in
    select
      te.*,
      vc.vat_rate
    from public.trip_expenses te
    join public.vat_codes vc
      on vc.id = te.vat_code_id
     and vc.workspace_id = te.workspace_id
    join public.accounts a
      on a.id = te.account_id
     and a.workspace_id = te.workspace_id
     and a.is_active
    where te.trip_id = p_trip_id
    order by te.expense_date, te.id
  loop
    v_gross_aed := round(v_expense.amount_aed, 2);
    v_net_aed := case
      when v_expense.vat_rate > 0
        then round(v_gross_aed / (1 + v_expense.vat_rate), 2)
      else v_gross_aed
    end;
    v_vat_aed := v_gross_aed - v_net_aed;
    v_total_aed := v_total_aed + v_gross_aed;

    v_line_no := v_line_no + 1;
    insert into public.transaction_lines (
      workspace_id, transaction_id, line_no, account_id, cost_center_id,
      trip_id, vat_code_id, counterparty_id, net_amount, vat_amount,
      amount, amount_aed, fx_rate_to_aed, memo
    ) values (
      v_workspace_id, v_transaction_id, v_line_no, v_expense.account_id,
      v_expense.cost_center_id, p_trip_id, v_expense.vat_code_id,
      v_expense.counterparty_id, v_net_aed, 0,
      v_net_aed, v_net_aed, 1,
      concat_ws(' - ', v_expense.merchant, v_expense.description)
    );

    if v_vat_aed <> 0 then
      v_line_no := v_line_no + 1;
      insert into public.transaction_lines (
        workspace_id, transaction_id, line_no, account_id, cost_center_id,
        trip_id, vat_code_id, net_amount, vat_amount, amount,
        amount_aed, fx_rate_to_aed, memo
      ) values (
        v_workspace_id, v_transaction_id, v_line_no, v_input_vat_account_id,
        v_expense.cost_center_id, p_trip_id, v_expense.vat_code_id,
        0, v_vat_aed, v_vat_aed, v_vat_aed, 1,
        'Input VAT: ' || concat_ws(' - ', v_expense.merchant, v_expense.description)
      );
    end if;
  end loop;

  if v_line_no = 0 then
    raise exception 'Trip % produced no posting lines', p_trip_id;
  end if;

  v_line_no := v_line_no + 1;
  insert into public.transaction_lines (
    workspace_id, transaction_id, line_no, account_id, trip_id,
    net_amount, vat_amount, amount, amount_aed, fx_rate_to_aed, memo
  ) values (
    v_workspace_id, v_transaction_id, v_line_no, v_clearing_account_id,
    p_trip_id, -v_total_aed, 0, -v_total_aed, -v_total_aed, 1,
    'Trip clearing: ' || v_trip_name
  );

  if not public.is_transaction_balanced(v_transaction_id) then
    raise exception 'Trip % generated an unbalanced transaction', p_trip_id;
  end if;

  perform public.post_transaction(v_transaction_id, auth.uid());

  update public.trip_expenses
  set status = 'posted',
      transaction_id = v_transaction_id
  where trip_id = p_trip_id;

  update public.trips
  set status = 'filed'
  where id = p_trip_id;

  insert into public.audit_events (
    workspace_id, entity_type, entity_id, action, details, created_by
  ) values (
    v_workspace_id,
    'trip',
    p_trip_id,
    'filed',
    jsonb_build_object(
      'transaction_id', v_transaction_id,
      'expense_count', v_expense_count,
      'total_aed', v_total_aed
    ),
    auth.uid()
  );
end;
$$;

-- Compatibility entry point. The UI does not use this function.
create or replace function public.post_trip(
  p_trip_id uuid,
  p_user_id uuid,
  p_mode text default 'consolidated'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'User mismatch';
  end if;

  if p_mode <> 'consolidated' then
    raise exception 'Only consolidated trip posting is supported';
  end if;

  perform public.submit_trip(p_trip_id);
  return jsonb_build_object('success', true);
end;
$$;

-- Individual posting conflicts with the consolidated UI lifecycle and is
-- intentionally disabled instead of silently creating another ledger shape.
create or replace function public.post_trip_expense(p_trip_expense_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Individual trip-expense posting is disabled; use prepare_trip and submit_trip';
end;
$$;

revoke all on function public.prepare_trip(uuid) from public;
revoke all on function public.prepare_trip_for_submission(uuid) from public;
revoke all on function public.submit_trip(uuid) from public;
revoke all on function public.post_trip(uuid, uuid, text) from public;
revoke all on function public.post_trip_expense(uuid) from public;

grant execute on function public.prepare_trip(uuid) to authenticated;
grant execute on function public.prepare_trip_for_submission(uuid) to authenticated;
grant execute on function public.submit_trip(uuid) to authenticated;
grant execute on function public.post_trip(uuid, uuid, text) to authenticated;

commit;

-- Read-only verification. No existing trip is changed by this file.
select
  p.proname as function_name,
  p.prosecdef as security_definer,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'post_trip',
    'post_trip_expense',
    'prepare_trip',
    'prepare_trip_for_submission',
    'submit_trip'
  )
order by p.proname;
