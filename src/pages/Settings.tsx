import { useState, useEffect, FormEvent } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';

export function Settings() {
  const { workspaceId, workspace, workspaceSettings, accounts, costCenters, vatCodes, refetchReferenceData } = useApp();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const [workspaceForm, setWorkspaceForm] = useState({
    legal_name: workspace?.legal_name || '',
    trade_name: workspace?.trade_name || '',
    vat_trn: workspace?.vat_trn || '',
    ct_trn: workspace?.ct_trn || '',
  });

  const [settingsForm, setSettingsForm] = useState({
    default_bank_account_id: workspaceSettings?.default_bank_account_id || '',
    default_cost_center_id: workspaceSettings?.default_cost_center_id || '',
    default_vat_code_id: workspaceSettings?.default_vat_code_id || '',
    default_revenue_account_id: workspaceSettings?.default_revenue_account_id || '',
    default_expense_account_id: workspaceSettings?.default_expense_account_id || '',
  });

  useEffect(() => {
    if (workspace) {
      setWorkspaceForm({
        legal_name: workspace.legal_name || '',
        trade_name: workspace.trade_name || '',
        vat_trn: workspace.vat_trn || '',
        ct_trn: workspace.ct_trn || '',
      });
    }
  }, [workspace]);

  useEffect(() => {
    if (workspaceSettings) {
      setSettingsForm({
        default_bank_account_id: workspaceSettings.default_bank_account_id || '',
        default_cost_center_id: workspaceSettings.default_cost_center_id || '',
        default_vat_code_id: workspaceSettings.default_vat_code_id || '',
        default_revenue_account_id: workspaceSettings.default_revenue_account_id || '',
        default_expense_account_id: workspaceSettings.default_expense_account_id || '',
      });
    }
  }, [workspaceSettings]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    setError('');

    try {
      if (!workspaceId) throw new Error('No company selected');
      const workspaceResult = await supabase
        .from('workspaces')
        .update(workspaceForm)
        .eq('id', workspaceId)
        .select('id')
        .single();
      if (workspaceResult.error || !workspaceResult.data) throw workspaceResult.error || new Error('Company settings were not saved');

      const normalizedSettings = Object.fromEntries(
        Object.entries(settingsForm).map(([key,value]) => [key,value || null])
      );
      const settingsResult = await supabase
        .from('workspace_settings')
        .upsert({ ...normalizedSettings, workspace_id: workspaceId }, { onConflict: 'workspace_id' })
        .select('workspace_id,default_bank_account_id,default_cost_center_id,default_vat_code_id,default_revenue_account_id,default_expense_account_id')
        .single();
      if (settingsResult.error || !settingsResult.data) throw settingsResult.error || new Error('Default accounts were not saved');

      await refetchReferenceData();
      setSettingsForm({
        default_bank_account_id: settingsResult.data.default_bank_account_id || '',
        default_cost_center_id: settingsResult.data.default_cost_center_id || '',
        default_vat_code_id: settingsResult.data.default_vat_code_id || '',
        default_revenue_account_id: settingsResult.data.default_revenue_account_id || '',
        default_expense_account_id: settingsResult.data.default_expense_account_id || '',
      });
      setSuccess(true);
    } catch (caught) {
      console.error('Error saving settings:', caught);
      setError(caught instanceof Error ? caught.message : 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Manage workspace configuration</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Workspace Information</h2>
          <div className="space-y-4">
            <Input
              label="Legal Name"
              value={workspaceForm.legal_name}
              onChange={(e) => setWorkspaceForm({ ...workspaceForm, legal_name: e.target.value })}
              required
            />
            <Input
              label="Trade Name"
              value={workspaceForm.trade_name}
              onChange={(e) => setWorkspaceForm({ ...workspaceForm, trade_name: e.target.value })}
            />
            <Input
              label="VAT TRN"
              value={workspaceForm.vat_trn}
              onChange={(e) => setWorkspaceForm({ ...workspaceForm, vat_trn: e.target.value })}
            />
            <Input
              label="Corporate Tax TRN"
              value={workspaceForm.ct_trn}
              onChange={(e) => setWorkspaceForm({ ...workspaceForm, ct_trn: e.target.value })}
            />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Default Accounts</h2>
          <div className="space-y-4">
            <Select
              label="Default bank ledger account"
              value={settingsForm.default_bank_account_id}
              onChange={(e) => setSettingsForm({ ...settingsForm, default_bank_account_id: e.target.value })}
            >
              <option value="">Select account...</option>
              {accounts.filter(a => a.type === 'asset').map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name}
                </option>
              ))}
            </Select>
            <p className="-mt-2 text-xs text-gray-500">This is the chart-of-accounts posting destination (for Austria, normally 2800 Bank). IBAN and account-holder details are managed separately under Company Bank Details.</p>

            <Select
              label="Default Cost Center"
              value={settingsForm.default_cost_center_id}
              onChange={(e) => setSettingsForm({ ...settingsForm, default_cost_center_id: e.target.value })}
            >
              <option value="">Select cost center...</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} - {c.name}
                </option>
              ))}
            </Select>

            <Select
              label="Default VAT Code"
              value={settingsForm.default_vat_code_id}
              onChange={(e) => setSettingsForm({ ...settingsForm, default_vat_code_id: e.target.value })}
            >
              <option value="">Select VAT code...</option>
              {vatCodes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} - {v.name}
                </option>
              ))}
            </Select>

            <Select
              label="Default Revenue Account"
              value={settingsForm.default_revenue_account_id}
              onChange={(e) => setSettingsForm({ ...settingsForm, default_revenue_account_id: e.target.value })}
            >
              <option value="">Select account...</option>
              {accounts.filter(a => a.type === 'income').map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name}
                </option>
              ))}
            </Select>

            <Select
              label="Default Expense Account"
              value={settingsForm.default_expense_account_id}
              onChange={(e) => setSettingsForm({ ...settingsForm, default_expense_account_id: e.target.value })}
            >
              <option value="">Select account...</option>
              {accounts.filter(a => a.type === 'expense' || a.type === 'cogs').map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} - {a.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">
            Settings saved successfully!
          </div>
        )}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        <div className="flex gap-3">
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </form>
    </div>
  );
}
