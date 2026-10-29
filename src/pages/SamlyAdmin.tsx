import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Row = { user_id: string; email: string | null; created_at: string; last_sign_in_at: string | null; deleted_at: string | null; removed: boolean; is_admin: boolean; account_id: string | null; display_name: string | null; plan_code: string | null; subscription_status: string | null; subscription_current_period_end: string | null; complimentary_until: string | null; companies: { name: string; country: string }[] };
type Action = 'grant_month' | 'delete_user';
type Audit = { id: string; user_id: string; user_email: string; action: Action; status: string; error: string | null; created_at: string; access_until: string | null };
const date = (value: string | null) => value ? new Date(value).toLocaleDateString() : '—';
const button = 'rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed';
export function SamlyAdmin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState<{ row: Row; action: Action; id: string } | null>(null);
  async function load() {
    const [users, history] = await Promise.all([supabase.rpc('samly_admin_users_list'), supabase.from('samly_admin_actions').select('id,user_id,user_email,action,status,error,created_at,access_until').order('created_at', { ascending: false }).limit(30)]);
    if (users.error || history.error) setError(users.error?.message || history.error?.message || 'Could not load users');
    else { setRows(users.data || []); setAudit(history.data || []); }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  function select(row: Row, action: Action, id: string = crypto.randomUUID()) { setPending({ row, action, id }); setConfirmation(''); setError(''); setMessage(''); }
  async function submit() {
    if (!pending || busy) return;
    setBusy(true); setError('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('samly-admin-user-action', { body: { action: pending.action, user_id: pending.row.user_id, confirmation_email: confirmation, request_id: pending.id } });
      let detail = data?.error;
      if (invokeError && 'context' in invokeError) { try { detail = (await invokeError.context.json()).error; } catch { /* Keep the original error. */ } }
      if (invokeError || detail) throw new Error(detail || invokeError?.message);
      setMessage(pending.action === 'delete_user' ? 'User deleted. Sign-in and data access removed; company accounting records retained.' : `One free month granted. Access through ${date(data.access_until)}.`);
      setPending(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); await load(); }
    finally { setBusy(false); }
  }
  const visible = rows.filter(r => (showRemoved || (!r.deleted_at && !r.removed)) && `${r.email || ''} ${r.user_id} ${r.display_name || ''} ${r.companies.map(c => `${c.name} ${c.country}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="max-w-7xl space-y-6">
    <div><h1 className="text-3xl font-bold">Samly admin</h1><p className="mt-2 text-gray-600">Users, access and feedback. Location is the company country supplied during setup.</p></div>
    <nav className="flex flex-wrap gap-3"><a className={button} href="/samly/feedback">Feature requests</a><a className={button} href="/samly-bug-reports">Bug reports</a></nav>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-green-50 p-4 text-green-800">{message}</p>}
    <div className="flex flex-wrap items-center gap-4"><input aria-label="Search users" className="min-w-64 flex-1 rounded-lg border p-3" placeholder="Search email, company, country or user ID" value={query} onChange={e => setQuery(e.target.value)} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showRemoved} onChange={e => setShowRemoved(e.target.checked)} />Show deleted users</label><span className="text-sm text-gray-600">{visible.length} users</span></div>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-gray-50"><tr>{['User', 'Company / country', 'Access', 'Joined / last sign-in', 'Actions'].map(h => <th key={h} className="p-4">{h}</th>)}</tr></thead><tbody>
      {visible.map(r => <tr key={r.user_id} className="border-t align-top"><td className="p-4"><p className="font-semibold">{r.email || 'Deleted user'}</p><p className="mt-1 break-all text-xs text-gray-500">{r.user_id}</p>{r.is_admin && <p className="mt-2 text-blue-700">Protected administrator</p>}</td><td className="p-4">{r.companies.length ? r.companies.map((c, i) => <p key={i}>{c.name} · {c.country || 'Not supplied'}</p>) : 'Company setup not completed'}</td><td className="p-4"><p className="capitalize">{r.deleted_at ? 'Deleted' : r.removed ? 'Access removed' : `${(r.plan_code || 'No plan').replace(/_/g, ' ')} · ${r.subscription_status || 'Not set up'}`}</p>{r.complimentary_until && <p className="mt-1">{new Date(r.complimentary_until).getTime() > Date.now() ? 'Free access until' : 'Free access ended'} {date(r.complimentary_until)}</p>}{r.subscription_current_period_end && <p className="mt-1 text-gray-500">Period ends {date(r.subscription_current_period_end)}</p>}</td><td className="p-4">{date(r.created_at)}<p className="mt-1 text-gray-500">Last seen {date(r.last_sign_in_at)}</p></td><td className="p-4"><div className="flex flex-wrap gap-2"><button className={button} disabled={r.is_admin || !!r.deleted_at || r.removed || !r.account_id || r.plan_code === 'lifetime' || busy} onClick={() => select(r, 'grant_month')}>Grant free month</button><button className={`${button} text-red-700`} disabled={r.is_admin || !!r.deleted_at || r.removed || busy} onClick={() => select(r, 'delete_user')}>Delete user</button></div></td></tr>)}
      {!visible.length && <tr><td colSpan={5} className="p-8 text-center text-gray-500">{loading ? 'Loading users…' : error ? 'User list unavailable.' : 'No matching users.'}</td></tr>}
    </tbody></table></div>
    {pending && <section role="dialog" aria-modal="true" aria-labelledby="admin-action-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"><h2 id="admin-action-title" className="text-xl font-bold">{pending.action === 'delete_user' ? 'Delete user' : 'Grant one free month'}</h2><p className="font-semibold break-all">{pending.row.email}</p><p className="text-sm text-gray-600">{pending.action === 'delete_user' ? 'This permanently removes sign-in and data access and cancels recurring billing without a refund or final charge. Company accounting records and their history are retained. This cannot be undone.' : 'Adds one calendar month after existing paid or free access, or starts today if access has expired. For a running Stripe subscription, renewal moves to the new date. Existing unpaid invoices are unchanged. No automatic charge is created for a user without a subscription.'}</p><label className="block text-sm">Type the user’s email to confirm<input autoFocus type="email" className="mt-2 w-full rounded-lg border p-3" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-3"><button className={button} disabled={busy} onClick={() => setPending(null)}>Cancel</button><button className={`${button} bg-slate-900 text-white`} disabled={busy || !confirmation || confirmation.trim().toLowerCase() !== pending.row.email?.toLowerCase()} onClick={() => void submit()}>{busy ? 'Working…' : pending.action === 'delete_user' ? 'Delete user' : 'Grant free month'}</button></div></div></section>}
    <section><h2 className="text-xl font-bold">Recent admin activity</h2><div className="mt-3 space-y-2">{audit.map(a => <div key={a.id} className="rounded-lg border bg-white p-3 text-sm"><p>{a.action === 'grant_month' ? 'Free month' : 'Delete user'} · {a.user_email} · <strong>{a.status}</strong> · {new Date(a.created_at).toLocaleString()}{a.access_until ? ` · until ${date(a.access_until)}` : ''}</p>{a.error && <p className="mt-1 text-red-700">{a.error}</p>}{a.status !== 'done' && rows.some(r => r.user_id === a.user_id) && <button className={`${button} mt-2`} disabled={busy} onClick={() => select({ ...rows.find(r => r.user_id === a.user_id)!, email: a.user_email }, a.action, a.id)}>Retry action</button>}</div>)}{!audit.length && <p className="text-sm text-gray-500">No admin actions yet.</p>}</div></section>
  </div>;
}
