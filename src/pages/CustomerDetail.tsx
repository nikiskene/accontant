import { useEffect, useState, FormEvent } from 'react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { ArrowLeft } from 'lucide-react';

interface CustomerDetailProps {
  customerId: string;
}

function normalizeEmail(email: string): { email: string | null; email_lc: string | null } {
  const e = (email || '').trim();
  if (!e) return { email: null, email_lc: null };
  return { email: e, email_lc: e.toLowerCase() };
}

function parseNumberSafe(v: string): number {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function CustomerDetail({ customerId }: CustomerDetailProps) {
  const { workspaceId } = useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const isNew = customerId === 'new';

  const [formData, setFormData] = useState({
    alias: '',
    company_name: '',
    street_address: '',
    city: '',
    state: '',
    country: '',
    zip: '',
    phone: '',
    email: '',
    vat_trn: '',
    default_payment_terms: '',
    open_balance: '0',
  });

  useEffect(() => {
    if (!isNew && workspaceId) {
      loadCustomer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, workspaceId]);

  const loadCustomer = async () => {
    try {
      setLoading(true);
      setError('');

      const { data, error } = await supabase
        .from('counterparties')
        .select('*')
        .eq('id', customerId)
        .eq('workspace_id', workspaceId)
        .eq('kind', 'customer')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setError('Customer not found');
        return;
      }

      setFormData({
        alias: data.alias || '',
        company_name: data.company_name || '',
        street_address: data.street_address || '',
        city: data.city || '',
        state: data.state || '',
        country: data.country || '',
        zip: data.zip || '',
        phone: data.phone || '',
        email: data.email || '',
        vat_trn: data.vat_trn || '',
        default_payment_terms: data.default_payment_terms || '',
        open_balance: data.open_balance?.toString() || '0',
      });
    } catch (err: any) {
      console.error('Error loading customer:', err);
      setError(err.message || 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  };

  const validateEmail = (email: string): boolean => {
    if (!email) return true;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    // Company (legal) is required (matches your check constraint)
    if (!formData.company_name.trim()) {
      setError('Company (legal) is required');
      return;
    }

    if (formData.email && !validateEmail(formData.email)) {
      setError('Please enter a valid email address');
      return;
    }

    const openBalance = parseNumberSafe(formData.open_balance);
    const { email } = normalizeEmail(formData.email);

    try {
      setSaving(true);

      // IMPORTANT:
      // - Do NOT write `name` (you removed it from DB).
      // - Do NOT write `email_lc` if your DB forbids non-default inserts/updates.
      //   If you have a generated column/trigger for email_lc, only send `email`.
      const customerData: any = {
        workspace_id: workspaceId,
        kind: 'customer' as const,
        alias: formData.alias.trim() || null,
        company_name: formData.company_name.trim(),
        street_address: formData.street_address.trim() || null,
        city: formData.city.trim() || null,
        state: formData.state.trim() || null,
        country: formData.country.trim() || null,
        zip: formData.zip.trim() || null,
        phone: formData.phone.trim() || null,
        email,
        vat_trn: formData.vat_trn.trim() || null,
        default_payment_terms: formData.default_payment_terms.trim() || null,
        open_balance: openBalance,
      };

      // If your schema allows setting email_lc, uncomment this block.
      // Otherwise leave it out to avoid: "cannot insert a non-DEFAULT value into column 'email_lc'"
      //
      // customerData.email_lc = email_lc;

      let savedId = customerId;
      if (isNew) {
        const { data: inserted, error: insertError } = await supabase.from('counterparties').insert(customerData).select('id').single();
        if (insertError) throw insertError;
        savedId = inserted.id;
      } else {
        const { error: updateError } = await supabase
          .from('counterparties')
          .update(customerData)
          .eq('id', customerId)
          .eq('workspace_id', workspaceId);

        if (updateError) throw updateError;
      }

      setSuccess(true);
      setTimeout(() => {
        const returnTo=sessionStorage.getItem('sales-customer-return');
        if(returnTo){sessionStorage.removeItem('sales-customer-return');sessionStorage.setItem('sales-new-customer-id',savedId);window.history.pushState({},'',returnTo)}
        else window.history.pushState({}, '', '/customers');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, 800);
    } catch (err: any) {
      console.error('Error saving customer:', err);
      setError(err.message || 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    window.history.pushState({}, '', '/customers');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  if (loading) {
    return <div className="text-center py-12">Loading customer...</div>;
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Button variant="ghost" onClick={handleBack} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Customers
        </Button>
        <h1 className="text-3xl font-bold text-gray-900">
          {isNew ? 'New Customer' : 'Edit Customer'}
        </h1>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Alias"
              value={formData.alias}
              onChange={(e) => setFormData({ ...formData, alias: e.target.value })}
              placeholder="SwipeSwipe"
            />

            <Input
              label="Company (Legal) *"
              value={formData.company_name}
              onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
              placeholder="SwipeSwipe.co Ltd"
              required
            />
          </div>

          <Input
            label="Street Address"
            value={formData.street_address}
            onChange={(e) => setFormData({ ...formData, street_address: e.target.value })}
            placeholder="123 Main Street"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="City"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              placeholder="Dubai"
            />

            <Input
              label="State"
              value={formData.state}
              onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              placeholder="Dubai"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Country"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              placeholder="UAE"
            />

            <Input
              label="Zip"
              value={formData.zip}
              onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
              placeholder="12345"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+971 50 123 4567"
            />

            <Input
              label="Email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="john@example.com"
            />
          </div>

          <Input
            label="Customer UID / VAT ID"
            value={formData.vat_trn}
            onChange={(e) => setFormData({ ...formData, vat_trn: e.target.value })}
            placeholder="For example: ATU12345678"
          />

          <Input
            label="Open Balance"
            type="number"
            step="0.01"
            value={formData.open_balance}
            onChange={(e) => setFormData({ ...formData, open_balance: e.target.value })}
            placeholder="0.00"
          />

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Default payment terms</label>
            <textarea
              rows={3}
              value={formData.default_payment_terms}
              onChange={(e) => setFormData({ ...formData, default_payment_terms: e.target.value })}
              placeholder="For example: 50% on acceptance, 50% within 14 days of invoice"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">Used as the starting text for this customer. It remains editable on every quote or invoice.</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">
              Customer saved successfully! Redirecting...
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Customer'}
            </Button>
            <Button type="button" variant="secondary" onClick={handleBack} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
