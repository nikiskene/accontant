import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Transaction, TransactionLine, TaxYear } from '../lib/types';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Input } from '../components/Input';

type TxnLineWithAccount = TransactionLine & { account?: any };

function safeISO(d: any): string {
  if (!d) return '';
  // expect YYYY-MM-DD already; if not, try Date parsing
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dd = new Date(d);
  if (Number.isNaN(dd.getTime())) return '';
  return dd.toISOString().split('T')[0];
}

export function Transactions() {
  const { workspaceId, accounts, taxYears, selectedTaxYearId } = useApp() as any;

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [txnLines, setTxnLines] = useState<TxnLineWithAccount[]>([]);

  const [showReverseModal, setShowReverseModal] = useState(false);
  const [reverseReason, setReverseReason] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>('');

  const accountsById = useMemo(() => {
    const m = new Map<string, any>();
    (accounts || []).forEach((a: any) => {
      if (a?.id) m.set(a.id, a);
    });
    return m;
  }, [accounts]);

  const activeTaxYear: TaxYear | null = useMemo(() => {
    if (!taxYears || !taxYears.length) return null;
    if (selectedTaxYearId) {
      return taxYears.find((t: any) => t.id === selectedTaxYearId) || null;
    }
    // fallback: default
    return taxYears.find((t: any) => t.is_default) || taxYears[0] || null;
  }, [taxYears, selectedTaxYearId]);

  const taxFrom = useMemo(() => safeISO((activeTaxYear as any)?.starts_on || (activeTaxYear as any)?.start_date), [activeTaxYear]);
  const taxTo = useMemo(() => safeISO((activeTaxYear as any)?.ends_on || (activeTaxYear as any)?.end_date), [activeTaxYear]);

  useEffect(() => {
    if (workspaceId) void loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, selectedTaxYearId, taxFrom, taxTo]);

  const loadTransactions = async () => {
    try {
      setLoading(true);
      if (!workspaceId) return;

      let q = supabase
        .from('transactions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('txn_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);

      // Tax year filter (only if we can resolve the window)
      if (taxFrom) q = q.gte('txn_date', taxFrom);
      if (taxTo) q = q.lte('txn_date', taxTo);

      const { data, error } = await q;

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Error loading transactions:', error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  const loadTransactionDetails = async (txnId: string) => {
    try {
      const { data: txnData, error: txnErr } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', txnId)
        .single();

      if (txnErr) throw txnErr;

      const { data: linesData, error: linesErr } = await supabase
        .from('transaction_lines')
        .select('*')
        .eq('transaction_id', txnId)
        .order('line_no', { ascending: true });

      if (linesErr) throw linesErr;

      if (txnData) setSelectedTxn(txnData);

      const linesWithAccounts = (linesData || []).map((line: any) => ({
        ...line,
        account: accountsById.get(line.account_id),
      }));
      setTxnLines(linesWithAccounts);
    } catch (error) {
      console.error('Error loading transaction details:', error);
    }
  };

  const handleReverse = async () => {
    if (!selectedTxn || !reverseReason.trim()) return;

    try {
      const { data: user } = await supabase.auth.getUser();

      const { data: result, error } = await supabase.rpc('reverse_transaction', {
        p_transaction_id: selectedTxn.id,
        p_user_id: user.user?.id,
        p_reason: reverseReason,
      });

      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || 'Failed to reverse transaction');

      setShowReverseModal(false);
      setReverseReason('');
      setSelectedTxn(null);
      setTxnLines([]);
      await loadTransactions();
    } catch (error: any) {
      alert('Error reversing transaction: ' + (error?.message || String(error)));
    }
  };

  const openDeleteDraft = () => {
    setDeleteError('');
    setShowDeleteModal(true);
  };

  const handleDeleteDraft = async () => {
    if (!selectedTxn) return;
    if (selectedTxn.status !== 'draft') {
      setDeleteError('Only draft transactions can be deleted.');
      return;
    }

    setDeleting(true);
    setDeleteError('');

    try {
      // Safety: re-check status from DB right before delete
      const { data: fresh, error: freshErr } = await supabase
        .from('transactions')
        .select('id,status')
        .eq('id', selectedTxn.id)
        .single();

      if (freshErr) throw freshErr;
      if (fresh?.status !== 'draft') throw new Error('This transaction is no longer a draft.');

      // Delete lines first (FK)
      const { error: delLinesErr } = await supabase
        .from('transaction_lines')
        .delete()
        .eq('transaction_id', selectedTxn.id);

      if (delLinesErr) throw delLinesErr;

      // Delete transaction
      const { error: delTxnErr } = await supabase
        .from('transactions')
        .delete()
        .eq('id', selectedTxn.id)
        .eq('status', 'draft');

      if (delTxnErr) throw delTxnErr;

      setShowDeleteModal(false);
      setSelectedTxn(null);
      setTxnLines([]);
      await loadTransactions();
    } catch (e: any) {
      console.error(e);
      setDeleteError(e?.message || 'Failed to delete draft.');
    } finally {
      setDeleting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      draft: 'bg-yellow-100 text-yellow-800',
      posted: 'bg-green-100 text-green-800',
      reversed: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded ${styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'}`}>
        {String(status || '').toUpperCase()}
      </span>
    );
  };

  if (loading) {
    return <div className="text-center py-12">Loading transactions...</div>;
  }

  const periodLabel =
    (activeTaxYear as any)?.label ||
    (activeTaxYear as any)?.name ||
    (taxFrom && taxTo ? `${taxFrom} → ${taxTo}` : 'All Dates');

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Transactions</h1>
            <p className="text-gray-600 mt-1">View and manage transactions</p>
          </div>
          <div className="text-sm text-gray-600">{periodLabel}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>

          <tbody className="bg-white divide-y divide-gray-200">
            {transactions.map((txn) => (
              <tr key={txn.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {txn.txn_date ? new Date(txn.txn_date).toLocaleDateString() : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{(txn as any).txn_type}</td>
                <td className="px-6 py-4 text-sm text-gray-900">{txn.description || '-'}</td>
                <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge((txn as any).status)}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      loadTransactionDetails(txn.id);
                    }}
                  >
                    View
                  </Button>
                </td>
              </tr>
            ))}

            {transactions.length === 0 && (
              <tr>
                <td className="px-6 py-8 text-sm text-gray-500" colSpan={5}>
                  No transactions for this tax year.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={!!selectedTxn}
        onClose={() => {
          setSelectedTxn(null);
          setTxnLines([]);
        }}
        title="Transaction Details"
        size="xl"
      >
        {selectedTxn && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-600">Date</p>
                <p className="text-base text-gray-900">
                  {selectedTxn.txn_date ? new Date(selectedTxn.txn_date).toLocaleDateString() : '-'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Type</p>
                <p className="text-base text-gray-900">{(selectedTxn as any).txn_type}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Status</p>
                <p className="text-base">{getStatusBadge((selectedTxn as any).status)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Description</p>
                <p className="text-base text-gray-900">{selectedTxn.description || '-'}</p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2">Lines</h3>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Account</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Debit</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Credit</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {txnLines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-4 py-2 text-sm">
                        {line.account?.code} - {line.account?.name}
                      </td>
                      <td className="px-4 py-2 text-sm text-right">
                        {(line as any).amount > 0 ? (line as any).amount.toFixed(2) : '-'}
                      </td>
                      <td className="px-4 py-2 text-sm text-right">
                        {(line as any).amount < 0 ? Math.abs((line as any).amount).toFixed(2) : '-'}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">{(line as any).memo || '-'}</td>
                    </tr>
                  ))}
                  {txnLines.length === 0 && (
                    <tr>
                      <td className="px-4 py-6 text-sm text-gray-500" colSpan={4}>
                        No lines found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="pt-4 border-t flex gap-3">
              {(selectedTxn as any).status === 'posted' && (
                <Button variant="danger" onClick={() => setShowReverseModal(true)}>
                  Reverse Transaction
                </Button>
              )}

              {(selectedTxn as any).status === 'draft' && (
                <Button variant="danger" onClick={openDeleteDraft}>
                  Delete Draft
                </Button>
              )}

              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedTxn(null);
                  setTxnLines([]);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={showReverseModal} onClose={() => setShowReverseModal(false)} title="Reverse Transaction">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This will create a reversal entry. You can then post a corrected transaction.
          </p>
          <Input
            label="Reason for Reversal"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="Explain why this transaction is being reversed"
            required
          />
          <div className="flex gap-3">
            <Button variant="danger" onClick={handleReverse} disabled={!reverseReason.trim()}>
              Confirm Reversal
            </Button>
            <Button variant="secondary" onClick={() => setShowReverseModal(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete Draft">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This will permanently delete the draft transaction and its lines. Posted transactions cannot be deleted.
          </p>

          {deleteError && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
              {deleteError}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="danger" onClick={handleDeleteDraft} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete Draft'}
            </Button>
            <Button variant="secondary" onClick={() => setShowDeleteModal(false)} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}