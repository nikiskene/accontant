import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceLineAmounts} from '../src/features/einvoicing/invoiceMath.ts';
test('round each invoice line before summing totals',()=>{assert.deepEqual(invoiceLineAmounts(3,0.33,0.05),{net:.99,tax:.05,gross:1.04});assert.deepEqual(invoiceLineAmounts(.5,.01,0),{net:.01,tax:0,gross:.01});});
test('reject invalid values instead of storing inconsistent line amounts',()=>{for(const args of [[NaN,1,0],[1,-1,0],[1,1,Infinity]])assert.throws(()=>invoiceLineAmounts(...args));});
