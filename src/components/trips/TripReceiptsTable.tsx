// src/components/trips/TripReceiptsTable.tsx
import { TripExpenseRow } from '../../utils/tripPdf';

function formatMoney(n: number, decimals = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function TripReceiptsTable(props: {
  loading: boolean;
  rows: TripExpenseRow[];
  totalNative: number;
  nativeCurrency: string | null;
  totalAED: number;
}) {
  const { loading, rows, totalNative, nativeCurrency, totalAED } = props;

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-white border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900">Receipts</div>
        <div className="text-sm font-semibold text-gray-900">
          Total {nativeCurrency && nativeCurrency !== 'MIXED' ? `(${nativeCurrency})` : ''}:{' '}
          {formatMoney(totalNative)} {nativeCurrency && nativeCurrency !== 'MIXED' ? nativeCurrency : ''}
          {'  '}|{'  '}
          Total (AED): {formatMoney(totalAED, 2)}
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-gray-600">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-gray-600">No receipts yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left whitespace-nowrap">Date</th>
                <th className="p-3 text-left whitespace-nowrap">Partner</th>
                <th className="p-3 text-left whitespace-nowrap">Description</th>
                <th className="p-3 text-right whitespace-nowrap">Amount</th>
                <th className="p-3 text-right whitespace-nowrap">AED</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => (
                <tr key={r.trip_expense_id} className="border-t">
                  <td className="p-3 whitespace-nowrap">{r.expense_date}</td>
                  <td className="p-3">{r.merchant || '-'}</td>
                  <td className="p-3">{r.description || '-'}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {formatMoney(Number(r.gross_amount || 0))} {r.currency}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {r.amount_aed ? formatMoney(Number(r.amount_aed), 2) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}