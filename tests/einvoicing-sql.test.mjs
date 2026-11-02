import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const w1='00000000-0000-0000-0000-000000000001',w2='00000000-0000-0000-0000-000000000002';
const user='00000000-0000-0000-0000-000000000010',customer='00000000-0000-0000-0000-000000000020',invoice='00000000-0000-0000-0000-000000000030';
async function database(){
 const db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 create table workspaces(id uuid primary key,country text,legal_name text,vat_trn text,ct_trn text);
 create table accounts(id uuid primary key,workspace_id uuid,is_active boolean,type text,code text,name text);create table vat_codes(id uuid primary key,workspace_id uuid,category text,applies_to text);
 create table counterparties(id uuid primary key,workspace_id uuid,name text,kind text);
 create table bank_transactions(id uuid primary key);
 create table transactions(id uuid primary key);create table cost_centers(id uuid primary key);create table attachments(id uuid primary key);
 create table audit_events(id uuid default gen_random_uuid(),workspace_id uuid,entity_type text,entity_id uuid,action text,created_by uuid,details jsonb);
 create function is_workspace_member(w uuid) returns boolean language sql stable as $$select auth.uid()='${user}'::uuid and w='${w1}'::uuid$$;
 create function can_write(w uuid) returns boolean language sql stable as $$select is_workspace_member(w)$$;
 create function can_admin(w uuid) returns boolean language sql stable as $$select is_workspace_member(w)$$;
 create function samly_assert_free_setup_capacity(w uuid,t text) returns void language sql as $$select$$;
 insert into auth.users values('${user}');
 insert into workspaces values('${w1}','AE','Seller LLC','100123456700003',null),('${w2}','AE','Other LLC',null,null);
 insert into counterparties values('${customer}','${w1}','Buyer LLC','both');
 select set_config('test.user','${user}',false);
 `);
 for(const name of ['011_add_commercial_documents.sql','012_add_quote_invoice_workflow.sql','014_add_company_legal_profiles.sql','016_add_supplier_invoices.sql','085_add_uae_einvoicing_preparation.sql','086_fix_credit_note_issuance.sql','087_add_einvoice_queue_and_inbox_review.sql','089_add_docflow_sandbox_setup.sql']) await db.exec(await readFile(new URL(`../supabase/manual/${name}`,import.meta.url),'utf8'));
 await db.exec(`update company_legal_profiles set address_line_1='One street',city='Dubai';insert into sales_documents(id,workspace_id,document_type,document_number,customer_id,issue_date,currency,status,subtotal,tax_total,total) values('${invoice}','${w1}','invoice','INV-1','${customer}','2026-10-28','AED','draft',100,5,105);insert into sales_document_lines(workspace_id,document_id,line_no,description,quantity,unit_price,net_amount,vat_amount,gross_amount) values('${w1}','${invoice}',1,'Service',1,100,100,5,105);grant usage on schema public,auth to authenticated;`);
 return db;
}
test('preparation migration and context enforce company access and cannot activate',async()=>{
 const db=await database();try {
 await db.query('select save_einvoice_settings($1,$2::jsonb)',[w1,JSON.stringify({vat_registered:true,tin:'1001234567',revenue_band:'below_50m',mode:'production'})]);
 const settings=(await db.query('select mode,target_date from einvoice_settings')).rows[0];assert.equal(settings.mode,'preparation');assert.equal(settings.target_date,null);
 await db.query('select save_einvoice_settings($1,$2::jsonb)',[w1,JSON.stringify({target_date:'2027-01-01'})]);
 assert.equal((await db.query("select target_date::text as date from einvoice_settings")).rows[0].date,'2027-01-01');
 const c=(await db.query('select einvoice_preparation_context($1) as c',[invoice])).rows[0].c;assert.equal(c.workspace.id,w1);assert.equal(c.lines.length,1);
 await assert.rejects(db.query('select save_einvoice_settings($1,$2::jsonb)',[w2,'{}']),/Not authorized/);
 await db.exec("select set_config('test.user','',false)");
 await assert.rejects(db.query('select einvoice_preparation_context($1)',[invoice]),/Not authorized/);
 }finally{await db.close();}
});
test('RLS hides other companies and clients cannot forge submission receipts',async()=>{
 const db=await database();try{
 await db.exec(`insert into einvoice_settings(workspace_id)values('${w1}'),('${w2}');set role authenticated;`);
 const rows=(await db.query('select workspace_id from einvoice_settings')).rows;assert.deepEqual(rows,[{workspace_id:w1}]);
 await assert.rejects(db.exec(`insert into einvoice_submissions(workspace_id,document_id,environment,provider,idempotency_key,payload) values('${w1}','${invoice}','production','fake','fake','{}')`),/permission denied/);
 }finally{await db.close();}
});
test('credit notes issue, preserve original identity and prevent excess credits',async()=>{
 const db=await database();try{
 await assert.rejects(db.query('select create_credit_note($1,1,$2)',[invoice,'2026-10-28']),/Invoice not found/);
 await db.query('select issue_sales_document($1)',[invoice]);
 const original=(await db.query('select issuer_snapshot from sales_documents where id=$1',[invoice])).rows[0].issuer_snapshot;
 const id=(await db.query('select create_credit_note($1,0.5,$2) as id',[invoice,'2026-10-28'])).rows[0].id;
 await db.exec("update workspaces set legal_name='Changed Seller';");
 await db.query('select issue_sales_document($1)',[id]);
 const credit=(await db.query('select * from sales_documents where id=$1',[id])).rows[0];assert.equal(credit.status,'sent');assert.equal(Number(credit.total),-52.50);assert.deepEqual(credit.issuer_snapshot,original);
 await assert.rejects(db.query('select create_credit_note($1,0.6,$2)',[invoice,'2026-10-28']),/exceeds/);
 await db.query('select create_credit_note($1,0.5,$2)',[invoice,'2026-10-28']);
 await assert.rejects(db.query('select create_credit_note($1,0.1,$2)',[invoice,'2026-10-28']),/exceeds/);
 }finally{await db.close();}
});
test('production submission freezes invoice and lines while allowing payments',async()=>{
 const db=await database();try{
 await db.query('select issue_sales_document($1)',[invoice]);
 await assert.rejects(db.query("insert into einvoice_submissions(workspace_id,document_id,environment,provider,idempotency_key,payload)values($1,$2,'production','p','bad','{}')",[w2,invoice]),/mismatch/);
 await db.query("insert into einvoice_submissions(workspace_id,document_id,environment,provider,idempotency_key,payload)values($1,$2,'production','p','good','{}')",[w1,invoice]);
 await assert.rejects(db.query("update sales_documents set total=1 where id=$1",[invoice]),/credit note/);
 await assert.rejects(db.query("update sales_documents set status='void' where id=$1",[invoice]),/credit note/);
 await assert.rejects(db.query('delete from sales_document_lines where document_id=$1',[invoice]),/cannot be changed/);
 await assert.rejects(db.query("insert into sales_document_lines(workspace_id,document_id,line_no,description,unit_price,net_amount,gross_amount)values($1,$2,2,'extra',1,1,1)",[w1,invoice]),/Cannot add/);
 await assert.rejects(db.query('select save_einvoice_metadata($1,$2)',[invoice,'{}']),/immutable/);
 await db.query("update sales_documents set amount_paid=105,status='paid' where id=$1",[invoice]);
 assert.equal((await db.query('select status from sales_documents where id=$1',[invoice])).rows[0].status,'paid');
 }finally{await db.close();}
});
const expense='00000000-0000-0000-0000-000000000040';
const incomingPayload={documentType:'invoice',number:'SUP-1',currency:'AED',issueDate:'2026-10-28',lines:[{description:'Service',net:'100.00',tax:'5.00',gross:'105.00'}],totals:{net:'100.00',tax:'5.00',gross:'105.00'}};
async function incoming(db,delivery='delivery-1',payload=incomingPayload,environment='production'){
 return (await db.query("insert into einvoice_inbox(workspace_id,provider,environment,provider_document_id,payload,original_xml)values($1,'test',$2,$3,$4,'<Invoice/>') returning id",[w1,environment,delivery,JSON.stringify(payload)])).rows[0].id;
}
test('incoming review is atomic, creates a draft, and deduplicates redelivery',async()=>{
 const db=await database();try{
 await db.query("insert into accounts values($1,$2,true,'expense','6000','Services')",[expense,w1]);
 const id=await incoming(db);const coding=JSON.stringify([{account_id:expense}]);
 const bill=(await db.query('select import_reviewed_einvoice($1,$2,$3) as id',[id,customer,coding])).rows[0].id;
 const row=(await db.query('select status,total from supplier_invoices where id=$1',[bill])).rows[0];assert.equal(row.status,'draft');assert.equal(Number(row.total),105);
 const again=(await db.query('select import_reviewed_einvoice($1,$2,$3) as id',[id,customer,coding])).rows[0].id;assert.equal(again,bill);
 const redelivery=await incoming(db,'delivery-2');assert.equal((await db.query('select import_reviewed_einvoice($1,$2,$3) as id',[redelivery,customer,coding])).rows[0].id,bill);
 assert.equal((await db.query('select count(*)::int as n from supplier_invoice_lines')).rows[0].n,1);
 const different=await incoming(db,'different-lines',{...incomingPayload,lines:[{...incomingPayload.lines[0],description:'Different service'}]});
 await assert.rejects(db.query('select import_reviewed_einvoice($1,$2,$3)',[different,customer,coding]),/different lines/);
 await assert.rejects(db.query('update einvoice_inbox set supplier_invoice_id=null where id=$1',[id]),/immutable/);
 await assert.rejects(db.query("update einvoice_inbox set original_xml='changed' where id=$1",[id]),/immutable/);
 }finally{await db.close();}
});
test('incoming review rejects sandbox, cross-company coding and mismatched totals',async()=>{
 const db=await database();try{
 await db.query("insert into accounts values($1,$2,true,'expense','6000','Services')",[expense,w2]);
 const coding=JSON.stringify([{account_id:expense}]);const id=await incoming(db);
 await assert.rejects(db.query('select import_reviewed_einvoice($1,$2,$3)',[id,customer,coding]),/Invalid account/);
 await db.query('update accounts set workspace_id=$1',[w1]);
 const sandbox=await incoming(db,'sandbox',incomingPayload,'sandbox');await assert.rejects(db.query('select import_reviewed_einvoice($1,$2,$3)',[sandbox,customer,coding]),/Sandbox/);
 const bad=await incoming(db,'bad',{...incomingPayload,totals:{...incomingPayload.totals,gross:'106'}});await assert.rejects(db.query('select import_reviewed_einvoice($1,$2,$3)',[bad,customer,coding]),/totals/);
 assert.equal((await db.query('select count(*)::int as n from supplier_invoices')).rows[0].n,0);
 await db.exec("select set_config('test.user','',false)");await assert.rejects(db.query('select import_reviewed_einvoice($1,$2,$3)',[id,customer,coding]),/Not authorized/);
 }finally{await db.close();}
});
test('queue leases reject stale workers and require reconciliation after uncertainty',async()=>{
 const db=await database();try{
 const s=(await db.query("insert into einvoice_submissions(workspace_id,document_id,environment,provider,idempotency_key,payload)values($1,$2,'sandbox','test','queue-test','{}')returning id",[w1,invoice])).rows[0].id;
 await db.query('insert into einvoice_jobs(workspace_id,submission_id)values($1,$2)',[w1,s]);
 const first=(await db.query('select claim_einvoice_job() as value')).rows[0].value;assert.equal(first.must_reconcile,false);
 assert.equal((await db.query('select claim_einvoice_job() as value')).rows[0].value,null);
 await assert.rejects(db.query("select finish_einvoice_job($1,$2,'accepted')",[first.job.id,user]),/stale/);
 await db.query("select finish_einvoice_job($1,$2,'reconcile','Timeout')",[first.job.id,first.job.lease_token]);
 await db.exec("update einvoice_jobs set available_at=now()-interval '1 second'");
 const second=(await db.query('select claim_einvoice_job() as value')).rows[0].value;assert.equal(second.must_reconcile,true);assert.notEqual(first.job.lease_token,second.job.lease_token);
 await assert.rejects(db.query("select finish_einvoice_job($1,$2,'accepted')",[first.job.id,first.job.lease_token]),/stale/);
 await db.query("select finish_einvoice_job($1,$2,'accepted')",[second.job.id,second.job.lease_token]);
 await db.exec('set role authenticated');await assert.rejects(db.query('select claim_einvoice_job()'),/permission denied/);
 }finally{await db.close();}
});

test('customer profiles are reusable and sandbox credentials have no browser read grant',async()=>{
 const db=await database();try{
 await db.exec(`update counterparties set einvoice_profile='{"tin":"1007654321","scheme":"0235"}';`);
 assert.equal((await db.query('select einvoice_profile from counterparties')).rows[0].einvoice_profile.tin,'1007654321');
 await db.exec(`insert into docflow_connections(workspace_id,provider_company_id,tin,vat_trn,encrypted_access_token)values('${w1}','${customer}','1001234567','100123456700003','ciphertext');set role authenticated;`);
 await assert.rejects(db.query('select encrypted_access_token from docflow_connections'),/permission denied/);
 await assert.rejects(db.query(`update docflow_connections set encrypted_access_token='fake'`),/permission denied/);
 }finally{await db.close();}
});
test('reference fields persist, and connection cannot be switched to production',async()=>{
 const db=await database();try{
 await db.query('select save_einvoice_metadata($1,$2::jsonb)',[invoice,JSON.stringify({buyer_reference:'FINANCE',purchase_order:'PO-1'})]);
 assert.equal((await db.query('select buyer_reference from einvoice_document_metadata')).rows[0].buyer_reference,'FINANCE');
 await assert.rejects(db.query(`insert into docflow_connections(workspace_id,provider_company_id,tin,vat_trn,encrypted_access_token,environment)values('${w1}','${customer}','1001234567','100123456700003','cipher','production')`),/check constraint/);
 await assert.rejects(db.query(`insert into docflow_validations(workspace_id,document_id,payload,provider_response,validation_verified)values('${w1}','${invoice}','{}','{}',true)`),/check constraint/);
 }finally{await db.close();}
});
test('issuing a new document freezes the company e-invoice settings',async()=>{
 const db=await database();try{
 await db.query('select save_einvoice_settings($1,$2::jsonb)',[w1,JSON.stringify({tin:'1001234567',vat_registered:true})]);
 await db.query('select issue_sales_document($1)',[invoice]);
 const snapshot=(await db.query('select issuer_snapshot from sales_documents where id=$1',[invoice])).rows[0].issuer_snapshot;
 assert.equal(snapshot.einvoice_settings.tin,'1001234567');
 await db.query('select save_einvoice_settings($1,$2::jsonb)',[w1,JSON.stringify({tin:'1000000000',vat_registered:true})]);
 assert.equal((await db.query('select issuer_snapshot from sales_documents where id=$1',[invoice])).rows[0].issuer_snapshot.einvoice_settings.tin,'1001234567');
 }finally{await db.close();}
});
