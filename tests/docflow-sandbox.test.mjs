import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocFlowSandbox} from '../supabase/functions/_shared/docflow-sandbox.ts';
const scope=()=>({workspaceId:'00000000-0000-0000-0000-000000000001',providerCompanyId:'00000000-0000-0000-0000-000000000002',tin:'1001234567',vatTrn:'100123456700003',environment:'sandbox'});
const company=()=>({id:scope().providerCompanyId,tin:scope().tin,trn:scope().vatTrn,isVATRegistered:true,peppolParticipantId:`0235:${scope().tin}`,status:1});
const candidate=()=>({companyId:scope().providerCompanyId,isDraft:false,seller:{taxRegistration:{id:scope().tin},taxIdentifier:{id:scope().vatTrn},electronicAddress:{id:scope().tin,schemeId:'0235'}}});
const json=data=>new Response(JSON.stringify({success:true,data}),{status:200,headers:{'content-type':'application/json'}});
test('sandbox verification binds credential lookup to one immutable company',async()=>{
 const binding=scope();const calls=[];const client=createDocFlowSandbox(binding,{getAccessToken:async b=>{calls.push(b);return 'test-token';},fetch:async(url,options)=>{assert.equal(url,`https://sandbox-api.docflow.ae/api/v1/companies/${scope().providerCompanyId}`);assert.equal(options.redirect,'error');return json(company());}});
 binding.workspaceId='changed';const result=await client.verifyCompany();assert.equal(calls[0].workspaceId,scope().workspaceId);assert.equal(result.identityMatched,true);assert.equal(result.activationVerified,false);
});
test('candidate validation cannot create or submit an invoice',async()=>{
 const requests=[];const client=createDocFlowSandbox(scope(),{getAccessToken:async()=> 'test-token',fetch:async(url,options)=>{requests.push([url,options]);return json(requests.length===1?company():{valid:true});}});
 const result=await client.validateCandidate(candidate());assert.equal(requests.length,2);assert.equal(requests[1][0],'https://sandbox-api.docflow.ae/api/v1/invoices/validate');assert.equal(JSON.parse(requests[1][1].body).isDraft,true);assert.equal(result.submitted,false);assert.equal(result.validationVerified,false);
});
test('wrong invoice identity is rejected before any credential lookup or request',async()=>{
 let called=false;const client=createDocFlowSandbox(scope(),{getAccessToken:async()=>{called=true;return 'token';},fetch:async()=>{called=true;return json(company());}});
 for(const body of [{...candidate(),companyId:scope().workspaceId},{...candidate(),seller:{}}])await assert.rejects(client.validateCandidate(body),/candidate_identity_mismatch/);
 assert.equal(called,false);
});
test('wrong provider company prevents validation',async()=>{
 let n=0;const client=createDocFlowSandbox(scope(),{getAccessToken:async()=> 'test-token',fetch:async()=>{n++;return json({...company(),tin:'9999999999'});}});
 await assert.rejects(client.validateCandidate(candidate()),/company_identity_mismatch/);assert.equal(n,1);
});
test('production binding and malformed identifiers are rejected',()=>{
 for(const b of [{...scope(),environment:'production'},{...scope(),providerCompanyId:'../../elsewhere'},{...scope(),tin:'123'}])assert.throws(()=>createDocFlowSandbox(b,{getAccessToken:async()=> 'token'}),/invalid_binding/);
});
test('transport failures are sanitized and are not retried automatically',async()=>{
 for(const response of [new Response('secret',{status:401}),new Response('secret',{status:429}),new Response('not json',{status:200})]){
 let n=0;const client=createDocFlowSandbox(scope(),{getAccessToken:async()=> 'secret-token',fetch:async()=>{n++;return response;}});
 await assert.rejects(client.verifyCompany(),e=>!e.message.includes('secret'));assert.equal(n,1);
 }
 const client=createDocFlowSandbox(scope(),{getAccessToken:async()=> 'token',fetch:async()=>{throw new Error('secret-token');}});await assert.rejects(client.verifyCompany(),/network_or_timeout/);
});
test('recognizes the observed successful response without confusing it with delivery',async()=>{
 let calls=0;const client=createDocFlowSandbox(scope(),{getAccessToken:async()=> 'test-token',fetch:async()=>++calls===1?json(company()):new Response(JSON.stringify({success:true,data:{isValid:true,message:'Invoice payload is valid.',invoiceNumber:'SYNTHETIC'},errors:[]}))});
 const result=await client.validateCandidate(candidate());assert.equal(result.validationVerified,true);assert.equal(result.submitted,false);assert.equal(result.environment,'sandbox');
});
test('retains documented field validation errors rather than losing the response on HTTP 400',async()=>{
 let calls=0;const client=createDocFlowSandbox(scope(),{getAccessToken:async()=> 'test-token',fetch:async()=>++calls===1?json(company()):new Response(JSON.stringify({success:false,data:null,errors:[{field:'TaxCurrency.Code',message:'Tax currency must differ from document currency.',code:null}]}),{status:400})});
 const result=await client.validateCandidate(candidate());assert.equal(result.validationVerified,false);assert.equal(result.providerResponse.errors[0].field,'TaxCurrency.Code');
});
