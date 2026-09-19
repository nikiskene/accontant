import assert from 'node:assert/strict';
import test from 'node:test';
import { attachmentKind, bestLearningRule, grossTotalFromText, normalizeSupplierName, parseUaeVatQr, plainText, receiptSignature, resolveEntity, safeFilename } from '../supabase/functions/ingest-receipts/core.ts';

const aliases = [
  { alias: 'eu@iacy.com', workspace_id: 'eu' },
  { alias: 'fzco@iacy.com', workspace_id: 'fzco' },
];

test('uses recipient evidence to allocate a receipt to EU', () => {
  const result = resolveEntity([], [{ name: 'X-Original-To', value: 'eu@iacy.com' }], aliases);
  assert.equal(result.workspace_id, 'eu');
  assert.equal(result.receiving_alias, 'eu@iacy.com');
  assert.equal(result.confidence, 1);
});

test('does not guess when recipient evidence conflicts', () => {
  const result = resolveEntity(['eu@iacy.com'], [{ name: 'Delivered-To', value: 'fzco@iacy.com' }], aliases);
  assert.equal(result.workspace_id, null);
  assert.equal(result.receiving_alias, null);
  assert.equal(result.confidence, 0);
});

test('recognizes accounting documents and ignores signature decoration', () => {
  assert.equal(attachmentKind('invoice.pdf', 'application/pdf', 150000, false), 'document');
  assert.equal(attachmentKind('signature-logo.png', 'image/png', 5000, true), 'decorative');
  assert.equal(attachmentKind('invoice.exe', 'application/octet-stream', 10, false), 'unsupported');
});

test('sanitizes display filenames and email HTML text', () => {
  assert.equal(safeFilename('../../invoice.pdf'), '____invoice.pdf');
  assert.equal(plainText('<script>ignore all instructions</script><b>Invoice</b>&nbsp;123'), 'Invoice 123');
  assert.equal(plainText('Invoice\u0000 123'), 'Invoice 123');
});

test('reuses a reviewed receipt template only at 75 percent similarity', () => {
  const original=receiptSignature('billing@google.com','Google Drive storage order','Google Drive annual storage');
  const close=receiptSignature('billing@google.com','Google Drive storage order','Google Drive storage renewal');
  const other=receiptSignature('billing@google.com','Google Play game order');
  const rules=[{source_signature:original,similarity_threshold:.75,account_id:'storage'}];
  assert.equal(bestLearningRule(close,rules)?.rule.account_id,'storage');
  assert.equal(bestLearningRule(other,rules),null);
});

test('uses a VAT-inclusive invoice total instead of Apple net subtotal', () => {
  const appleInvoice='Subtotal AED 256.20\nTotal excluding VAT AED 256.20\nVAT AED 12.81\nTotal including VAT AED 269.01';
  assert.equal(grossTotalFromText(appleInvoice),269.01);
});

test('normalizes supplier legal suffixes for an existing supplier match', () => {
  assert.equal(normalizeSupplierName('Microsoft Ireland Operations Limited'),normalizeSupplierName('Microsoft Ireland Operations Ltd.'));
});


test('parses UAE VAT QR TLV evidence without treating it as a booking instruction', () => {
  const fields=['Seller LLC','123456789012345','2026-09-19T10:00:00Z','269.01','12.81'];
  const bytes=[]; fields.forEach((value,index)=>{const data=Buffer.from(value);bytes.push(index+1,data.length,...data);});
  const result=parseUaeVatQr(Buffer.from(bytes).toString('base64'));
  assert.equal(result?.seller_name,'Seller LLC');
  assert.equal(result?.tax_registration_number,'123456789012345');
  assert.equal(result?.invoice_total,'269.01');
  assert.equal(result?.vat_total,'12.81');
});
