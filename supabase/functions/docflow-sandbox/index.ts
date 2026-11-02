import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {createDocFlowSandbox} from '../_shared/docflow-sandbox.ts';
import {sealToken,openToken} from '../_shared/docflow-credentials.ts';
import {mapDocFlow} from '../../../src/features/einvoicing/docflow.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json'}});
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error('Server configuration unavailable');return value;};
const check=<T>(r:{data:T;error:unknown}):T=>{if(r.error)throw r.error;return r.data;};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  if(Number(req.headers.get('content-length')||0)>20000)return json({error:'Request too large'},413);
  const auth=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
  const {data:{user},error}=await auth.auth.getUser();if(error||!user)return json({error:'Please sign in again.'},401);
  const body=await req.json(),workspace=String(body.workspace_id||'');
  if(!uuid.test(workspace))return json({error:'Choose a company.'},400);
  if(check(await auth.rpc('can_write',{p_workspace_id:workspace}))!==true)return json({error:'Company write access is required.'},403);
  const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
  const company=check(await db.from('workspaces').select('country').eq('id',workspace).single());
  if(company.country!=='AE')return json({error:'Choose a UAE company.'},400);
  const connection=check(await db.from('docflow_connections').select('*').eq('workspace_id',workspace).maybeSingle());
  if(body.action==='status')return json({connected:!!connection,environment:'sandbox',companyId:connection?.provider_company_id||null,updatedAt:connection?.updated_at||null,productionEnabled:false});
  if(body.action==='connect'||body.action==='disconnect'){
   if(check(await auth.rpc('can_admin',{p_workspace_id:workspace}))!==true)return json({error:'Only a company administrator can change this connection.'},403);
   if(body.action==='disconnect'){check(await db.from('docflow_connections').delete().eq('workspace_id',workspace));return json({connected:false});}
   const companyId=String(body.company_id||''),accessToken=String(body.access_token||'').trim();
   if(!uuid.test(companyId)||!accessToken||accessToken.length>12000||/[\r\n]/.test(accessToken))return json({error:'Enter the company ID and sandbox access token issued by Docflow.'},400);
   const settings=check(await db.from('einvoice_settings').select('tin,vat_registered').eq('workspace_id',workspace).single());
   const profile=check(await db.from('company_legal_profiles').select('vat_number').eq('workspace_id',workspace).single());
   const binding={workspaceId:workspace,providerCompanyId:companyId,tin:settings.tin,vatTrn:profile.vat_number,environment:'sandbox' as const};
   const client=createDocFlowSandbox(binding,{getAccessToken:async()=>accessToken});await client.verifyCompany();
   const encrypted=await sealToken(accessToken,env('DOCFLOW_CREDENTIAL_ENCRYPTION_KEY'),`${workspace}:${companyId}`);
   check(await db.from('docflow_connections').upsert({workspace_id:workspace,provider_company_id:companyId,tin:settings.tin,vat_trn:profile.vat_number,encrypted_access_token:encrypted,updated_by:user.id,updated_at:new Date().toISOString()}));
   return json({connected:true,environment:'sandbox',productionEnabled:false});
  }
  if(body.action!=='validate')return json({error:'Unknown action.'},400);
  if(!connection)return json({error:'Connect this company’s Docflow sandbox account first.'},400);
  const documentId=String(body.document_id||'');if(!uuid.test(documentId))return json({error:'Choose an invoice.'},400);
  const context=check(await auth.rpc('einvoice_preparation_context',{p_document_id:documentId}));
  if(context.workspace.id!==workspace)return json({error:'The invoice belongs to another company.'},403);
  const mapping=mapDocFlow(context,connection.provider_company_id);
  if(!mapping.ready)return json({error:'Complete the invoice details before sandbox validation.',findings:mapping.findings},422);
  const last=check(await db.from('docflow_validations').select('created_at').eq('workspace_id',workspace).order('created_at',{ascending:false}).limit(1).maybeSingle());
  if(last&&Date.now()-Date.parse(last.created_at)<10000)return json({error:'Please wait a few seconds before validating again.'},429);
  const binding={workspaceId:workspace,providerCompanyId:connection.provider_company_id,tin:connection.tin,vatTrn:connection.vat_trn,environment:'sandbox' as const};
  const client=createDocFlowSandbox(binding,{getAccessToken:()=>openToken(connection.encrypted_access_token,env('DOCFLOW_CREDENTIAL_ENCRYPTION_KEY'),`${workspace}:${connection.provider_company_id}`)});
  const result=await client.validateCandidate(mapping.payload!);
  const record=check(await db.from('docflow_validations').insert({workspace_id:workspace,document_id:documentId,payload:mapping.payload,provider_response:result.providerResponse,validation_verified:result.validationVerified,created_by:user.id}).select('id').single());
  return json({id:record.id,environment:'sandbox',submitted:false,productionEnabled:false,validationVerified:result.validationVerified,providerResponse:result.providerResponse,message:result.validationVerified?'Sandbox validation passed. No invoice was created, delivered or reported.':'Sandbox response received. Review the provider findings; no invoice was sent.'});
 }catch(error){
  // Deliberately do not log credentials, full invoice content or provider error bodies.
  const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';
  const known=['company_identity_mismatch','candidate_identity_mismatch','authorization_failed','network_or_timeout','rate_limited','invalid_binding'];
  return json({error:known.includes(code)?`Docflow sandbox: ${code}. Check the company identity and token, then try again.`:'The sandbox operation could not be completed. Check company setup and sandbox access.'},400);
 }
});
