import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
import {Button} from '../../components/Button';
import {Input} from '../../components/Input';
import type {Row} from './core';
export function DocFlowConnection({workspaceId,documentId,onConnection}:{workspaceId:string;documentId:string;onConnection:(id:string)=>void}){
 const [canAdmin,setCanAdmin]=useState(false);
 const [status,setStatus]=useState<Row|null>(null),[companyId,setCompanyId]=useState(''),[token,setToken]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[response,setResponse]=useState<unknown>(null);
 const call=async(action:string,extra:Row={})=>{const {data,error}=await supabase.functions.invoke('docflow-sandbox',{body:{action,workspace_id:workspaceId,...extra}});if(error){let msg=error.message;try{const detail=await error.context.json();msg=detail.error||msg;if(detail.findings)msg+=' '+detail.findings.map((f:{message:string})=>f.message).join(' ');}catch{/* network fallback */}throw new Error(msg);}if(data.error)throw new Error(data.error);return data;};
 useEffect(()=>{let active=true;setStatus(null);setCanAdmin(false);setMessage('');setToken('');setResponse(null);void Promise.all([call('status'),supabase.rpc('can_admin',{p_workspace_id:workspaceId})]).then(([data,permission])=>{if(!active)return;setStatus(data);setCanAdmin(!permission.error&&permission.data===true);setCompanyId(data.companyId||'');onConnection(data.companyId||'');}).catch(error=>{if(active)setMessage(error.message);});return()=>{active=false;};},[workspaceId]);
 const run=async(action:string)=>{setBusy(true);setMessage('');setResponse(null);try{const result=await call(action,action==='connect'?{company_id:companyId,access_token:token}:action==='validate'?{document_id:documentId}:{});setToken('');if(action==='validate'){setResponse(result.providerResponse);setMessage(result.message);}else{setStatus(result);onConnection(action==='disconnect'?'':companyId);setMessage(action==='connect'?'Sandbox company identity verified. Production remains inactive.':'Sandbox credentials removed.');}}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}};
 return <section className="rounded-xl border bg-white p-5 space-y-4"><h2 className="text-lg font-semibold">Connection status</h2>
 {message&&<p role="status" className="rounded-lg bg-blue-50 p-3 text-sm">{message}</p>}
 {!status?<p className="text-sm text-gray-500">{message?'Connection details are unavailable.':'Checking connection…'}</p>:<>
 <p className="text-sm">{status.connected===true?'Sandbox connected':'Sandbox not connected'} · Production inactive</p>
 <p className="text-sm text-gray-600">Connection setup is managed once per company. It is separate from entering or reviewing invoices.</p>
 {canAdmin&&<details onToggle={event=>{if(!event.currentTarget.open)setToken('');}} className="border-t pt-3"><summary className="cursor-pointer text-sm text-blue-700 min-h-11 py-3">Advanced connection settings</summary><div className="space-y-3 pt-2">
 <p className="text-sm text-gray-500">For company administrators managing the Docflow test connection. Production delivery is not enabled here.</p>
 {status.connected===true?<Button variant="secondary" disabled={busy} onClick={()=>void run('disconnect')}>Disconnect sandbox</Button>:<><Input label="Docflow sandbox company ID" aria-label="Docflow sandbox company ID" value={companyId} onChange={e=>setCompanyId(e.target.value)}/><Input type="password" autoComplete="off" label="Sandbox access token" aria-label="Sandbox access token" value={token} onChange={e=>setToken(e.target.value)}/><Button disabled={busy||!companyId||!token} onClick={()=>void run('connect')}>Verify and connect sandbox</Button></>}
 </div></details>}
 </>}
 {status?.connected===true&&documentId&&<div className="space-y-2"><Button disabled={busy} onClick={()=>void run('validate')}>{busy?'Checking…':'Validate saved invoice in sandbox'}</Button><p className="text-sm text-gray-500">Save invoice preparation details first. This sends the saved invoice data to Docflow’s sandbox validation endpoint. It does not create or deliver an invoice.</p></div>}
 {response!==null&&<details open><summary className="cursor-pointer font-medium">Provider response · not production approval</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-3 text-xs">{JSON.stringify(response,null,2)}</pre></details>}
 </section>;
}
