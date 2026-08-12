import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { supabase } from '../../lib/supabase';
import { BankTransaction } from '../../lib/types';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';

import { ImportModal } from './ImportModal';
import { ReconcileModal } from './ReconcileModal';
import { loadBankAccounts, loadBankTransactions } from './bankInboxApi';

type BankAccountRow = { id: string; name?: string | null };
type TabKey = 'unreconciled' | 'matched' | 'private' | 'excluded';

export function BankInbox() {
  const { workspaceId } = useApp();

  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('unreconciled');

  const [showImport, setShowImport] = useState(false);
  const [selectedBt, setSelectedBt] = useState<BankTransaction | null>(null);

  const tabs = useMemo(
    () =>
      [
        { key: 'unreconciled', label: 'Unreconciled' },
        { key: 'matched', label: 'Matched' },
        { key: 'private', label: 'Private' },
        { key: 'excluded', label: 'Excluded' },
      ] as const,
    []
  );

  const refresh = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [txns, bas] = await Promise.all([
        loadBankTransactions(workspaceId, activeTab),
        loadBankAccounts(workspaceId),
      ]);
      setBankTransactions(txns);
      setBankAccounts(bas);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (workspaceId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, activeTab]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Bank Inbox</h1>
          <p className="text-gray-600 mt-1">Reconcile imported bank transactions</p>
        </div>
        <Button onClick={() => setShowImport(true)}>Import CSV</Button>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-12">Loading...</div>
          ) : bankTransactions.length === 0 ? (
            <div className="text-center py-12 text-gray-600">No {activeTab} transactions</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Currency</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Counterparty</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {bankTransactions.map((txn) => (
                  <tr
                    key={txn.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelectedBt(txn)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {new Date(txn.booked_date).toLocaleDateString()}
                    </td>
                    <td
                      className={`px-4 py-3 whitespace-nowrap text-sm text-right font-medium ${
                        txn.amount >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {txn.amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                      {(txn as any).currency || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{txn.description || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{(txn as any).counterparty || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ImportModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        workspaceId={workspaceId}
        bankAccounts={bankAccounts}
        onImported={async () => {
          setShowImport(false);
          await refresh();
        }}
      />

      <ReconcileModal
        isOpen={!!selectedBt}
        onClose={() => setSelectedBt(null)}
        bankTxn={selectedBt}
        workspaceId={workspaceId}
        onChanged={async () => {
          setSelectedBt(null);
          await refresh();
        }}
      />
    </div>
  );
}