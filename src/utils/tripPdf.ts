// src/utils/tripPdf.ts
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabase';

export type TripExpenseRow = {
  trip_expense_id: string;
  expense_date: string;
  merchant: string | null;
  description: string | null;
  gross_amount: string;
  currency: string;
  amount_aed: string | null;
  fx_rate_to_aed: string | null;
  status: string;
};

export type TripRowLike = {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
};

function formatMoney(n: number, decimals = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatFooterTimestamp() {
  const d = new Date();
  const datePart = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: '2-digit' });
  const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const tz =
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    `GMT${String(-d.getTimezoneOffset() / 60).startsWith('-') ? '' : '+'}${-d.getTimezoneOffset() / 60}`;
  return `${datePart} ${timePart} ${tz}`;
}

export async function downloadTripPdf(params: {
  workspaceId: string;
  tripId: string;
  trip: TripRowLike | null;
  rows: TripExpenseRow[];
}) {
  const { workspaceId, tripId, trip, rows } = params;

  // company info
  const { data: settings, error: settingsError } = await supabase
    .from('workspace_settings')
    .select('company_name, license_number, trn, reporting_currency')
    .eq('workspace_id', workspaceId)
    .single();
  if (settingsError) throw settingsError;

  const company = settings?.company_name ?? '';
  const license = settings?.license_number ?? '';
  const trn = settings?.trn ?? '';
  const reportingCurrency = settings?.reporting_currency ?? 'AED';

  // ensure latest rows if needed
  const useRows =
    rows.length > 0
      ? rows
      : await (async () => {
          const { data, error } = await supabase
            .from('v_trip_expenses_aed')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('trip_id', tripId)
            .order('expense_date', { ascending: true });
          if (error) throw error;
          return (data as TripExpenseRow[]) || [];
        })();

  // totals: prefer DB function if present, else fallback
  let totalNativeDb: number | null = null;
  let totalAedDb: number | null = null;

  const totalsRes = await supabase.rpc('trip_report_totals', { p_trip_id: tripId });
  if (!totalsRes.error && Array.isArray(totalsRes.data) && totalsRes.data[0]) {
    totalNativeDb = Number(totalsRes.data[0].total_native ?? 0);
    totalAedDb = Number(totalsRes.data[0].total_aed ?? 0);
  }

  const tNative = totalNativeDb ?? useRows.reduce((s, r) => s + Number(r.gross_amount || 0), 0);
  const tAed = totalAedDb ?? useRows.reduce((s, r) => s + Number(r.amount_aed || 0), 0);

  const singleCurrency = (() => {
    const set = new Set(useRows.map((r) => r.currency).filter(Boolean));
    if (set.size === 1) return Array.from(set)[0];
    if (set.size === 0) return reportingCurrency;
    return 'MIXED';
  })();

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 18;
  const right = pageW - 18;

  // Header
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0);

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

  doc.setFontSize(16);
  doc.text('Travel Expenses Report', left, 26);

  doc.setFontSize(10);
  doc.setTextColor(60);

  const tripName = trip?.name ?? 'Trip';
  const d1 = trip?.start_date ? new Date(trip.start_date).toLocaleDateString() : '-';
  const d2 = trip?.end_date ? new Date(trip.end_date).toLocaleDateString() : '-';
  doc.text(tripName, left, 32);
  doc.text(`${d1} - ${d2}`, left, 37);

  // Totals block
  doc.setTextColor(0);
  doc.setFontSize(10);
  const totalsY = 32;
  doc.text(`Total (${singleCurrency}): ${formatMoney(tNative)}`, right, totalsY, { align: 'right' });
  doc.text(`Total (AED): ${formatMoney(tAed, 2)}`, right, totalsY + 5, { align: 'right' });

  doc.setLineWidth(0.2);
  doc.line(left, 42, right, 42);

  const body = useRows.map((r) => {
    const amt = `${formatMoney(Number(r.gross_amount || 0))} ${r.currency}`;
    const aed = r.amount_aed ? formatMoney(Number(r.amount_aed), 2) : '-';
    return [r.expense_date, r.merchant || '-', r.description || '-', amt, aed];
  });

  autoTable(doc, {
    startY: 46,
    theme: 'plain',
    head: [['Date', 'Partner', 'Description', 'Amount', 'AED']],
    body,
    margin: { left, right: pageW - right },
    styles: {
      font: 'helvetica',
      fontSize: 9,
      textColor: 20,
      cellPadding: { top: 1.8, right: 1.5, bottom: 1.8, left: 1.5 },
    },
    headStyles: { fontStyle: 'normal', textColor: 80 },
    columnStyles: {
      0: { halign: 'left', cellWidth: 22 },
      1: { halign: 'left', cellWidth: 38 },
      2: { halign: 'left', cellWidth: 66 },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'right', cellWidth: 26 },
    },
    didDrawPage: () => {
      const footerY = pageH - 10;
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`Accrual Basis  ${formatFooterTimestamp()}`, left, footerY);

      const pageCount = doc.getNumberOfPages();
      const pageNum = doc.getCurrentPageInfo().pageNumber;
      doc.text(`${pageNum}/${pageCount}`, right, footerY, { align: 'right' });

      doc.setTextColor(0);
    },
  });

  const safeName = (tripName || 'Trip').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
  doc.save(`Travel_Expenses_${safeName}_${tripId}.pdf`);
}