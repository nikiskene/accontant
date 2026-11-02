import {useEffect, useRef, useState} from 'react';
import {Camera, Upload, ScanLine} from 'lucide-react';
import {useApp} from '../contexts/AppContext';
import {supabase} from '../lib/supabase';
import {Button} from '../components/Button';
import {Input} from '../components/Input';
import {Select} from '../components/Select';
import {blankReceipt, validateReceipt, type ReceiptFields} from '../features/receipt-scanner/model';
import {prepareReceipt} from '../features/receipt-scanner/image';

export function ReceiptScanner(){
 const {workspaces,workspaceId}=useApp();
 const [company,setCompany]=useState(workspaceId||'');
 const [fields,setFields]=useState<ReceiptFields>(blankReceipt);
 const [photo,setPhoto]=useState<{extraction:Blob;archive:Blob}|null>(null);
 const [preview,setPreview]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[saved,setSaved]=useState('');
 const [confirmed,setConfirmed]=useState(false),[submissionId,setSubmissionId]=useState(()=>crypto.randomUUID());
 const camera=useRef<HTMLInputElement>(null),upload=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!company&&workspaceId)setCompany(workspaceId);},[workspaceId,company]);
 useEffect(()=>{if(!photo){setPreview('');return;}const url=URL.createObjectURL(photo.archive);setPreview(url);return()=>URL.revokeObjectURL(url);},[photo]);
 const invoke=async(form:FormData)=>{
  const {data,error:failure}=await supabase.functions.invoke('scan-receipt',{body:form});
  if(failure){let message=failure.message;try{message=(await failure.context.json()).error||message;}catch{/* Preserve network error. */}throw new Error(message);}
  if(data.error)throw new Error(data.error);return data;
 };
 const detect=async(image:{extraction:Blob;archive:Blob})=>{
  const form=new FormData();form.set('action','extract');form.set('workspace_id',company);form.set('photo',image.extraction,'capture.jpg');
  const result=await invoke(form);
  const normalized={...blankReceipt(),...result.fields};
  for(const key of ['vendor','tax_number','invoice_number','document_date','due_date','currency','description'] as const)normalized[key]=normalized[key]||'';
  setFields(normalized);setNotice(`${result.qr_detected?'QR code detected. ':''}Check the detected details and fill in anything missing.`);
 };
 const capture=async(file?:File)=>{
  if(!file)return;setBusy('Reading receipt…');setError('');setNotice('');setSaved('');setConfirmed(false);setFields(blankReceipt());setPhoto(null);setSubmissionId(crypto.randomUUID());
  try{const image=await prepareReceipt(file);setPhoto(image);setBusy('Detecting receipt details…');try{await detect(image);}catch(e){setError(`${(e as Error).message} Your photo is ready; enter the details below.`);}}
  catch(e){setError('Could not read this photo. Please try a JPEG or PNG image.');}finally{setBusy('');}
 };
 const update=<K extends keyof ReceiptFields>(key:K,value:ReceiptFields[K])=>{setFields(current=>({...current,[key]:value}));setConfirmed(false);};
 const submit=async()=>{
  const validation=validateReceipt(fields);if(validation){setError(validation);return;}
  if(!photo||!confirmed)return;setBusy('Submitting to accounting…');setError('');
  try{const form=new FormData();form.set('action','submit');form.set('workspace_id',company);form.set('id',submissionId);form.set('photo',photo.archive,'receipt.jpg');form.set('fields',JSON.stringify(fields));const result=await invoke(form);setSaved(result.id);setNotice(result.possible_duplicate?'Submitted. A possible duplicate was flagged for review.':'Submitted. Your receipt details and compressed photo are saved. Complete the accounting information in the receipt inbox.');}
  catch(e){setError((e as Error).message);}finally{setBusy('');}
 };
 return <div className="max-w-5xl space-y-5">
  <div><h1 className="text-3xl font-bold flex items-center gap-2"><ScanLine/>Receipt scanner</h1><p className="mt-2 text-gray-600">Scan, check the receipt details, then submit to accounting.</p></div>
  <Select label="Company" value={company} disabled={!!busy||!!photo} onChange={e=>setCompany(e.target.value)}><option value="">Choose company</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.legal_name}</option>)}</Select>
  {error&&<p role="alert" className="rounded-lg bg-red-50 text-red-800 p-3">{error}</p>}
  {notice&&<p role="status" className="rounded-lg bg-blue-50 text-blue-900 p-3">{notice}</p>}
  {saved?<div className="bg-white border rounded-xl p-5 space-y-4"><h2 className="text-xl font-semibold">Receipt submitted</h2><div className="flex flex-wrap gap-3"><a className="rounded-lg bg-blue-600 text-white px-4 py-3" href={`/receipt-inbox?receipt=${saved}`}>Complete accounting information</a><Button variant="secondary" onClick={()=>{setSaved('');setPhoto(null);setFields(blankReceipt());setNotice('');}}>Scan another receipt</Button></div></div>:<>
  <input ref={camera} className="hidden" type="file" accept="image/*" capture="environment" onChange={e=>{void capture(e.target.files?.[0]);e.target.value='';}}/>
  <input ref={upload} className="hidden" type="file" accept="image/*" onChange={e=>{void capture(e.target.files?.[0]);e.target.value='';}}/>
  <div className="flex flex-wrap gap-3"><Button disabled={!company||!!busy} onClick={()=>camera.current?.click()}><Camera className="w-5 h-5 mr-2"/>{photo?'Retake photo':'Scan receipt'}</Button><Button variant="secondary" disabled={!company||!!busy} onClick={()=>upload.current?.click()}><Upload className="w-5 h-5 mr-2"/>Choose photo</Button>{photo&&<Button variant="secondary" disabled={!!busy} onClick={()=>{setPhoto(null);setFields(blankReceipt());setConfirmed(false);setNotice('');setError('');}}>Discard</Button>}</div>
  {busy&&<p role="status" aria-live="polite">{busy}</p>}
  {!photo&&!busy&&<p className="p-6 border border-dashed rounded-xl text-gray-600">Keep the full receipt in view, including the QR code. Use good light and check that small print is sharp.</p>}
  {photo&&<div className="grid md:grid-cols-2 gap-5 items-start"><div className="space-y-3"><img src={preview} alt="Compressed receipt preview — check the small print is readable" className="w-full max-h-[70vh] object-contain border rounded-lg bg-white"/><a href={preview} target="_blank" rel="noreferrer" className="text-blue-700 underline">Open full preview to check readability</a><Button variant="secondary" disabled={!!busy} onClick={()=>{setPhoto({...photo,archive:photo.extraction});setConfirmed(false);}}>Use sharper saved photo</Button><p className="text-sm text-gray-600">Saved photo: {Math.round(photo.archive.size/1024)} KB. Only this compressed photo is kept after submission.</p></div>
  <div className="bg-white rounded-xl border p-4 space-y-4"><h2 className="text-xl font-semibold">Check receipt details</h2><p className="text-sm text-gray-600">Receipt number and supplier tax number may be left blank when absent from the receipt.</p>
  <fieldset disabled={!!busy} className="space-y-4">
  <Input label="Supplier name *" value={fields.vendor} onChange={e=>update('vendor',e.target.value)}/>
  <Input label="Supplier tax number (if shown)" value={fields.tax_number} onChange={e=>update('tax_number',e.target.value)}/>
  <Input label="Receipt / invoice number (if shown)" value={fields.invoice_number} onChange={e=>update('invoice_number',e.target.value)}/>
  <div className="grid grid-cols-2 gap-3"><Input type="date" label="Receipt date *" value={fields.document_date} onChange={e=>update('document_date',e.target.value)}/><Input type="date" label="Due date (optional)" value={fields.due_date} onChange={e=>update('due_date',e.target.value)}/><Input label="Currency *" placeholder="EUR, AED…" maxLength={3} value={fields.currency} onChange={e=>update('currency',e.target.value.toUpperCase())}/><Input type="number" min="0.01" step=".01" label="Total including VAT *" value={fields.gross_amount??''} onChange={e=>update('gross_amount',e.target.value===''?null:Number(e.target.value))}/></div>
  <Input label="What was purchased?" value={fields.description} onChange={e=>update('description',e.target.value)}/>
  <div className="space-y-3"><h3 className="font-semibold">VAT breakdown *</h3><p className="text-sm text-gray-600">Add one line per VAT rate. For a receipt without VAT, enter the total and zero VAT.</p>{fields.taxes.map((line,index)=><div key={index} className="border rounded-lg p-3 space-y-2"><div className="grid grid-cols-3 gap-2">{(['gross','tax','tax_rate'] as const).map(key=><Input key={key} label={key==='gross'?'Line total':key==='tax'?'VAT amount':'VAT %'} type="number" min="0" step=".01" value={line[key]} onChange={e=>update('taxes',fields.taxes.map((item,i)=>i===index?{...item,[key]:Number(e.target.value)}:item))}/>)}</div><button type="button" className="text-red-700 min-h-11" onClick={()=>update('taxes',fields.taxes.filter((_,i)=>i!==index))}>Remove line</button></div>)}<Button variant="secondary" onClick={()=>update('taxes',[...fields.taxes,{gross:fields.taxes.length?0:fields.gross_amount||0,tax:0,tax_rate:0}])}>Add VAT line</Button></div>
  <label className="flex gap-3 items-start py-3"><input type="checkbox" className="mt-1 w-5 h-5" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>I checked the receipt details, VAT breakdown and readability of the saved photo.</span></label>
  <Button className="w-full" disabled={!confirmed||!!busy} onClick={()=>void submit()}>Submit to accounting</Button><p className="text-sm text-gray-500">Next: complete accounting information before booking.</p>
  </fieldset></div></div>}
  </>}
 </div>;
}
