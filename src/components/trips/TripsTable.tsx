// src/components/trips/TripsTable.tsx

import { ReactNode } from 'react';
import { Button } from '../Button';

type TripStatus = 'draft' | 'locked' | 'filed';

export type TripRow = {
  id: string;
  name: string;
  purpose: string | null;
  destination: string | null;
  start_date: string;
  end_date: string;
  status: TripStatus | string;
  created_at: string;
};

function formatDate(d: string | null | undefined) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString();
}

function normalizeStatus(status: TripStatus | string): 'draft' | 'locked' | 'filed' {
  if (status === 'filed') return 'filed';
  if (status === 'locked') return 'locked';
  return 'draft';
}

function badge(status: TripStatus | string): ReactNode {
  const s = normalizeStatus(status);

  const styles: Record<typeof s, string> = {
    draft: 'bg-yellow-100 text-yellow-800',
    locked: 'bg-blue-100 text-blue-800',
    filed: 'bg-gray-200 text-gray-800',
  };

  const label: Record<typeof s, string> = {
    draft: 'DRAFT',
    locked: 'READY',
    filed: 'FILED',
  };

  return <span className={`px-2 py-1 text-xs font-medium rounded ${styles[s]}`}>{label[s]}</span>;
}

type Props = {
  trips: TripRow[];
  onEditTrip: (tripId: string) => void;
};

export function TripsTable({ trips, onEditTrip }: Props) {
  const stop = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* MOBILE: cards */}
      <div className="block md:hidden">
        <div className="divide-y divide-gray-200">
          {trips.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onEditTrip(t.id)}
              className="w-full text-left p-4 hover:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{t.name}</div>
                  <div className="text-xs text-gray-600 mt-1 truncate">
                    {formatDate(t.start_date)} - {formatDate(t.end_date)}
                  </div>
                  <div className="text-xs text-gray-600 mt-1 truncate">
                    {t.destination || '-'}
                    {t.purpose ? ` • ${t.purpose}` : ''}
                  </div>
                </div>
                <div className="shrink-0">{badge(t.status)}</div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={(e: any) => {
                    stop(e);
                    onEditTrip(t.id);
                  }}
                >
                  Edit
                </Button>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* DESKTOP: table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Trip
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Dates
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="bg-white divide-y divide-gray-200">
            {trips.map((t) => (
              <tr
                key={t.id}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => onEditTrip(t.id)}
              >
                <td className="px-6 py-4 min-w-[220px]">
                  <div className="text-sm font-medium text-gray-900">{t.name}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    {t.destination || '-'}
                    {t.purpose ? ` • ${t.purpose}` : ''}
                  </div>
                </td>

                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {formatDate(t.start_date)} - {formatDate(t.end_date)}
                </td>

                <td className="px-6 py-4 whitespace-nowrap">{badge(t.status)}</td>

                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <Button
                    variant="secondary"
                    onClick={(e: any) => {
                      stop(e);
                      onEditTrip(t.id);
                    }}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}