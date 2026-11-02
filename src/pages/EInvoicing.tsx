import {DocFlowConnection} from '../features/einvoicing/DocFlowConnection';
import {mapDocFlow} from '../features/einvoicing/docflow';
import { InboxReview } from '../features/einvoicing/InboxReview';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Button } from '../components/Button';
import { prepare, text, type Context, type Row } from '../features/einvoicing/core';

const initialSettings = {mode:'preparation',vat_status:'unconfirmed',vat_registered:false,tin:'',target_date:'',revenue_band:'unconfirmed',registration_type:'TL'};
const initialMetadata = {buyer_reference:'',purchase_order:'',buyer:{type:'',country:'',tin:'',scheme:'',electronic_address:'',registration_number:'',registration_type:''},supply_date:'',payment_means:'',transaction_type:'',exchange_rate:'',credit_reason:'',lines:{}};
const navigate = (path:string) => { history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate')); };

export function EInvoicing() {
  const {workspaceId} = useApp();
  return <CompanyEInvoicing key={workspaceId || "none"}/>;
}

function CompanyEInvoicing() {
  const {workspace,workspaceId} = useApp();
  const [providerCompanyId,setProviderCompanyId]=useState('');
  const [settings,setSettings] = useState<Row>(initialSettings);
  const [documents,setDocuments] = useState<Row[]>([]);
  const [documentId,setDocumentId] = useState(new URLSearchParams(location.search).get('document') || '');
  const [context,setContext] = useState<Context|null>(null);
  const [metadata,setMetadata] = useState<Row>(initialMetadata);
  const [message,setMessage] = useState('');
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [available,setAvailable] = useState(false);
  const [hasMore,setHasMore] = useState(false);
  const buyer = metadata.buyer as Row;
  const lineMetadata = metadata.lines as Record<string,Row>;
  useEffect(()=>{
    let cancelled=false;
    setSettings(initialSettings);setDocuments([]);setContext(null);setMetadata(initialMetadata);setAvailable(false);setLoading(true);setMessage('');
    if(!workspaceId||workspace?.country!=='AE'){setLoading(false);return;}
    void (async()=>{
      const [s,d]=await Promise.all([
        supabase.from('einvoice_settings').select('*').eq('workspace_id',workspaceId).maybeSingle(),
        supabase.from('sales_documents').select('id,document_number,document_type,status,issue_date').eq('workspace_id',workspaceId).in('document_type',['invoice','credit_note']).neq('status','void').order('issue_date',{ascending:false}).order('id').range(0,99),
      ]);
      if(cancelled)return;
      setLoading(false);
      if(s.error||d.error){setMessage('E-invoicing preparation could not be loaded. The database preparation update must be installed before using this screen.');return;}
      setAvailable(true);setSettings(s.data||initialSettings);setDocuments(d.data||[]);setHasMore(d.data?.length===100);
    })();
    return()=>{cancelled=true;};
  },[workspaceId,workspace?.country]);
  useEffect(()=>{
    let cancelled=false;setContext(null);setMetadata(initialMetadata);
    if(!documentId||!workspaceId||!available)return;
    void supabase.rpc('einvoice_preparation_context',{p_document_id:documentId}).then(({data,error})=>{
      if(cancelled)return;
      if(error||!data){setMessage(error?.message||'Could not load invoice.');return;}
      if(data.workspace.id!==workspaceId){setMessage('Select an invoice belonging to the current company.');return;}
      setContext(data as Context);setMetadata({...initialMetadata,...data.metadata,buyer:{...initialMetadata.buyer,...(data.document.status==='draft'?data.customer?.einvoice_profile:data.document.customer_snapshot?.einvoice_profile),...Object.fromEntries(Object.entries(data.metadata?.buyer||{}).filter(([,value])=>text(value)!==''))},lines:data.metadata?.lines||{}});setMessage('');
    });
    return()=>{cancelled=true;};
  },[documentId,workspaceId,available]);
  const result=useMemo(()=>context?prepare({...context,settings,metadata}):null,[context,settings,metadata]);
  const mapping=useMemo(()=>context?mapDocFlow({...context,settings,metadata},providerCompanyId):null,[context,settings,metadata,providerCompanyId]);
  const updateBuyer=(key:string,value:string)=>setMetadata({...metadata,buyer:{...buyer,[key]:value}});
  const updateLine=(id:string,key:string,value:string)=>setMetadata({...metadata,lines:{...lineMetadata,[id]:{...lineMetadata[id],[key]:value}}});
  const saveSettings=async()=>{
    if(!workspaceId)return;setSaving(true);setMessage('');
    const {error}=await supabase.rpc('save_einvoice_settings',{p_workspace_id:workspaceId,p_settings:settings});setSaving(false);setMessage(error?.message||'Preparation settings saved. E-invoicing remains inactive.');
  };
  const saveMetadata=async()=>{
    if(!context)return;setSaving(true);setMessage('');
    const {error}=await supabase.rpc('save_einvoice_metadata',{p_document_id:context.document.id,p_metadata:metadata});setSaving(false);setMessage(error?.message||'Electronic invoice details saved. Nothing has been submitted.');
  };
  const more=async()=>{
    if(!workspaceId)return;setLoading(true);
    const {data,error}=await supabase.from('sales_documents').select('id,document_number,document_type,status,issue_date').eq('workspace_id',workspaceId).in('document_type',['invoice','credit_note']).neq('status','void').order('issue_date',{ascending:false}).order('id').range(documents.length,documents.length+99);
    setLoading(false);if(error){setMessage(error.message);return;}setDocuments([...documents,...data||[]]);setHasMore(data?.length===100);
  };
  const exportPreparation=()=>{
    if(!result)return;
    const file=new Blob([JSON.stringify({purpose:'Preparation only. Not a legal e-invoice or proof of reporting.',generatedAt:new Date().toISOString(),providerAcceptance:'not tested',...result},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=`samly-preparation-${documentId}.json`;a.click();URL.revokeObjectURL(url);
  };
  const field=(key:string,label:string,type='text')=><Input type={type} label={label} value={text(metadata[key])} onChange={e=>setMetadata({...metadata,[key]:e.target.value})}/>;
  if(workspace?.country!=='AE')return <p>Choose a UAE company to prepare e-invoicing.</p>;
  return <div className="max-w-5xl space-y-6">
    <div><h1 className="text-3xl font-bold">E-invoicing preparation</h1><p className="mt-1 text-sm text-gray-500">Powered by DocFlow</p><p className="mt-2 text-gray-600">Complete {workspace.legal_name}’s invoice details and connect Docflow for sandbox checks.</p></div>
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><strong>Preparation only · Not activated</strong><p className="mt-1">Complete company details once, customer details once, then check each invoice. This screen prepares and tests invoices; production delivery and FTA reporting remain inactive.</p></div>
    {message&&<p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{message}</p>}
    {!available?<p>{loading?'Loading preparation…':'Preparation is unavailable until the database update is installed.'}</p>:<>
      <section className="rounded-xl border bg-white p-5 space-y-4"><h2 className="text-lg font-semibold">Company readiness</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="VAT registration" value={text(settings.vat_status)||(settings.vat_registered?'registered':'unconfirmed')} onChange={e=>setSettings({...settings,vat_status:e.target.value,vat_registered:e.target.value==='registered'})}><option value="unconfirmed">Not confirmed</option><option value="registered">VAT registered</option><option value="not_registered">Not VAT registered — confirmed</option></Select>
          <Input label="Confirmed company TIN (10 digits)" inputMode="numeric" maxLength={10} value={text(settings.tin)} onChange={e=>setSettings({...settings,tin:e.target.value})}/>
          <Select label="Annual revenue" value={text(settings.revenue_band)} onChange={e=>setSettings({...settings,revenue_band:e.target.value})}><option value="unconfirmed">Confirm revenue band</option><option value="below_50m">Below AED 50 million</option><option value="at_least_50m">AED 50 million or more</option></Select>
          <Select label="Legal registration type" value={text(settings.registration_type)||'TL'} onChange={e=>setSettings({...settings,registration_type:e.target.value})}><option value="TL">Trade licence</option><option value="EID">Emirates ID</option><option value="PAS">Passport</option><option value="CD">Cabinet decision</option></Select><Input type="date" label="Planned activation date" value={text(settings.target_date)} onChange={e=>setSettings({...settings,target_date:e.target.value})}/>
        </div>
        {settings.revenue_band==='below_50m'&&<p className="text-sm text-gray-600">Appoint a provider by 31 March 2027; mandatory implementation is 1 July 2027. You can plan an earlier launch.</p>}
        {settings.revenue_band==='at_least_50m'&&<p className="text-sm text-amber-800">Appoint a provider by 30 October 2026; mandatory implementation is 1 January 2027.</p>}
        <p className="text-sm text-gray-600">Use your confirmed FTA identity. Your TIN and VAT TRN are separate fields; do not use a VAT-group representative’s identity for another member.</p>
        <div className="flex flex-wrap gap-2"><Button disabled={saving} onClick={saveSettings}>Save preparation settings</Button><Button variant="secondary" onClick={()=>navigate('/company-profile')}>Company credentials</Button></div>
      </section>
      <section className="rounded-xl border bg-white p-5 space-y-4"><h2 className="text-lg font-semibold">Check an invoice</h2>
        <Select label="Invoice or credit note" value={documentId} onChange={e=>setDocumentId(e.target.value)}><option value="">Choose a document</option>{documents.map(d=><option key={text(d.id)} value={text(d.id)}>{text(d.document_number)||'Draft'} · {text(d.issue_date)} · {text(d.document_type).replace('_',' ')}</option>)}</Select>
        {hasMore&&<Button variant="secondary" disabled={loading} onClick={more}>Load older invoices</Button>}
        {context&&<><p className="text-sm text-gray-600">Issued documents are checked against their frozen company and customer details. These preparation fields do not rewrite the invoice.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Customer type" value={text(buyer.type)} onChange={e=>updateBuyer('type',e.target.value)}><option value="">Confirm customer type</option><option value="business">Business</option><option value="consumer">Consumer — scope review</option></Select>
            <Input label="Customer country code" maxLength={2} placeholder="AE" value={text(buyer.country)} onChange={e=>updateBuyer('country',e.target.value.toUpperCase())}/>
            <Input label="Customer TIN" value={text(buyer.tin)} onChange={e=>updateBuyer('tin',e.target.value)}/>
            <Input label="Customer electronic address" value={text(buyer.electronic_address)} onChange={e=>updateBuyer('electronic_address',e.target.value)}/>
            <Input label="Electronic address scheme" placeholder="0235 for UAE TIN" value={text(buyer.scheme)} onChange={e=>updateBuyer('scheme',e.target.value)}/>
            <Input label="Customer legal registration type (if applicable)" value={text(buyer.registration_type)} onChange={e=>updateBuyer('registration_type',e.target.value)}/><Input label="Customer legal registration number (if applicable)" value={text(buyer.registration_number)} onChange={e=>updateBuyer('registration_number',e.target.value)}/>
            {field('buyer_reference','Customer / buyer reference')}
            {field('purchase_order','Customer purchase-order number (if supplied)')}
            {field('supply_date','Exact supply date','date')}
            <Select label="Payment method" value={text(metadata.payment_means)} onChange={e=>setMetadata({...metadata,payment_means:e.target.value})}><option value="">Select payment method</option><option value="30">Bank transfer</option><option value="48">Card</option><option value="10">Cash</option><option value="49">Direct debit</option><option value="1">Not defined</option></Select>
            <Select label="Transaction scenario" value={text(metadata.transaction_type)} onChange={e=>setMetadata({...metadata,transaction_type:e.target.value})}><option value="">Confirm scenario</option><option value="00000000">Ordinary domestic supply</option><option value="00000001">Export — provider review needed</option><option value="10000000">Free-trade-zone scenario — provider review needed</option><option value="00000010">E-commerce — provider review needed</option></Select>
            {context.document.currency!=='AED'&&field('exchange_rate','Exchange rate to AED','number')}
            {context.document.document_type==='credit_note'&&field('credit_reason','Reason for credit note')}
          </div>
          <p className="text-sm text-gray-500">Customer electronic details default from the customer record. Add a buyer reference or the customer’s PO number for routing; no purchase-order system is needed.</p><div className="space-y-3">{context.lines.map((line,index)=><div className="rounded-lg border p-3" key={text(line.id)}><p className="mb-3 text-sm font-medium">{index+1}. {text(line.description)}</p><div className="grid gap-3 sm:grid-cols-3"><Input label="Unit code override (optional)" value={text(lineMetadata[text(line.id)]?.unit_code)} placeholder="C62, HUR, DAY…" onChange={e=>updateLine(text(line.id),'unit_code',e.target.value)}/><Select label="Tax category" value={text(lineMetadata[text(line.id)]?.tax_category)} onChange={e=>updateLine(text(line.id),'tax_category',e.target.value)}><option value="">Use invoice VAT code</option><option value="standard">Standard rated</option><option value="zero">Zero rated</option><option value="exempt">Exempt</option><option value="out_of_scope">Outside VAT scope</option></Select><Input label="Provider exemption code (if needed)" value={text(lineMetadata[text(line.id)]?.tax_reason_code)} onChange={e=>updateLine(text(line.id),'tax_reason_code',e.target.value)}/><Input label="Tax treatment reason (if needed)" value={text(lineMetadata[text(line.id)]?.tax_reason)} onChange={e=>updateLine(text(line.id),'tax_reason',e.target.value)}/></div></div>)}</div>
          <div className="flex flex-wrap gap-2"><Button disabled={saving} onClick={saveMetadata}>Save electronic invoice details</Button><Button variant="secondary" onClick={exportPreparation}>Download preparation report</Button></div>
        </>}
      </section>
      {result&&<section className={`rounded-xl border p-5 ${result.ready?'border-blue-200 bg-blue-50':'border-amber-200 bg-amber-50'}`}><h2 className="font-semibold">{result.ready?'Local data checks passed — provider checks still pending':`${result.findings.length} item${result.findings.length===1?'':'s'} to resolve`}</h2>{result.findings.length>0&&<ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{result.findings.map((f,i)=><li key={`${f.field}-${i}`}>{f.message}</li>)}</ul>}<p className="mt-3 text-sm">This is a preparation check, not a complete PINT-AE validation or evidence of delivery to the FTA.</p></section>}
      {mapping&&<section className="rounded-xl border bg-white p-5 space-y-3"><h2 className="font-semibold">Docflow field mapping</h2><p className="text-sm">{mapping.ready?'Validation candidate built. Sandbox acceptance is still required.':`${mapping.findings.length} item(s) to resolve before sandbox validation.`}</p>{mapping.findings.length>0&&<ul className="list-disc pl-5 text-sm space-y-2">{mapping.findings.map((finding,i)=><li key={i}>{finding.message}</li>)}</ul>}<p className="text-sm text-gray-500">Credit notes, discounts, special tax scenarios and production activation require provider acceptance before use.</p></section>}
      {workspaceId&&<DocFlowConnection key={workspaceId} workspaceId={workspaceId} documentId={documentId} onConnection={setProviderCompanyId}/>}
      {workspaceId&&<InboxReview key={workspaceId} workspaceId={workspaceId}/>}
      <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">Before activation</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-gray-700"><li>Resolve invoice data and scenario checks.</li><li>Choose an accredited provider; complete your registration.</li><li>Connect Samly and test sending, receiving, corrections and reporting.</li><li>Verify retained records, failure recovery and accountant reconciliation.</li></ol></section>
    </>}
  </div>;
}
