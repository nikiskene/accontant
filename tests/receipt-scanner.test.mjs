import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReceipt,blankReceipt} from '../src/features/receipt-scanner/model.ts';
const receipt=()=>({...blankReceipt(),vendor:'Merchant',document_date:'2026-11-02',currency:'EUR',gross_amount:120,taxes:[{gross:120,tax:20,tax_rate:20}]});
test('reviewed receipt can omit numbers absent on the paper',()=>assert.equal(validateReceipt(receipt()),null));
test('mixed VAT and zero VAT preserve valid totals',()=>{const r=receipt();r.taxes=[{gross:60,tax:10,tax_rate:20},{gross:60,tax:0,tax_rate:0}];assert.equal(validateReceipt(r),null);});
test('reject missing and impossible document fields',()=>{for(const override of [{vendor:''},{document_date:'2026-02-30'},{currency:''},{gross_amount:0},{gross_amount:NaN},{taxes:[]}])assert.ok(validateReceipt({...receipt(),...override}));});
test('reject mismatched allocations and invalid VAT',()=>{for(const taxes of [[{gross:119,tax:20,tax_rate:20}],[{gross:120,tax:121,tax_rate:20}],[{gross:120,tax:-1,tax_rate:20}],[{gross:120,tax:20,tax_rate:101}]])assert.ok(validateReceipt({...receipt(),taxes}));});
test('reject malformed submission payloads',()=>{for(const r of [{},null,{...receipt(),taxes:[null]},{...receipt(),vendor:123},{...receipt(),description:'x'.repeat(2001)}])assert.ok(validateReceipt(r));});
