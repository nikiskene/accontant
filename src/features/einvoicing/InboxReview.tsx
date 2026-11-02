import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { text, type Row } from './core';

// The parent keys this component by company so pending responses cannot cross companies.
export function InboxReview({ workspaceId }: { workspaceId: string }) {
  const [inbox,setInbox]=useState<Row[]>([]);
  const [suppliers,setSuppliers]=useState<Row[]>([]);
  const [accounts,setAccounts]=useState<Row[]>([]);
  const [vatCodes,setVatCodes]=useState<Row[]>([]);
  const [selected,setSelected]=useState<Row|null>(null);
  const [supplier,setSupplier]=useState('');
  const [coding,setCoding]=useState<Array<{account_id:string;vat_code_id:string}>>([]);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [hasMore,setHasMore]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      const results=await Promise.all([
        supabase.from('einvoice_inbox').select('id,provider,environment,payload,received_at,supplier_invoice_id').eq('workspace_id',workspaceId).order('received_at',{ascending:false}).order('id').range(0,49),
        supabase.from('counterparties').select('id,name').eq('workspace_id',workspaceId).in('kind',['vendor','both']).order('name'),
        supabase.from('accounts').select('id,code,name').eq('workspace_id',workspaceId).eq('is_active',true).in('type',['expense','cogs','asset']).order('code'),
        supabase.from('vat_codes').select('id,name').eq('workspace_id',workspaceId).in('applies_to',['purchases','both']).order('name'),
      ]);
      if(cancelled)return;
      const error=results.find(r=>r.error)?.error;
      if(error){setMessage(error.message);return;}
      setInbox(results[0].data||[]);setHasMore(results[0].data?.length===50);setSuppliers(results[1].data||[]);setAccounts(results[2].data||[]);setVatCodes(results[3].data||[]);
    })();
    return()=>{cancelled=true;};
  },[workspaceId]);
  const choose=(id:string)=>{
    const item=inbox.find(i=>i.id===id)||null;setSelected(item);setSupplier('');setMessage('');
    const lines=(item?.payload as Row)?.lines;
    setCoding(Array.isArray(lines)?lines.map(()=>({account_id:'',vat_code_id:''})):[]);
  };
  const more=async()=>{
    setBusy(true);
    const {data,error}=await supabase.from('einvoice_inbox').select('id,provider,environment,payload,received_at,supplier_invoice_id').eq('workspace_id',workspaceId).order('received_at',{ascending:false}).order('id').range(inbox.length,inbox.length+49);
    setBusy(false);if(error){setMessage(error.message);return;}setInbox([...inbox,...data||[]]);setHasMore(data?.length===50);
  };
  const download=async()=>{
    if(!selected)return;setBusy(true);
    const {data,error}=await supabase.from('einvoice_inbox').select('original_xml').eq('workspace_id',workspaceId).eq('id',selected.id).single();setBusy(false);
    if(error){setMessage(error.message);return;}
    const url=URL.createObjectURL(new Blob([data.original_xml],{type:'application/xml'}));const a=document.createElement('a');a.href=url;a.download=`received-${text(selected.id)}.xml`;a.click();URL.revokeObjectURL(url);
  };
  const importDraft=async()=>{
    if(!selected)return;setBusy(true);setMessage('');
    const {data,error}=await supabase.rpc('import_reviewed_einvoice',{p_inbox_id:selected.id,p_supplier_id:supplier,p_coding:coding});setBusy(false);
    if(error){setMessage(error.message);return;}
    setSelected({...selected,supplier_invoice_id:data});setInbox(inbox.map(i=>i.id===selected.id?{...i,supplier_invoice_id:data}:i));setMessage('Linked to a supplier invoice. Review and approve it in Supplier invoices. Nothing was posted automatically.');
  };
  const payload=(selected?.payload||{}) as Row;
  const lines=Array.isArray(payload.lines)?payload.lines as Row[]:[];
  const locked=busy||!!selected?.supplier_invoice_id||selected?.environment!=='production';
  return <section className="rounded-xl border bg-white p-5 space-y-4">
    <h2 className="text-lg font-semibold">Incoming electronic invoices</h2>
    <p className="text-sm text-gray-600">After connection, review your provider’s received documents here. Choose the supplier and accounting categories before creating a draft bill.</p>
    {message&&<p role="status" className="text-sm text-amber-900">{message}</p>}
    <Select label="Received document" value={text(selected?.id)} disabled={busy} onChange={e=>choose(e.target.value)}><option value="">{inbox.length?'Choose a document':'No received documents'}</option>{inbox.map(i=><option key={text(i.id)} value={text(i.id)}>{text((i.payload as Row)?.number)} · {text(i.environment)} · {i.supplier_invoice_id?'Linked':'Needs review'}</option>)}</Select>
    {hasMore&&<Button variant="secondary" disabled={busy} onClick={more}>Load older documents</Button>}
    {selected&&<>
      <p className="text-sm">{text(payload.documentType)} · {text(payload.issueDate)} · {text(payload.currency)} · Total {text((payload.totals as Row)?.gross)}</p>
      <Button variant="secondary" disabled={busy} onClick={download}>Download original XML</Button>
      {selected.environment!=='production'&&<p className="text-sm text-amber-900">Sandbox document — cannot enter your accounting records.</p>}
      {!!selected.supplier_invoice_id&&<p className="text-sm">Already linked to supplier invoice {text(selected.supplier_invoice_id)}.</p>}
      <Select label="Supplier" value={supplier} disabled={locked} onChange={e=>setSupplier(e.target.value)}><option value="">Choose the matching supplier</option>{suppliers.map(s=><option key={text(s.id)} value={text(s.id)}>{text(s.name)}</option>)}</Select>
      {lines.map((line,index)=><div key={index} className="rounded-lg border p-3 space-y-2">
        <p className="text-sm">{index+1}. {text(line.description)} · Net {text(line.net)} + VAT {text(line.tax)} = {text(line.gross)}</p>
        <div className="grid gap-3 sm:grid-cols-2"><Select label="Account" disabled={locked} value={coding[index]?.account_id||''} onChange={e=>setCoding(coding.map((c,j)=>j===index?{...c,account_id:e.target.value}:c))}><option value="">Choose an account</option>{accounts.map(a=><option key={text(a.id)} value={text(a.id)}>{text(a.code)} · {text(a.name)}</option>)}</Select>
        <Select label="Purchase VAT code" disabled={locked} value={coding[index]?.vat_code_id||''} onChange={e=>setCoding(coding.map((c,j)=>j===index?{...c,vat_code_id:e.target.value}:c))}><option value="">No VAT code — review treatment</option>{vatCodes.map(v=><option key={text(v.id)} value={text(v.id)}>{text(v.name)}</option>)}</Select></div>
      </div>)}
      <Button disabled={locked||!supplier||!coding.length||coding.some(c=>!c.account_id)} onClick={importDraft}>Create or link draft supplier invoice</Button>
    </>}
  </section>;
}
