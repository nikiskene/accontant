// src/utils/reportTypes.ts

export type ReportType = 'profit_and_loss' | 'balance_sheet' | 'trial_balance' | 'vat_summary';

export function toISODate(d: Date) {
  return d.toISOString().split('T')[0];
}

export function todayISO() {
  return toISODate(new Date());
}

export function startOfYearISO() {
  const d = new Date();
  d.setMonth(0, 1);
  return toISODate(d);
}