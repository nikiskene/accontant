import { useState, FormEvent } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Modal } from '../components/Modal';

interface VatPreset {
  label: string;
  vatCode: string;
  revenueAccount: string;
}

const vatPresets: VatPreset[] = [
  { label: 'Domestic 5%', vatCode: 'SR5', revenueAccount: '4000' },
  { label: 'Foreign Out of Scope', vatCode: 'OOS', revenueAccount: '4010' },
  { label: 'Zero-rated', vatCode: 'ZR0', revenueAccount: '4010' },
  { label: 'Exempt', vatCode: 'EX', revenueAccount: '4010' },
];

export function NewSale() {
  const { workspaceId, accounts, vatCodes, costCenters, counterparties, workspaceSettings, refetchReferenceData } = useApp();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const [showNewCounterparty, setShowNewCounterparty] = useState(false);
  const [newCounterpartyName, setNewCounterpartyName] = useState('');

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    counterpartyId: '',
    description: '',
    grossAmount: '',
    vatPreset: 'domestic',
    depositToAccountId: workspaceSettings?.default_bank_account_id || '',
    costCenterId: workspaceSettings?.default_cost_center_id || '',
  });

  const getVatCodeAndRevenueAccount = () => {
    const preset = vatPresets.find((p) =>
      p.label.toLowerCase().includes(formData.vatPreset)
    ) || vatPresets[0];

    const vatCode = vatCodes.find((v) => v.code === preset.vatCode);
    const revenueAccount = accounts.find((a) => a.code === preset.revenueAccount);

    return { vatCode, revenueAccount };
  };

  const handleCreateCounterparty = async () => {
    if (!newCounterpartyName.trim()) return;

    try {
      const { data, error } = await supabase
        .from('counterparties')
        .insert({
          workspace_id: workspaceId,
          name: newCounterpartyName,
          kind: 'customer',
        })
        .select()
        .single();

      if (error) throw error;

      await refetchReferenceData();
      setFormData({ ...formData, counterpartyId: data.id });
      setShowNewCounterparty(false);
      setNewCounterpartyName('');
    } catch (err: any) {
      console.error('Error creating counterparty:', err);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    try {
      const { vatCode, revenueAccount } = getVatCodeAndRevenueAccount();

      if (!vatCode || !revenueAccount) {
        throw new Error('VAT code or revenue account not found');
      }

      const grossAmount = parseFloat(formData.grossAmount);
      const vatRate = vatCode.vat_rate;

      let netAmount: number;
      let vatAmount: number;

      if (vatRate > 0) {
        netAmount = Math.round((grossAmount / (1 + vatRate)) * 100) / 100;
        vatAmount = grossAmount - netAmount;
      } else {
        netAmount = grossAmount;
        vatAmount = 0;
      }

      const { data: transaction, error: txnError } = await supabase
        .from('transactions')
        .insert({
          workspace_id: workspaceId,
          txn_date: formData.date,
          txn_type: 'sale',
          description: formData.description,
          status: 'draft',
        })
        .select()
        .single();

      if (txnError) throw txnError;

      const lines = [
        {
          workspace_id: workspaceId,
          transaction_id: transaction.id,
          account_id: formData.depositToAccountId,
          amount: grossAmount,
          cost_center_id: formData.costCenterId || null,
          counterparty_id: formData.counterpartyId || null,
          memo: formData.description,
        },
        {
          workspace_id: workspaceId,
          transaction_id: transaction.id,
          account_id: revenueAccount.id,
          amount: -netAmount,
          vat_code_id: vatCode.id,
          cost_center_id: formData.costCenterId || null,
          counterparty_id: formData.counterpartyId || null,
          memo: formData.description,
        },
      ];

      if (vatAmount > 0) {
        const vatOutputAccount = accounts.find((a) => a.code === '2200');
        if (vatOutputAccount) {
          lines.push({
            workspace_id: workspaceId,
            transaction_id: transaction.id,
            account_id: vatOutputAccount.id,
            amount: -vatAmount,
            vat_code_id: vatCode.id,
            cost_center_id: formData.costCenterId || null,
            counterparty_id: null,
            memo: 'VAT Output',
          });
        }
      }

      const { error: linesError } = await supabase.from('transaction_lines').insert(lines);
      if (linesError) throw linesError;

      const { data: postResult, error: postError } = await supabase.rpc('post_transaction', {
        p_transaction_id: transaction.id,
        p_user_id: (await supabase.auth.getUser()).data.user?.id,
      });

      if (postError) throw postError;
      if (!postResult?.success) throw new Error(postResult?.error || 'Failed to post transaction');

      setSuccess(true);
      setFormData({
        date: new Date().toISOString().split('T')[0],
        counterpartyId: '',
        description: '',
        grossAmount: '',
        vatPreset: 'domestic',
        depositToAccountId: workspaceSettings?.default_bank_account_id || '',
        costCenterId: workspaceSettings?.default_cost_center_id || '',
      });
    } catch (err: any) {
      setError(err.message || 'Failed to create sale');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">New Sale</h1>
        <p className="text-gray-600 mt-1">Record a revenue transaction</p>
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
            <div className="flex gap-2">
              <Select
                value={formData.counterpartyId}
                onChange={(e) => setFormData({ ...formData, counterpartyId: e.target.value })}
                className="flex-1"
              >
                <option value="">Select customer...</option>
                {counterparties
                  .filter((c) => c.kind === 'customer' || c.kind === 'both' || !c.kind)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
              <Button type="button" variant="secondary" onClick={() => setShowNewCounterparty(true)}>
                New
              </Button>
            </div>
          </div>

          <Input
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Invoice #123 - Consulting services"
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
            label="VAT Treatment"
            value={formData.vatPreset}
            onChange={(e) => setFormData({ ...formData, vatPreset: e.target.value })}
          >
            <option value="domestic">Domestic 5%</option>
            <option value="foreign">Foreign Out of Scope</option>
            <option value="zero">Zero-rated</option>
            <option value="exempt">Exempt</option>
          </Select>

          <Select
            label="Deposit to Account"
            value={formData.depositToAccountId}
            onChange={(e) => setFormData({ ...formData, depositToAccountId: e.target.value })}
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
              Sale created and posted successfully!
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Sale'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setFormData({
                  date: new Date().toISOString().split('T')[0],
                  counterpartyId: '',
                  description: '',
                  grossAmount: '',
                  vatPreset: 'domestic',
                  depositToAccountId: workspaceSettings?.default_bank_account_id || '',
                  costCenterId: workspaceSettings?.default_cost_center_id || '',
                })
              }
            >
              Clear
            </Button>
          </div>
        </form>
      </div>

      <Modal
        isOpen={showNewCounterparty}
        onClose={() => setShowNewCounterparty(false)}
        title="New Customer"
      >
        <div className="space-y-4">
          <Input
            label="Customer Name"
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
