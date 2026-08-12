// src/pages/NewExpense.tsx
import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Modal } from '../components/Modal';

type Currency = 'AED' | 'USD' | 'EUR' | 'HKD' | 'RMB' | 'CNY';
const CURRENCIES: Currency[] = ['AED', 'USD', 'EUR', 'HKD', 'RMB', 'CNY'];

type Counterparty = {
  id: string;
  name: string;
  kind?: string | null;
};

function norm(s: string) {
  // makes "Döring" searchable via "dor"
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function NewExpense() {
  const {
    workspaceId,
    accounts,
    vatCodes,
    costCenters,
    counterparties,
    workspaceSettings,
    refetchReferenceData,
  } = useApp();

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // New vendor modal
  const [showNewCounterparty, setShowNewCounterparty] = useState(false);
  const [newCounterpartyName, setNewCounterpartyName] = useState('');

  // Vendor search (Option B)
  const [vendorQuery, setVendorQuery] = useState('');
  const [showVendorSuggestions, setShowVendorSuggestions] = useState(false);

  const defaultCurrency: Currency = (workspaceSettings?.reporting_currency as Currency) || 'AED';

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    currency: defaultCurrency,
    counterpartyId: '',
    expenseAccountId: workspaceSettings?.default_expense_account_id || '',
    description: '',
    grossAmount: '',
    vatCodeId: workspaceSettings?.default_vat_code_id || '',
    paidFromAccountId: workspaceSettings?.default_bank_account_id || '',
    costCenterId: workspaceSettings?.default_cost_center_id || '',
  });

  // Keep defaults in sync once workspaceSettings arrive
  useEffect(() => {
    if (!workspaceSettings) return;

    const nextDefaultCurrency: Currency = (workspaceSettings.reporting_currency as Currency) || 'AED';

    setFormData((p) => ({
      ...p,
      currency: p.currency || nextDefaultCurrency,
      expenseAccountId: p.expenseAccountId || workspaceSettings.default_expense_account_id || '',
      vatCodeId: p.vatCodeId || workspaceSettings.default_vat_code_id || '',
      paidFromAccountId: p.paidFromAccountId || workspaceSettings.default_bank_account_id || '',
      costCenterId: p.costCenterId || workspaceSettings.default_cost_center_id || '',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspaceSettings?.default_expense_account_id,
    workspaceSettings?.default_vat_code_id,
    workspaceSettings?.default_bank_account_id,
    workspaceSettings?.default_cost_center_id,
    workspaceSettings?.reporting_currency,
  ]);

  const vendorOptions: Counterparty[] = useMemo(() => {
    const list = (counterparties as Counterparty[]) || [];
    return list
      .filter((c) => {
        const k = (c.kind ?? '').toLowerCase();
        return k === 'vendor' || k === 'both' || k === '';
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [counterparties]);

  const selectedVendor: Counterparty | undefined = useMemo(() => {
    if (!formData.counterpartyId) return undefined;
    return vendorOptions.find((v) => v.id === formData.counterpartyId);
  }, [formData.counterpartyId, vendorOptions]);

  const filteredVendorSuggestions: Counterparty[] = useMemo(() => {
    const q = norm(vendorQuery);
    if (q.length < 3) return [];
    return vendorOptions
      .filter((v) => norm(v.name).includes(q))
      .slice(0, 12);
  }, [vendorOptions, vendorQuery]);

  // Close suggestions when query becomes too short
  useEffect(() => {
    if (norm(vendorQuery).length < 3) setShowVendorSuggestions(false);
  }, [vendorQuery]);

  const clearForm = () => {
    const nextDefaultCurrency: Currency = (workspaceSettings?.reporting_currency as Currency) || 'AED';
    setFormData({
      date: new Date().toISOString().split('T')[0],
      currency: nextDefaultCurrency,
      counterpartyId: '',
      expenseAccountId: workspaceSettings?.default_expense_account_id || '',
      description: '',
      grossAmount: '',
      vatCodeId: workspaceSettings?.default_vat_code_id || '',
      paidFromAccountId: workspaceSettings?.default_bank_account_id || '',
      costCenterId: workspaceSettings?.default_cost_center_id || '',
    });
    setVendorQuery('');
    setShowVendorSuggestions(false);
  };

  const handlePickVendor = (vendor: Counterparty) => {
    setFormData((p) => ({ ...p, counterpartyId: vendor.id }));
    setVendorQuery(vendor.name);
    setShowVendorSuggestions(false);
  };

  const handleCreateCounterparty = async () => {
    const name = newCounterpartyName.trim();
    if (!name) return;
    if (!workspaceId) {
      setError('Workspace not available.');
      return;
    }

    try {
      setError('');

      // prevent duplicates client-side
      const existing = vendorOptions.find((v) => norm(v.name) === norm(name));
      if (existing) {
        handlePickVendor(existing);
        setShowNewCounterparty(false);
        setNewCounterpartyName('');
        return;
      }

      const { data, error: insErr } = await supabase
        .from('counterparties')
        .insert({
          workspace_id: workspaceId,
          name,
          kind: 'vendor',
        })
        .select('id,name,kind')
        .single();

      if (insErr) throw insErr;

      await refetchReferenceData();

      if (data?.id) {
        setFormData((p) => ({ ...p, counterpartyId: data.id }));
        setVendorQuery(data.name);
      }

      setShowNewCounterparty(false);
      setNewCounterpartyName('');
      setShowVendorSuggestions(false);
    } catch (err: any) {
      console.error('Error creating counterparty:', err);
      setError(err?.message || 'Failed to create vendor');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    try {
      if (!workspaceId) throw new Error('Workspace not available.');

      const grossAmount = parseFloat(formData.grossAmount);
      if (!Number.isFinite(grossAmount) || grossAmount <= 0) throw new Error('Enter a valid gross amount.');

      const vatCode = vatCodes.find((v) => v.id === formData.vatCodeId);
      const vatRate = Number((vatCode as any)?.vat_rate ?? (vatCode as any)?.rate ?? 0);

      let netAmount: number;
      let vatAmount: number;

      if (vatRate > 0) {
        netAmount = Math.round((grossAmount / (1 + vatRate)) * 100) / 100;
        vatAmount = Math.round((grossAmount - netAmount) * 100) / 100;
      } else {
        netAmount = grossAmount;
        vatAmount = 0;
      }

      const { data: transaction, error: txnError } = await supabase
        .from('transactions')
        .insert({
          workspace_id: workspaceId,
          txn_date: formData.date,
          txn_type: 'purchase',
          description: formData.description,
          currency: formData.currency,
          counterparty_id: formData.counterpartyId || null,
          status: 'draft',
        })
        .select('id,status')
        .single();

      if (txnError) throw txnError;
      if (!transaction?.id) throw new Error('Failed to create transaction.');

      const lines: any[] = [
        {
          workspace_id: workspaceId,
          transaction_id: transaction.id,
          line_no: 1,
          account_id: formData.expenseAccountId,
          amount: netAmount,
          vat_code_id: formData.vatCodeId || null,
          cost_center_id: formData.costCenterId || null,
          memo: formData.description,
        },
      ];

      let nextLineNo = 2;

      if (vatAmount > 0) {
        const vatInputAccount = accounts.find((a) => a.code === '2210');
        if (vatInputAccount) {
          lines.push({
            workspace_id: workspaceId,
            transaction_id: transaction.id,
            line_no: nextLineNo++,
            account_id: vatInputAccount.id,
            amount: vatAmount,
            vat_code_id: formData.vatCodeId || null,
            cost_center_id: formData.costCenterId || null,
            memo: 'VAT Input',
          });
        }
      }

      lines.push({
        workspace_id: workspaceId,
        transaction_id: transaction.id,
        line_no: nextLineNo++,
        account_id: formData.paidFromAccountId,
        amount: -grossAmount,
        cost_center_id: formData.costCenterId || null,
        memo: formData.description,
      });

      const { error: linesError } = await supabase.from('transaction_lines').insert(lines);
      if (linesError) throw linesError;

      const userRes = await supabase.auth.getUser();
      const userId = userRes.data.user?.id || null;

      const { error: postError } = await supabase.rpc('post_transaction', {
        p_transaction_id: transaction.id,
        p_user_id: userId,
      });
      if (postError) throw postError;

      const { data: postedTxn, error: verifyErr } = await supabase
        .from('transactions')
        .select('status')
        .eq('id', transaction.id)
        .single();

      if (verifyErr) throw verifyErr;
      if (postedTxn?.status !== 'posted') throw new Error('Transaction did not post.');

      setSuccess(true);
      clearForm();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to create expense');
    } finally {
      setLoading(false);
    }
  };

  const shouldShowSuggestions = showVendorSuggestions && norm(vendorQuery).length >= 3;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">New Expense</h1>
        <p className="text-gray-600 mt-1">Record a purchase transaction</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="date"
            label="Date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            required
          />

          <Select
            label="Currency"
            value={formData.currency}
            onChange={(e) => setFormData({ ...formData, currency: e.target.value as Currency })}
            required
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>

          {/* Vendor search */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>

            <div className="flex gap-2">
              <Input
                label=""
                placeholder="Type at least 3 letters..."
                value={vendorQuery}
                onChange={(e) => {
                  const val = e.target.value;
                  setVendorQuery(val);
                  setFormData((p) => ({ ...p, counterpartyId: '' })); // until user selects
                  setShowVendorSuggestions(true);
                }}
                onFocus={() => setShowVendorSuggestions(true)}
                onBlur={() => {
                  // allow click on suggestion buttons before closing
                  window.setTimeout(() => setShowVendorSuggestions(false), 150);
                }}
              />

              <Button type="button" variant="secondary" onClick={() => setShowNewCounterparty(true)}>
                New
              </Button>
            </div>

            {selectedVendor && (
              <div className="text-xs text-gray-500 mt-1">
                Selected: <span className="font-medium">{selectedVendor.name}</span>
              </div>
            )}

            {shouldShowSuggestions && (
              <div className="absolute z-20 mt-2 w-full bg-white border border-gray-200 rounded-lg shadow max-h-64 overflow-auto">
                {filteredVendorSuggestions.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">No matches. Use “New” to create.</div>
                ) : (
                  filteredVendorSuggestions.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      onMouseDown={(ev) => ev.preventDefault()} // prevent input blur from cancelling click
                      onClick={() => handlePickVendor(v)}
                    >
                      {v.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <Select
            label="Expense Account"
            value={formData.expenseAccountId}
            onChange={(e) => setFormData({ ...formData, expenseAccountId: e.target.value })}
            required
          >
            <option value="">Select account...</option>
            {accounts
              .filter((a) => a.type === 'expense' || a.type === 'cogs')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name}
                </option>
              ))}
          </Select>

          <Input
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Office supplies invoice #456"
            required
          />

          <Input
            type="number"
            step="0.01"
            label="Amount (Gross)"
            value={formData.grossAmount}
            onChange={(e) => setFormData({ ...formData, grossAmount: e.target.value })}
            placeholder="0.00"
            required
          />

          <Select
            label="VAT Code"
            value={formData.vatCodeId}
            onChange={(e) => setFormData({ ...formData, vatCodeId: e.target.value })}
          >
            <option value="">No VAT</option>
            {vatCodes.map((v) => {
              const pct = Number((v as any).vat_rate ?? (v as any).rate ?? 0) * 100;
              return (
                <option key={v.id} value={v.id}>
                  {v.code} - {v.description} ({Number.isFinite(pct) ? pct.toFixed(2) : '0.00'}%)
                </option>
              );
            })}
          </Select>

          <Select
            label="Paid from Account"
            value={formData.paidFromAccountId}
            onChange={(e) => setFormData({ ...formData, paidFromAccountId: e.target.value })}
            required
          >
            <option value="">Select account...</option>
            {accounts
              .filter((a) => a.type === 'asset')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name}
                </option>
              ))}
          </Select>

          <Select
            label="Cost Center"
            value={formData.costCenterId}
            onChange={(e) => setFormData({ ...formData, costCenterId: e.target.value })}
          >
            <option value="">Select cost center...</option>
            {costCenters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} - {c.name}
              </option>
            ))}
          </Select>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">
              Expense created and posted successfully!
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Expense'}
            </Button>
            <Button type="button" variant="secondary" onClick={clearForm}>
              Clear
            </Button>
          </div>
        </form>
      </div>

      <Modal isOpen={showNewCounterparty} onClose={() => setShowNewCounterparty(false)} title="New Vendor">
        <div className="space-y-4">
          <Input
            label="Vendor Name"
            value={newCounterpartyName}
            onChange={(e) => setNewCounterpartyName(e.target.value)}
            placeholder="Company Name"
          />
          <div className="flex gap-3">
            <Button onClick={handleCreateCounterparty}>Create</Button>
            <Button variant="secondary" onClick={() => setShowNewCounterparty(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}