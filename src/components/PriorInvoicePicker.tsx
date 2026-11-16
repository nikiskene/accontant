import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';

export const issuedInvoiceStatuses = ['sent', 'partially_paid', 'paid', 'overdue', 'invoiced'];

export type PriorInvoice = {
  id: string;
  document_number: string;
  issue_date: string;
  currency: string;
  subtotal: number;
  tax_total: number;
  total: number;
};

type Props = {
  workspaceId: string;
  customerId: string;
  currency: string;
  issueDate: string;
  excludedIds: string[];
  onSelect: (invoice: PriorInvoice) => Promise<void>;
  onManual: () => void;
  onClose: () => void;
};

const pageSize = 20;

export function PriorInvoicePicker({ workspaceId, customerId, currency, issueDate, excludedIds, onSelect, onManual, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<PriorInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [more, setMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSearchError('');
    const timer = window.setTimeout(async () => {
      const prefix = search.trim();
      let query = supabase.from('sales_documents')
        .select('id,document_number,issue_date,currency,subtotal,tax_total,total')
        .eq('workspace_id', workspaceId).eq('customer_id', customerId)
        .eq('currency', currency).eq('document_type', 'invoice')
        .in('status', issuedInvoiceStatuses).not('document_number', 'is', null)
        .lte('issue_date', issueDate).gt('total', 0);
      if (prefix) query = query.ilike('document_number', `%${prefix.replace(/[\\%_]/g, '\\$&')}%`);
      const { data, error } = await query.order('issue_date', { ascending: false }).order('id')
        .range(page * pageSize, (page + 1) * pageSize).abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      setRows((data || []).slice(0, pageSize));
      setMore((data?.length || 0) > pageSize);
      setSearchError(error ? 'Could not load invoices. Change the search to try again.' : '');
      setLoading(false);
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [workspaceId, customerId, currency, issueDate, search, page]);

  const select = async (invoice: PriorInvoice) => {
    setSelecting(true);
    setError('');
    try {
      await onSelect(invoice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the deduction. Try again.');
    } finally {
      setSelecting(false);
    }
  };

  return <Modal isOpen title="Deduct a previous invoice" onClose={() => { if (!selecting) onClose(); }} size="lg">
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Showing issued {currency} invoices for this customer. Selecting one deducts its invoiced amount.</p>
      <Input autoFocus type="search" label="Search by invoice number" aria-label="Search by invoice number" value={search}
        onChange={event => { setLoading(true); setSearch(event.target.value); setPage(0); }} disabled={selecting}/>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {searchError && <p role="alert" className="text-sm text-red-700">{searchError}</p>}
      {loading ? <p role="status" className="text-sm">Searching invoices…</p> : <>
        {!rows.length && !searchError && <p className="text-sm">No matching invoices.</p>}
        <ul className="max-h-80 divide-y overflow-y-auto">
          {rows.map(invoice => {
            const added = excludedIds.includes(invoice.id);
            return <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><p className="font-medium">{invoice.document_number}</p><p className="text-sm text-gray-600">{invoice.issue_date} · {currency} {Number(invoice.total).toFixed(2)} total</p></div>
              <Button type="button" size="sm" disabled={added || selecting} onClick={() => void select(invoice)}>{added ? 'Already added' : 'Deduct invoice'}</Button>
            </li>;
          })}
        </ul>
      </>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="ghost" disabled={selecting} onClick={onManual}>Enter deduction manually</Button>
        <div className="flex gap-2">
          {page > 0 && <Button type="button" variant="secondary" disabled={loading || selecting} onClick={() => setPage(page - 1)}>Previous</Button>}
          {more && <Button type="button" variant="secondary" disabled={loading || selecting} onClick={() => setPage(page + 1)}>Next</Button>}
        </div>
      </div>
    </div>
  </Modal>;
}
