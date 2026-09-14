import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {extractText} from 'npm:unpdf@1.8.1';
import {Alias,Header,resolveEntity,attachmentKind,safeFilename,plainText,parseText,criticalComplete,documentInstructions,receiptSignature,bestLearningRule,normalizeSupplierName} from './core.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-receipt-job-key'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const env=(name:string)=>{const v=Deno.env.get(name);if(!v)throw new Error(`${name} is not configured`);return v;};
const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
function check<T>(result:{data:T;error:unknown}):T{if(result.error)throw result.error;return result.data;}
interface GraphMessage{id:string;internetMessageId?:string;subject?:string;receivedDateTime?:string;from?:{emailAddress:{address:string}};toRecipients?:{emailAddress:{address:string}}[];ccRecipients?:{emailAddress:{address:string}}[];internetMessageHeaders?:Header[];body?:{content:string;contentType:string};'@removed'?:unknown}
interface Attachment{id:string;name:string;contentType:string;size:number;isInline:boolean;'@odata.type':string}
interface Mailbox{id:string;mailbox:string;enabled:boolean;ai_enabled:boolean;start_at:string;delta_url:string|null}
const schema={type:'object',additionalProperties:false,required:['vendor','document_date','currency','gross_amount','invoice_number','description'],properties:{vendor:{type:['string','null']},document_date:{type:['string','null']},currency:{type:['string','null']},gross_amount:{type:['number','null']},invoice_number:{type:['string','null']},description:{type:'string'}}};
async function request(url:string,token:string){
 if(!url.startsWith('https://graph.microsoft.com/v1.0/'))throw new Error('Unexpected Graph URL');
 const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Prefer:'IdType="ImmutableId", outlook.body-content-type="text", odata.maxpagesize=20'},signal:AbortSignal.timeout(25000)});
 if(!res.ok)throw new Error(`Graph ${res.status}${res.status===429?' throttled; retry after '+(res.headers.get('Retry-After')||'60')+' seconds':''}${res.status===410?' delta token expired; reset cursor through administrator recovery':''}`);
 return res;
}
async function token(){const r=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env('MS_ENTRA_TENANT_ID'))}/oauth2/v2.0/token`,{method:'POST',body:new URLSearchParams({client_id:env('MS_ENTRA_CLIENT_ID'),client_secret:env('MS_ENTRA_CLIENT_SECRET'),grant_type:'client_credentials',scope:'https://graph.microsoft.com/.default'}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`Microsoft authentication failed (${r.status})`);return(await r.json()).access_token as string;}
async function event(receipt_id:string,event:string,details:Record<string,unknown>={}){check(await db.from('receipt_processing_events').insert({receipt_id,event,details}));console.log(JSON.stringify({event,receipt_id}));}
async function aiExtract(id:string,text:string,bytes:Uint8Array|null,mime:string){
 const model=Deno.env.get('RECEIPT_AI_MODEL')||'gpt-5.4';
 const content:Record<string,unknown>[]=[{type:'input_text',text:JSON.stringify({untrusted_document_excerpt:text.slice(0,12000)})}];
 if(!text.trim()&&bytes){
 if(bytes.length>5*1024*1024)throw new Error('Image exceeds vision fallback limit; manual review required');
 if(!['image/jpeg','image/png'].includes(mime))throw new Error('Scanned PDF / HEIC requires OCR or manual entry; original preserved');
 let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 content.push({type:'input_image',image_url:`data:${mime};base64,${btoa(binary)}`,detail:'high'});
 }
 const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env('OPENAI_API_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,instructions:documentInstructions,input:[{role:'user',content}],max_output_tokens:1200,text:{format:{type:'json_schema',name:'receipt',strict:true,schema}}}),signal:AbortSignal.timeout(45000)});
 if(!res.ok)throw new Error(`AI extraction failed (${res.status})`);
 const data=await res.json();
 check(await db.from('receipt_ai_usage').insert({receipt_id:id,task:text.trim()?'structured_extraction':'vision_extraction',model,input_tokens:data.usage?.input_tokens,output_tokens:data.usage?.output_tokens}));
 const output=data.output?.flatMap((o:{content?:{type:string;text?:string}[]})=>o.content||[]).find((o:{type:string})=>o.type==='output_text')?.text;
 if(!output)throw new Error('AI returned no extraction');
 const result=JSON.parse(output) as ReturnType<typeof parseText>;
 if(result.gross_amount!==null&&(!Number.isFinite(result.gross_amount)||result.gross_amount<=0))result.gross_amount=null;
 if(result.document_date&&!/^\d{4}-\d{2}-\d{2}$/.test(result.document_date))result.document_date=null;
 if(result.currency&&!/^[A-Z]{3}$/.test(result.currency))result.currency=null;
 return result;
}
async function extractCandidate(id:string,box:Mailbox){
 const r=check(await db.from('receipt_candidates').select('*').eq('id',id).single());
 if(r.status!=='received')return;
 check(await db.from('receipt_candidates').update({status:'extracting',updated_at:new Date().toISOString()}).eq('id',id).eq('status','received'));
 try{
 const source=check(await db.from('receipt_emails').select('sender,subject,body_text').eq('id',r.email_id).maybeSingle());
 let bytes:Uint8Array|null=null,text='';
 if(r.file_path){const blob=check(await db.storage.from('receipt-originals').download(r.file_path));bytes=new Uint8Array(await blob.arrayBuffer());}
 if(r.mime_type==='text/plain'&&bytes)text=new TextDecoder().decode(bytes);
 else if(r.mime_type==='application/pdf'&&bytes){const pdf=await extractText(bytes,{mergePages:true});text=pdf.text;}
 let parsed=parseText(text);let method=r.mime_type==='application/pdf'?'pdf_text':'text_rules';
 if(!criticalComplete(parsed)&&box.ai_enabled){await event(id,'ai_extraction_requested');parsed=await aiExtract(id,text,bytes,r.mime_type);method=text?'ai_structured_text':'vision';}
 const reasons=['Confirm booking accounts, private use and tax treatment'];
 if(!r.workspace_id)reasons.push('Receiving alias unknown or conflicting');
 if(!criticalComplete(parsed))reasons.push('Critical invoice fields missing or uncertain');
 let duplicate_status='none',duplicate_of=null;
 if(r.workspace_id&&parsed.vendor&&parsed.invoice_number){const duplicates=check(await db.from('receipt_candidates').select('id,status').eq('workspace_id',r.workspace_id).ilike('vendor',parsed.vendor.replace(/[%_]/g,'')).eq('invoice_number',parsed.invoice_number).neq('id',id).limit(1));if(duplicates.length){duplicate_status='possible_duplicate';duplicate_of=duplicates[0].id;reasons.push('Matching supplier invoice number');}}
 if(duplicate_status==='none'&&r.workspace_id&&parsed.vendor&&parsed.document_date&&parsed.gross_amount){const matches=check(await db.from('receipt_candidates').select('id').eq('workspace_id',r.workspace_id).ilike('vendor',parsed.vendor.replace(/[%_]/g,'')).eq('document_date',parsed.document_date).eq('gross_amount',parsed.gross_amount).eq('currency',parsed.currency).neq('id',id).limit(1));if(matches.length){duplicate_status='possible_duplicate';duplicate_of=matches[0].id;reasons.push('Matching vendor, date, amount and currency');}}
 const signature=receiptSignature(source?.sender,source?.subject,source?.body_text?.slice(0,12000),parsed.vendor,parsed.description);
 let account_id='';if(r.workspace_id&&parsed.vendor){const rule=check(await db.from('receipt_vendor_rules').select('account_id').eq('workspace_id',r.workspace_id).eq('vendor_normalized',parsed.vendor.toLowerCase().trim()).eq('enabled',true).maybeSingle());account_id=rule?.account_id||'';}
 let supplier_id:string|null=null;
 if(r.workspace_id&&parsed.vendor){const suppliers=check(await db.from('counterparties').select('id,name,company_name,alias').eq('workspace_id',r.workspace_id).or('kind.eq.vendor,kind.eq.both').limit(200));const target=normalizeSupplierName(parsed.vendor);const match=suppliers.find(s=>[s.company_name,s.name,s.alias].some(value=>normalizeSupplierName(value)===target));supplier_id=match?.id||null;}
 let booking={lines:[{account_id,vat_code_id:'',gross:parsed.gross_amount||0,tax:0,tax_rate:0,description:parsed.description,private_percent:0,deductible_percent:100,vat_recovery_percent:0}]};
 let learned:null|{score:number;rule:{vendor_template:string|null;description_template:string;booking_template:typeof booking}}=null;
 if(r.workspace_id&&signature){const rules=check(await db.from('receipt_learning_rules').select('source_signature,similarity_threshold,vendor_template,description_template,booking_template').eq('workspace_id',r.workspace_id).eq('enabled',true).order('last_confirmed',{ascending:false}).limit(50));learned=bestLearningRule(signature,rules) as typeof learned;}
 if(learned){
   const template=learned.rule.booking_template;
   booking={...template,lines:(template.lines||[]).map((line,index)=>({...line,gross:index===0&&parsed.gross_amount!==null?parsed.gross_amount:line.gross,description:line.description||learned!.rule.description_template}))};
   account_id=booking.lines[0]?.account_id||account_id;
   if(!parsed.vendor)parsed.vendor=learned.rule.vendor_template;
   if(!parsed.description)parsed.description=learned.rule.description_template;
   reasons.push(`Prefilled from a confirmed receipt (${Math.round(learned.score*100)}% similar); review before booking`);
 }
 if(supplier_id)reasons.push('Matched existing supplier record');
 check(await db.from('receipt_candidates').update({...parsed,source_signature:signature,supplier_id,extraction:parsed,extraction_method:method,confidence:{entity:r.workspace_id?1:0,extraction:criticalComplete(parsed)?.85:.4,category:account_id?1:0,learned_booking:learned?.score||0,supplier:supplier_id?1:0},status:'needs_review',duplicate_status,duplicate_of,review_reasons:reasons,booking,updated_at:new Date().toISOString()}).eq('id',id));
 await event(id,'extraction_completed',{method,duplicate_status});
 }catch(e){const message=e instanceof Error?e.message:'Extraction failed';check(await db.from('receipt_candidates').update({status:'failed',failure_reason:message,updated_at:new Date().toISOString()}).eq('id',id));await event(id,'processing_failed',{reason:message});}
}
async function discover(box:Mailbox,m:GraphMessage,access:string,aliases:Alias[]){
 const recipients=[...(m.toRecipients||[]),...(m.ccRecipients||[])].map(r=>r.emailAddress.address);
 const entity=resolveEntity(recipients,m.internetMessageHeaders||[],aliases);
 const email=check(await db.from('receipt_emails').upsert({mailbox_id:box.id,graph_id:m.id,internet_message_id:m.internetMessageId,sender:m.from?.emailAddress.address,subject:m.subject,received_at:m.receivedDateTime,recipients,headers:entity.evidence,body_text:plainText(m.body?.content||'').slice(0,100000)},{onConflict:'mailbox_id,graph_id',ignoreDuplicates:true}));void email;
 const source=check(await db.from('receipt_emails').select('*').eq('mailbox_id',box.id).eq('graph_id',m.id).single());
 if(source.status==='processed')return;
 const root=`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(box.mailbox)}/messages/${encodeURIComponent(m.id)}`;
 let next:string|null=`${root}/attachments?$select=id,name,contentType,size,isInline`;
 const attachments:Attachment[]=[];
 while(next){const page=await(await request(next,access)).json();attachments.push(...page.value);next=page['@odata.nextLink']||null;if(attachments.length>100)throw new Error('Too many attachments; requires manual review');}
 let documents=0;
 for(const a of attachments){
 const kind=attachmentKind(a.name,a.contentType,a.size,a.isInline);
 if(kind==='decorative')continue;
 const existing=check(await db.from('receipt_candidates').select('id,file_path,status').eq('email_id',source.id).eq('source_key',a.id).maybeSingle());
 if(existing?.file_path){documents++;continue;}
 if(kind!=='document'||a['@odata.type']!=='#microsoft.graph.fileAttachment'){
 check(await db.from('receipt_candidates').upsert({email_id:source.id,source_key:a.id,workspace_id:entity.workspace_id,receiving_alias:entity.receiving_alias,entity_evidence:entity,filename:safeFilename(a.name),mime_type:a.contentType,status:'failed',failure_reason:`Attachment ${kind}; original remains in source mailbox`},{onConflict:'email_id,source_key',ignoreDuplicates:true}));continue;
 }
 documents++;
 const id=existing?.id||crypto.randomUUID();
 if(!existing)check(await db.from('receipt_candidates').insert({id,email_id:source.id,source_key:a.id,workspace_id:entity.workspace_id,receiving_alias:entity.receiving_alias,entity_evidence:entity,filename:safeFilename(a.name),mime_type:a.contentType}));
 const bytes=new Uint8Array(await(await request(`${root}/attachments/${encodeURIComponent(a.id)}/$value`,access)).arrayBuffer());
 if(bytes.length>20*1024*1024)throw new Error('Attachment exceeds size limit');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const duplicates=check(await db.from('receipt_candidates').select('id').eq('file_hash',hash).neq('id',id).not('file_path','is',null).order('created_at').limit(1));
 const path=`${id}/original`;
 const stored=await db.storage.from('receipt-originals').upload(path,bytes,{contentType:a.contentType,upsert:false});if(stored.error&&stored.error.message!=='The resource already exists')throw stored.error;
 check(await db.from('receipt_candidates').update({file_path:path,file_hash:hash,...(duplicates.length?{status:'duplicate',duplicate_status:'confirmed_duplicate',duplicate_of:duplicates[0].id}:{})}).eq('id',id));
 await event(id,duplicates.length?'duplicate_detected':'attachment_discovered');
 }
 if(!documents){const text=plainText(m.body?.content||'');const id=crypto.randomUUID();const source_key='body';const old=check(await db.from('receipt_candidates').select('id').eq('email_id',source.id).eq('source_key',source_key).maybeSingle());if(!old){check(await db.from('receipt_candidates').insert({id,email_id:source.id,source_key,workspace_id:entity.workspace_id,receiving_alias:entity.receiving_alias,entity_evidence:entity,filename:'email-body.txt',mime_type:'text/plain'}));const path=`${id}/original`;check(await db.storage.from('receipt-originals').upload(path,text,{contentType:'text/plain'}));check(await db.from('receipt_candidates').update({file_path:path}).eq('id',id));}}
 check(await db.from('receipt_emails').update({status:'processed',error:null,attempts:source.attempts+1}).eq('id',source.id));
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Method not allowed'},405);
 let mailboxId:string|null=null;
 try{
 const jobKey=Deno.env.get('RECEIPT_JOB_KEY');const isJob=!!jobKey&&req.headers.get('x-receipt-job-key')===jobKey;
 const body=await req.json();
 const auth=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
 if(!isJob){const{data:{user},error}=await auth.auth.getUser();if(error||!user)return json({error:'Unauthorized'},401);if(!body.mailbox_id)return json({error:'Mailbox required'},400);const allowed=check(await auth.rpc('can_review_receipt_mailbox',{p_id:body.mailbox_id}));if(!allowed)return json({error:'Forbidden'},403);}
 const query=db.from('receipt_mailboxes').select('*');const boxes:Mailbox[]=check(await(body.mailbox_id?query.eq('id',body.mailbox_id):query.eq('enabled',true)));
 const access=await token();
 for(const box of boxes){mailboxId=box.id;
 const lease=check(await db.rpc('claim_receipt_mailbox',{p_id:box.id}));if(!lease)continue;
 try{
 const aliases:Alias[]=check(await db.from('receipt_aliases').select('alias,workspace_id').eq('mailbox_id',box.id));
 const root=`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(box.mailbox)}`;
 const url=box.delta_url||`${root}/mailFolders/inbox/messages/delta?$select=id,receivedDateTime&$filter=receivedDateTime%20ge%20${encodeURIComponent(box.start_at)}`;
 const page=await(await request(url,access)).json();
 for(const item of page.value as GraphMessage[]){if(item['@removed'])continue;const message:GraphMessage=await(await request(`${root}/messages/${encodeURIComponent(item.id)}?$select=id,internetMessageId,subject,receivedDateTime,from,toRecipients,ccRecipients,internetMessageHeaders,body`,access)).json();await discover(box,message,access,aliases);}
 check(await db.from('receipt_mailboxes').update({delta_url:page['@odata.nextLink']||page['@odata.deltaLink'],last_success:new Date().toISOString(),last_error:null}).eq('id',box.id));
 const pending=check(await db.from('receipt_candidates').select('id,receipt_emails!inner(mailbox_id)').eq('receipt_emails.mailbox_id',box.id).eq('status','received').limit(3));
 for(const r of pending)await extractCandidate(r.id,box);
 }finally{check(await db.from('receipt_mailboxes').update({lease_until:null}).eq('id',box.id));}
 }
 return json({ok:true});
 }catch(e){const message=e instanceof Error?e.message:'Ingestion failed';if(mailboxId)await db.from('receipt_mailboxes').update({last_error:message,lease_until:null}).eq('id',mailboxId);console.error(JSON.stringify({event:'ingestion_failed',mailbox_id:mailboxId,reason:message}));return json({error:message},500);}
});
