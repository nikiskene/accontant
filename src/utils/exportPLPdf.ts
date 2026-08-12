// src/utils/exportPLPdf.ts

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabase';

type PLRow = {
  label: string;
  amount: number | null;
  row_type: 'header' | 'line' | 'total' | 'calc';
  level: number;
};

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeriod(fromDate: string, toDate: string) {
  return `${fromDate} to ${toDate}`;
}

function formatFooterTimestamp() {
  const d = new Date();
  const datePart = d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: '2-digit',
  });
  const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const tz =
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    `GMT${String(-d.getTimezoneOffset() / 60).startsWith('-') ? '' : '+'}${-d.getTimezoneOffset() / 60}`;
  return `${datePart} ${timePart} ${tz}`;
}

/**
 * Presentation sign conventions:
 * - Income is stored as credit (often negative) -> display as positive
 * - Expense is stored as debit (often positive) -> display as positive
 * - Calculated lines (Gross Profit / Net earnings) should display as "business positive"
 */
function displayAmount(row: PLRow, amount: number, currency: string) {
  const label = (row.label || '').toLowerCase();

  const isIncomeSection =
    label === 'income' ||
    label.includes('revenue') ||
    row.row_type === 'calc' ||
    label.includes('gross profit') ||
    label.includes('net earnings') ||
    label.includes('total for income');

  // Expenses should appear positive.
  const isExpenseSection =
    label === 'expenses' ||
    label.includes('expense') ||
    label.includes('total for expenses') ||
    label.includes('cost of sales') ||
    label.includes('total for cost of sales');

  let shown = amount;

  // Income / profit lines: show absolute value
  if (isIncomeSection) shown = Math.abs(amount);

  // Expense lines: show absolute value
  if (isExpenseSection) shown = Math.abs(amount);

  // Fallback: if it's a normal line and negative, show abs (safer for P&L readability)
  if (row.row_type === 'line' && shown < 0) shown = Math.abs(shown);

  return `${formatMoney(shown)} ${currency}`;
}

export async function exportPLPdf(workspaceId: string, fromDate: string, toDate: string) {
  // 1) company info (exact field names from your table)
  const { data: settings, error: settingsError } = await supabase
    .from('workspace_settings')
    .select('company_name, license_number, trn, reporting_currency')
    .eq('workspace_id', workspaceId)
    .single();

  if (settingsError) throw settingsError;

  // 2) P&L layout rows
  const { data: rows, error: rowsError } = await supabase.rpc('profit_and_loss_layout', {
    p_workspace_id: workspaceId,
    p_from: fromDate,
    p_to: toDate,
  });

  if (rowsError) throw rowsError;

  const company = settings?.company_name ?? '';
  const license = settings?.license_number ?? '';
  const trn = settings?.trn ?? '';
  const currency = settings?.reporting_currency ?? 'AED';

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 18;
  const right = pageW - 18;

  // ---- Header (centered like the reference) ----
  doc.setFont('helvetica', 'normal');

  doc.setFontSize(16);
  doc.text('Profit and Loss', pageW / 2, 22, { align: 'center' });

  doc.setFontSize(10);
  if (company) doc.text(company, pageW / 2, 28, { align: 'center' });

  const credsParts: string[] = [];
  if (license) credsParts.push(`License ${license}`);
  if (trn) credsParts.push(`TRN ${trn}`);
  if (credsParts.length) doc.text(credsParts.join('  |  '), pageW / 2, 33, { align: 'center' });

  doc.setFontSize(10);
  doc.text(formatPeriod(fromDate, toDate), pageW / 2, 38, { align: 'center' });

  // Horizontal rule under header
  doc.setLineWidth(0.2);
  doc.line(left, 46, right, 46);

  // ---- Table content ----
  const plRows: PLRow[] = Array.isArray(rows) ? rows : [];

  const body = plRows.map((r) => {
    const indent = r.level > 0 ? '  '.repeat(r.level) : '';
    const label = `${indent}${r.label}`;

    const amountText =
      r.amount === null || r.row_type === 'header'
        ? ''
        : displayAmount(r, Number(r.amount), currency);

    return [label, amountText];
  });

  autoTable(doc, {
    startY: 50,
    theme: 'plain',
    head: [['DISTRIBUTION ACCOUNT', `TOTAL (${currency})`]],
    body,
    margin: { left, right: pageW - right },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: { top: 1.5, right: 0, bottom: 1.5, left: 0 },
      textColor: 20,
    },
    headStyles: {
      fontStyle: 'normal',
      textColor: 80,
    },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'right' },
    },
    didDrawCell: (data) => {
      if (data.section !== 'body') return;

      const r = plRows[data.row.index];
      if (!r) return;

      const x1 = left;
      const x2 = right;
      const yTop = data.cell.y;
      const yBottom = data.cell.y + data.cell.height;

      if (r.row_type === 'header') {
        data.cell.styles.fontStyle = 'normal';
      }

      if (r.row_type === 'total') {
        data.cell.styles.fontStyle = 'bold';
        if (data.column.index === 0) {
          doc.setLineWidth(0.3);
          doc.line(x1, yTop, x2, yTop);
          doc.line(x1, yBottom, x2, yBottom);
        }
      }

      if (r.row_type === 'calc') {
        data.cell.styles.fontStyle = 'bold';
        if (data.column.index === 0) {
          doc.setLineWidth(0.4);
          doc.line(x1, yTop, x2, yTop);
          doc.line(x1, yBottom, x2, yBottom);
        }
      }
    },
  });

  // ---- Optional: explicit Net earnings line with currency (at bottom) ----
  // You asked for “either at the top TOTAL (AED) or at the bottom Net earnings (AED) or both”.
  const net = plRows.find((r) => (r.label || '').toLowerCase().includes('net earnings'));
  if (net?.amount !== null && net?.amount !== undefined) {
    const finalY = (doc as any).lastAutoTable?.finalY ?? 260;
    const y = Math.min(finalY + 10, pageH - 22);

    doc.setTextColor(20);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Net earnings (${currency})`, left, y);

    doc.setFont('helvetica', 'bold');
    doc.text(displayAmount(net, Number(net.amount), currency), right, y, { align: 'right' });
  }

  // ---- Footer ----
  const footerY = pageH - 12;
  doc.setFontSize(8);
  doc.setTextColor(140);

  const footerLeft = `Accrual Basis  ${formatFooterTimestamp()}`;
  doc.text(footerLeft, left, footerY);

  const pageCount = doc.getNumberOfPages();
  doc.text(`1/${pageCount}`, right, footerY, { align: 'right' });

  doc.save(`PL_${fromDate}_${toDate}.pdf`);
}