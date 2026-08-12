// src/components/trips/TripReceiptForm.tsx
import { Button } from '../Button';
import { Input } from '../Input';
import { Select } from '../Select';

const CURRENCIES = ['AED', 'EUR', 'USD', 'HKD', 'RMB', 'CHF', 'GPB'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function TripReceiptForm(props: {
  locked: boolean;
  date: string;
  merchant: string;
  amount: string;
  currency: Currency;
  desc: string;
  onChange: (patch: Partial<{ date: string; merchant: string; amount: string; currency: Currency; desc: string }>) => void;
  onAdd: () => void;
  saving: boolean;
}) {
  const { locked, date, merchant, amount, currency, desc, onChange, onAdd, saving } = props;

  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="text-sm font-semibold text-gray-900 mb-3">Add Receipt</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-2">
          <Input
            type="date"
            label="Date"
            value={date}
            onChange={(e) => onChange({ date: e.target.value })}
            disabled={locked}
          />
        </div>

        <div className="lg:col-span-2">
          <Input
            label="Partner"
            value={merchant}
            onChange={(e) => onChange({ merchant: e.target.value })}
            disabled={locked}
          />
        </div>

        <div className="lg:col-span-1">
          <Input
            label="Amount"
            value={amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            disabled={locked}
          />
        </div>

        <div className="lg:col-span-1">
          <Select
            label="Currency"
            value={currency}
            onChange={(e) => onChange({ currency: e.target.value as Currency })}
            disabled={locked}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        <div className="sm:col-span-2 lg:col-span-6">
          <Input
            label="Description"
            value={desc}
            onChange={(e) => onChange({ desc: e.target.value })}
            disabled={locked}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="text-xs text-gray-600">
          Amount will be converted to AED automatically (based on expense date FX).
        </div>

        <Button onClick={onAdd} disabled={locked || saving}>
          {saving ? 'Saving…' : 'Add Receipt'}
        </Button>
      </div>
    </div>
  );
}