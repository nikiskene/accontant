// src/pages/Dashboard.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { TrendingUp, TrendingDown, AlertCircle, FileText, Inbox } from 'lucide-react';

interface DashboardStats {
  ytdInvoicedRevenue: Record<string, number>;
  ytdCollectedRevenue: Record<string, number>;
  ytdTotalExpenses: number;
  currentMonthVat: { input: number; output: number; netPayable: number };
  unreconciledBankLines: number;
  draftTransactions: number;
  currency: string;
  periodLabel: string;
}

function toISODate(d: Date) {
  return d.toISOString().split('T')[0];
}

function startOfMonthISO(year: number, month1to12: number) {
  return `${year}-${String(month1to12).padStart(2, '0')}-01`;
}

function safeNumber(v: any): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeId(v: any): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length ? s : null;
}

function addCurrencyAmount(totals: Record<string, number>, currency: string, amount: unknown) {
  const code = currency || 'Unknown';
  totals[code] = (totals[code] || 0) + safeNumber(amount);
}

function CurrencyTotals({ values }: { values: Record<string, number> }) {
  const entries = Object.entries(values).filter(([, amount]) => Math.abs(amount) >= 0.005);
  if (!entries.length) return <p className="text-2xl font-bold text-gray-900 mt-2">0.00</p>;
  return <div className="mt-2 space-y-1">{entries.sort(([a],[b])=>a.localeCompare(b)).map(([currency,amount])=><p key={currency} className="text-2xl font-bold text-gray-900">{amount.toFixed(2)} {currency}</p>)}</div>;
}

export function Dashboard() {
  const { workspaceId, workspace, accounts, taxYearId } = useApp() as any;

  // Debug: must be inside the component (after useApp())
  console.log('[Dashboard] workspaceId=', workspaceId, 'taxYearId=', taxYearId);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);

  // Prevent race conditions: only the latest request may update state.
  const requestSeq = useRef(0);

  const accountsById = useMemo(() => {
    const m = new Map<string, any>();
    (accounts || []).forEach((a: any) => {
      if (a?.id) m.set(a.id, a);
    });
    return m;
  }, [accounts]);

  useEffect(() => {
    const ws = normalizeId(workspaceId);
    const ty = normalizeId(taxYearId);

    if (!ws) return;

    // If accounts haven’t loaded yet, still load; we just won’t classify by account type properly.
    void loadDashboardStats(ws, ty);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, taxYearId, accountsById, workspace?.base_currency]);

  const loadDashboardStats = async (wsId: string, tyId: string | null) => {
    const seq = ++requestSeq.current;

    setFatalError(null);
    setLoading(true);

    try {
      // 1) Currency belongs to the selected legal entity.
      const currency = workspace?.base_currency || 'AED';

      // 2) Resolve tax year: prefer selected id, else default
      let ty: any = null;

      if (tyId) {
        const { data, error } = await supabase
          .from('tax_years')
          .select('id, label, name, starts_on, ends_on, start_date, end_date')
          .eq('workspace_id', wsId)
          .eq('id', tyId)
          .maybeSingle();

        if (error) throw error;
        ty = data || null;
      }

      if (!ty) {
        const { data, error } = await supabase
          .from('tax_years')
          .select('id, label, name, starts_on, ends_on, start_date, end_date')
          .eq('workspace_id', wsId)
          .eq('is_default', true)
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        ty = data;
      }

      if (!ty) throw new Error('No tax year found (tax_years is empty for this workspace).');

      const fromDate = ty.starts_on || ty.start_date;
      const toDate = ty.ends_on || ty.end_date;

      if (!fromDate || !toDate) throw new Error('Tax year is missing start/end dates.');

      const periodLabel = ty.label || ty.name || `${fromDate} → ${toDate}`;

      // 3) Operational sales live in sales_documents; expenses live in the posted ledger.
      const [postedResult, salesResult] = await Promise.all([
        supabase.from('v_posted_lines_aed').select('account_id, amount_aed, txn_date')
          .eq('workspace_id', wsId).gte('txn_date', fromDate).lte('txn_date', toDate),
        supabase.from('sales_documents').select('currency,subtotal,tax_total,total,amount_paid,issue_date,status')
          .eq('workspace_id', wsId).eq('document_type', 'invoice').neq('status', 'void')
          .gte('issue_date', fromDate).lte('issue_date', toDate),
      ]);
      if (postedResult.error) throw postedResult.error;
      if (salesResult.error) throw salesResult.error;
      const posted = postedResult.data || [];
      const sales = salesResult.data || [];

      // 4) Aggregate KPIs
      const invoicedRevenue: Record<string, number> = {};
      const collectedRevenue: Record<string, number> = {};
      let totalExpenses = 0;

      for (const document of sales) {
        addCurrencyAmount(invoicedRevenue, document.currency, document.subtotal);
        addCurrencyAmount(collectedRevenue, document.currency, document.amount_paid);
      }

      for (const row of posted) {
        const acct = accountsById.get((row as any).account_id);
        const amount = safeNumber((row as any).amount_aed);

        // Expenses include expense + cogs (if we know type)
        if (acct?.type === 'expense' || acct?.type === 'cogs') totalExpenses += amount;
      }

      // 5) VAT for current month (best-effort; not tax-year specific)
      const now = new Date();
      const monthStart = startOfMonthISO(now.getFullYear(), now.getMonth() + 1);
      const today = toISODate(now);

      let vatInput = 0;
      let vatOutput = sales
        .filter((document) => document.issue_date >= monthStart && document.issue_date <= today)
        .reduce((sum, document) => sum + safeNumber(document.tax_total), 0);
      let vatNet = 0;

      const tryVatRpc = async (fn: string) => {
        const res = await supabase.rpc(fn, {
          p_workspace_id: wsId,
          p_from: monthStart,
          p_to: today,
        });
        if ((res as any)?.error) throw (res as any).error;
        return (res as any)?.data || [];
      };

      try {
        let vatRows: any[] = [];
        try {
          vatRows = await tryVatRpc('vat_summary_filed');
        } catch {
          vatRows = await tryVatRpc('vat_summary');
        }

        const totalVat = vatRows.reduce((s, r) => s + safeNumber(r.vat_amount), 0);
        vatOutput += totalVat > 0 ? totalVat : 0;
        vatInput = totalVat < 0 ? Math.abs(totalVat) : 0;
        vatNet = vatOutput - vatInput;
      } catch {
        vatInput = 0;
        vatNet = 0;
      }
      vatNet = vatOutput - vatInput;

      // 6) Counts
      const [bankResult, draftResult] = await Promise.all([
        supabase
          .from('bank_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', wsId)
          .eq('status', 'unreconciled'),
        supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', wsId)
          .eq('status', 'draft'),
      ]);

      // Only latest request updates state
      if (seq !== requestSeq.current) return;

      setStats({
        ytdInvoicedRevenue: invoicedRevenue,
        ytdCollectedRevenue: collectedRevenue,
        ytdTotalExpenses: Math.abs(totalExpenses),
        currentMonthVat: {
          input: Math.abs(vatInput),
          output: Math.abs(vatOutput),
          netPayable: vatNet,
        },
        unreconciledBankLines: (bankResult as any)?.count || 0,
        draftTransactions: (draftResult as any)?.count || 0,
        currency,
        periodLabel,
      });
    } catch (error: any) {
      if (seq !== requestSeq.current) return;
      console.error('Dashboard load failed:', error);
      setFatalError(error?.message ?? String(error));
      setStats(null);
    } finally {
      if (seq !== requestSeq.current) return;
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-600">Loading dashboard...</div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard not available</h1>
        <p className="text-gray-700 mt-2">
          Check the console for the exact Supabase error (the dashboard now fails loudly instead of showing zeros).
        </p>
        <pre className="mt-4 p-3 bg-gray-50 rounded text-xs text-gray-700 overflow-auto">{fatalError}</pre>
      </div>
    );
  }

  const ccy = stats?.currency ?? 'AED';

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-600 mt-1">Overview of your accounting data</p>
          </div>
          <div className="text-sm text-gray-600">{stats?.periodLabel}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">YTD Invoiced Revenue (net)</p>
              <CurrencyTotals values={stats?.ytdInvoicedRevenue || {}} />
            </div>
            <TrendingUp className="w-10 h-10 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">YTD Collected (gross)</p>
              <CurrencyTotals values={stats?.ytdCollectedRevenue || {}} />
            </div>
            <TrendingUp className="w-10 h-10 text-green-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">YTD Total Expenses</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                {stats?.ytdTotalExpenses.toFixed(2)} {ccy}
              </p>
            </div>
            <TrendingDown className="w-10 h-10 text-red-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-yellow-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Current Month VAT</p>
              <p className="text-xs text-gray-500 mt-1">
                Input: {stats?.currentMonthVat.input.toFixed(2)} | Output: {stats?.currentMonthVat.output.toFixed(2)}
              </p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                Net: {stats?.currentMonthVat.netPayable.toFixed(2)} {ccy}
              </p>
            </div>
            <FileText className="w-10 h-10 text-yellow-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-orange-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Unreconciled Bank Lines</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">{stats?.unreconciledBankLines}</p>
            </div>
            <Inbox className="w-10 h-10 text-orange-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-gray-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Draft Transactions</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">{stats?.draftTransactions}</p>
            </div>
            <AlertCircle className="w-10 h-10 text-gray-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
