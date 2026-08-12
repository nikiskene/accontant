// src/utils/exportCsv.ts

function escapeCsvValue(v: any) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportRowsToCSV(reportType: string, rows: any[]) {
  if (!rows || rows.length === 0) return;

  const keys = Object.keys(rows[0]);
  const headers = keys.map(escapeCsvValue).join(',');
  const body = rows
    .map((row) => keys.map((k) => escapeCsvValue((row as any)[k])).join(','))
    .join('\n');

  const csv = `${headers}\n${body}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${reportType}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();

  window.URL.revokeObjectURL(url);
}