import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]!));

async function graphSend(to:string,subject:string,html:string){
  const tenant=Deno.env.get('MS_ENTRA_TENANT_ID');const client=Deno.env.get('MS_ENTRA_CLIENT_ID');const secret=Deno.env.get('MS_ENTRA_CLIENT_SECRET');const sender=Deno.env.get('MS_GRAPH_SENDER')?.toLowerCase();
  if(!tenant||!client||!secret||!sender)throw new Error('Microsoft email is not configured');
  const tokenResponse=await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client,client_secret:secret,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'})});
  if(!tokenResponse.ok)throw new Error(`Microsoft authentication failed (${tokenResponse.status})`);
  const token=await tokenResponse.json();
  const sent=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({message:{subject,body:{contentType:'HTML',content:html},toRecipients:[{emailAddress:{address:to}}]},saveToSentItems:true})});
  if(!sent.ok)throw new Error(`Microsoft Graph rejected the email (${sent.status})`);
  return sender;
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    if(request.method!=='POST')return reply({error:'Method not allowed'},405);
    const url=Deno.env.get('SUPABASE_URL')!;const anon=Deno.env.get('SUPABASE_ANON_KEY')!;const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization=request.headers.get('Authorization')??'';const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}});const{data:{user}}=await userClient.auth.getUser();if(!user)return reply({error:'Unauthorized'},401);
    const{invoice_id,action,collection_recipient}=await request.json();if(!invoice_id||!['reminder_1','reminder_2','collection'].includes(action))throw new Error('Invalid escalation request');
    const admin=createClient(url,service);
    const{data:invoice,error:invoiceError}=await admin.from('sales_documents').select('*,customer:counterparties(email,company_name,alias,street_address,zip,city,country,vat_trn)').eq('id',invoice_id).eq('document_type','invoice').single();
    if(invoiceError||!invoice)throw new Error('Invoice not found');
    const{data:member}=await admin.from('workspace_members').select('role').eq('workspace_id',invoice.workspace_id).eq('user_id',user.id).maybeSingle();if(!member||!['owner','admin','writer','accountant'].includes(member.role))return reply({error:'Not authorized'},403);
    const customer=Array.isArray(invoice.customer)?invoice.customer[0]:invoice.customer;const balance=Number(invoice.total)-Number(invoice.amount_paid);if(balance<=0)throw new Error('Invoice is already paid');
    const{data:reminders}=await admin.from('payment_reminders').select('*').eq('invoice_id',invoice_id).order('reminder_level');

    if(action==='collection'){
      if(!reminders?.some(item=>item.reminder_level===1&&item.status==='sent')||!reminders?.some(item=>item.reminder_level===2&&item.status==='sent'))throw new Error('Both reminders must be sent before collection referral');
      const recipient=String(collection_recipient||'').trim().toLowerCase();if(!recipient||!recipient.includes('@'))throw new Error('Enter the collection agency email address');
      const{data:existing}=await admin.from('collection_referrals').select('*').eq('invoice_id',invoice_id).maybeSingle();if(existing?.status==='sent')throw new Error('This invoice was already referred for collection');
      const{data:link}=await admin.from('sales_document_links').select('source_document_id').eq('target_document_id',invoice_id).eq('link_type','quote_to_invoice').maybeSingle();
      const documentIds=[invoice_id,...(link?.source_document_id?[link.source_document_id]:[])];const{data:documents}=await admin.from('sales_documents').select('id,document_type,document_number,issue_date,due_date,currency,total,terms_text,header_text').in('id',documentIds);const{data:lines}=await admin.from('sales_document_lines').select('document_id,line_no,description,quantity,unit_price,gross_amount').in('document_id',documentIds).order('line_no');
      const documentHtml=(documents||[]).map(doc=>`<h3>${esc(doc.document_type)} ${esc(doc.document_number)}</h3><p>Issue date: ${esc(doc.issue_date)}${doc.due_date?` · Due: ${esc(doc.due_date)}`:''}<br>Total: ${esc(doc.currency)} ${Number(doc.total).toFixed(2)}</p><ul>${(lines||[]).filter(line=>line.document_id===doc.id).map(line=>`<li>${esc(line.description)} — ${esc(line.quantity)} × ${Number(line.unit_price).toFixed(2)} = ${Number(line.gross_amount).toFixed(2)}</li>`).join('')}</ul>`).join('');
      const reminderHtml=(reminders||[]).map(item=>`<h3>Reminder ${item.reminder_level} — ${esc(item.reminder_date)}</h3><p>${esc(item.message).replace(/\n/g,'<br>')}</p><p>Balance: ${esc(invoice.currency)} ${Number(item.balance_at_reminder||0).toFixed(2)} · Late fee: ${esc(invoice.currency)} ${Number(item.late_fee_amount||0).toFixed(2)}</p>`).join('');
      const html=`<p>Please review the following account for collection.</p><p><strong>Customer:</strong> ${esc(customer?.company_name||customer?.alias)}<br><strong>Current outstanding balance:</strong> ${esc(invoice.currency)} ${balance.toFixed(2)}</p>${documentHtml}${reminderHtml}`;
      const referralPayload={workspace_id:invoice.workspace_id,invoice_id,recipient_email:recipient,status:'sending',created_by:user.id,last_error:null};const referral=existing?await admin.from('collection_referrals').update(referralPayload).eq('id',existing.id).select('id').single():await admin.from('collection_referrals').insert(referralPayload).select('id').single();if(referral.error)throw referral.error;
      try{await graphSend(recipient,`Collection package — invoice ${invoice.document_number}`,html);await admin.from('collection_referrals').update({status:'sent',sent_at:new Date().toISOString()}).eq('id',referral.data.id)}catch(error){await admin.from('collection_referrals').update({status:'failed',last_error:error instanceof Error?error.message:String(error)}).eq('id',referral.data.id);throw error}
      await admin.from('audit_events').insert({workspace_id:invoice.workspace_id,entity_type:'invoice',entity_id:invoice_id,action:'referred_for_collection',created_by:user.id,details:{recipient_email:recipient}});return reply({sent:true,recipient});
    }

    if(invoice.due_date&&invoice.due_date>=new Date().toISOString().slice(0,10))throw new Error('Invoice is not overdue');
    const level=action==='reminder_1'?1:2;const previous=reminders?.find(item=>item.reminder_level===level);if(previous?.status==='sent')throw new Error(`Reminder ${level} was already sent`);if(level===2&&!reminders?.some(item=>item.reminder_level===1&&item.status==='sent'))throw new Error('Send the first reminder before the second');
    const recipient=customer?.email?.trim()?.toLowerCase();if(!recipient)throw new Error('The customer has no email address');const feeRate=level===2?0.04:0;const fee=Math.round(balance*feeRate*100)/100;const message=level===1?`This is a friendly reminder that invoice ${invoice.document_number} with an outstanding balance of ${invoice.currency} ${balance.toFixed(2)} is overdue. Please arrange payment.`:`This is the second reminder for invoice ${invoice.document_number}. Outstanding balance: ${invoice.currency} ${balance.toFixed(2)}. Late fee (4%): ${invoice.currency} ${fee.toFixed(2)}. Total requested: ${invoice.currency} ${(balance+fee).toFixed(2)}.`;const subject=`${level===1?'First':'Second'} payment reminder — invoice ${invoice.document_number}`;
    const reminderPayload={workspace_id:invoice.workspace_id,invoice_id,reminder_level:level,reminder_date:new Date().toISOString().slice(0,10),status:'sending',subject,message,balance_at_reminder:balance,late_fee_rate:feeRate,late_fee_amount:fee,recipient_email:recipient,created_by:user.id,sent_at:null};const saved=previous?await admin.from('payment_reminders').update(reminderPayload).eq('id',previous.id).select('id').single():await admin.from('payment_reminders').insert(reminderPayload).select('id').single();if(saved.error)throw saved.error;
    try{await graphSend(recipient,subject,`<p>Dear ${esc(customer.company_name||customer.alias||'Customer')},</p><p>${esc(message)}</p><p>Kind regards,<br>IACy</p>`);await admin.from('payment_reminders').update({status:'sent',sent_at:new Date().toISOString()}).eq('id',saved.data.id)}catch(error){await admin.from('payment_reminders').update({status:'draft'}).eq('id',saved.data.id);throw error}
    await admin.from('audit_events').insert({workspace_id:invoice.workspace_id,entity_type:'invoice',entity_id:invoice_id,action:`payment_reminder_${level}_sent`,created_by:user.id,details:{recipient_email:recipient,late_fee_amount:fee}});return reply({sent:true,recipient,level,late_fee_amount:fee});
  }catch(error){return reply({error:error instanceof Error?error.message:String(error)},400)}
});
