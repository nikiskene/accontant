import { useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { createSalesDocumentPdf, pdfBase64, type SalesPdfTemplate } from '../utils/salesDocumentPdf';

type Doc={id:string;workspace_id:string;document_type:string;document_number:string|null;issue_date:string;due_date:string|null;status:string;currency:string;subtotal:number;tax_total:number;total:number;amount_paid:number;issuer_snapshot:any;customer_snapshot:any;customer:any};
type Line={id:string;description:string;quantity:number;unit:string;unit_price:number;net_amount:number;vat_amount:number;gross_amount:number};

export function SalesDocumentDetail({id}:{id:string}) {
  const {workspace}=useApp();
  const [doc,setDoc]=useState<Doc|null>(null);
  const [lines,setLines]=useState<Line[]>([]);
  const [msg,setMsg]=useState('');
  const [fraction,setFraction]=useState('50');
  const [sending,setSending]=useState(false);
  const [template,setTemplate]=useState<(SalesPdfTemplate&{logo_path?:string|null})>({});
  const load=async()=>{const{data,error}=await supabase.from('sales_documents').select('*,customer:counterparties(*)').eq('id',id).single();if(error)return setMsg(error.message);setDoc(data as Doc);const [lineResult,templateResult]=await Promise.all([supabase.from('sales_document_lines').select('*').eq('document_id',id).order('line_no'),supabase.from('document_templates').select('*').eq('workspace_id',data.workspace_id).eq('document_type',data.document_type).eq('is_default',true).maybeSingle()]);if(lineResult.error)setMsg(lineResult.error.message);else setLines((lineResult.data||[])as Line[]);if(templateResult.data)setTemplate(templateResult.data as SalesPdfTemplate&{logo_path?:string|null})};
  useEffect(()=>{void load()},[id]);
  const rpc=async(name:string,args:any)=>{const{error}=await supabase.rpc(name,args);if(error)setMsg(error.message);else{setMsg('Saved.');void load()}};
  const convert=()=>rpc('convert_quote_to_invoice',{p_quote_id:id,p_fraction:Number(fraction)/100,p_issue_date:new Date().toISOString().slice(0,10),p_due_date:null});
  const makePdf=async()=>{if(!doc)return null;let logo_data_url:string|undefined;if(template.logo_path){const{data}=await supabase.storage.from('finance-documents').createSignedUrl(template.logo_path,60);if(data?.signedUrl){const blob=await fetch(data.signedUrl).then(response=>response.blob());logo_data_url=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(blob)})}}return createSalesDocumentPdf(doc,lines,workspace?.legal_name||'Company',{...template,logo_data_url})};
  const download=async()=>{const pdf=await makePdf();pdf?.save(`${doc?.document_number||'draft'}.pdf`)};
  const send=async()=>{const pdf=await makePdf();if(!pdf||!doc)return;setSending(true);setMsg('Sending…');const{data,error}=await supabase.functions.invoke('send-sales-document',{body:{document_id:id,pdf_base64:pdfBase64(pdf),file_name:`${doc.document_number||'document'}.pdf`}});setSending(false);if(error||data?.error)setMsg(data?.error||error?.message||'Could not send email');else setMsg(`Sent to ${data.recipient}.`)};
  const remove=async()=>{if(!doc||doc.status!=='draft'||!confirm(`Delete this draft ${doc.document_type.replace('_',' ')}?`))return;const{error}=await supabase.from('sales_documents').delete().eq('id',id).eq('status','draft');if(error)return setMsg(error.message);window.history.pushState({},'','/sales-documents');window.dispatchEvent(new PopStateEvent('popstate'))};

  if(!doc)return <p>{msg||'Loading…'}</p>;
  return <div className="max-w-5xl">
    <button className="text-sm text-blue-600 mb-4" onClick={()=>history.back()}>← Back</button>
    <div className="bg-white border rounded-2xl p-4 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between"><div><p className="text-sm uppercase text-gray-500">{doc.document_type.replace('_',' ')}</p><h1 className="text-3xl font-bold">{doc.document_number||'Draft'}</h1><p className="text-gray-500 mt-1">{doc.customer?.company_name||doc.customer?.alias}</p></div><div className="sm:text-right"><span className="capitalize bg-gray-100 px-3 py-1 rounded">{doc.status.replace('_',' ')}</span><p className="text-2xl font-bold mt-3">{doc.currency} {Number(doc.total).toFixed(2)}</p>{doc.document_type==='invoice'&&Number(doc.amount_paid)>0&&<p className="text-sm text-gray-600">Paid {doc.currency} {Number(doc.amount_paid).toFixed(2)} · Open {doc.currency} {Math.max(0,Number(doc.total)-Number(doc.amount_paid)).toFixed(2)}</p>}</div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] mt-8"><thead className="text-left text-xs uppercase text-gray-500"><tr><th className="py-3">Description</th><th>Qty</th><th>Unit price</th><th>Tax</th><th className="text-right">Total</th></tr></thead><tbody>{lines.map(line=><tr key={line.id} className="border-t"><td className="py-3">{line.description}</td><td>{line.quantity} {line.unit}</td><td>{Number(line.unit_price).toFixed(2)}</td><td>{Number(line.vat_amount).toFixed(2)}</td><td className="text-right">{Number(line.gross_amount).toFixed(2)}</td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap justify-end gap-2 mt-7"><Button variant="secondary" onClick={download}>Download PDF</Button>{doc.status!=='draft'&&doc.status!=='void'&&<Button onClick={send} disabled={sending}>{sending?'Sending…':'Email PDF'}</Button>}{doc.status==='draft'&&<><Button variant="danger" onClick={remove}>Delete draft</Button><Button onClick={()=>rpc('issue_sales_document',{p_document_id:id})}>Issue document</Button></>}{doc.document_type==='quote'&&doc.status==='sent'&&<Button onClick={()=>rpc('accept_quote',{p_quote_id:id})}>Accept quote</Button>}{doc.document_type==='quote'&&['accepted','partially_invoiced'].includes(doc.status)&&<div className="flex gap-2"><Input className="w-24" type="number" min="1" max="100" value={fraction} onChange={event=>setFraction(event.target.value)}/><Button onClick={convert}>Invoice %</Button></div>}</div>
      {msg&&<p className="text-sm text-amber-700 mt-4">{msg}</p>}
    </div>
  </div>;
}
