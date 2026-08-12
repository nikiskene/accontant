-- Atomically repair the three classified 2025 legacy trips.
-- Preserves and reverses the three oversimplified postings, creates detailed
-- replacements, links all 33 expenses, and audit-voids 16 zero-line headers.

do $$
declare
  v_workspace constant uuid := 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9';
  v_owner constant uuid := 'c0a1df38-31e5-4feb-9c31-82ad11cc9af0';
  v_trip_ids constant uuid[] := array[
    'b558acc5-8d6d-4188-b84a-b330e1591ddf',
    '755fe831-3a67-4450-96fb-b5868f2ab3dc',
    'f5118091-ab28-4320-8e09-5e19546f0efa'
  ]::uuid[];
  v_empty_ids constant uuid[] := array[
    '9aadacb8-e0ed-476b-8369-a20e4be3cb9c', '63743d3e-18c8-4ada-b5de-3d5807ea70b4',
    '94b34226-1687-4928-a64f-8a9ef29a73f1', '76d72858-7658-47ce-b825-efdb67414858',
    '24e4956c-34a6-4e18-9149-bb71fb50f487', '3b24b122-5460-4266-9a66-0e47a8203ed0',
    'bd5ca55b-8048-4cf2-8d4a-fa6afbed34ef', '7dffa11f-5693-4fa6-adb8-3ac3d6e93e6c',
    'a813e348-780d-4d82-a3eb-86ce8297a856', 'f2fd2567-2168-4874-901f-af856d9136d5',
    'd11995f2-f1fc-4d48-86f1-a60592c5239d', '035087f2-6ced-421c-969d-7d5e910f42ce',
    '0cf89527-828f-420a-b3ae-11ea25707cf8', 'bb07c7d1-bd54-4a6f-bb85-7f083fa31d72',
    'b84ae43c-57e4-4108-9bd4-03e211043d2f', '852007ef-54f9-4923-9f69-c24ac39b1732'
  ]::uuid[];
  v_clearing uuid;
  v_reversal uuid;
  v_corrected uuid;
  v_count integer;
  v_line integer;
  v_total numeric;
  v_trip record;
  v_expense record;
begin
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  if auth.uid() is distinct from v_owner or not public.can_write(v_workspace) then
    raise exception 'Could not establish the expected owner write context';
  end if;

  if exists (
    select 1 from public.accounting_periods
    where workspace_id = v_workspace and status = 'locked'
      and period_start <= date '2025-12-31' and period_end >= date '2025-01-01'
  ) then
    raise exception 'A 2025 accounting period is locked';
  end if;

  select default_trip_clearing_account_id into v_clearing
  from public.workspace_settings where workspace_id = v_workspace;
  if v_clearing is null then
    raise exception 'Trip clearing account is missing';
  end if;

  select count(*) into v_count from public.trip_expenses
  where workspace_id = v_workspace and trip_id = any(v_trip_ids)
    and account_id is not null and vat_code_id is not null
    and amount_aed is not null and transaction_id is null;
  if v_count <> 33 then
    raise exception 'Expected 33 classified unlinked expenses, found %', v_count;
  end if;

  select count(*) into v_count from public.transactions tx
  where tx.workspace_id = v_workspace and tx.id = any(v_empty_ids)
    and tx.status = 'posted'
    and not exists (select 1 from public.transaction_lines tl where tl.transaction_id = tx.id);
  if v_count <> 16 then
    raise exception 'Expected 16 known posted zero-line headers, found %', v_count;
  end if;

  if exists (
    select 1 from public.transactions
    where workspace_id = v_workspace
      and (source in ('trip_repair', 'trip_repair_reversal')
        or description like 'CORRECTED TRIP:%')
  ) then
    raise exception 'A prior trip repair already exists';
  end if;

  for v_trip in
    select t.id, t.name, tx.id as original_id, tx.txn_date
    from (values
      ('b558acc5-8d6d-4188-b84a-b330e1591ddf'::uuid, '2deb1a9d-199e-4abf-857b-61fd46b4ed71'::uuid),
      ('755fe831-3a67-4450-96fb-b5868f2ab3dc'::uuid, '2cd077ea-a2d4-4f4f-84a9-edd079ee5ec8'::uuid),
      ('f5118091-ab28-4320-8e09-5e19546f0efa'::uuid, 'c40b32d1-962d-4021-b0de-d65ea4458a50'::uuid)
    ) m(trip_id, transaction_id)
    join public.trips t on t.id = m.trip_id and t.workspace_id = v_workspace
    join public.transactions tx on tx.id = m.transaction_id
      and tx.workspace_id = v_workspace and tx.status = 'posted'
      and public.is_transaction_balanced(tx.id)
    order by tx.txn_date, t.id
  loop
    select round(sum(amount_aed), 2) into v_total
    from public.trip_expenses where trip_id = v_trip.id;

    if v_total is distinct from (
      select round(sum(amount), 2) from public.transaction_lines
      where transaction_id = v_trip.original_id and amount > 0
    ) then
      raise exception 'Original posting total does not match trip %', v_trip.id;
    end if;

    v_reversal := public.reverse_transaction(
      v_trip.original_id, v_owner,
      'Legacy aggregate posting replaced with reviewed detailed classifications'
    );

    update public.transactions
    set txn_date = v_trip.txn_date, source = 'trip_repair_reversal'
    where id = v_reversal;

    update public.transaction_lines reversal_line
    set amount_aed = -coalesce(original_line.amount_aed, original_line.amount),
        fx_rate_to_aed = coalesce(original_line.fx_rate_to_aed, 1)
    from public.transaction_lines original_line
    where reversal_line.transaction_id = v_reversal
      and original_line.transaction_id = v_trip.original_id
      and original_line.line_no = reversal_line.line_no;

    perform public.post_transaction(v_reversal, v_owner);
    if not exists (
      select 1 from public.transactions
      where id = v_reversal and status = 'posted'
        and public.is_transaction_balanced(id)
    ) then
      raise exception 'Reversal failed for trip %', v_trip.id;
    end if;

    insert into public.transactions (
      workspace_id, txn_date, txn_type, description, currency, status, source
    ) values (
      v_workspace, v_trip.txn_date, 'journal',
      'CORRECTED TRIP:' || v_trip.id::text, 'AED', 'draft', 'trip_repair'
    ) returning id into v_corrected;

    v_line := 0;
    for v_expense in
      select * from public.trip_expenses
      where trip_id = v_trip.id order by expense_date, id
    loop
      v_line := v_line + 1;
      insert into public.transaction_lines (
        workspace_id, transaction_id, line_no, account_id, cost_center_id,
        trip_id, vat_code_id, counterparty_id, net_amount, vat_amount,
        amount, amount_aed, fx_rate_to_aed, memo
      ) values (
        v_workspace, v_corrected, v_line, v_expense.account_id,
        v_expense.cost_center_id, v_trip.id, v_expense.vat_code_id,
        v_expense.counterparty_id, round(v_expense.amount_aed, 2), 0,
        round(v_expense.amount_aed, 2), round(v_expense.amount_aed, 2), 1,
        concat_ws(' - ', v_expense.merchant, v_expense.description)
      );
    end loop;

    v_line := v_line + 1;
    insert into public.transaction_lines (
      workspace_id, transaction_id, line_no, account_id, trip_id,
      net_amount, vat_amount, amount, amount_aed, fx_rate_to_aed, memo
    ) values (
      v_workspace, v_corrected, v_line, v_clearing, v_trip.id,
      -v_total, 0, -v_total, -v_total, 1, 'Trip clearing: ' || v_trip.name
    );

    if not public.is_transaction_balanced(v_corrected) then
      raise exception 'Corrected posting is unbalanced for trip %', v_trip.id;
    end if;
    perform public.post_transaction(v_corrected, v_owner);
    if not exists (select 1 from public.transactions where id = v_corrected and status = 'posted') then
      raise exception 'Corrected posting failed for trip %', v_trip.id;
    end if;

    -- Source expenses remain submitted. Their linked posted transaction is the
    -- accounting authority; "posted" is not a permitted expense status.
    update public.trip_expenses
    set transaction_id = v_corrected
    where trip_id = v_trip.id;

    insert into public.audit_events (
      workspace_id, entity_type, entity_id, action, details, created_by
    ) values (
      v_workspace, 'trip', v_trip.id, 'legacy_posting_corrected',
      jsonb_build_object(
        'original_transaction_id', v_trip.original_id,
        'reversal_transaction_id', v_reversal,
        'corrected_transaction_id', v_corrected,
        'total_aed', v_total
      ), v_owner
    );
  end loop;

  select count(*) into v_count from public.trip_expenses
  where trip_id = any(v_trip_ids) and status = 'submitted' and transaction_id is not null;
  if v_count <> 33 then raise exception 'Only % of 33 expenses were linked', v_count; end if;

  update public.transactions set status = 'void'
  where workspace_id = v_workspace and id = any(v_empty_ids) and status = 'posted'
    and not exists (
      select 1 from public.transaction_lines tl where tl.transaction_id = transactions.id
    );
  get diagnostics v_count = row_count;
  if v_count <> 16 then raise exception 'Voided only % of 16 empty headers', v_count; end if;

  insert into public.audit_events (
    workspace_id, entity_type, entity_id, action, details, created_by
  )
  select v_workspace, 'transaction', legacy_id, 'voided_legacy_empty_header',
    jsonb_build_object(
      'reason', 'Zero-line header superseded by reviewed detailed trip posting',
      'repair_file', '010_repair_legacy_trip_postings.sql'
    ), v_owner
  from unnest(v_empty_ids) as x(legacy_id);
end
$$;

select jsonb_build_object(
  'linked_submitted_expenses', (
    select count(*) from public.trip_expenses
    where trip_id = any(array[
      'b558acc5-8d6d-4188-b84a-b330e1591ddf', '755fe831-3a67-4450-96fb-b5868f2ab3dc',
      'f5118091-ab28-4320-8e09-5e19546f0efa'
    ]::uuid[]) and status = 'submitted' and transaction_id is not null
  ),
  'corrected_postings', (
    select count(*) from public.transactions
    where workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
      and source = 'trip_repair' and status = 'posted'
      and public.is_transaction_balanced(id)
  ),
  'posted_reversals', (
    select count(*) from public.transactions
    where workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
      and source = 'trip_repair_reversal' and status = 'posted'
      and public.is_transaction_balanced(id)
  ),
  'void_legacy_headers', (
    select count(*) from public.transactions
    where workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
      and status = 'void' and not exists (
        select 1 from public.transaction_lines tl where tl.transaction_id = transactions.id
      )
  ),
  'remaining_unbalanced_posted', (
    select count(*) from public.transactions
    where workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
      and status = 'posted' and not public.is_transaction_balanced(id)
  )
) as verification;
