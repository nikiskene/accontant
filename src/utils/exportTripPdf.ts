// src/utils/exportTripPdf.ts

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabase';

type Trip = {
  id: string;
  workspace_id: string;
  name: string;
  purpose: string | null;
  destination: string | null;
  start_date: string;
  end_date: string;
  status: string;
};

type WorkspaceSettings = {
  company_name: string | null;
  license_number: string | null;
  trn: string | null;
  reporting_currency: string | null; // should be AED
};

type TripExpenseRow = {
  transaction_line_id?: string;
  trip_expense_id?: string;
  expense_date?: string;
  txn_date?: string;
  merchant: string | null;
  description: string | null;
  memo?: string | null;
  gross_amount?: string | number; // from v_trip_expenses_aed
  currency?: string; // from v_trip_expenses_aed
  amount_native?: string | number; // from v_transaction_lines_aed
  txn_currency?: string; // from v_transaction_lines_aed
  fx_rate_to_aed: string | number | null;
  amount_aed: string | number | null;
};

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

function todayStamp() {
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

function pickDate(r: TripExpenseRow): string {
  return (r.expense_date ?? r.txn_date ?? '').slice(0, 10);
}

function pickDesc(r: TripExpenseRow): string {
  return (r.description ?? r.memo ?? '') || '';
}

function pickNativeAmount(r: TripExpenseRow): number {
  // prefer explicit native amount columns if present
  if (r.gross_amount !== undefined) return toNum(r.gross_amount);
  if (r.amount_native !== undefined) return toNum(r.amount_native);
  return 0;
}

function pickCurrency(r: TripExpenseRow): string {
  return (r.currency ?? r.txn_currency ?? 'AED') || 'AED';
}

export async function exportTripPdf(workspaceId: string, tripId: string) {
  // 1) trip
  const { data: trip, error: tripErr } = await supabase
    .from('trips')
    .select('id, workspace_id, name, purpose, destination, start_date, end_date, status')
    .eq('workspace_id', workspaceId)
    .eq('id', tripId)
    .single();

  if (tripErr) throw tripErr;
  const t = trip as Trip;

  // 2) settings (for header)
  const { data: settings, error: settingsErr } = await supabase
    .from('workspace_settings')
    .select('company_name, license_number, trn, reporting_currency')
    .eq('workspace_id', workspaceId)
    .single();

  if (settingsErr) throw settingsErr;
  const s = (settings ?? {}) as WorkspaceSettings;
  const company = s.company_name ?? '';
  const license = s.license_number ?? '';
  const trn = s.trn ?? '';
  const reportingCurrency = (s.reporting_currency ?? 'AED') || 'AED';

  // 3) receipts rows
  // Prefer v_trip_expenses_aed (your TripDetailPanel uses it). If it’s missing, fall back to v_transaction_lines_aed.
  let rows: TripExpenseRow[] = [];

  {
    const { data, error } = await supabase
      .from('v_trip_expenses_aed')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('trip_id', tripId)
      .order('expense_date', { ascending: true });

    if (!error && Array.isArray(data)) {
      rows = data as TripExpenseRow[];
    } else {
      const fallback = await supabase
        .from('v_transaction_lines_aed')
        .select('txn_date, merchant:counterparty_id, memo, amount_native, txn_currency, fx_rate_to_aed, amount_aed, trip_id')
        .eq('workspace_id', workspaceId)
        .eq('trip_id', tripId)
        .order('txn_date', { ascending: true });

      if (fallback.error) throw fallback.error;
      rows = (fallback.data as TripExpenseRow[]) || [];
    }
  }

  // 4) totals (native + AED)
  // You created trip_report_totals(uuid) in Supabase.
  let totalNative = 0;
  let totalAED = 0;

  {
    const { data, error } = await supabase.rpc('trip_report_totals', { p_trip_id: tripId });
    if (!error && Array.isArray(data) && data[0]) {
      totalNative = toNum(data[0].total_native);
      totalAED = toNum(data[0].total_aed);
    } else {
      // fallback compute
      totalNative = rows.reduce((s, r) => s + pickNativeAmount(r), 0);
      totalAED = rows.reduce((s, r) => s + toNum(r.amount_aed), 0);
    }
  }

  // ---- PDF ----
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 18;
  const right = pageW - 18;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0);

  // Header top line
  doc.setFontSize(11);
  const topY = 16;
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
  doc.text('Travel Expenses', left, 26);

  // Trip meta
  doc.setFontSize(10);
  doc.setTextColor(60);

  const line1 = `${t.name}`;
  const line2 = `${(t.destination ?? '').trim() || '—'}  |  ${t.start_date} → ${t.end_date}`;
  const line3 = `${(t.purpose ?? '').trim() || '—'}  |  Status: ${(t.status ?? '').toUpperCase()}`;

  doc.text(line1, left, 32);
  doc.text(line2, left, 37);
  doc.text(line3, left, 42);

  doc.setTextColor(0);

  // Divider
  doc.setLineWidth(0.2);
  doc.line(left, 47, right, 47);

  // Table
  const amountColW = 26; // native amount
  const currColW = 14; // currency
  const rateColW = 20; // fx rate
  const aedColW = 28; // AED amount
  const dateColW = 20;
  const partnerColW = 34;
  const descColW = (right - left) - (dateColW + partnerColW + amountColW + currColW + rateColW + aedColW);

  const body = rows.map((r) => {
    const date = pickDate(r) || '-';
    const partner = (r.merchant ?? '') || '-';
    const desc = pickDesc(r) || '-';
    const native = pickNativeAmount(r);
    const cur = pickCurrency(r);
    const rate = r.fx_rate_to_aed == null ? '' : fmtMoney(toNum(r.fx_rate_to_aed));
    const aed = r.amount_aed == null ? '' : fmtMoney(toNum(r.amount_aed));

    return [
      date,
      partner,
      desc,
      native ? fmtMoney(native) : fmtMoney(0),
      cur,
      rate,
      aed,
    ];
  });

  autoTable(doc, {
    startY: 52,
    theme: 'plain',
    head: [[
      'Date',
      'Partner',
      'Description',
      'Amount',
      'Cur',
      `FX→${reportingCurrency}`,
      `${reportingCurrency}`,
    ]],
    body,
    margin: { left, right: pageW - right },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      textColor: 20,
      cellPadding: { top: 1.6, right: 1.5, bottom: 1.6, left: 1.5 },
      valign: 'top',
    },
    headStyles: {
      fontStyle: 'normal',
      textColor: 80,
    },
    columnStyles: {
      0: { cellWidth: dateColW, halign: 'left' },
      1: { cellWidth: partnerColW, halign: 'left' },
      2: { cellWidth: descColW, halign: 'left' },
      3: { cellWidth: amountColW, halign: 'right' },
      4: { cellWidth: currColW, halign: 'left' },
      5: { cellWidth: rateColW, halign: 'right' },
      6: { cellWidth: aedColW, halign: 'right' },
    },
    didDrawPage: () => {
      // keep footer on every page
      const footerY = pageH - 10;
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`Accrual Basis  ${todayStamp()}`, left, footerY);
      const pageCount = doc.getNumberOfPages();
      const pageNum = doc.getCurrentPageInfo().pageNumber;
      doc.text(`${pageNum}/${pageCount}`, right, footerY, { align: 'right' });
      doc.setTextColor(0);
    },
  });

  // Totals box (after table)
  const lastY = (doc as any).lastAutoTable?.finalY ?? 52;
  const boxTop = Math.min(lastY + 6, pageH - 35);

  doc.setLineWidth(0.2);
  doc.line(left, boxTop, right, boxTop);

  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text('Totals', left, boxTop + 7);
  doc.setTextColor(0);

  doc.setFontSize(10);
  const totalsLeft = left;
  const totalsRight = right;

  // Native total is meaningful only if mostly single-currency; still show it (it matches your DB total_native).
  doc.text(`Total (native):`, totalsLeft, boxTop + 14);
  doc.text(`${fmtMoney(totalNative)}`, totalsRight - 45, boxTop + 14, { align: 'right' });

  doc.text(`Total (${reportingCurrency}):`, totalsLeft, boxTop + 20);
  doc.setFont('helvetica', 'bold');
  doc.text(`${fmtMoney(totalAED)}`, totalsRight - 45, boxTop + 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');

  // Filename
  const safeName = (t.name || 'Trip').replace(/[^\w\-]+/g, '_').slice(0, 60);
  doc.save(`Travel_Expenses_${safeName}_${t.start_date}_to_${t.end_date}.pdf`);
}