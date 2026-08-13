import { FormEvent, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';

export function AustrianTaxSetup() {
  const { workspace, workspaceId, taxYears, refetchReferenceData } = useApp();
  const [form, setForm] = useState({ year: '2026', revenue: '0', regime: 'normal', method: 'accrual', override: '' });
  const [message, setMessage] = useState('');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId) return;
    setMessage('Saving…');
    const isAustria=workspace?.country==='AT';
    const request=isAustria?await supabase.rpc('create_austrian_tax_year', {
      p_workspace_id: workspaceId,p_year:Number(form.year),p_prior_year_revenue:Number(form.revenue),p_vat_regime:form.regime,p_accounting_method:form.method,p_override_frequency:form.override||null,p_override_reason:form.override?'Manual override; requires accountant confirmation':null,
    }):await supabase.from('tax_years').insert({workspace_id:workspaceId,label:form.year,start_date:`${form.year}-01-01`,end_date:`${form.year}-12-31`,status:'open',is_default:taxYears.length===0}).select('id').single();
    const {data,error}=request;
    const result = Array.isArray(data) ? data[0] : data;
    if(!error)await refetchReferenceData();
    setMessage(error ? error.message : isAustria?`Tax year created. VAT filing workflow: ${result?.filing_frequency}.`:'Tax year created.');
  };

  return <div className="max-w-3xl">
    <h1 className="text-3xl font-bold">Tax years</h1>
    <p className="text-gray-600 mt-1 mb-6">Create fiscal years for {workspace?.legal_name}. {workspace?.country==='AT'&&'The Austrian VAT filing cycle is derived from prior-year revenue.'}</p>
    <div className="flex flex-wrap gap-2 mb-4">{taxYears.map(year=><span key={year.id} className="rounded-full border bg-white px-3 py-1 text-sm">{year.label} · {year.status}</span>)}</div>
    <form onSubmit={save} className="bg-white border rounded-xl p-6 space-y-4">
      <Input required type="number" min="2000" max="2100" label="Tax year" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} />
      {workspace?.country==='AT'&&<><Input required type="number" min="0" step="0.01" label="Prior-year taxable revenue (EUR)" value={form.revenue} onChange={e => setForm({ ...form, revenue: e.target.value })} />
      <Select label="VAT regime" value={form.regime} onChange={e => setForm({ ...form, regime: e.target.value })}><option value="normal">Normal taxpayer</option><option value="small_business">Kleinunternehmer</option></Select>
      <Select label="VAT accounting" value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}><option value="accrual">Accrual</option><option value="cash">Cash</option></Select>
      <Select label="Accountant-confirmed override (optional)" value={form.override} onChange={e => setForm({ ...form, override: e.target.value })}><option value="">Use calculated frequency</option><option value="annual_only">Annual only</option><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option></Select>
      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Annual U1 remains required. A calculated “annual only” workflow can still have exception-based UVA obligations, so filing is not marked compliance-approved until reviewed.</div></>}
      <Button type="submit">Create tax year</Button>
      {message && <p className="bg-blue-50 p-3 rounded">{message}</p>}
    </form>
  </div>;
}
