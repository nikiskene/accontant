// src/components/trips/TripDetailPanel.tsx
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../Button';

import { downloadTripPdf, TripExpenseRow, TripRowLike } from '../../utils/tripPdf';
import { TripReceiptForm, type Currency } from './TripReceiptForm';
import { TripReceiptsTable } from './TripReceiptsTable';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// DB-allowed statuses: draft, submitted, filed
function isReadOnlyStatus(s: string | null | undefined) {
  return s === 'submitted' || s === 'filed';
}

export function TripDetailPanel(props: {
  open: boolean;
  workspaceId: string;
  tripId: string;
  trip: TripRowLike | null;
  onClose: () => void;
  onTripUpdated?: (patch: Partial<TripRowLike> & { id: string }) => void;
}) {
  const { open, workspaceId, tripId, trip, onClose, onTripUpdated } = props;

  const [rows, setRows] = useState<TripExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(todayISO());
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('AED');
  const [desc, setDesc] = useState('');

  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const status = trip?.status ?? 'draft';
  const readOnly = isReadOnlyStatus(status);

  // Step 1 button: only in draft
  const canPrepare = status === 'draft';

  // Step 2 button: after prepare, trip becomes submitted
  const canSubmit = status === 'submitted';

  useEffect(() => {
    if (open && tripId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tripId]);

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setMerchant('');
    setAmount('');
    setCurrency('AED');
    setDesc('');
  }, [open, tripId]);

  const load = async () => {
    if (!workspaceId || !tripId) return;

    setLoading(true);

    const { data, error } = await supabase
      .from('v_trip_expenses_aed')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('trip_id', tripId)
      .order('expense_date', { ascending: true });

    if (error) {
      console.error(error);
      setRows([]);
    } else {
      setRows((data as TripExpenseRow[]) || []);
    }

    setLoading(false);
  };

  const nativeCurrency = useMemo(() => {
    const set = new Set(rows.map((r) => r.currency).filter(Boolean));
    if (set.size === 1) return Array.from(set)[0];
    if (set.size === 0) return null;
    return 'MIXED';
  }, [rows]);

  const totalNative = useMemo(() => rows.reduce((s, r) => s + Number(r.gross_amount || 0), 0), [rows]);
  const totalAED = useMemo(() => rows.reduce((s, r) => s + Number(r.amount_aed || 0), 0), [rows]);

  const add = async () => {
    if (readOnly) return;

    const amt = Number(amount);
    if (!amount || Number.isNaN(amt) || amt <= 0) return alert('Valid amount required');

    setSaving(true);

    const { error } = await supabase.from('trip_expenses').insert({
      workspace_id: workspaceId,
      trip_id: tripId,
      expense_date: date,
      merchant: merchant || null,
      description: desc || null,
      gross_amount: amt,
      currency,
      status: 'draft',
    });

    if (error) {
      console.error(error);
      alert(error.message);
      setSaving(false);
      return;
    }

    setAmount('');
    setMerchant('');
    setDesc('');
    await load();

    setSaving(false);
  };

  const prepareTrip = async () => {
    if (!canPrepare) return;

    try {
      setPreparing(true);

      const res = await supabase.rpc('prepare_trip', { p_trip_id: tripId });
      if (res.error) throw res.error;

      // IMPORTANT: prepare_trip should set trip status -> 'submitted'
      onTripUpdated?.({ id: tripId, status: 'submitted' });
      await load();
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? String(e));
    } finally {
      setPreparing(false);
    }
  };

  const submitTrip = async () => {
    if (!canSubmit) return;

    try {
      setSubmitting(true);

      const res = await supabase.rpc('submit_trip', { p_trip_id: tripId });
      if (res.error) throw res.error;

      onTripUpdated?.({ id: tripId, status: 'filed' });
      await load();
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const downloadPdf = async () => {
    try {
      setDownloading(true);
      await downloadTripPdf({ workspaceId, tripId, trip, rows });
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? String(e));
    } finally {
      setDownloading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
        aria-label="Close trip details"
      />

      <div className="absolute inset-x-0 bottom-0 md:inset-y-0 md:right-0 md:left-auto w-full md:w-[760px] bg-white shadow-xl flex flex-col max-h-[92vh] md:max-h-full">
        <div className="p-4 sm:p-6 border-b flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-gray-900 truncate">{trip?.name ?? 'Trip'}</div>
            <div className="text-sm text-gray-600 mt-1">
              {trip?.start_date ? new Date(trip.start_date).toLocaleDateString() : '-'} {' - '}
              {trip?.end_date ? new Date(trip.end_date).toLocaleDateString() : '-'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Status: <span className="font-medium">{String(status).toUpperCase()}</span>
              {readOnly ? ' (read-only)' : ''}
            </div>
          </div>

          <div className="shrink-0 flex flex-col sm:flex-row flex-wrap gap-2 justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>

            <Button variant="secondary" onClick={downloadPdf} disabled={downloading}>
              {downloading ? 'Preparing…' : 'Download PDF'}
            </Button>

            {canPrepare && (
              <Button onClick={prepareTrip} disabled={preparing}>
                {preparing ? 'Preparing…' : 'Prepare'}
              </Button>
            )}

            {canSubmit && (
              <Button onClick={submitTrip} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit'}
              </Button>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-6 overflow-auto space-y-6">
          <TripReceiptForm
            locked={readOnly}
            date={date}
            merchant={merchant}
            amount={amount}
            currency={currency}
            desc={desc}
            saving={saving}
            onChange={(patch) => {
              if (patch.date !== undefined) setDate(patch.date);
              if (patch.merchant !== undefined) setMerchant(patch.merchant);
              if (patch.amount !== undefined) setAmount(patch.amount);
              if (patch.currency !== undefined) setCurrency(patch.currency);
              if (patch.desc !== undefined) setDesc(patch.desc);
            }}
            onAdd={add}
          />

          <TripReceiptsTable
            loading={loading}
            rows={rows}
            totalNative={totalNative}
            nativeCurrency={nativeCurrency}
            totalAED={totalAED}
          />

          {readOnly && <div className="text-sm text-gray-600">This trip is submitted/filed and read-only.</div>}
        </div>
      </div>
    </div>
  );
}