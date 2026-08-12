import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { supabase } from '../../lib/supabase';
import { BankTransaction } from '../../lib/types';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';

import { getDefaultTaxYearId, getWorkspaceSettings, setBankTxnStatus, upsertCounterparty } from './bankInboxApi';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  bankTxn: BankTransaction | null;
  workspaceId: string | null;
  onChanged: () => Promise<void> | void;
};

type AccountRow = { id: string; code: string; name: string; type: string };

export function ReconcileModal({ isOpen, onClose, bankTxn, workspaceId, onChanged }: Props) {
  const { accounts } = useApp();
  const [posting, setPosting] = useState(false);
  const [memo, setMemo] = useState('');
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [status, setStatus] = useState<'posted' | 'draft'>('posted');

  const expenseAccounts = useMemo(() => {
    return (accounts || []).filter((a: any) => a.type === 'expense') as AccountRow[];
  }, [accounts]);

  useEffect(() => {
    if (!bankTxn) return;
    setMemo(bankTxn.description || (bankTxn as any).reference || '');
  }, [bankTxn]);

  useEffect(() => {
    const init = async () => {
      if (!workspaceId) return;
      if (expenseAccountId) return;
      try {
        const ws = await getWorkspaceSettings(workspaceId);
        if (ws.default_expense_account_id) setExpenseAccountId(ws.default_expense_account_id);
        else if (expenseAccounts.length) setExpenseAccountId(expenseAccounts[0].id);
      } catch {
        if (expenseAccounts.length) setExpenseAccountId(expenseAccounts[0].id);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, expenseAccounts]);

  const postToLedger = async () => {
    if (!workspaceId || !bankTxn) return;
    if (!expenseAccountId) {
      alert('Select an expense account.');
      return;
    }

    try {
      setPosting(true);

      const taxYearId = await getDefaultTaxYearId(workspaceId);
      const ws = await getWorkspaceSettings(workspaceId);
      if (!ws.default_bank_account_id) throw new Error('workspace_settings.default_bank_account_id is not set.');

      const counterpartyId = await upsertCounterparty(workspaceId, (bankTxn as any).counterparty ?? null);

      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id ?? null;

      const header = {
        workspace_id: workspaceId,
        batch_id: null,
        txn_date: bankTxn.booked_date,
        txn_type: 'bank',
        description: memo || bankTxn.description || (bankTxn as any).reference || null,
        counterparty_id: counterpartyId,
        invoice_number: null,
        currency: (bankTxn as any).currency,
        status,
        posted_at: status === 'posted' ? new Date().toISOString() : null,
        posted_by: status === 'posted' ? userId : null,
        created_at: new Date().toISOString(),
        bank_transaction_id: bankTxn.id,
        tax_year_id: taxYearId,
      };

      const { data: txn, error: txnErr } = await supabase
        .from('transactions')
        .insert([header])
        .select('id')
        .single();

      if (txnErr) throw txnErr;

      const amount = Number(bankTxn.amount);

      // line.amount convention: >0 = Debit, <0 = Credit in your UI
      const expenseLineAmount = amount < 0 ? Math.abs(amount) : -Math.abs(amount);
      const bankLineAmount = -expenseLineAmount;

      const lines = [
        {
          workspace_id: workspaceId,
          transaction_id: txn.id,
          line_no: 1,
          account_id: expenseAccountId,
          cost_center_id: ws.default_cost_center_id,
          trip_id: null,
          vat_code_id: ws.default_vat_code_id,
          net_amount: expenseLineAmount,
          vat_amount: 0,
          amount: expenseLineAmount,
          memo: memo || null,
          tax_year_id: taxYearId,
        },
        {
          workspace_id: workspaceId,
          transaction_id: txn.id,
          line_no: 2,
          account_id: ws.default_bank_account_id,
          cost_center_id: null,
          trip_id: null,
          vat_code_id: null,
          net_amount: bankLineAmount,
          vat_amount: 0,
          amount: bankLineAmount,
          memo: (bankTxn as any).reference || null,
          tax_year_id: taxYearId,
        },
      ];

      const { error: linesErr } = await supabase.from('transaction_lines').insert(lines);
      if (linesErr) throw linesErr;

      const { error: updErr } = await supabase
        .from('bank_transactions')
        .update({ status: 'matched', matched_amount: Math.abs(amount) })
        .eq('id', bankTxn.id)
        .eq('workspace_id', workspaceId);

      if (updErr) throw updErr;

      alert('Posted.');
      await onChanged();
    } catch (e: any) {
      console.error(e);
      alert('Posting failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setPosting(false);
    }
  };

  const mark = async (s: 'private' | 'excluded') => {
    if (!workspaceId || !bankTxn) return;
    try {
      setPosting(true);
      await setBankTxnStatus(workspaceId, bankTxn.id, s);
      await onChanged();
    } catch (e: any) {
      console.error(e);
      alert('Update failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reconcile bank transaction" size="xl">
      {bankTxn && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-gray-600">Date</div>
              <div className="text-gray-900">{new Date(bankTxn.booked_date).toLocaleDateString()}</div>
            </div>
            <div>
              <div className="text-gray-600">Amount</div>
              <div className="text-gray-900 font-medium">
                {bankTxn.amount.toFixed(2)} {(bankTxn as any).currency}
              </div>
            </div>
            <div>
              <div className="text-gray-600">Counterparty</div>
              <div className="text-gray-900">{(bankTxn as any).counterparty || '-'}</div>
            </div>
          </div>

          <Input label="Memo / Description" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What is this payment for?" />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Expense account</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}>
              <option value="">Select expense account...</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Posting status</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="posted">Posted (shows in P&L)</option>
              <option value="draft">Draft</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-3 pt-2 border-t">
            <Button onClick={postToLedger} disabled={posting || !expenseAccountId}>
              {posting ? 'Posting...' : 'Post to ledger'}
            </Button>

            <Button variant="secondary" onClick={() => mark('private')} disabled={posting}>
              Mark Private
            </Button>

            <Button variant="secondary" onClick={() => mark('excluded')} disabled={posting}>
              Exclude
            </Button>

            <div className="ml-auto">
              <Button variant="secondary" onClick={onClose} disabled={posting}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}