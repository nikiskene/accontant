// src/utils/exportBSPdf.ts

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabase';

type BSRow = {
  label: string;
  amount: number | null;
  row_type: 'header' | 'line' | 'total' | 'calc';
  level: number;
};

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAsOf(asOfDate: string) {
  return `As of ${asOfDate}`;
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

function normalizeLabel(s: string) {
  return (s ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export async function exportBSPdf(workspaceId: string, asOfDate: string) {
  // 1) company info (exact field names)
  const { data: settings, error: settingsError } = await supabase
    .from('workspace_settings')
    .select('company_name, license_number, trn, reporting_currency')
    .eq('workspace_id', workspaceId)
    .single();

  if (settingsError) throw settingsError;

  // 2) balance sheet layout rows
  const { data: rows, error: rowsError } = await supabase.rpc('balance_sheet_layout', {
    p_workspace_id: workspaceId,
    p_as_of: asOfDate,
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

  // ---- Header ----
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0);

  // Top line: Company (left) and License/TRN (right)
  const topY = 16;
  doc.setFontSize(11);
  if (company) doc.text(company, left, topY);

  const credsParts: string[] = [];
  if (license) credsParts.push(`License ${license}`);
  if (trn) credsParts.push(`TRN ${trn}`);
  if (credsParts.length) {
    doc.setFontSize(9);
    doc.setTextColor(60);
    doc.text(credsParts.join('  |  '), right, topY, { align: 'right' });
    doc.setTextColor(0);
  }

  // Title
  doc.setFontSize(16);
  doc.text('Balance Sheet', left, 26);

  // As-of line
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text(formatAsOf(asOfDate), left, 32);
  doc.setTextColor(0);

  // Divider
  doc.setLineWidth(0.2);
  doc.line(left, 38, right, 38);

  // ---- Rows: remove the redundant "TOTAL" header row coming from the DB ----
  let bsRows: BSRow[] = Array.isArray(rows) ? rows : [];

  // Common pattern: first row is { label: "TOTAL", row_type: "header", level: 0 }
  // Keep the table head "TOTAL (AED)", so drop this row to avoid the second TOTAL.
  if (bsRows.length > 0) {
    const r0 = bsRows[0];
    const isRedundantTotalHeader =
      r0 &&
      r0.row_type === 'header' &&
      (r0.level ?? 0) === 0 &&
      normalizeLabel(r0.label) === 'TOTAL';

    if (isRedundantTotalHeader) {
      bsRows = bsRows.slice(1);
    }
  }

  const body = bsRows.map((r) => {
    const indent = r.level > 0 ? '  '.repeat(r.level) : '';
    const label = `${indent}${r.label}`;

    const amount =
      r.amount === null || r.row_type === 'header' ? '' : formatMoney(Number(r.amount));

    return [label, amount];
  });

  // Column sizing: header right-aligned and lined up with amounts
  const amountColWidth = 50; // mm
  const labelColWidth = right - left - amountColWidth;

  autoTable(doc, {
    startY: 42,
    theme: 'plain',

    // Single header line; right cell aligns with the amount column
    head: [['', `TOTAL (${currency})`]],
    body,

    margin: { left, right: pageW - right },

    styles: {
      font: 'helvetica',
      fontSize: 9,
      textColor: 20,
      cellPadding: { top: 1.5, right: 0, bottom: 1.5, left: 0 },
    },

    headStyles: {
      fontStyle: 'normal',
      textColor: 80,
    },

    columnStyles: {
      0: { halign: 'left', cellWidth: labelColWidth },
      1: { halign: 'right', cellWidth: amountColWidth },
    },

    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index === 1) data.cell.styles.halign = 'right';
        return;
      }
      if (data.section !== 'body') return;

      const r = bsRows[data.row.index];
      if (!r) return;

      if (r.row_type === 'header') data.cell.styles.fontStyle = 'normal';
      if (r.row_type === 'total' || r.row_type === 'calc') data.cell.styles.fontStyle = 'bold';
    },

    didDrawCell: (data) => {
      if (data.section !== 'body') return;

      const r = bsRows[data.row.index];
      if (!r) return;

      if ((r.row_type === 'total' || r.row_type === 'calc') && data.column.index === 0) {
        const yTop = data.cell.y;
        const yBottom = data.cell.y + data.cell.height;

        doc.setLineWidth(r.row_type === 'calc' ? 0.4 : 0.3);
        doc.line(left, yTop, right, yTop);
        doc.line(left, yBottom, right, yBottom);
      }
    },
  });

  // ---- Footer ----
  const footerY = pageH - 10;
  doc.setFontSize(8);
  doc.setTextColor(140);

  const pageCount = doc.getNumberOfPages();
  const pageNum = doc.getCurrentPageInfo().pageNumber;

  doc.text(`Accrual Basis  ${formatFooterTimestamp()}`, left, footerY);
  doc.text(`${pageNum}/${pageCount}`, right, footerY, { align: 'right' });

  doc.setTextColor(0);

  doc.save(`Balance_Sheet_${asOfDate}.pdf`);
}