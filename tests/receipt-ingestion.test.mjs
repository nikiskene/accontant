import assert from 'node:assert/strict';
import test from 'node:test';
import { attachmentKind, bestLearningRule, normalizeSupplierName, plainText, receiptSignature, resolveEntity, safeFilename } from '../supabase/functions/ingest-receipts/core.ts';

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
});

test('reuses a reviewed receipt template only at 75 percent similarity', () => {
  const original=receiptSignature('billing@google.com','Google Drive storage order','Google Drive annual storage');
  const close=receiptSignature('billing@google.com','Google Drive storage order','Google Drive storage renewal');
  const other=receiptSignature('billing@google.com','Google Play game order');
  const rules=[{source_signature:original,similarity_threshold:.75,account_id:'storage'}];
  assert.equal(bestLearningRule(close,rules)?.rule.account_id,'storage');
  assert.equal(bestLearningRule(other,rules),null);
});

test('normalizes supplier legal suffixes for an existing supplier match', () => {
  assert.equal(normalizeSupplierName('Microsoft Ireland Operations Limited'),normalizeSupplierName('Microsoft Ireland Operations Ltd.'));
});
