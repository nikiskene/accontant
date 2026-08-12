// src/pages/TripDetails.tsx

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';

type TripStatus = 'draft' | 'reviewed' | 'posted' | 'locked';

type Trip = {
  id: string;
  workspace_id: string;
  name: string;
  purpose: string | null;
  destination: string | null;
  start_date: string;
  end_date: string;
  status: TripStatus;
  created_at: string;
};

type TripExpense = {
  id: string;
  trip_id: string;
  expense_date: string;
  merchant: string | null;
  description: string | null;
  gross_amount: number;
  currency: string;
  status: string;
  created_at: string;
};

const CURRENCIES = ['AED', 'EUR', 'USD', 'HKD', 'RMB', 'CHF', 'GBP'];

function fmtDate(d?: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString();
}

function fmtMoney(n: any) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// UI label mapping: DB uses locked; user wants FILED
function statusLabel(status: TripStatus) {
  if (status === 'locked') return 'FILED';
  return status.toUpperCase();
}

export function TripDetails(props: {
  workspaceId: string;
  tripId: string;
  onBack: () => void;
  onTripStatusChanged?: (tripId: string, nextStatus: TripStatus) => void;
}) {
  const { workspaceId, tripId, onBack, onTripStatusChanged } = props;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [expenses, setExpenses] = useState<TripExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Receipt form (your required fields)
  const [expenseDate, setExpenseDate] = useState('');
  const [partner, setPartner] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<string>('AED');
  const [description, setDescription] = useState('');

  const canEdit = useMemo(() => trip?.status !== 'locked', [trip?.status]);

  useEffect(() => {
    if (workspaceId && tripId) {
      loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, tripId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: tripData, error: tripErr }, { data: expData, error: expErr }] =
        await Promise.all([
          supabase
            .from('trips')
            .select('id, workspace_id, name, purpose, destination, start_date, end_date, status, created_at')
            .eq('workspace_id', workspaceId)
            .eq('id', tripId)
            .single(),
          supabase
            .from('trip_expenses')
            .select('id, trip_id, expense_date, merchant, description, gross_amount, currency, status, created_at')
            .eq('workspace_id', workspaceId)
            .eq('trip_id', tripId)
            .order('expense_date', { ascending: true })
            .order('created_at', { ascending: true }),
        ]);

      if (tripErr) throw tripErr;
      if (expErr) throw expErr;

      setTrip(tripData as Trip);
      setExpenses((expData as TripExpense[]) || []);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const addReceipt = async () => {
    if (!trip) return;

    // minimal validation
    if (!expenseDate) return alert('Please select a date.');
    if (!amount || !Number.isFinite(Number(amount))) return alert('Please enter a valid amount.');
    if (!currency) return alert('Please select a currency.');

    setSavingReceipt(true);
    try {
      const payload = {
        workspace_id: workspaceId,
        trip_id: trip.id,
        expense_date: expenseDate,
        merchant: partner || null,
        description: description || null,
        gross_amount: Number(amount),
        currency,
        status: 'draft',
      };

      const { data, error } = await supabase
        .from('trip_expenses')
        .insert(payload)
        .select('id, trip_id, expense_date, merchant, description, gross_amount, currency, status, created_at')
        .single();

      if (error) throw error;

      setExpenses((prev) => [...prev, data as TripExpense]);

      // reset form
      setExpenseDate('');
      setPartner('');
      setAmount('');
      setCurrency('AED');
      setDescription('');
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? String(e));
    } finally {
      setSavingReceipt(false);
    }
  };

  const submitTrip = async () => {
    if (!trip) return;
    if (trip.status === 'locked') return;

    if (expenses.length === 0) {
      return alert('Add at least one receipt before submitting.');
    }

    setSubmitting(true);
    try {
      // DB constraint currently supports "locked". We'll treat that as FILED.
      const { error } = await supabase
        .from('trips')
        .update({ status: 'locked' })
        .eq('workspace_id', workspaceId)
        .eq('id', trip.id);

      if (error) throw error;

      setTrip((prev) => (prev ? { ...prev, status: 'locked' } : prev));
      onTripStatusChanged?.(trip.id, 'locked');
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading trip…</div>;
  }

  if (!trip) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-gray-900 font-medium">Trip not found.</div>
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  const totalByCurrency = expenses.reduce<Record<string, number>>((acc, e) => {
    const k = e.currency || 'UNK';
    acc[k] = (acc[k] || 0) + Number(e.gross_amount || 0);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{trip.name}</h1>
          <div className="text-gray-600 mt-1">
            {fmtDate(trip.start_date)} – {fmtDate(trip.end_date)} · Status: {statusLabel(trip.status)}
          </div>
          {(trip.purpose || trip.destination) && (
            <div className="text-sm text-gray-600 mt-1">
              {trip.purpose ? `Purpose: ${trip.purpose}` : null}
              {trip.purpose && trip.destination ? ' · ' : null}
              {trip.destination ? `Destination: ${trip.destination}` : null}
            </div>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button onClick={submitTrip} disabled={!canEdit || submitting}>
            {submitting ? 'Submitting…' : 'Submit (File)'}
          </Button>
        </div>
      </div>

      {/* Receipt entry */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-gray-900 font-semibold">Add receipt</div>
          {!canEdit && <div className="text-sm text-gray-600">Trip is filed (locked).</div>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mt-4">
          <Input
            type="date"
            label="Date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            disabled={!canEdit}
          />

          <Input
            label="Partner"
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
            placeholder="Merchant / vendor"
            disabled={!canEdit}
          />

          <Input
            label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={!canEdit}
          />

          <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!canEdit}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>

          <div className="flex items-end">
            <Button onClick={addReceipt} disabled={!canEdit || savingReceipt} className="w-full">
              {savingReceipt ? 'Saving…' : 'Add'}
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional notes"
            disabled={!canEdit}
          />
        </div>
      </div>

      {/* Receipts list */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-gray-900 font-semibold">Receipts</div>
          <div className="text-sm text-gray-600">
            Totals:{' '}
            {Object.keys(totalByCurrency).length === 0
              ? '-'
              : Object.entries(totalByCurrency)
                  .map(([c, v]) => `${c} ${fmtMoney(v)}`)
                  .join(' · ')}
          </div>
        </div>

        {expenses.length === 0 ? (
          <div className="p-12 text-center text-gray-600">No receipts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Partner
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Currency
                  </th>
                </tr>
              </thead>

              <tbody className="bg-white divide-y divide-gray-200">
                {expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{fmtDate(e.expense_date)}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{e.merchant || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{e.description || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {fmtMoney(e.gross_amount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{e.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Note about AED conversion */}
      <div className="text-sm text-gray-600">
        AED conversion: this screen stores the receipt in its original currency. The AED conversion used for reporting
        is handled in your posting/reporting pipeline (fx rate → AED).
      </div>
    </div>
  );
}