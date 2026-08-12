// src/pages/Trips.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Plus } from 'lucide-react';

import { TripCreateModal } from '../components/trips/TripCreateModal';
import { TripsTable, type TripRow } from '../components/trips/TripsTable';
import { TripDetailPanel } from '../components/trips/TripDetailPanel';

type TaxYearRow = {
  id: string;
  label: string | null;
  name: string | null;
  starts_on: string | null;
  ends_on: string | null;
  start_date: string | null;
  end_date: string | null;
};

function normalizeId(v: any): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length ? s : null;
}

export function Trips() {
  const { workspaceId, selectedTaxYearId } = useApp() as any;

  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  // Trip details panel
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Prevent race conditions when switching tax years quickly
  const requestSeq = useRef(0);

  useEffect(() => {
    const ws = normalizeId(workspaceId);
    const ty = normalizeId(selectedTaxYearId);

    if (!ws) return;

    void loadTrips(ws, ty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, selectedTaxYearId]);

  const resolveTaxYearWindow = async (wsId: string, tyId: string | null) => {
    let ty: TaxYearRow | null = null;

    if (tyId) {
      const { data, error } = await supabase
        .from('tax_years')
        .select('id,label,name,starts_on,ends_on,start_date,end_date')
        .eq('workspace_id', wsId)
        .eq('id', tyId)
        .maybeSingle();

      if (error) throw error;
      ty = (data as TaxYearRow) || null;
    }

    // Fallback to default tax year if selected id is missing/stale
    if (!ty) {
      const { data, error } = await supabase
        .from('tax_years')
        .select('id,label,name,starts_on,ends_on,start_date,end_date')
        .eq('workspace_id', wsId)
        .eq('is_default', true)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      ty = (data as TaxYearRow) || null;
    }

    if (!ty) {
      throw new Error('No tax year found for this workspace.');
    }

    const fromDate = ty.starts_on || ty.start_date;
    const toDate = ty.ends_on || ty.end_date;

    if (!fromDate || !toDate) {
      throw new Error('Selected tax year is missing start/end dates.');
    }

    return { fromDate, toDate };
  };

  const loadTrips = async (wsId: string, tyId: string | null) => {
    const seq = ++requestSeq.current;

    try {
      setLoading(true);

      const { fromDate, toDate } = await resolveTaxYearWindow(wsId, tyId);

      // Trips that overlap the tax-year window:
      // trip.start_date <= toDate AND trip.end_date >= fromDate
      const { data, error } = await supabase
        .from('trips')
        .select('id, name, purpose, destination, start_date, end_date, status, created_at')
        .eq('workspace_id', wsId)
        .lte('start_date', toDate)
        .gte('end_date', fromDate)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (seq !== requestSeq.current) return;
      setTrips((data as TripRow[]) || []);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      console.error('Error loading trips:', e);
      setTrips([]);
    } finally {
      if (seq !== requestSeq.current) return;
      setLoading(false);
    }
  };

  const activeTrip = useMemo(
    () => (activeTripId ? trips.find((t) => t.id === activeTripId) ?? null : null),
    [activeTripId, trips]
  );

  const handleCreated = (trip: any) => {
    const row: TripRow = {
      id: trip.id,
      name: trip.name,
      purpose: trip.purpose ?? null,
      destination: trip.destination ?? null,
      start_date: trip.start_date,
      end_date: trip.end_date,
      status: trip.status,
      created_at: trip.created_at,
    };

    setTrips((prev) => [row, ...prev]);

    setActiveTripId(row.id);
    setDetailOpen(true);
  };

  const openTripDetails = (tripId: string) => {
    setActiveTripId(tripId);
    setDetailOpen(true);
  };

  const handleTripUpdated = (patch: Partial<TripRow> & { id: string }) => {
    setTrips((prev) => prev.map((t) => (t.id === patch.id ? { ...t, ...patch } : t)));
  };

  const closeDetails = () => {
    setDetailOpen(false);
    setActiveTripId(null);
  };

  if (loading) {
    return <div className="text-center py-12">Loading trips...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Trips</h1>
          <p className="text-gray-600 mt-1">Manage trip receipts and filing</p>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
            <Plus className="w-5 h-5 mr-2" />
            New Trip
          </Button>
        </div>
      </div>

      {trips.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 sm:p-12 text-center">
          <p className="text-gray-600 mb-4">No trips in selected tax year</p>
          <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
            Create Your First Trip
          </Button>
        </div>
      ) : (
        <TripsTable trips={trips} onEditTrip={openTripDetails} />
      )}

      {workspaceId && (
        <TripCreateModal
          open={createOpen}
          workspaceId={workspaceId}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {workspaceId && detailOpen && activeTripId && (
        <TripDetailPanel
          open={detailOpen}
          workspaceId={workspaceId}
          tripId={activeTripId}
          trip={activeTrip}
          onClose={closeDetails}
          onTripUpdated={handleTripUpdated}
        />
      )}
    </div>
  );
}