import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
export function InvoiceReadiness({documentId}:{documentId:string}){
 const [result,setResult]=useState<{required:boolean;ready:boolean;findings:{field:string;message:string}[]}|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{let active=true;void supabase.rpc('einvoice_issue_readiness',{p_document_id:documentId}).then(({data,error})=>{if(!active)return;if(error)setError('Could not check the required UAE invoice details.');else setResult(data);});return()=>{active=false;};},[documentId]);
 if(error)return <p className="text-sm text-amber-800">{error}</p>;
 if(!result?.required)return null;
 return <section className="mt-4 rounded-lg border bg-blue-50 p-4 space-y-2"><h2 className="font-semibold">UAE e-invoice data</h2><p className="text-sm">{result.ready?'Required data is complete. Docflow validation and delivery are separate steps.':'Complete these details before issuing. You can keep this invoice as a draft.'}</p>{result.findings.length>0&&<ul className="list-disc pl-5 text-sm space-y-1">{result.findings.map((f,i)=><li key={i}>{f.message}</li>)}</ul>}<a className="inline-block text-sm text-blue-700 underline py-2" href={`/e-invoicing?document=${documentId}`}>Review structured invoice details</a></section>;
}
