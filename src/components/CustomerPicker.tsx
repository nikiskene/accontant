import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Counterparty } from '../lib/types';

export function CustomerPicker({workspaceId,value,onChange}:{workspaceId:string;value:string;onChange:(id:string)=>void}) {
  const [query,setQuery]=useState('');
  const [customers,setCustomers]=useState<Counterparty[]>([]);
  const [open,setOpen]=useState(false);

  useEffect(()=>{if(!workspaceId)return;const timer=setTimeout(async()=>{
    let request=supabase.from('counterparties').select('*').eq('workspace_id',workspaceId).or('kind.eq.customer,kind.eq.both,kind.is.null').order('company_name',{ascending:true,nullsFirst:false}).limit(50);
    const term=query.trim().replace(/[^\p{L}\p{N}@.+\- ]/gu,'');
    if(term)request=request.or(`company_name.ilike.%${term}%,alias.ilike.%${term}%,name.ilike.%${term}%,email.ilike.%${term}%`);
    const{data}=await request;setCustomers((data||[])as Counterparty[]);
  },200);return()=>clearTimeout(timer)},[workspaceId,query]);

  useEffect(()=>{if(!value)return;void supabase.from('counterparties').select('*').eq('workspace_id',workspaceId).eq('id',value).maybeSingle().then(({data})=>{if(data)setQuery(data.company_name||data.name||'')})},[value,workspaceId]);
  const create=()=>{sessionStorage.setItem('sales-customer-return','/new-quote'+window.location.search);window.history.pushState({},'','/customers/new');window.dispatchEvent(new PopStateEvent('popstate'))};

  return <div className="relative">
    <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
    <input required value={query} onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);onChange('');setOpen(true)}} placeholder="Search customers…" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
    {open&&<div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-64 overflow-y-auto">
      <button type="button" onClick={create} className="w-full flex items-center gap-2 px-3 py-3 text-left text-blue-700 font-medium hover:bg-blue-50 sticky top-0 bg-white border-b"><Plus className="w-4 h-4"/>New customer</button>
      {customers.map(customer=><button key={customer.id} type="button" onClick={()=>{onChange(customer.id);setQuery(customer.company_name||customer.name||'');setOpen(false)}} className={`w-full px-3 py-2 text-left hover:bg-gray-50 ${customer.id===value?'bg-blue-50':''}`}><span className="block">{customer.company_name||customer.name}</span>{customer.email&&<span className="block text-xs text-gray-500">{customer.email}</span>}</button>)}
      {!customers.length&&<p className="px-3 py-4 text-sm text-gray-500">No matching customers.</p>}
    </div>}
  </div>;
}
