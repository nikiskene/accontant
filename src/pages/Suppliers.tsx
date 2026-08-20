import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Search } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Counterparty } from '../lib/types';
import { Button } from '../components/Button';
import { Input } from '../components/Input';

const go=(path:string)=>{window.history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'))};
export function Suppliers(){
  const{workspaceId}=useApp();const[rows,setRows]=useState<Counterparty[]>([]);const[query,setQuery]=useState('');const[msg,setMsg]=useState('');
  const load=async()=>{if(!workspaceId)return;const{data,error}=await supabase.from('counterparties').select('*').eq('workspace_id',workspaceId).or('kind.eq.vendor,kind.eq.both').order('company_name',{ascending:true,nullsFirst:false});if(error)setMsg(error.message);else setRows((data||[])as Counterparty[])};
  useEffect(()=>{void load()},[workspaceId]);
  const visible=useMemo(()=>{const term=query.trim().toLocaleLowerCase();if(!term)return rows;return rows.filter((r:any)=>[r.company_name,r.name,r.alias,r.email,r.vat_trn,r.city,r.country].some(value=>String(value||'').toLocaleLowerCase().includes(term)))},[rows,query]);
  return <div><div className="mb-6 flex flex-wrap justify-between gap-3"><div><h1 className="text-3xl font-bold">Vendors</h1><p className="mt-1 text-gray-600">External invoices, cost of revenue and operating expenses.</p></div><Button onClick={()=>go('/customers/new?role=vendor&return=suppliers')}><Plus className="mr-2 h-4 w-4"/>Add vendor</Button></div>{msg&&<div className="mb-4 rounded bg-amber-50 p-3">{msg}</div>}<div className="rounded-xl border bg-white"><div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-end sm:justify-between"><div className="relative w-full sm:max-w-md"><Search className="pointer-events-none absolute left-3 top-9 h-4 w-4 text-gray-400"/><Input label="Search vendors" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, email, UID, city…" className="pl-9"/></div><p className="text-sm text-gray-500">{visible.length} of {rows.length} vendors</p></div><div className="max-h-[65vh] overflow-auto"><table className="w-full min-w-[620px]"><thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="p-4">Vendor</th><th>Email</th><th>VAT / tax number</th><th className="text-right pr-4">Actions</th></tr></thead><tbody>{visible.map(r=><tr key={r.id} className="border-t"><td className="p-4 font-medium">{r.company_name||r.name}</td><td>{r.email||'—'}</td><td>{r.vat_trn||'—'}</td><td className="pr-4 text-right"><Button size="sm" variant="secondary" onClick={()=>go(`/customers/${r.id}?return=suppliers`)}><Pencil className="mr-1 h-4 w-4"/>Edit</Button></td></tr>)}{!visible.length&&<tr><td colSpan={4} className="p-10 text-center text-gray-500">{query?'No vendors match your search.':'No vendors yet.'}</td></tr>}</tbody></table></div></div></div>;
}
