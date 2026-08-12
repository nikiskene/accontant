// src/components/trips/TripCreateModal.tsx

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '../Button';
import { Input } from '../Input';

type TripStatus = 'draft' | 'locked' | 'filed';

type TripRow = {
  id: string;
  workspace_id: string;
  name: string;
  purpose: string | null;
  destination: string | null;
  start_date: string;
  end_date: string;
  default_cost_center_id: string | null;
  status: TripStatus;
  posted_batch_id: string | null;
  created_at: string;
};

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

export function TripCreateModal(props: {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreated: (trip: TripRow) => void;
}) {
  const { open, workspaceId, onClose, onCreated } = props;

  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setName('');
    setPurpose('');
    setDestination('');

    const t = todayISO();
    setStartDate(t);
    setEndDate(t);

    setSaving(false);
    setErrorMsg(null);
  }, [open]);

  if (!open) return null;

  const validate = () => {
    if (!name.trim()) return 'Name is required.';
    if (!startDate) return 'Start date is required.';
    if (!endDate) return 'End date is required.';
    if (startDate > endDate) return 'Start date must be before (or equal to) end date.';
    return null;
  };

  const handleCreate = async () => {
    const v = validate();
    if (v) {
      setErrorMsg(v);
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    try {
      // IMPORTANT:
      // Your DB currently has a check constraint:
      //   status IN ('draft','reviewed','posted','locked')
      //
      // For "Step 1" (Draft + Submit->Locked + Filed later),
      // we create trips as 'draft' only.
      //
      // Filed will be set by your existing file_trip() RPC later.
      const { data, error } = await supabase
        .from('trips')
        .insert({
          workspace_id: workspaceId,
          name: name.trim(),
          purpose: purpose.trim() ? purpose.trim() : null,
          destination: destination.trim() ? destination.trim() : null,
          start_date: startDate,
          end_date: endDate,
          status: 'draft',
        })
        .select('*')
        .single();

      if (error) throw error;

      onCreated(data as TripRow);
      onClose();
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-label="Close"
      />

      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div className="p-5 sm:p-6 border-b">
          <div className="text-xl font-semibold text-gray-900">New Trip</div>
          <div className="text-sm text-gray-600 mt-1">Create a trip container for receipts.</div>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />

          <Input label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />

          <Input
            label="Destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              type="date"
              label="Start date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              type="date"
              label="End date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="text-xs text-gray-500">
            Status is created as <span className="font-medium">DRAFT</span>. Use Submit in Trip
            Details to lock and file later.
          </div>

          {errorMsg && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="p-5 sm:p-6 border-t flex flex-col sm:flex-row sm:justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating…' : 'Create Trip'}
          </Button>
        </div>
      </div>
    </div>
  );
}