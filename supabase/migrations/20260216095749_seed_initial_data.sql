/*
  # Seed Initial Data for IACy Tax Ledger

  ## Purpose
  Creates the initial workspace, accounts, VAT codes, cost centers,
  and workspace settings for the IACy demo workspace.

  ## Workspace
  - ID: fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9
  - Legal Name: IACy Demo Company
  - VAT TRN: 123456789012345

  ## Chart of Accounts
  Standard UAE accounts:
  - 1000: Bank Account (Asset)
  - 2100: Accounts Payable (Liability)
  - 2200: VAT Output (Liability)
  - 2210: VAT Input (Asset)
  - 4000: Domestic Revenue (Revenue)
  - 4010: Foreign Revenue (Revenue)
  - 6200: General Expenses (Expense)

  ## VAT Codes
  - SR5: Standard Rate 5%
  - ZR0: Zero Rated 0%
  - EX: Exempt 0%
  - OOS: Out of Scope 0%

  ## Cost Centers
  - GEN: General

  ## Note
  Workspace member will be created when user signs up.
  The seed uses a fixed workspace ID for development.
*/

-- ============================================================================
-- WORKSPACE
-- ============================================================================

INSERT INTO workspaces (id, legal_name, trade_name, vat_trn, ct_trn, base_currency, country)
VALUES (
  'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9',
  'IACy Demo Company',
  'IACy Tax Ledger',
  '123456789012345',
  'CT987654321',
  'AED',
  'AE'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- ACCOUNTS
-- ============================================================================

INSERT INTO accounts (workspace_id, code, name, account_type, is_active) VALUES
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', '1000', 'Bank Account', 'asset', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', '2100', 'Accounts Payable', 'liability', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', '2200', 'VAT Output', 'liability', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', '2210', 'VAT Input', 'asset', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', '3000', 'Capital', 'equity', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', '4000', 'Domestic Revenue', 'revenue', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', '4010', 'Foreign Revenue', 'revenue', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', '6200', 'General Expenses', 'expense', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', '6210', 'Travel Expenses', 'expense', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', '6220', 'Office Expenses', 'expense', true)
ON CONFLICT (workspace_id, code) DO NOTHING;

-- ============================================================================
-- VAT CODES
-- ============================================================================

INSERT INTO vat_codes (workspace_id, code, description, rate) VALUES
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', 'SR5', 'Standard Rate 5%', 0.05),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', 'ZR0', 'Zero Rated', 0),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', 'EX', 'Exempt', 0),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', 'OOS', 'Out of Scope', 0)
ON CONFLICT (workspace_id, code) DO NOTHING;

-- ============================================================================
-- COST CENTERS
-- ============================================================================

INSERT INTO cost_centers (workspace_id, code, name, is_active) VALUES
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', 'GEN', 'General', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', 'OPS', 'Operations', true),
  ('fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9', 'MKT', 'Marketing', true)
ON CONFLICT (workspace_id, code) DO NOTHING;

-- ============================================================================
-- WORKSPACE SETTINGS
-- ============================================================================

INSERT INTO workspace_settings (
  workspace_id,
  default_bank_account_id,
  default_cost_center_id,
  default_vat_code_id,
  default_revenue_account_id,
  default_expense_account_id
)
SELECT
  'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9',
  (SELECT id FROM accounts WHERE workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9' AND code = '1000' LIMIT 1),
  (SELECT id FROM cost_centers WHERE workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9' AND code = 'GEN' LIMIT 1),
  (SELECT id FROM vat_codes WHERE workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9' AND code = 'SR5' LIMIT 1),
  (SELECT id FROM accounts WHERE workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9' AND code = '4000' LIMIT 1),
  (SELECT id FROM accounts WHERE workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9' AND code = '6200' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_settings WHERE workspace_id = 'fb3a9c15-a7b2-4c57-b7d5-24e6d104eca9'
);
