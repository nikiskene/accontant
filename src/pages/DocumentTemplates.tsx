import { FormEvent, useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';

type Kind = 'invoice' | 'quote' | 'credit_note';
const empty = { id:'', font_family:'helvetica', accent_color:'#2563eb', footer_text:'', payment_instructions:'', payment_instructions_font_size:'9', logo_path:'' };

export function DocumentTemplates() {
  const { workspaceId, workspace } = useApp();
  const [kind,setKind] = useState<Kind>('invoice');
  const [form,setForm] = useState(empty);
  const [logoUrl,setLogoUrl] = useState('');
  const [msg,setMsg] = useState('');
  const [busy,setBusy] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setMsg('');
    void supabase.from('document_templates').select('*').eq('workspace_id',workspaceId)
      .eq('document_type',kind).eq('is_default',true).maybeSingle().then(async ({data,error}) => {
        if (error) return setMsg(error.message);
        const value=data?{...empty,...data,payment_instructions_font_size:String(data.payment_instructions_font_size||9)}:empty;
        setForm(value);
        if(value.logo_path){const{data:signed}=await supabase.storage.from('finance-documents').createSignedUrl(value.logo_path,3600);setLogoUrl(signed?.signedUrl||'')}else setLogoUrl('');
      });
  },[workspaceId,kind]);

  const upload=async(file:File)=>{if(!workspaceId)return;setBusy(true);const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const path=`${workspaceId}/document-assets/${kind}-${Date.now()}-${safe}`;const{error}=await supabase.storage.from('finance-documents').upload(path,file,{contentType:file.type,upsert:false});if(error)setMsg(error.message);else{setForm({...form,logo_path:path});const{data}=await supabase.storage.from('finance-documents').createSignedUrl(path,3600);setLogoUrl(data?.signedUrl||'')}setBusy(false)};
  const save=async(event:FormEvent)=>{event.preventDefault();if(!workspaceId)return;setBusy(true);const payload={workspace_id:workspaceId,document_type:kind,name:`Default ${kind.replace('_',' ')}`,is_default:true,font_family:form.font_family,accent_color:form.accent_color,footer_text:form.footer_text||null,payment_instructions:form.payment_instructions||null,payment_instructions_font_size:Number(form.payment_instructions_font_size),logo_path:form.logo_path||null,updated_at:new Date().toISOString()};const request=form.id?supabase.from('document_templates').update(payload).eq('id',form.id):supabase.from('document_templates').insert(payload);const{error}=await request;setBusy(false);setMsg(error?error.message:'Document layout saved.')};

  return <div className="max-w-6xl"><h1 className="text-3xl font-bold">Invoice layout</h1><p className="text-gray-600 mt-1 mb-6">Design customer-facing documents for {workspace?.legal_name}. Purchase orders and payment terms are entered on each document.</p><div className="grid gap-6 lg:grid-cols-2">
    <form onSubmit={save} className="space-y-4 bg-white border rounded-xl p-4 sm:p-6">
      <Select label="Document" value={kind} onChange={event=>setKind(event.target.value as Kind)}><option value="invoice">Invoice</option><option value="quote">Quote / cost estimate</option><option value="credit_note">Credit note</option></Select>
      <div className="grid grid-cols-2 gap-3"><Select label="Font" value={form.font_family} onChange={event=>setForm({...form,font_family:event.target.value})}><option value="helvetica">Helvetica</option><option value="times">Times</option><option value="courier">Courier</option></Select><Input type="color" label="Accent colour" value={form.accent_color} onChange={event=>setForm({...form,accent_color:event.target.value})}/></div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Logo</label><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file)}} className="block w-full text-sm"/></div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Payment instructions</label><textarea rows={5} value={form.payment_instructions} onChange={event=>setForm({...form,payment_instructions:event.target.value})} placeholder={'Account name:\nBank:\nIBAN:\nBIC:'} className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
      <Input type="number" min="6" max="16" step="0.5" label="Payment instruction text size" value={form.payment_instructions_font_size} onChange={event=>setForm({...form,payment_instructions_font_size:event.target.value})}/>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Footer text</label><textarea rows={4} value={form.footer_text} onChange={event=>setForm({...form,footer_text:event.target.value})} placeholder="Company registration, tax details, address or other legal footer" className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
      <Button type="submit" disabled={busy}>{busy?'Saving…':'Save layout'}</Button>{msg&&<p className="text-sm text-blue-700">{msg}</p>}
    </form>
    <div className="bg-white border rounded-xl p-6 min-h-[520px] shadow-sm" style={{fontFamily:form.font_family}}><div className="h-1 rounded mb-6" style={{backgroundColor:form.accent_color}}/><div className="flex justify-between items-start">{logoUrl?<img src={logoUrl} alt="Company logo" className="max-h-16 max-w-40 object-contain"/>:<div className="h-12 w-28 rounded border border-dashed flex items-center justify-center text-xs text-gray-400">Logo</div>}<div className="text-right"><p className="text-2xl font-semibold">{kind==='quote'?'COST ESTIMATE':kind.replace('_',' ').toUpperCase()}</p><p className="text-sm text-gray-500">No. 2026-0001</p></div></div><h2 className="text-lg font-semibold mt-8">{workspace?.legal_name}</h2><p className="mt-2 rounded bg-gray-50 p-2 text-sm">Document header / purchase order appears here</p><p className="text-sm text-gray-500 mt-3">Customer details and line items appear here.</p><div className="mt-8 border-y py-4 text-sm"><div className="flex justify-between"><span>Example service</span><span>{workspace?.base_currency} 1,000.00</span></div></div><div className="mt-5 text-right font-semibold">Total: {workspace?.base_currency} 1,000.00</div><div className="mt-8 whitespace-pre-line text-gray-600" style={{fontSize:`${form.payment_instructions_font_size}px`}}>{form.payment_instructions||'Payment instructions'}</div><p className="mt-5 text-sm text-gray-600">Customer and document-specific payment terms appear here.</p><div className="mt-12 whitespace-pre-line border-t pt-3 text-xs text-gray-500">{form.footer_text||'Footer text'}</div></div>
  </div></div>;
}
