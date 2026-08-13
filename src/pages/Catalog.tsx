import { FormEvent, useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { ProductService } from '../lib/types';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Modal } from '../components/Modal';

export function Catalog() {
  const { workspaceId, workspace, accounts, vatCodes } = useApp();
  const [items, setItems] = useState<ProductService[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ item_type: 'service', name: '', sku: '', unit: 'each', unit_price: '0', currency: workspace?.base_currency||'EUR', revenue_account_id: '', vat_code_id: '' });

  const load = async () => {
    if (!workspaceId) return;
    const { data, error: loadError } = await supabase.from('products_services').select('*')
      .eq('workspace_id', workspaceId).order('name');
    if (loadError) setError(loadError.message); else setItems((data || []) as ProductService[]);
  };
  useEffect(() => { void load(); }, [workspaceId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !workspace) return;
    const payload = {
      workspace_id: workspaceId, item_type: form.item_type, name: form.name,
      sku: form.sku || null, unit: form.unit, unit_price: Number(form.unit_price),
      currency: form.currency, revenue_account_id: form.revenue_account_id || null,
      vat_code_id: form.vat_code_id || null,
    };
    const request = editingId
      ? supabase.from('products_services').update(payload).eq('id', editingId).eq('workspace_id', workspaceId)
      : supabase.from('products_services').insert(payload);
    const { error: saveError } = await request;
    if (saveError) return setError(saveError.message);
    setOpen(false); setEditingId(null); setForm({ item_type: 'service', name: '', sku: '', unit: 'each', unit_price: '0', currency:workspace.base_currency, revenue_account_id: '', vat_code_id: '' });
    void load();
  };

  const edit = (item: ProductService) => {
    setEditingId(item.id);
    setForm({ item_type:item.item_type, name:item.name, sku:item.sku||'', unit:item.unit, unit_price:String(item.unit_price), currency:item.currency, revenue_account_id:item.revenue_account_id||'', vat_code_id:item.vat_code_id||'' });
    setError(''); setOpen(true);
  };
  const close = () => { setOpen(false); setEditingId(null); setForm({ item_type:'service',name:'',sku:'',unit:'each',unit_price:'0',currency:workspace?.base_currency||'EUR',revenue_account_id:'',vat_code_id:'' }); };

  return <div>
    <div className="flex justify-between items-start mb-6"><div><h1 className="text-3xl font-bold">Products & services</h1><p className="text-gray-600 mt-1">Reusable sales items for this company.</p></div>
      <Button onClick={() => { setEditingId(null); setOpen(true); }}><Plus className="w-4 h-4 mr-2" />Add item</Button></div>
    {error && <div className="bg-amber-50 text-amber-900 p-3 rounded-lg mb-4">{error}</div>}
    <div className="bg-white rounded-xl border overflow-hidden"><table className="w-full"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="p-4">Item</th><th>Type</th><th>Unit</th><th>Price</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {items.map(item => <tr key={item.id} className="border-t"><td className="p-4"><p className="font-medium">{item.name}</p><p className="text-xs text-gray-500">{item.sku || 'No SKU'}</p></td><td className="capitalize">{item.item_type}</td><td>{item.unit}</td><td>{item.currency} {Number(item.unit_price).toFixed(2)}</td><td>{item.is_active ? 'Active' : 'Inactive'}</td><td className="pr-4 text-right"><Button type="button" size="sm" variant="secondary" onClick={()=>edit(item)}><Pencil className="w-4 h-4 mr-1"/>Edit</Button></td></tr>)}
      {!items.length && <tr><td colSpan={6} className="p-10 text-center text-gray-500">No products or services yet.</td></tr>}
    </tbody></table></div>
    <Modal isOpen={open} onClose={close} title={editingId?'Edit product or service':'Add product or service'}><form onSubmit={save} className="space-y-4">
      <Select label="Type" value={form.item_type} onChange={e => setForm({...form, item_type:e.target.value})}><option value="service">Service</option><option value="product">Product</option></Select>
      <Input required label="Name" value={form.name} onChange={e => setForm({...form, name:e.target.value})}/><div className="grid grid-cols-2 gap-3"><Input label="SKU" value={form.sku} onChange={e => setForm({...form, sku:e.target.value})}/><Input label="Unit" value={form.unit} onChange={e => setForm({...form, unit:e.target.value})}/></div>
      <div className="grid grid-cols-2 gap-3"><Input required type="number" step="0.01" label="Unit price" value={form.unit_price} onChange={e => setForm({...form, unit_price:e.target.value})}/><Select label="Currency" value={form.currency} onChange={e=>setForm({...form,currency:e.target.value})}>{['EUR','USD','AED','GBP','CHF'].map(currency=><option key={currency}>{currency}</option>)}</Select></div>
      <Select label="Revenue account" value={form.revenue_account_id} onChange={e => setForm({...form, revenue_account_id:e.target.value})}><option value="">Select later</option>{accounts.filter(a=>a.type==='income').map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select>
      <Select label="VAT code" value={form.vat_code_id} onChange={e => setForm({...form, vat_code_id:e.target.value})}><option value="">Select later</option>{vatCodes.filter(v=>v.applies_to!=='purchases').map(v=><option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}</Select>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit">{editingId?'Update item':'Save item'}</Button></div>
    </form></Modal>
  </div>;
}
