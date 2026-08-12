import { supabase } from '../../lib/supabase';
import { BankTransaction } from '../../lib/types';

export type BankAccountRow = { id: string; name?: string | null };
export type TabKey = 'unreconciled' | 'matched' | 'private' | 'excluded';

export async function loadBankAccounts(workspaceId: string): Promise<BankAccountRow[]> {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('id,name')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as BankAccountRow[];
}

export async function loadBankTransactions(workspaceId: string, status: TabKey): Promise<BankTransaction[]> {
  const { data, error } = await supabase
    .from('bank_transactions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', status)
    .order('booked_date', { ascending: false })
    .limit(1000);

  if (error) throw error;
  return (data || []) as BankTransaction[];
}

export async function getDefaultTaxYearId(workspaceId: string): Promise<string> {
  const { data, error } = await supabase
    .from('tax_years')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('is_default', true)
    .single();

  if (error || !data?.id) throw new Error(`No default tax year set for workspace ${workspaceId}`);
  return data.id;
}

export async function getWorkspaceSettings(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_settings')
    .select('default_bank_account_id,default_expense_account_id,default_vat_code_id,default_cost_center_id')
    .eq('workspace_id', workspaceId)
    .single();

  if (error) throw error;
  return data as {
    default_bank_account_id: string | null;
    default_expense_account_id: string | null;
    default_vat_code_id: string | null;
    default_cost_center_id: string | null;
  };
}

export async function upsertCounterparty(workspaceId: string, nameOrNull: string | null): Promise<string | null> {
  const name = (nameOrNull || '').trim();
  if (!name) return null;

  const alias_lc = name.toLowerCase();

  const { data: found } = await supabase
    .from('counterparties')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('alias_lc', alias_lc)
    .limit(1);

  if (found && found.length > 0) return found[0].id;

  const { data: ins, error } = await supabase
    .from('counterparties')
    .insert([{ workspace_id: workspaceId, name, alias_lc }])
    .select('id')
    .single();

  if (error) throw error;
  return ins.id as string;
}

export async function setBankTxnStatus(workspaceId: string, bankTxnId: string, status: 'private' | 'excluded') {
  const { error } = await supabase
    .from('bank_transactions')
    .update({ status })
    .eq('id', bankTxnId)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
}