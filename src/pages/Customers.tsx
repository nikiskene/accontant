// src/pages/Customers.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Counterparty } from '../lib/types';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Plus, Upload, Trash2 } from 'lucide-react';

const PAGE_SIZE = 50;

function safeStr(v: any) {
  return (v ?? '').toString();
}

export function Customers() {
  const { workspaceId } = useApp();

  const [customers, setCustomers] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);

  // paging
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // search (server-side)
  const [searchTerm, setSearchTerm] = useState('');
  const searchTimer = useRef<any>(null);

  // delete
  const [deleteTarget, setDeleteTarget] = useState<Counterparty | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayRows = useMemo(() => customers || [], [customers]);

  useEffect(() => {
    if (!workspaceId) return;
    void loadCustomers({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Debounced search -> reset paging
  useEffect(() => {
    if (!workspaceId) return;

    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void loadCustomers({ reset: true });
    }, 250);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, workspaceId]);

  const loadCustomers = async ({ reset }: { reset: boolean }) => {
    if (!workspaceId) return;

    try {
      setError(null);
      setLoading(true);

      const nextPage = reset ? 0 : page;
      const from = nextPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const term = searchTerm.trim();

      let q = supabase
        .from('counterparties')
        .select('*')
        .eq('workspace_id', workspaceId)
        // include both customer and both; also allow legacy nulls
        .or('kind.eq.customer,kind.eq.both,kind.is.null')
        .order('alias', { ascending: true, nullsFirst: false })
        .order('company_name', { ascending: true, nullsFirst: false });

      // Search by alias/company/email (server-side)
      if (term.length > 0) {
        const t = term.replace(/%/g, '\\%').replace(/_/g, '\\_');
        q = q.or(
          `alias.ilike.%${t}%,company_name.ilike.%${t}%,email.ilike.%${t}%`
        );
      }

      const { data, error } = await q.range(from, to);

      if (error) throw error;

      const rows = (data as Counterparty[]) || [];

      if (reset) {
        setCustomers(rows);
        setPage(1);
      } else {
        setCustomers((prev) => {
          const seen = new Set(prev.map((x: any) => x.id));
          const merged = [...prev];
          for (const r of rows as any[]) {
            if (r?.id && !seen.has(r.id)) merged.push(r);
          }
          return merged as any;
        });
        setPage(nextPage + 1);
      }

      setHasMore(rows.length === PAGE_SIZE);
    } catch (e: any) {
      console.error('Error loading customers:', e);
      setError(e?.message || 'Failed to load customers');
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const handleRowClick = (customerId: string) => {
    window.history.pushState({}, '', `/customers/${customerId}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleAddCustomer = () => {
    window.history.pushState({}, '', '/customers/new');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleImport = () => {
    window.history.pushState({}, '', '/customers/import');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const openDelete = (c: Counterparty) => {
    setError(null);
    setDeleteTarget(c);
  };

  const handleDelete = async () => {
    if (!workspaceId || !deleteTarget?.id) return;

    setDeleteBusy(true);
    setError(null);

    try {
      // Safety: block delete if referenced by any transactions
      const { count: refCount, error: refErr } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('counterparty_id', deleteTarget.id);

      if (refErr) throw refErr;

      if ((refCount || 0) > 0) {
        throw new Error(
          `Cannot delete: this customer is referenced by ${refCount} transaction(s). Remove/replace the customer on those transactions first.`
        );
      }

      // Also block if referenced by invoices if your schema uses customer_id on invoices.
      // If invoices table doesn’t exist, this will just error; ignore it safely.
      try {
        const invRes = await supabase
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('customer_id', deleteTarget.id);

        if ((invRes as any)?.error) {
          // ignore if table/column not present
        } else {
          const invCount = (invRes as any)?.count || 0;
          if (invCount > 0) {
            throw new Error(
              `Cannot delete: this customer is referenced by ${invCount} invoice(s).`
            );
          }
        }
      } catch {
        // ignore if invoices isn’t part of your schema
      }

      const { error: delErr } = await supabase
        .from('counterparties')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('id', deleteTarget.id);

      if (delErr) throw delErr;

      setCustomers((prev) => prev.filter((x: any) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: any) {
      console.error('Delete customer failed:', e);
      setError(e?.message || 'Failed to delete customer');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-600 mt-1">Manage your customer database</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleImport}>
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
          <Button onClick={handleAddCustomer}>
            <Plus className="w-4 h-4 mr-2" />
            Add Customer
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search by alias, company (legal), or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => loadCustomers({ reset: true })}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>

        {error && (
          <div className="px-4 py-3 text-sm bg-red-50 border-b border-red-200 text-red-800">
            {error}
          </div>
        )}

        {loading && customers.length === 0 ? (
          <div className="text-center py-12">Loading customers...</div>
        ) : displayRows.length === 0 ? (
          <div className="p-12 text-center text-gray-600">
            {searchTerm ? 'No customers match your search' : 'No customers yet'}
          </div>
        ) : (
          <div className="overflow-auto max-h-[70vh]">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Alias
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Company (Legal)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Country
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    City
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Phone
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Open Balance
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {displayRows.map((customer: any) => (
                  <tr
                    key={customer.id}
                    onClick={() => handleRowClick(customer.id)}
                    className="hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {customer.alias || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {customer.company_name || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{customer.country || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{customer.city || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{customer.email || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{customer.phone || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                      {typeof customer.open_balance === 'number'
                        ? customer.open_balance.toFixed(2)
                        : customer.open_balance
                        ? Number(customer.open_balance).toFixed(2)
                        : '0.00'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-red-50 text-red-700"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openDelete(customer);
                        }}
                        title="Delete customer"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="p-4 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {displayRows.length} customer(s)
              </div>

              {hasMore ? (
                <Button
                  variant="secondary"
                  onClick={() => loadCustomers({ reset: false })}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load more'}
                </Button>
              ) : (
                <div className="text-sm text-gray-500">End of list</div>
              )}
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => {
          if (deleteBusy) return;
          setDeleteTarget(null);
          setError(null);
        }}
        title="Delete customer"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Delete customer{' '}
            <span className="font-medium">
              {safeStr((deleteTarget as any)?.alias) || safeStr((deleteTarget as any)?.company_name) || '—'}
            </span>
            ?
          </p>
          <p className="text-xs text-gray-500">
            This is blocked if the customer is referenced by transactions (or invoices, if present).
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="danger" onClick={handleDelete} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting...' : 'Confirm delete'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}