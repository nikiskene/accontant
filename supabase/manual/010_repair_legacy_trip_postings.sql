-- Repair the three classified 2025 legacy trips in one atomic operation.
-- Creates three canonical balanced postings, links all 33 expenses, and marks
-- the 16 known zero-line legacy headers void. Nothing is deleted.

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
    '9aadacb8-e0ed-476b-8369-a20e4be3cb9c',
    '63743d3e-18c8-4ada-b5de-3d5807ea70b4',
    '94b34226-1687-4928-a64f-8a9ef29a73f1',
    '76d72858-7658-47ce-b825-efdb67414858',
    '24e4956c-34a6-4e18-9149-bb71fb50f487',
    '3b24b122-5460-4266-9a66-0e47a8203ed0',
    'bd5ca55b-8048-4cf2-8d4a-fa6afbed34ef',
    '7dffa11f-5693-4fa6-adb8-3ac3d6e93e6c',
    'a813e348-780d-4d82-a3eb-86ce8297a856',
    'f2fd2567-2168-4874-901f-af856d9136d5',
    'd11995f2-f1fc-4d48-86f1-a60592c5239d',
    '035087f2-6ced-421c-969d-7d5e910f42ce',
    '0cf89527-828f-420a-b3ae-11ea25707cf8',
    'bb07c7d1-bd54-4a6f-bb85-7f083fa31d72',
    'b84ae43c-57e4-4108-9bd4-03e211043d2f',
    '852007ef-54f9-4923-9f69-c24ac39b1732'
  ]::uuid[];
  v_count integer;
begin
  -- Attribute canonical posting and audit events to the sole workspace owner.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  if auth.uid() is distinct from v_owner then
    raise exception 'Could not establish the expected audit user';
  end if;

  if not public.can_write(v_workspace) then
    raise exception 'Expected owner does not have write access';
  end if;

  if exists (
    select 1 from public.accounting_periods
    where workspace_id = v_workspace
      and status = 'locked'
      and period_start <= date '2025-12-31'
      and period_end >= date '2025-01-01'
  ) then
    raise exception 'A 2025 accounting period is locked';
  end if;

  select count(*) into v_count
  from public.trips
  where workspace_id = v_workspace
    and id = any(v_trip_ids)
    and status = 'filed';
  if v_count <> 3 then
    raise exception 'Expected three un-repaired filed trips, found %', v_count;
  end if;

  select count(*) into v_count
  from public.trip_expenses
  where workspace_id = v_workspace
    and trip_id = any(v_trip_ids)
    and account_id is not null
    and vat_code_id is not null
    and amount_aed is not null
    and transaction_id is null;
  if v_count <> 33 then
    raise exception 'Expected 33 classified unlinked expenses, found %', v_count;
  end if;

  select count(*) into v_count
  from public.transactions tx
  where tx.workspace_id = v_workspace
    and tx.id = any(v_empty_ids)
    and tx.status = 'posted'
    and not exists (
      select 1 from public.transaction_lines tl
      where tl.transaction_id = tx.id
    );
  if v_count <> 16 then
    raise exception 'Expected 16 known posted zero-line headers, found %', v_count;
  end if;

  -- Temporarily restore the lifecycle state required by the canonical function.
  update public.trips
  set status = 'submitted'
  where workspace_id = v_workspace
    and id = any(v_trip_ids)
    and status = 'filed';

  perform public.submit_trip('b558acc5-8d6d-4188-b84a-b330e1591ddf');
  perform public.submit_trip('755fe831-3a67-4450-96fb-b5868f2ab3dc');
  perform public.submit_trip('f5118091-ab28-4320-8e09-5e19546f0efa');

  select count(*) into v_count
  from public.trip_expenses
  where workspace_id = v_workspace
    and trip_id = any(v_trip_ids)
    and status = 'posted'
    and transaction_id is not null;
  if v_count <> 33 then
    raise exception 'Canonical posting linked only % of 33 expenses', v_count;
  end if;

  select count(*) into v_count
  from public.transactions tx
  where tx.workspace_id = v_workspace
    and tx.source = 'trip'
    and tx.description = any(array[
      'TRIP:b558acc5-8d6d-4188-b84a-b330e1591ddf',
      'TRIP:755fe831-3a67-4450-96fb-b5868f2ab3dc',
      'TRIP:f5118091-ab28-4320-8e09-5e19546f0efa'
    ])
    and tx.status = 'posted'
    and public.is_transaction_balanced(tx.id);
  if v_count <> 3 then
    raise exception 'Expected three balanced posted trip transactions, found %', v_count;
  end if;

  update public.transactions
  set status = 'void'
  where workspace_id = v_workspace
    and id = any(v_empty_ids)
    and status = 'posted'
    and not exists (
      select 1 from public.transaction_lines tl
      where tl.transaction_id = transactions.id
    );
  get diagnostics v_count = row_count;
  if v_count <> 16 then
    raise exception 'Voided only % of 16 legacy headers', v_count;
  end if;

  insert into public.audit_events (
    workspace_id, entity_type, entity_id, action, details, created_by
  )
  select
    v_workspace,
    'transaction',
    legacy_id,
    'voided_legacy_empty_header',
    jsonb_build_object(
      'reason', 'Zero-line trip header replaced by canonical consolidated posting',
      'repair_file', '010_repair_legacy_trip_postings.sql'
    ),
    v_owner
  from unnest(v_empty_ids) as legacy_id;

  insert into public.audit_events (
    workspace_id, entity_type, entity_id, action, details, created_by
  ) values (
    v_workspace,
    'workspace',
    v_workspace,
    'legacy_trip_repair_completed',
    jsonb_build_object(
      'trips_posted', 3,
      'expenses_linked', 33,
      'empty_headers_voided', 16
    ),
    v_owner
  );
end
$$;

-- Read-only verification returned after a successful repair.
select jsonb_build_object(
  'filed_trips', (
    select count(*) from public.trips
    where id = any(array[
      'b558acc5-8d6d-4188-b84a-b330e1591ddf',
      '755fe831-3a67-4450-96fb-b5868f2ab3dc',
      'f5118091-ab28-4320-8e09-5e19546f0efa'
    ]::uuid[]) and status = 'filed'
  ),
  'linked_posted_expenses', (
    select count(*) from public.trip_expenses
    where trip_id = any(array[
      'b558acc5-8d6d-4188-b84a-b330e1591ddf',
      '755fe831-3a67-4450-96fb-b5868f2ab3dc',
      'f5118091-ab28-4320-8e09-5e19546f0efa'
    ]::uuid[]) and status = 'posted' and transaction_id is not null
  ),
  'balanced_trip_postings', (
    select count(*) from public.transactions
    where workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
      and source = 'trip'
      and description like 'TRIP:%'
      and status = 'posted'
      and public.is_transaction_balanced(id)
  ),
  'void_legacy_headers', (
    select count(*) from public.transactions
    where workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
      and id = any(array[
      '9aadacb8-e0ed-476b-8369-a20e4be3cb9c', '63743d3e-18c8-4ada-b5de-3d5807ea70b4',
      '94b34226-1687-4928-a64f-8a9ef29a73f1', '76d72858-7658-47ce-b825-efdb67414858',
      '24e4956c-34a6-4e18-9149-bb71fb50f487', '3b24b122-5460-4266-9a66-0e47a8203ed0',
      'bd5ca55b-8048-4cf2-8d4a-fa6afbed34ef', '7dffa11f-5693-4fa6-adb8-3ac3d6e93e6c',
      'a813e348-780d-4d82-a3eb-86ce8297a856', 'f2fd2567-2168-4874-901f-af856d9136d5',
      'd11995f2-f1fc-4d48-86f1-a60592c5239d', '035087f2-6ced-421c-969d-7d5e910f42ce',
      '0cf89527-828f-420a-b3ae-11ea25707cf8', 'bb07c7d1-bd54-4a6f-bb85-7f083fa31d72',
      'b84ae43c-57e4-4108-9bd4-03e211043d2f', '852007ef-54f9-4923-9f69-c24ac39b1732'
    ]::uuid[]) and status = 'void'
  )
) as verification;
