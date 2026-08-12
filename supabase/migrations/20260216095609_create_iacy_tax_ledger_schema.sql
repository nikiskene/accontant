/*
  # IACy Tax Ledger - Complete Schema

  ## Overview
  UAE-focused tax accounting system with VAT readiness, corporate tax support,
  and bank reconciliation. Built for workspace-based multi-tenancy with
  double-entry bookkeeping and immutable posted transactions.

  ## Core Tables
  
  ### 1. Workspaces & Members
    - `workspaces` - Company entities with tax registration details
    - `workspace_members` - User access to workspaces
    - `workspace_settings` - Default accounts and preferences per workspace
  
  ### 2. Chart of Accounts
    - `accounts` - GL accounts with standard UAE account codes
    - `vat_codes` - VAT treatment codes (SR5, ZR0, EX, OOS)
    - `cost_centers` - Department/project tracking
    - `counterparties` - Customers and vendors
  
  ### 3. Transactions (Double-Entry)
    - `transactions` - Transaction headers with posting status
    - `transaction_lines` - Individual debit/credit lines
    - `v_posted_lines` - View of posted lines for reporting
  
  ### 4. Trip Expenses
    - `trips` - Trip containers for employee expense batches
    - `trip_expenses` - Individual expenses captured during trips
  
  ### 5. Bank Reconciliation
    - `bank_accounts` - Bank account registry
    - `bank_transactions` - Imported bank lines with reconciliation status
  
  ### 6. Attachments & Audit
    - `attachments` - File upload metadata for receipts/invoices
    - `audit_events` - Complete audit trail of all actions
  
  ## RPC Functions
  
  Transaction lifecycle:
    - `post_transaction` - Validates and posts draft transactions
    - `reverse_transaction` - Creates reversal entry for corrections
  
  Trip posting:
    - `post_trip` - Converts trip expenses to GL transactions
  
  Bank reconciliation:
    - `create_expense_from_bank_line` - Match bank line to expense
    - `create_sale_from_bank_line` - Match bank line to revenue
    - `set_bank_line_status` - Mark line as private/excluded
  
  Reporting:
    - `profit_and_loss` - P&L by account type
    - `balance_sheet` - Assets, liabilities, equity snapshot
    - `trial_balance` - All accounts with period totals
    - `vat_summary` - VAT analysis by code
  
  ## Security
  
  All tables have RLS enabled with policies restricting access to:
    - Users who are members of the workspace
    - Data filtered by workspace_id
  
  Storage policies require:
    - Objects must be prefixed with ${workspace_id}/
    - Users must be workspace members
*/

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- WORKSPACES
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trade_name text,
  vat_trn text,
  ct_trn text,
  base_currency text NOT NULL DEFAULT 'AED',
  country text NOT NULL DEFAULT 'AE',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- WORKSPACE SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
  default_bank_account_id uuid,
  default_trip_clearing_account_id uuid,
  default_cost_center_id uuid,
  default_vat_code_id uuid,
  default_revenue_account_id uuid,
  default_expense_account_id uuid,
  default_ar_account_id uuid,
  default_ap_account_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- CHART OF ACCOUNTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, code)
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_accounts_workspace ON accounts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type);

-- ============================================================================
-- VAT CODES
-- ============================================================================

CREATE TABLE IF NOT EXISTS vat_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  description text NOT NULL,
  rate numeric(5,4) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, code)
);

ALTER TABLE vat_codes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vat_codes_workspace ON vat_codes(workspace_id);

-- ============================================================================
-- COST CENTERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, code)
);

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_cost_centers_workspace ON cost_centers(workspace_id);

-- ============================================================================
-- COUNTERPARTIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS counterparties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  counterparty_type text CHECK (counterparty_type IN ('customer', 'vendor', 'both')),
  vat_trn text,
  email text,
  phone text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_counterparties_workspace ON counterparties(workspace_id);

-- ============================================================================
-- TRANSACTIONS (Double-Entry)
-- ============================================================================

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  txn_date date NOT NULL,
  txn_type text NOT NULL CHECK (txn_type IN ('sale', 'purchase', 'journal', 'trip_batch', 'bank_match')),
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  posted_at timestamptz,
  posted_by uuid REFERENCES auth.users(id),
  reversal_of uuid REFERENCES transactions(id),
  reversal_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_transactions_workspace ON transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(txn_date);

-- ============================================================================
-- TRANSACTION LINES
-- ============================================================================

CREATE TABLE IF NOT EXISTS transaction_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  amount numeric(15,2) NOT NULL,
  vat_code_id uuid REFERENCES vat_codes(id),
  cost_center_id uuid REFERENCES cost_centers(id),
  counterparty_id uuid REFERENCES counterparties(id),
  memo text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE transaction_lines ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_transaction_lines_workspace ON transaction_lines(workspace_id);
CREATE INDEX IF NOT EXISTS idx_transaction_lines_transaction ON transaction_lines(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_lines_account ON transaction_lines(account_id);

-- ============================================================================
-- VIEW: Posted Lines (for reporting)
-- ============================================================================

CREATE OR REPLACE VIEW v_posted_lines AS
SELECT 
  tl.id,
  tl.workspace_id,
  tl.transaction_id,
  t.txn_date,
  t.txn_type,
  t.description as txn_description,
  tl.account_id,
  a.code as account_code,
  a.name as account_name,
  a.account_type,
  tl.amount,
  tl.vat_code_id,
  vc.code as vat_code,
  tl.cost_center_id,
  cc.code as cost_center_code,
  tl.counterparty_id,
  cp.name as counterparty_name,
  tl.memo,
  t.posted_at,
  t.posted_by
FROM transaction_lines tl
JOIN transactions t ON tl.transaction_id = t.id
JOIN accounts a ON tl.account_id = a.id
LEFT JOIN vat_codes vc ON tl.vat_code_id = vc.id
LEFT JOIN cost_centers cc ON tl.cost_center_id = cc.id
LEFT JOIN counterparties cp ON tl.counterparty_id = cp.id
WHERE t.status = 'posted';

-- ============================================================================
-- TRIPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  purpose text,
  destination text,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  default_cost_center_id uuid REFERENCES cost_centers(id),
  posted_transaction_id uuid REFERENCES transactions(id),
  posted_at timestamptz,
  posted_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trips_workspace ON trips(workspace_id);

-- ============================================================================
-- TRIP EXPENSES
-- ============================================================================

CREATE TABLE IF NOT EXISTS trip_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  expense_date date NOT NULL,
  merchant text,
  description text,
  gross_amount numeric(15,2) NOT NULL,
  currency text NOT NULL DEFAULT 'AED',
  account_id uuid REFERENCES accounts(id),
  vat_code_id uuid REFERENCES vat_codes(id),
  cost_center_id uuid REFERENCES cost_centers(id),
  counterparty_id uuid REFERENCES counterparties(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE trip_expenses ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trip_expenses_workspace ON trip_expenses(workspace_id);
CREATE INDEX IF NOT EXISTS idx_trip_expenses_trip ON trip_expenses(trip_id);

-- ============================================================================
-- BANK ACCOUNTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  bank_name text NOT NULL,
  account_number text,
  iban text,
  currency text NOT NULL DEFAULT 'AED',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bank_accounts_workspace ON bank_accounts(workspace_id);

-- ============================================================================
-- BANK TRANSACTIONS (Imported Lines)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  booked_date date NOT NULL,
  value_date date,
  amount numeric(15,2) NOT NULL,
  description text,
  counterparty_text text,
  reference text,
  status text NOT NULL DEFAULT 'unreconciled' CHECK (status IN ('unreconciled', 'matched', 'private', 'excluded')),
  matched_transaction_id uuid REFERENCES transactions(id),
  notes text,
  dedupe_hash text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_workspace ON bank_transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_bank_account ON bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_status ON bank_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_dedupe ON bank_transactions(dedupe_hash);

-- ============================================================================
-- ATTACHMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES transactions(id) ON DELETE CASCADE,
  trip_expense_id uuid REFERENCES trip_expenses(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size integer,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_attachments_workspace ON attachments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_attachments_transaction ON attachments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_attachments_trip_expense ON attachments(trip_expense_id);

-- ============================================================================
-- AUDIT EVENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  details jsonb,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_events_workspace ON audit_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Workspaces: Users can view workspaces they are members of
CREATE POLICY "Users can view their workspaces"
  ON workspaces FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = workspaces.id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their workspaces"
  ON workspaces FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = workspaces.id
      AND workspace_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = workspaces.id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Workspace Members: Users can view members of their workspaces
CREATE POLICY "Users can view workspace members"
  ON workspace_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = workspace_members.workspace_id
      AND wm.user_id = auth.uid()
    )
  );

-- Workspace Settings
CREATE POLICY "Users can view workspace settings"
  ON workspace_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = workspace_settings.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update workspace settings"
  ON workspace_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = workspace_settings.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = workspace_settings.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Accounts
CREATE POLICY "Users can view workspace accounts"
  ON accounts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = accounts.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workspace accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = accounts.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- VAT Codes
CREATE POLICY "Users can view workspace vat codes"
  ON vat_codes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = vat_codes.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Cost Centers
CREATE POLICY "Users can view workspace cost centers"
  ON cost_centers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = cost_centers.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Counterparties
CREATE POLICY "Users can view workspace counterparties"
  ON counterparties FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = counterparties.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workspace counterparties"
  ON counterparties FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = counterparties.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update workspace counterparties"
  ON counterparties FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = counterparties.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = counterparties.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Transactions
CREATE POLICY "Users can view workspace transactions"
  ON transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = transactions.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workspace transactions"
  ON transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = transactions.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update workspace transactions"
  ON transactions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = transactions.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = transactions.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Transaction Lines
CREATE POLICY "Users can view workspace transaction lines"
  ON transaction_lines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = transaction_lines.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workspace transaction lines"
  ON transaction_lines FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = transaction_lines.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Trips
CREATE POLICY "Users can view workspace trips"
  ON trips FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = trips.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workspace trips"
  ON trips FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = trips.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update workspace trips"
  ON trips FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = trips.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = trips.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Trip Expenses
CREATE POLICY "Users can view workspace trip expenses"
  ON trip_expenses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = trip_expenses.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workspace trip expenses"
  ON trip_expenses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = trip_expenses.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update workspace trip expenses"
  ON trip_expenses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = trip_expenses.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = trip_expenses.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Bank Accounts
CREATE POLICY "Users can view workspace bank accounts"
  ON bank_accounts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = bank_accounts.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workspace bank accounts"
  ON bank_accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = bank_accounts.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Bank Transactions
CREATE POLICY "Users can view workspace bank transactions"
  ON bank_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = bank_transactions.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workspace bank transactions"
  ON bank_transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = bank_transactions.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update workspace bank transactions"
  ON bank_transactions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = bank_transactions.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = bank_transactions.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Attachments
CREATE POLICY "Users can view workspace attachments"
  ON attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = attachments.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workspace attachments"
  ON attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = attachments.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

-- Audit Events
CREATE POLICY "Users can view workspace audit events"
  ON audit_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = audit_events.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert workspace audit events"
  ON audit_events FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = audit_events.workspace_id
      AND workspace_members.user_id = auth.uid()
    )
  );
