import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

export type StatementInstallment = { schedule_id: string; due_date: string; amount_due: number; amount_paid: number; balance: number };
export type StatementPayment = { id: string; schedule_id: string; paid_date: string; amount_paid: number; reference: string | null };
type Creditor = { name: string; payment_reference: string | null; receiving_iban: string | null };
const cents = (value: number) => Math.round(Number(value) * 100);
const money = (value: number) => `EUR ${(value / 100).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, ' ')}`;

export function createCreditorStatementPdf(creditor: Creditor, installments: StatementInstallment[], payments: StatementPayment[], statementDate: string) {
  const pdf = new jsPDF();
  const rows = [...installments].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const history = [...payments].sort((a, b) => a.paid_date.localeCompare(b.paid_date) || (rows.find(row => row.schedule_id === a.schedule_id)?.due_date || '').localeCompare(rows.find(row => row.schedule_id === b.schedule_id)?.due_date || '') || a.id.localeCompare(b.id));
  const overdue = rows.filter(row => cents(row.balance) > 0 && row.due_date < statementDate);
  const rest = rows.filter(row => cents(row.balance) > 0 && row.due_date >= statementDate);
  const paid = history.reduce((sum, row) => sum + cents(row.amount_paid), 0);
  const scheduledPaid = rows.reduce((sum, row) => sum + cents(row.amount_paid), 0);
  if (paid !== scheduledPaid) throw new Error('Payment history and schedule have changed. Please try the statement again.');
  const overdueTotal = overdue.reduce((sum, row) => sum + cents(row.balance), 0);
  const restTotal = rest.reduce((sum, row) => sum + cents(row.balance), 0);
  const planTotal = rows.reduce((sum, row) => sum + cents(row.amount_due), 0);
  pdf.setProperties({ title: `Account statement - ${creditor.name}`, subject: `Downpayment plan as of ${statementDate}` });
  pdf.setTextColor(78, 39, 128);
  pdf.setFontSize(20);
  pdf.text('Account statement', 16, 23);
  pdf.setTextColor(35, 39, 47);
  pdf.setFontSize(13);
  const nameLines = pdf.splitTextToSize(creditor.name, 178);
  pdf.text(nameLines, 16, 33);
  let y = 34 + nameLines.length * 6;
  pdf.setFontSize(9);
  for (const line of [`Downpayment plan | Statement date: ${statementDate}`, creditor.payment_reference && `Payment reference: ${creditor.payment_reference}`, creditor.receiving_iban && `Receiving IBAN: ${creditor.receiving_iban}`].filter(Boolean) as string[]) {
    const lines = pdf.splitTextToSize(line, 178);
    pdf.text(lines, 16, y);
    y += lines.length * 5;
  }
  autoTable(pdf, { startY: y + 4, margin: { left: 16, right: 16 }, theme: 'plain', styles: { fontSize: 9, cellPadding: 3 }, body: [
    ['Plan total', money(planTotal), 'Paid', money(paid)],
    ['Open - overdue', money(overdueTotal), 'Open - remaining', money(restTotal)],
    ['Total open', money(overdueTotal + restTotal), '', ''],
  ], columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } } });
  y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  function table(title: string, head: string[], body: string[][], total: number) {
    if (y > 245) { pdf.addPage(); y = 22; }
    pdf.setFontSize(11);
    pdf.setTextColor(35, 39, 47);
    pdf.text(`${title} - ${money(total)}`, 16, y);
    autoTable(pdf, { startY: y + 4, margin: { top: 20, bottom: 20, left: 16, right: 16 }, head: [head], body: body.length ? body : [head.map((_, i) => i === 0 ? 'None' : '')], theme: 'striped', styles: { fontSize: 9, cellPadding: 2.5, overflow: 'linebreak' }, headStyles: { fillColor: [78, 39, 128] }, columnStyles: { [head.length - 1]: { halign: 'right' } }, rowPageBreak: 'avoid', didDrawPage: data => { if (data.pageNumber > 1) { pdf.setFontSize(9); pdf.setTextColor(35, 39, 47); pdf.text(`${title} (continued)`, 16, 16); } } });
    y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }
  const dueDates = new Map(rows.map(row => [row.schedule_id, row.due_date]));
  table('Paid - recorded payments', ['Payment date', 'Installment due', 'Reference', 'Amount paid'], history.map(row => [row.paid_date, dueDates.get(row.schedule_id) || '-', row.reference || '-', money(cents(row.amount_paid))]), paid);
  const openBody = (items: StatementInstallment[]) => items.map(row => [row.due_date, money(cents(row.amount_due)), money(cents(row.amount_paid)), money(cents(row.balance))]);
  table('Open - overdue', ['Due date', 'Scheduled', 'Already paid', 'Still open'], openBody(overdue), overdueTotal);
  table('Open - remaining (due today or later)', ['Due date', 'Scheduled', 'Already paid', 'Still open'], openBody(rest), restTotal);
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFontSize(8);
    if (page > 1) pdf.text(pdf.splitTextToSize(creditor.name, 178)[0], 16, 9);
    pdf.setTextColor(100, 100, 110);
    pdf.text(`Downpayment tracker | ${statementDate}`, 16, 287);
    pdf.text(`Page ${page} of ${pages}`, 194, 287, { align: 'right' });
  }
  return pdf;
}
