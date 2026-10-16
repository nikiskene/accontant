import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/utils/creditorStatementPdf.ts', import.meta.url), 'utf8');
const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(createRequire(import.meta.url), module, module.exports);
const { createCreditorStatementPdf } = module.exports;
const creditor = { name: 'Sample Creditor', payment_reference: 'Account 12345', receiving_iban: null };
const rows = Array.from({ length: 84 }, (_, i) => ({
  schedule_id: String(i), due_date: new Date(Date.UTC(2024, 9 + i, 15)).toISOString().slice(0, 10),
  amount_due: 15.71, amount_paid: i < 12 ? 15.71 : i === 12 ? 5 : 0,
  balance: i < 12 ? 0 : i === 12 ? 10.71 : 15.71,
}));
const payments = rows.filter(row => row.amount_paid > 0).map(row => ({
  id: row.schedule_id, schedule_id: row.schedule_id, paid_date: '2025-09-04', amount_paid: row.amount_paid, reference: null,
}));

test('statement reconciles totals and includes every installment across pages', () => {
  const pdf = createCreditorStatementPdf(creditor, rows, payments, '2026-10-16');
  const text = pdf.output();
  assert.ok(pdf.getNumberOfPages() > 1);
  for (const row of rows) assert.ok(text.includes(row.due_date), row.due_date);
  for (const amount of ['193,52', '199,23', '926,89', '1 126,12', '10,71']) assert.ok(text.includes(amount), amount);
  assert.ok(text.includes('2025-09-04'));
  assert.ok(text.includes('continued'));
});

test('refuses inconsistent payment history rather than generating wrong totals', () => {
  assert.throws(() => createCreditorStatementPdf(creditor, rows, [], '2026-10-16'), /changed/);
});

test('empty creditor has a printable one-page statement', () => {
  const pdf = createCreditorStatementPdf(creditor, [], [], '2026-10-16');
  assert.equal(pdf.getNumberOfPages(), 1);
  assert.ok(pdf.output().includes('None'));
});

test('due today belongs to remaining open and multiple partial payments retain their dates', () => {
  const installment = [{ schedule_id: '1', due_date: '2026-10-16', amount_due: 20, amount_paid: 8, balance: 12 }];
  const history = [{ id: 'a', schedule_id: '1', paid_date: '2026-10-01', amount_paid: 3, reference: null }, { id: 'b', schedule_id: '1', paid_date: '2026-10-10', amount_paid: 5, reference: null }];
  const text = createCreditorStatementPdf(creditor, installment, history, '2026-10-16').output();
  assert.ok(text.includes('2026-10-01'));
  assert.ok(text.includes('2026-10-10'));
  assert.ok(text.includes('Open - overdue - EUR 0,00'));
  assert.ok(text.includes('Open - remaining \\(due today or later\\) - EUR 12,00'));
});
