import assert from 'node:assert/strict';
import test from 'node:test';
import {prepare, scaled, decimal, validDate, applyEvent} from '../src/features/einvoicing/core.ts';
const fixture=()=>({
 workspace:{id:'w1',country:'AE',legal_name:'Example LLC'},
 profile:{vat_number:'100123456700003',trade_licence_number:'123',licensing_authority:'DET',address_line_1:'One Street',city:'Dubai',state_region:'DXB'},
 settings:{mode:'preparation',tin:'1001234567',vat_registered:true},
 document:{id:'invoice',document_type:'invoice',status:'draft',currency:'AED',issue_date:'2026-10-28',due_date:'2026-11-11',subtotal:'100.00',tax_total:'5.00',total:'105.00',amount_paid:0},
 customer:{company_name:'Buyer LLC',street_address:'Two Street',city:'Dubai',state:'DXB',country:'AE',vat_trn:'100765432100003'},
 metadata:{supply_date:'2026-10-28',payment_means:'30',transaction_type:'00000000',buyer:{type:'business',tin:'1007654321',scheme:'0235',electronic_address:'1007654321'},lines:{}},
 lines:[{id:'l1',description:'Consulting',quantity:'1',unit:'hour',unit_price:'100',vat_rate:'.05',vat_code:{category:'standard'},net_amount:'100',vat_amount:'5',gross_amount:'105',discount_percent:0}],preceding:null,
});
// Database decimals use a leading zero; a leading-dot input is rejected, not guessed.
const valid=()=>{const f=fixture();f.lines[0].vat_rate='0.05';return f;};
test('ordinary VAT invoice produces positive canonical amounts without pretending provider validation',()=>{const r=prepare(valid());assert.deepEqual(r.findings,[]);assert.equal(r.ready,true);assert.equal(r.payload.totals.gross,'105.00');assert.equal(r.payload.lines[0].unit,'HUR');});
test('exact decimals round half away from zero',()=>{assert.equal(decimal(scaled('1.005')),'1.01');assert.equal(decimal(scaled('-1.005')),'-1.01');assert.equal(scaled('NaN'),null);assert.equal(scaled('Infinity'),null);assert.equal(scaled('1e3'),null);assert.equal(scaled(''),null);});
test('invalid dates do not normalize silently',()=>{assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2028-02-29'),true);});
test('rounding discrepancies and bad VAT are blocked',()=>{const c=valid();c.lines[0].vat_amount='4.99';assert.ok(prepare(c).findings.some(x=>x.field==='lines.1.tax'));assert.ok(prepare(c).findings.some(x=>x.field==='totals'));});
test('does not infer zero-rated versus exempt from a zero percentage',()=>{const c=valid();c.lines[0].vat_rate='0';c.lines[0].vat_code={};assert.ok(prepare(c).findings.some(x=>x.field==='lines.1.tax_category'));});
test('issued documents use frozen identities instead of live records',()=>{const c=valid();c.document.status='sent';c.document.issuer_snapshot={legal_name:'Original Seller',profile:c.profile};c.document.customer_snapshot={...c.customer,company_name:'Original Buyer'};c.profile={};c.customer={};const r=prepare(c);assert.equal(r.payload.seller.name,'Original Seller');assert.equal(r.payload.buyer.name,'Original Buyer');assert.equal(r.ready,true);});
test('missing frozen identities cannot fall back to mutable records',()=>{const c=valid();c.document.status='sent';assert.equal(prepare(c).ready,false);});
test('foreign currencies, exports, advances and special scenarios require acceptance tests',()=>{for(const mutate of [c=>c.document.currency='USD',c=>c.metadata.transaction_type='00000001',c=>c.document.amount_paid=10,c=>c.metadata.buyer.country='AT']){const c=valid();mutate(c);assert.equal(prepare(c).ready,false);}});
test('consumer, non-VAT, invalid TIN and unrelated countries fail closed',()=>{for(const mutate of [c=>c.metadata.buyer.type='consumer',c=>c.settings.vat_registered=false,c=>c.settings.tin='123',c=>c.workspace.country='AT']){const c=valid();mutate(c);assert.equal(prepare(c).ready,false);}});
test('credit notes keep negative accounting but positive exchange amounts and original reference',()=>{const c=valid();c.document.document_type='credit_note';for(const k of ['subtotal','tax_total','total'])c.document[k]=String(-Number(c.document[k]));for(const k of ['quantity','net_amount','vat_amount','gross_amount'])c.lines[0][k]=String(-Number(c.lines[0][k]));c.preceding={workspace_id:'w1',document_number:'INV-1'};c.metadata.credit_reason='Cancellation';c.metadata.details={credit_reason_code:'DL8.61.1.A'};const r=prepare(c);assert.deepEqual(r.findings,[]);assert.equal(r.payload.lines[0].quantity,'1.0000');assert.equal(r.payload.totals.gross,'105.00');c.preceding.workspace_id='someone-else';assert.equal(prepare(c).ready,false);});
const state=()=>({workspaceId:'w1',submissionId:'s1',exchange:'pending',reporting:'pending',exchangeAt:null,reportingAt:null,eventIds:[]});
const event=(kind,id='event1',time='2027-01-01T12:00:00Z')=>({id,workspaceId:'w1',submissionId:'s1',kind,occurredAt:time,evidence:'provider acknowledgement'});
test('network delivery never implies FTA reporting',()=>{const s=applyEvent(state(),event('delivered'));assert.equal(s.exchange,'delivered');assert.equal(s.reporting,'pending');});
test('replayed callbacks are idempotent',()=>{const e=event('reported');const s=applyEvent(state(),e);assert.equal(applyEvent(s,e),s);});
test('late failures do not overwrite success or independent state',()=>{let s=applyEvent(state(),event('reported'));s=applyEvent(s,event('reporting_rejected','e2','2027-01-01T11:59:00Z'));s=applyEvent(s,event('delivery_rejected','e3'));assert.equal(s.reporting,'reported');assert.equal(s.exchange,'rejected');});
test('cross-tenant and evidence-free events are rejected',()=>{assert.throws(()=>applyEvent(state(),{...event('reported'),workspaceId:'w2'}));assert.throws(()=>applyEvent(state(),{...event('reported'),evidence:''}));});

test('AED tax conversion uses eight-decimal rates and rounds only the tax total',()=>{const c=valid();c.document.currency='USD';c.metadata.exchange_rate='3.67250000';const r=prepare(c);assert.equal(r.payload.taxCurrency,'AED');assert.equal(r.payload.taxTotalAED,'18.36');assert.equal(r.payload.exchangeRate,'3.67250000');assert.equal(r.ready,true);c.metadata.exchange_rate='invalid';assert.equal(prepare(c).payload.taxTotalAED,'');});
test('confirmed non-VAT company is not asked to provide a VAT number or register for VAT',()=>{const c=valid();c.settings.vat_registered=false;c.settings.vat_status='not_registered';c.profile.vat_number='';const r=prepare(c);assert.ok(r.findings.some(f=>f.field==='buyer.registration'));assert.equal(r.payload.lines[0].taxCategory,'O');assert.ok(!r.findings.some(f=>f.field==='seller.vat_number'||f.field==='vat_registered'));});
