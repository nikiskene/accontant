import { useEffect, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Counterparty } from '../lib/types';
import { Button } from '../components/Button';

const go=(path:string)=>{window.history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'))};
export function Suppliers(){
  const{workspaceId}=useApp();const[rows,setRows]=useState<Counterparty[]>([]);const[msg,setMsg]=useState('');
  const load=async()=>{if(!workspaceId)return;const{data,error}=await supabase.from('counterparties').select('*').eq('workspace_id',workspaceId).or('kind.eq.vendor,kind.eq.both').order('company_name',{ascending:true,nullsFirst:false});if(error)setMsg(error.message);else setRows((data||[])as Counterparty[])};
  useEffect(()=>{void load()},[workspaceId]);
  return <div><div className="mb-6 flex flex-wrap justify-between gap-3"><div><h1 className="text-3xl font-bold">Vendors</h1><p className="mt-1 text-gray-600">External invoices, cost of revenue and operating expenses.</p></div><Button onClick={()=>go('/customers/new?role=vendor&return=suppliers')}><Plus className="mr-2 h-4 w-4"/>Add vendor</Button></div>{msg&&<div className="mb-4 rounded bg-amber-50 p-3">{msg}</div>}<div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[620px]"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="p-4">Vendor</th><th>Email</th><th>VAT / tax number</th><th className="text-right pr-4">Actions</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-t"><td className="p-4 font-medium">{r.company_name||r.name}</td><td>{r.email||'—'}</td><td>{r.vat_trn||'—'}</td><td className="pr-4 text-right"><Button size="sm" variant="secondary" onClick={()=>go(`/customers/${r.id}?return=suppliers`)}><Pencil className="mr-1 h-4 w-4"/>Edit</Button></td></tr>)}{!rows.length&&<tr><td colSpan={4} className="p-10 text-center text-gray-500">No vendors yet.</td></tr>}</tbody></table></div></div>;
}
