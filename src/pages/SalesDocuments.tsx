import { useEffect, useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { SalesDocument } from '../lib/types';
import { Button } from '../components/Button';

export function SalesDocuments() {
  const { workspaceId } = useApp();
  const [documents, setDocuments] = useState<SalesDocument[]>([]);
  const [filter, setFilter] = useState<'all'|'quote'|'invoice'|'credit_note'>('all');
  const [error, setError] = useState('');
  const load = async () => {
    if (!workspaceId) return;
    let query = supabase.from('sales_documents').select('*, customer:counterparties(id,name,company_name)')
      .eq('workspace_id', workspaceId).order('issue_date', { ascending: false });
    if (filter !== 'all') query = query.eq('document_type', filter);
    const { data, error: loadError } = await query;
    if (loadError) setError(loadError.message); else setDocuments((data || []) as unknown as SalesDocument[]);
  };
  useEffect(() => { void load(); }, [workspaceId, filter]);
  return <div>
    <div className="flex justify-between items-start mb-6"><div><h1 className="text-3xl font-bold">Quotes & invoices</h1><p className="text-gray-600 mt-1">From estimate to full or staged billing.</p></div><div className="flex gap-2">
      <Button variant="secondary" onClick={() => {window.history.pushState({},'', '/new-quote?type=invoice');window.dispatchEvent(new PopStateEvent('popstate'));}}><FilePlus2 className="w-4 h-4 mr-2"/>New invoice</Button>
      <Button onClick={() => {window.history.pushState({},'', '/new-quote');window.dispatchEvent(new PopStateEvent('popstate'));}}><FilePlus2 className="w-4 h-4 mr-2"/>New quote</Button></div></div>
    <div className="flex gap-2 mb-4">{(['all','quote','invoice','credit_note'] as const).map(value=><button key={value} onClick={()=>setFilter(value)} className={`px-3 py-2 rounded-lg text-sm capitalize ${filter===value?'bg-blue-600 text-white':'bg-white border'}`}>{value.replace('_',' ')}</button>)}</div>
    {error && <div className="bg-blue-50 text-blue-900 p-3 rounded-lg mb-4">{error}</div>}
    <div className="bg-white rounded-xl border overflow-x-auto"><table className="w-full min-w-[820px]"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="p-4">Number</th><th>Customer</th><th>Type</th><th>Date</th><th>Status</th><th className="text-right">Total</th><th className="pr-4 text-right">Actions</th></tr></thead><tbody>
      {documents.map(doc=><tr key={doc.id} className="border-t cursor-pointer hover:bg-gray-50" onClick={()=>{window.history.pushState({},'',`/sales-documents/${doc.id}`);window.dispatchEvent(new PopStateEvent('popstate'));}}><td className="p-4 font-medium">{doc.document_number || 'Draft'}</td><td>{doc.customer?.company_name || doc.customer?.name || 'Customer'}</td><td className="capitalize">{doc.document_type.replace('_',' ')}</td><td>{doc.issue_date}</td><td className="capitalize">{doc.status.replace('_',' ')}</td><td className="text-right">{doc.currency} {Number(doc.total).toFixed(2)}</td><td className="pr-4 text-right">{doc.document_type==='invoice'&&!['draft','void','paid'].includes(doc.status)&&Number(doc.amount_paid||0)<Number(doc.total)&&<Button size="sm" variant="secondary" onClick={event=>{event.stopPropagation();window.history.pushState({},'',`/receivables?invoice=${doc.id}`);window.dispatchEvent(new PopStateEvent('popstate'))}}>Record payment</Button>}</td></tr>)}
      {!documents.length && <tr><td colSpan={7} className="p-10 text-center text-gray-500">No sales documents yet.</td></tr>}
    </tbody></table></div>
  </div>;
}
