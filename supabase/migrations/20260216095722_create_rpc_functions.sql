/*
  # RPC Functions for IACy Tax Ledger

  ## Transaction Management
  
  1. `post_transaction` - Posts a draft transaction after validation
     - Validates balance (sum of lines = 0)
     - Updates status to 'posted'
     - Records posted_at and posted_by
     - Creates audit event
  
  2. `reverse_transaction` - Creates reversal entry for corrections
     - Creates new transaction with reversed lines
     - Marks original as 'reversed'
     - Links via reversal_of
     - Creates audit event
  
  ## Trip Management
  
  3. `post_trip` - Converts trip expenses to GL transaction
     - Validates all expenses have account_id
     - Creates consolidated or individual transactions
     - Updates trip and expenses status to 'posted'
     - Creates audit event
  
  ## Bank Reconciliation
  
  4. `create_expense_from_bank_line` - Match bank line to expense
     - Creates purchase transaction from bank line
     - Marks bank line as 'matched'
     - Links transaction to bank line
  
  5. `create_sale_from_bank_line` - Match bank line to revenue
     - Creates sale transaction from bank line
     - Marks bank line as 'matched'
     - Links transaction to bank line
  
  6. `set_bank_line_status` - Update bank line status
     - Sets status to private/excluded
     - Records notes
  
  ## Reporting Functions
  
  7. `profit_and_loss` - P&L by account type
  8. `balance_sheet` - Assets, liabilities, equity
  9. `trial_balance` - All accounts with period totals
  10. `vat_summary` - VAT analysis by code
*/

-- ============================================================================
-- Helper Function: Create Audit Event
-- ============================================================================

CREATE OR REPLACE FUNCTION create_audit_event(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_details jsonb DEFAULT NULL
) RETURNS void AS $$
BEGIN
  INSERT INTO audit_events (workspace_id, entity_type, entity_id, action, details, created_by)
  VALUES (p_workspace_id, p_entity_type, p_entity_id, p_action, p_details, auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 1. POST TRANSACTION
-- ============================================================================

CREATE OR REPLACE FUNCTION post_transaction(
  p_transaction_id uuid,
  p_user_id uuid
) RETURNS jsonb AS $$
DECLARE
  v_workspace_id uuid;
  v_status text;
  v_balance numeric;
  v_line_count int;
BEGIN
  -- Get transaction details
  SELECT workspace_id, status INTO v_workspace_id, v_status
  FROM transactions
  WHERE id = p_transaction_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;
  
  -- Check status
  IF v_status != 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only draft transactions can be posted');
  END IF;
  
  -- Validate balance
  SELECT COALESCE(SUM(amount), 0), COUNT(*)
  INTO v_balance, v_line_count
  FROM transaction_lines
  WHERE transaction_id = p_transaction_id;
  
  IF v_line_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction has no lines');
  END IF;
  
  IF ABS(v_balance) > 0.01 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction is not balanced', 'balance', v_balance);
  END IF;
  
  -- Post transaction
  UPDATE transactions
  SET status = 'posted',
      posted_at = now(),
      posted_by = p_user_id,
      updated_at = now()
  WHERE id = p_transaction_id;
  
  -- Create audit event
  PERFORM create_audit_event(
    v_workspace_id,
    'transaction',
    p_transaction_id,
    'posted',
    jsonb_build_object('posted_by', p_user_id)
  );
  
  RETURN jsonb_build_object('success', true, 'transaction_id', p_transaction_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. REVERSE TRANSACTION
-- ============================================================================

CREATE OR REPLACE FUNCTION reverse_transaction(
  p_transaction_id uuid,
  p_user_id uuid,
  p_reason text
) RETURNS jsonb AS $$
DECLARE
  v_workspace_id uuid;
  v_status text;
  v_txn_date date;
  v_txn_type text;
  v_description text;
  v_reversal_id uuid;
  v_line record;
BEGIN
  -- Get transaction details
  SELECT workspace_id, status, txn_date, txn_type, description
  INTO v_workspace_id, v_status, v_txn_date, v_txn_type, v_description
  FROM transactions
  WHERE id = p_transaction_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction not found');
  END IF;
  
  -- Check status
  IF v_status != 'posted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only posted transactions can be reversed');
  END IF;
  
  -- Create reversal transaction
  INSERT INTO transactions (
    workspace_id, txn_date, txn_type, description, status,
    reversal_of, reversal_reason
  ) VALUES (
    v_workspace_id,
    CURRENT_DATE,
    'journal',
    'REVERSAL: ' || v_description,
    'draft',
    p_transaction_id,
    p_reason
  ) RETURNING id INTO v_reversal_id;
  
  -- Copy lines with reversed amounts
  FOR v_line IN
    SELECT * FROM transaction_lines WHERE transaction_id = p_transaction_id
  LOOP
    INSERT INTO transaction_lines (
      workspace_id, transaction_id, account_id, amount,
      vat_code_id, cost_center_id, counterparty_id, memo
    ) VALUES (
      v_workspace_id,
      v_reversal_id,
      v_line.account_id,
      -v_line.amount,
      v_line.vat_code_id,
      v_line.cost_center_id,
      v_line.counterparty_id,
      'REVERSAL: ' || COALESCE(v_line.memo, '')
    );
  END LOOP;
  
  -- Mark original as reversed
  UPDATE transactions
  SET status = 'reversed', updated_at = now()
  WHERE id = p_transaction_id;
  
  -- Create audit event
  PERFORM create_audit_event(
    v_workspace_id,
    'transaction',
    p_transaction_id,
    'reversed',
    jsonb_build_object('reversal_id', v_reversal_id, 'reason', p_reason, 'reversed_by', p_user_id)
  );
  
  RETURN jsonb_build_object('success', true, 'reversal_id', v_reversal_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. POST TRIP
-- ============================================================================

CREATE OR REPLACE FUNCTION post_trip(
  p_trip_id uuid,
  p_user_id uuid,
  p_mode text DEFAULT 'consolidated'
) RETURNS jsonb AS $$
DECLARE
  v_workspace_id uuid;
  v_trip_status text;
  v_trip_name text;
  v_default_cost_center_id uuid;
  v_default_bank_account_id uuid;
  v_trip_clearing_account_id uuid;
  v_transaction_id uuid;
  v_expense record;
  v_net_amount numeric;
  v_vat_amount numeric;
  v_vat_rate numeric;
  v_missing_accounts int;
BEGIN
  -- Get trip details
  SELECT t.workspace_id, t.status, t.name, t.default_cost_center_id, ws.default_bank_account_id, ws.default_trip_clearing_account_id
  INTO v_workspace_id, v_trip_status, v_trip_name, v_default_cost_center_id, v_default_bank_account_id, v_trip_clearing_account_id
  FROM trips t
  JOIN workspace_settings ws ON t.workspace_id = ws.workspace_id
  WHERE t.id = p_trip_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trip not found');
  END IF;
  
  IF v_trip_status != 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trip already posted');
  END IF;
  
  -- Check all expenses have account_id
  SELECT COUNT(*) INTO v_missing_accounts
  FROM trip_expenses
  WHERE trip_id = p_trip_id AND account_id IS NULL;
  
  IF v_missing_accounts > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Some expenses missing account assignment', 'count', v_missing_accounts);
  END IF;
  
  -- Create consolidated transaction
  INSERT INTO transactions (
    workspace_id, txn_date, txn_type, description, status
  ) VALUES (
    v_workspace_id,
    CURRENT_DATE,
    'trip_batch',
    'Trip: ' || v_trip_name,
    'draft'
  ) RETURNING id INTO v_transaction_id;
  
  -- Process each expense
  FOR v_expense IN
    SELECT te.*, vc.rate as vat_rate
    FROM trip_expenses te
    LEFT JOIN vat_codes vc ON te.vat_code_id = vc.id
    WHERE te.trip_id = p_trip_id
  LOOP
    -- Calculate VAT
    v_vat_rate := COALESCE(v_expense.vat_rate, 0);
    IF v_vat_rate > 0 THEN
      v_net_amount := ROUND(v_expense.gross_amount / (1 + v_vat_rate), 2);
      v_vat_amount := v_expense.gross_amount - v_net_amount;
    ELSE
      v_net_amount := v_expense.gross_amount;
      v_vat_amount := 0;
    END IF;
    
    -- Debit expense account (net)
    INSERT INTO transaction_lines (
      workspace_id, transaction_id, account_id, amount,
      vat_code_id, cost_center_id, counterparty_id, memo
    ) VALUES (
      v_workspace_id,
      v_transaction_id,
      v_expense.account_id,
      v_net_amount,
      v_expense.vat_code_id,
      COALESCE(v_expense.cost_center_id, v_default_cost_center_id),
      v_expense.counterparty_id,
      v_expense.description
    );
    
    -- Debit VAT input if applicable
    IF v_vat_amount > 0 THEN
      INSERT INTO transaction_lines (
        workspace_id, transaction_id, account_id, amount,
        vat_code_id, cost_center_id, memo
      ) VALUES (
        v_workspace_id,
        v_transaction_id,
        (SELECT id FROM accounts WHERE workspace_id = v_workspace_id AND code = '2210' LIMIT 1),
        v_vat_amount,
        v_expense.vat_code_id,
        COALESCE(v_expense.cost_center_id, v_default_cost_center_id),
        'VAT Input: ' || v_expense.description
      );
    END IF;
  END LOOP;
  
  -- Credit trip clearing account or bank
  INSERT INTO transaction_lines (
    workspace_id, transaction_id, account_id, amount, memo
  ) VALUES (
    v_workspace_id,
    v_transaction_id,
    COALESCE(v_trip_clearing_account_id, v_default_bank_account_id),
    -(SELECT SUM(gross_amount) FROM trip_expenses WHERE trip_id = p_trip_id),
    'Trip reimbursement: ' || v_trip_name
  );
  
  -- Post the transaction
  PERFORM post_transaction(v_transaction_id, p_user_id);
  
  -- Update trip status
  UPDATE trips
  SET status = 'posted',
      posted_transaction_id = v_transaction_id,
      posted_at = now(),
      posted_by = p_user_id,
      updated_at = now()
  WHERE id = p_trip_id;
  
  -- Update trip expenses status
  UPDATE trip_expenses
  SET status = 'posted', updated_at = now()
  WHERE trip_id = p_trip_id;
  
  -- Create audit event
  PERFORM create_audit_event(
    v_workspace_id,
    'trip',
    p_trip_id,
    'posted',
    jsonb_build_object('transaction_id', v_transaction_id, 'posted_by', p_user_id)
  );
  
  RETURN jsonb_build_object('success', true, 'transaction_id', v_transaction_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. CREATE EXPENSE FROM BANK LINE
-- ============================================================================

CREATE OR REPLACE FUNCTION create_expense_from_bank_line(
  p_bank_transaction_id uuid,
  p_expense_account_id uuid,
  p_vat_code_id uuid,
  p_counterparty_id uuid DEFAULT NULL,
  p_cost_center_id uuid DEFAULT NULL,
  p_memo text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_workspace_id uuid;
  v_bank_account_id uuid;
  v_gl_account_id uuid;
  v_amount numeric;
  v_booked_date date;
  v_description text;
  v_status text;
  v_transaction_id uuid;
  v_vat_rate numeric;
  v_net_amount numeric;
  v_vat_amount numeric;
BEGIN
  -- Get bank transaction details
  SELECT bt.workspace_id, bt.bank_account_id, bt.amount, bt.booked_date, bt.description, bt.status, ba.account_id
  INTO v_workspace_id, v_bank_account_id, v_amount, v_booked_date, v_description, v_status, v_gl_account_id
  FROM bank_transactions bt
  JOIN bank_accounts ba ON bt.bank_account_id = ba.id
  WHERE bt.id = p_bank_transaction_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bank transaction not found');
  END IF;
  
  IF v_status != 'unreconciled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bank transaction already reconciled');
  END IF;
  
  IF v_amount > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot create expense from incoming payment');
  END IF;
  
  -- Get VAT rate
  SELECT rate INTO v_vat_rate FROM vat_codes WHERE id = p_vat_code_id;
  v_vat_rate := COALESCE(v_vat_rate, 0);
  
  -- Calculate VAT (amount is negative for expenses)
  IF v_vat_rate > 0 THEN
    v_net_amount := ROUND(ABS(v_amount) / (1 + v_vat_rate), 2);
    v_vat_amount := ABS(v_amount) - v_net_amount;
  ELSE
    v_net_amount := ABS(v_amount);
    v_vat_amount := 0;
  END IF;
  
  -- Create transaction
  INSERT INTO transactions (
    workspace_id, txn_date, txn_type, description, status
  ) VALUES (
    v_workspace_id,
    v_booked_date,
    'bank_match',
    COALESCE(p_memo, v_description, 'Bank expense'),
    'draft'
  ) RETURNING id INTO v_transaction_id;
  
  -- Debit expense account (net)
  INSERT INTO transaction_lines (
    workspace_id, transaction_id, account_id, amount,
    vat_code_id, cost_center_id, counterparty_id, memo
  ) VALUES (
    v_workspace_id,
    v_transaction_id,
    p_expense_account_id,
    v_net_amount,
    p_vat_code_id,
    p_cost_center_id,
    p_counterparty_id,
    COALESCE(p_memo, v_description)
  );
  
  -- Debit VAT input if applicable
  IF v_vat_amount > 0 THEN
    INSERT INTO transaction_lines (
      workspace_id, transaction_id, account_id, amount,
      vat_code_id, cost_center_id, memo
    ) VALUES (
      v_workspace_id,
      v_transaction_id,
      (SELECT id FROM accounts WHERE workspace_id = v_workspace_id AND code = '2210' LIMIT 1),
      v_vat_amount,
      p_vat_code_id,
      p_cost_center_id,
      'VAT Input'
    );
  END IF;
  
  -- Credit bank account
  INSERT INTO transaction_lines (
    workspace_id, transaction_id, account_id, amount, memo
  ) VALUES (
    v_workspace_id,
    v_transaction_id,
    v_gl_account_id,
    v_amount,
    'Bank payment'
  );
  
  -- Post transaction
  PERFORM post_transaction(v_transaction_id, auth.uid());
  
  -- Update bank transaction
  UPDATE bank_transactions
  SET status = 'matched',
      matched_transaction_id = v_transaction_id,
      updated_at = now()
  WHERE id = p_bank_transaction_id;
  
  RETURN jsonb_build_object('success', true, 'transaction_id', v_transaction_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. CREATE SALE FROM BANK LINE
-- ============================================================================

CREATE OR REPLACE FUNCTION create_sale_from_bank_line(
  p_bank_transaction_id uuid,
  p_revenue_account_id uuid,
  p_vat_code_id uuid,
  p_counterparty_id uuid DEFAULT NULL,
  p_cost_center_id uuid DEFAULT NULL,
  p_memo text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_workspace_id uuid;
  v_bank_account_id uuid;
  v_gl_account_id uuid;
  v_amount numeric;
  v_booked_date date;
  v_description text;
  v_status text;
  v_transaction_id uuid;
  v_vat_rate numeric;
  v_net_amount numeric;
  v_vat_amount numeric;
BEGIN
  -- Get bank transaction details
  SELECT bt.workspace_id, bt.bank_account_id, bt.amount, bt.booked_date, bt.description, bt.status, ba.account_id
  INTO v_workspace_id, v_bank_account_id, v_amount, v_booked_date, v_description, v_status, v_gl_account_id
  FROM bank_transactions bt
  JOIN bank_accounts ba ON bt.bank_account_id = ba.id
  WHERE bt.id = p_bank_transaction_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bank transaction not found');
  END IF;
  
  IF v_status != 'unreconciled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bank transaction already reconciled');
  END IF;
  
  IF v_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot create sale from outgoing payment');
  END IF;
  
  -- Get VAT rate
  SELECT rate INTO v_vat_rate FROM vat_codes WHERE id = p_vat_code_id;
  v_vat_rate := COALESCE(v_vat_rate, 0);
  
  -- Calculate VAT
  IF v_vat_rate > 0 THEN
    v_net_amount := ROUND(v_amount / (1 + v_vat_rate), 2);
    v_vat_amount := v_amount - v_net_amount;
  ELSE
    v_net_amount := v_amount;
    v_vat_amount := 0;
  END IF;
  
  -- Create transaction
  INSERT INTO transactions (
    workspace_id, txn_date, txn_type, description, status
  ) VALUES (
    v_workspace_id,
    v_booked_date,
    'bank_match',
    COALESCE(p_memo, v_description, 'Bank revenue'),
    'draft'
  ) RETURNING id INTO v_transaction_id;
  
  -- Debit bank account
  INSERT INTO transaction_lines (
    workspace_id, transaction_id, account_id, amount, memo
  ) VALUES (
    v_workspace_id,
    v_transaction_id,
    v_gl_account_id,
    v_amount,
    'Bank receipt'
  );
  
  -- Credit revenue account (net)
  INSERT INTO transaction_lines (
    workspace_id, transaction_id, account_id, amount,
    vat_code_id, cost_center_id, counterparty_id, memo
  ) VALUES (
    v_workspace_id,
    v_transaction_id,
    p_revenue_account_id,
    -v_net_amount,
    p_vat_code_id,
    p_cost_center_id,
    p_counterparty_id,
    COALESCE(p_memo, v_description)
  );
  
  -- Credit VAT output if applicable
  IF v_vat_amount > 0 THEN
    INSERT INTO transaction_lines (
      workspace_id, transaction_id, account_id, amount,
      vat_code_id, cost_center_id, memo
    ) VALUES (
      v_workspace_id,
      v_transaction_id,
      (SELECT id FROM accounts WHERE workspace_id = v_workspace_id AND code = '2200' LIMIT 1),
      -v_vat_amount,
      p_vat_code_id,
      p_cost_center_id,
      'VAT Output'
    );
  END IF;
  
  -- Post transaction
  PERFORM post_transaction(v_transaction_id, auth.uid());
  
  -- Update bank transaction
  UPDATE bank_transactions
  SET status = 'matched',
      matched_transaction_id = v_transaction_id,
      updated_at = now()
  WHERE id = p_bank_transaction_id;
  
  RETURN jsonb_build_object('success', true, 'transaction_id', v_transaction_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. SET BANK LINE STATUS
-- ============================================================================

CREATE OR REPLACE FUNCTION set_bank_line_status(
  p_bank_transaction_id uuid,
  p_status text,
  p_notes text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_workspace_id uuid;
  v_current_status text;
BEGIN
  SELECT workspace_id, status INTO v_workspace_id, v_current_status
  FROM bank_transactions
  WHERE id = p_bank_transaction_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bank transaction not found');
  END IF;
  
  IF v_current_status != 'unreconciled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bank transaction already processed');
  END IF;
  
  IF p_status NOT IN ('private', 'excluded') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid status');
  END IF;
  
  UPDATE bank_transactions
  SET status = p_status,
      notes = p_notes,
      updated_at = now()
  WHERE id = p_bank_transaction_id;
  
  PERFORM create_audit_event(
    v_workspace_id,
    'bank_transaction',
    p_bank_transaction_id,
    'status_changed',
    jsonb_build_object('new_status', p_status, 'notes', p_notes)
  );
  
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. PROFIT AND LOSS
-- ============================================================================

CREATE OR REPLACE FUNCTION profit_and_loss(
  p_workspace_id uuid,
  p_from_date date,
  p_to_date date
) RETURNS TABLE (
  account_type text,
  account_code text,
  account_name text,
  amount numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.account_type,
    a.code as account_code,
    a.name as account_name,
    SUM(tl.amount) as amount
  FROM transaction_lines tl
  JOIN accounts a ON tl.account_id = a.id
  JOIN transactions t ON tl.transaction_id = t.id
  WHERE tl.workspace_id = p_workspace_id
    AND t.status = 'posted'
    AND t.txn_date >= p_from_date
    AND t.txn_date <= p_to_date
    AND a.account_type IN ('revenue', 'expense')
  GROUP BY a.account_type, a.code, a.name
  ORDER BY a.account_type, a.code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 8. BALANCE SHEET
-- ============================================================================

CREATE OR REPLACE FUNCTION balance_sheet(
  p_workspace_id uuid,
  p_as_of_date date
) RETURNS TABLE (
  account_type text,
  account_code text,
  account_name text,
  amount numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.account_type,
    a.code as account_code,
    a.name as account_name,
    SUM(tl.amount) as amount
  FROM transaction_lines tl
  JOIN accounts a ON tl.account_id = a.id
  JOIN transactions t ON tl.transaction_id = t.id
  WHERE tl.workspace_id = p_workspace_id
    AND t.status = 'posted'
    AND t.txn_date <= p_as_of_date
    AND a.account_type IN ('asset', 'liability', 'equity')
  GROUP BY a.account_type, a.code, a.name
  ORDER BY a.account_type, a.code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 9. TRIAL BALANCE
-- ============================================================================

CREATE OR REPLACE FUNCTION trial_balance(
  p_workspace_id uuid,
  p_from_date date,
  p_to_date date
) RETURNS TABLE (
  account_code text,
  account_name text,
  account_type text,
  debit numeric,
  credit numeric,
  balance numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.code as account_code,
    a.name as account_name,
    a.account_type,
    SUM(CASE WHEN tl.amount > 0 THEN tl.amount ELSE 0 END) as debit,
    SUM(CASE WHEN tl.amount < 0 THEN ABS(tl.amount) ELSE 0 END) as credit,
    SUM(tl.amount) as balance
  FROM transaction_lines tl
  JOIN accounts a ON tl.account_id = a.id
  JOIN transactions t ON tl.transaction_id = t.id
  WHERE tl.workspace_id = p_workspace_id
    AND t.status = 'posted'
    AND t.txn_date >= p_from_date
    AND t.txn_date <= p_to_date
  GROUP BY a.code, a.name, a.account_type
  ORDER BY a.code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 10. VAT SUMMARY
-- ============================================================================

CREATE OR REPLACE FUNCTION vat_summary(
  p_workspace_id uuid,
  p_from_date date,
  p_to_date date
) RETURNS TABLE (
  vat_code text,
  vat_description text,
  vat_rate numeric,
  net_amount numeric,
  vat_amount numeric,
  gross_amount numeric
) AS $$
BEGIN
  RETURN QUERY
  WITH vat_lines AS (
    SELECT
      vc.code,
      vc.description,
      vc.rate,
      tl.amount,
      a.code as account_code
    FROM transaction_lines tl
    JOIN accounts a ON tl.account_id = a.id
    JOIN transactions t ON tl.transaction_id = t.id
    LEFT JOIN vat_codes vc ON tl.vat_code_id = vc.id
    WHERE tl.workspace_id = p_workspace_id
      AND t.status = 'posted'
      AND t.txn_date >= p_from_date
      AND t.txn_date <= p_to_date
      AND tl.vat_code_id IS NOT NULL
  )
  SELECT
    COALESCE(code, 'NONE') as vat_code,
    COALESCE(description, 'No VAT') as vat_description,
    COALESCE(rate, 0) as vat_rate,
    SUM(CASE WHEN account_code NOT IN ('2200', '2210') THEN amount ELSE 0 END) as net_amount,
    SUM(CASE WHEN account_code IN ('2200', '2210') THEN amount ELSE 0 END) as vat_amount,
    SUM(amount) as gross_amount
  FROM vat_lines
  GROUP BY code, description, rate
  ORDER BY code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
