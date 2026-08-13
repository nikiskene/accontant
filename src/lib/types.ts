export interface Workspace {
  id: string;
  legal_name: string;
  trade_name: string | null;
  vat_trn: string | null;
  ct_trn: string | null;
  base_currency: string;
  country: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceSettings {
  id: string;
  workspace_id: string;
  default_bank_account_id: string | null;
  default_trip_clearing_account_id: string | null;
  default_cost_center_id: string | null;
  default_vat_code_id: string | null;
  default_revenue_account_id: string | null;
  default_expense_account_id: string | null;
  default_ar_account_id: string | null;
  default_ap_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'cogs' | 'expense';
  parent_id?: string | null;
  is_active: boolean;
}

export interface VatCode {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  vat_rate: number;
  category: 'standard' | 'zero' | 'exempt' | 'out_of_scope';
  applies_to: 'sales' | 'purchases' | 'both';
  is_default: boolean;
}

export interface CostCenter {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Counterparty {
  id: string;
  workspace_id: string;
  name: string;
  kind: 'customer' | 'vendor' | 'both' | 'other' | null;
  company_name?: string | null;
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  email_lc?: string | null;
  open_balance?: number | null;
  default_payment_terms?: string | null;
  vat_trn: string | null;
  default_vat_code_id?: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  workspace_id: string;
  batch_id?: string | null;
  txn_date: string;
  txn_type: 'sale' | 'purchase' | 'journal';
  description: string | null;
  counterparty_id?: string | null;
  invoice_number?: string | null;
  currency: string;
  status: 'draft' | 'posted' | 'void';
  posted_at: string | null;
  posted_by: string | null;
  tax_year_id?: string | null;
  bank_transaction_id?: string | null;
  created_at: string;
}

export interface TransactionLine {
  id: string;
  workspace_id: string;
  transaction_id: string;
  line_no: number;
  account_id: string;
  cost_center_id?: string | null;
  trip_id?: string | null;
  vat_code_id?: string | null;
  net_amount: number;
  vat_amount: number;
  amount: number;
  memo?: string | null;
  tax_year_id?: string | null;
}

export interface Trip {
  id: string;
  workspace_id: string;
  name: string;
  purpose: string | null;
  destination: string | null;
  start_date: string;
  end_date: string;
  default_cost_center_id: string | null;
  status: 'draft' | 'reviewed' | 'posted' | 'locked';
  posted_batch_id: string | null;
  created_at: string;
}

export interface TripExpense {
  id: string;
  workspace_id: string;
  trip_id: string;
  expense_date: string;
  merchant: string | null;
  description: string | null;
  gross_amount: number;
  currency: string;
  vat_code_id: string | null;
  account_id: string | null;
  counterparty_id: string | null;
  cost_center_id: string | null;
  status: 'draft' | 'reviewed' | 'posted';
  created_at: string;
}

export interface BankAccount {
  id: string;
  workspace_id: string;
  name: string;
  bank_name: string | null;
  currency: string;
  last4: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BankTransaction {
  id: string;
  workspace_id: string;
  bank_account_id: string;
  bank_import_id?: string | null;
  booked_date: string;
  value_date: string | null;
  amount: number;
  currency: string;
  description: string | null;
  counterparty: string | null;
  reference: string | null;
  external_id?: string | null;
  hash?: string | null;
  status: 'unreconciled' | 'matched' | 'excluded' | 'private' | 'split';
  suggested_account_id?: string | null;
  suggested_vat_code_id?: string | null;
  suggested_counterparty_id?: string | null;
  notes: string | null;
  matched_amount?: number | null;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  details: any;
  created_at: string;
  created_by: string | null;
}

export interface TaxYear {
  id: string;
  workspace_id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: string;
  is_default: boolean;
  created_at: string;
}

export interface ReportFiling {
  id: string;
  workspace_id: string;
  tax_year_id: string;
  report_type: string;
  filed_on: string;
  filed_at: string;
  filed_by?: string | null;
  created_at: string;
}

export interface FilingsDashboard {
  filing_id: string;
  workspace_id: string;
  tax_year_id: string;
  report_type: string;
  filed_on: string;
  revenue_aed: number;
  expenses_aed: number;
  net_income_aed: number;
  total_assets_aed: number;
  total_vat_aed: number;
}

export interface ProductService {
  id: string;
  workspace_id: string;
  item_type: 'product' | 'service';
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  unit_price: number;
  currency: string;
  revenue_account_id: string | null;
  cogs_account_id: string | null;
  vat_code_id: string | null;
  is_active: boolean;
}

export interface SalesDocument {
  id: string;
  workspace_id: string;
  document_type: 'quote' | 'invoice' | 'credit_note';
  document_number: string | null;
  customer_id: string;
  issue_date: string;
  valid_until: string | null;
  due_date: string | null;
  currency: string;
  status: string;
  total: number;
  amount_paid: number;
  customer?: Pick<Counterparty, 'id' | 'name' | 'company_name'> | null;
}
