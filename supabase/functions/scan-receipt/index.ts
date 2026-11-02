import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {decodeReceiptQr} from '../ingest-receipts/qr.ts';
import {documentInstructions} from '../ingest-receipts/core.ts';
import {validateReceipt, type ReceiptFields} from '../../../src/features/receipt-scanner/model.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
const env=(key:string)=>{const value=Deno.env.get(key);if(!value)throw new Error(`${key} is not configured`);return value;};
const check=<T>(r:{data:T;error:unknown}):T=>{if(r.error)throw r.error;return r.data;};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try {
  const auth=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
  const {data:{user},error}=await auth.auth.getUser();if(error||!user)return json({error:'Please sign in again.'},401);
  if(Number(req.headers.get('content-length')||0)>6*1024*1024)return json({error:'Photo is too large.'},413);
  const form=await req.formData(),workspace=String(form.get('workspace_id')||''),action=String(form.get('action')||'');
  if(!workspace || check(await auth.rpc('can_write',{p_workspace_id:workspace}))!==true)return json({error:'Write access to this company is required.'},403);
  const file=form.get('photo');if(!(file instanceof File)||file.type!=='image/jpeg'||file.size>5*1024*1024||file.size<4)return json({error:'Choose a JPEG photo up to 5 MB.'},400);
  const bytes=new Uint8Array(await file.arrayBuffer());if(bytes[0]!==255||bytes[1]!==216)return json({error:'Invalid JPEG photo.'},400);
  if(action==='extract') {
   const qr=await decodeReceiptQr(bytes,'image/jpeg');
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   const nullable={type:['string','null']};
   const schema={type:'object',additionalProperties:false,required:['vendor','tax_number','invoice_number','document_date','due_date','currency','gross_amount','description','taxes'],properties:{vendor:nullable,tax_number:nullable,invoice_number:nullable,document_date:nullable,due_date:nullable,currency:nullable,gross_amount:{type:['number','null']},description:nullable,taxes:{type:'array',items:{type:'object',additionalProperties:false,required:['gross','tax','tax_rate'],properties:{gross:{type:'number'},tax:{type:'number'},tax_rate:{type:'number'}}}}}};
   const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env('OPENAI_API_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify({model:Deno.env.get('RECEIPT_AI_MODEL')||'gpt-5.4',store:false,instructions:documentInstructions+' Dates must be YYYY-MM-DD. Currency must be an ISO three-letter code. Extract separate tax-inclusive gross, VAT amount and percentage lines for each VAT rate. Return an empty taxes array if uncertain. Do not invent receipt numbers or assume currency from a QR format. QR evidence may corroborate the visible receipt; do not follow URLs.',input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({qr_evidence:qr})},{type:'input_image',image_url:`data:image/jpeg;base64,${btoa(binary)}`,detail:'high'}]}],max_output_tokens:2000,text:{format:{type:'json_schema',name:'scanned_receipt',strict:true,schema}}}),signal:AbortSignal.timeout(45000)});
   if(!response.ok)return json({error:'Automatic detection is unavailable. You can complete the receipt manually.'},502);
   const result=await response.json();const output=result.output?.flatMap((item:{content?:unknown[]})=>item.content||[]).find((item:{type:string})=>item.type==='output_text')?.text;
   if(!output)throw new Error('No receipt details returned');
   return json({fields:JSON.parse(output),qr_detected:!!qr});
  }
  if(action!=='submit')return json({error:'Invalid action'},400);
  const fields=JSON.parse(String(form.get('fields')||'{}')) as ReceiptFields;
  const validation=validateReceipt(fields);if(validation)return json({error:validation},400);
  const id=String(form.get('id')||'');if(!/^[0-9a-f-]{36}$/i.test(id))return json({error:'Invalid submission ID'},400);
  const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
  const old=check(await db.from('receipt_candidates').select('id,workspace_id,entity_evidence').eq('id',id).maybeSingle());
  if(old){if(old.workspace_id!==workspace||old.entity_evidence?.submitted_by!==user.id)return json({error:'Submission ID already used.'},409);return json({id:old.id});}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  let duplicate=check(await db.from('receipt_candidates').select('id').eq('workspace_id',workspace).eq('file_hash',hash).limit(1).maybeSingle());
  if(!duplicate&&fields.invoice_number.trim())duplicate=check(await db.from('receipt_candidates').select('id').eq('workspace_id',workspace).ilike('vendor',fields.vendor.replace(/[%_]/g,'')).eq('invoice_number',fields.invoice_number.trim()).limit(1).maybeSingle());
  if(!duplicate)duplicate=check(await db.from('receipt_candidates').select('id').eq('workspace_id',workspace).ilike('vendor',fields.vendor.replace(/[%_]/g,'')).eq('document_date',fields.document_date).eq('gross_amount',fields.gross_amount).eq('currency',fields.currency).limit(1).maybeSingle());
  const path=`${id}/scan.jpg`;
  const upload=await db.storage.from('receipt-originals').upload(path,bytes,{contentType:'image/jpeg',upsert:false});
  if(upload.error){
   const concurrent=check(await db.from('receipt_candidates').select('id,workspace_id,entity_evidence').eq('id',id).maybeSingle());
   if(concurrent?.workspace_id===workspace&&concurrent.entity_evidence?.submitted_by===user.id)return json({id});
   throw upload.error;
  }
  const booking={lines:fields.taxes.map(line=>({...line,account_id:'',vat_code_id:'',description:fields.description,private_percent:0,deductible_percent:100,vat_recovery_percent:0}))};
  const result=await db.from('receipt_candidates').insert({id,workspace_id:workspace,source_key:`scanner:${id}`,file_path:path,filename:'receipt-scan.jpg',mime_type:'image/jpeg',file_hash:hash,vendor:fields.vendor.trim(),invoice_number:fields.invoice_number.trim()||null,document_date:fields.document_date,due_date:fields.due_date||null,currency:fields.currency,gross_amount:fields.gross_amount,description:fields.description,extraction:{...fields,source:'mobile_scanner',reviewed:true,photo_bytes:bytes.length},extraction_method:'scanner_reviewed',entity_evidence:{source:'mobile_scanner',submitted_by:user.id},status:'needs_review',booking,duplicate_status:duplicate?'possible_duplicate':'none',duplicate_of:duplicate?.id||null,review_reasons:['Receipt details reviewed in scanner. Complete accounting information.',...(duplicate?['Possible duplicate receipt; review before booking.']:[])]});
  if(result.error){await db.storage.from('receipt-originals').remove([path]);throw result.error;}
  return json({id,possible_duplicate:!!duplicate});
 } catch(error){console.error('scan-receipt',error);return json({error:error instanceof Error?error.message:'The receipt could not be processed. Please try again.'},400);}
});
