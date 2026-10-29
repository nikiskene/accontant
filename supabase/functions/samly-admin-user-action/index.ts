import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPERADMIN = 'c0a1df38-31e5-4feb-9c31-82ad11cc9af0';
const cors = { 'Access-Control-Allow-Origin': 'https://samly.cc', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const env = (name: string) => { const v = Deno.env.get(name); if (!v) throw new Error(`${name} is not configured`); return v; };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
async function stripe(path: string, method = 'GET', form?: URLSearchParams, id?: string) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(id ? { 'Idempotency-Key': id } : {}) }, body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Stripe request failed');
  return body;
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  let actionId: string | undefined;
  try {
    const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    const { data: { user }, error: authError } = await db.auth.getUser(jwt);
    if (authError || !user) return json({ error: 'Sign in required' }, 401);
    if (user.id !== SUPERADMIN) return json({ error: 'Superadmin access required' }, 403);
    const { action, user_id, confirmation_email, request_id } = await req.json();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!['grant_month', 'delete_user'].includes(action) || !uuid.test(user_id || '') || !uuid.test(request_id || '') || typeof confirmation_email !== 'string') return json({ error: 'Invalid action' }, 400);
    const { data: account, error: accountError } = await db.from('samly_accounts').select('id, stripe_subscription_id').eq('owner_user_id', user_id).maybeSingle();
    if (accountError) throw accountError;
    // Read Stripe before claiming an action. Retries use the original stored access date.
    const subscription = account?.stripe_subscription_id ? await stripe(`subscriptions/${encodeURIComponent(account.stripe_subscription_id)}`) : null;
    const paidEnd = subscription && ['active', 'trialing'].includes(subscription.status)
      ? Math.max(subscription.current_period_end || 0, subscription.trial_end || 0, ...(subscription.items?.data || []).map((item: { current_period_end?: number }) => item.current_period_end || 0)) : 0;
    const { data: operation, error: beginError } = await db.rpc('samly_begin_admin_action', { p_id: request_id, p_actor: user.id, p_user: user_id, p_email: confirmation_email, p_action: action, p_paid_until: paidEnd ? new Date(paidEnd * 1000).toISOString() : null });
    if (beginError) throw beginError;
    if (operation.status === 'done') return json({ ok: true, access_until: operation.access_until });
    actionId = request_id;
    if (action === 'grant_month') {
      if (subscription && !['canceled', 'incomplete_expired'].includes(subscription.status)) {
        if (subscription.schedule || subscription.cancel_at || subscription.cancel_at_period_end) throw new Error('This subscription has a scheduled change or cancellation. Resolve it in Stripe before granting a free month.');
        const form = new URLSearchParams({ trial_end: String(Math.floor(new Date(operation.access_until).getTime() / 1000)), proration_behavior: 'none' });
        await stripe(`subscriptions/${encodeURIComponent(subscription.id)}`, 'POST', form, `samly-month-${request_id}`);
      }
    } else {
      // Stop recurring billing before revoking access; never create a final charge or refund.
      if (subscription && !['canceled', 'incomplete_expired'].includes(subscription.status)) await stripe(`subscriptions/${encodeURIComponent(subscription.id)}`, 'DELETE', new URLSearchParams({ invoice_now: 'false', prorate: 'false' }));
      const { error: blockError } = await db.from('samly_removed_users').upsert({ user_id }, { onConflict: 'user_id', ignoreDuplicates: true });
      if (blockError) throw blockError;
      const { data: target, error: targetError } = await db.auth.admin.getUserById(user_id);
      if (targetError) throw targetError;
      if (!(target.user as unknown as { deleted_at?: string }).deleted_at) {
        const { error: deleteError } = await db.auth.admin.deleteUser(user_id, true);
        if (deleteError) throw deleteError;
      }
    }
    const { error: completeError } = await db.rpc('samly_complete_admin_action', { p_id: request_id });
    if (completeError) throw completeError;
    return json({ ok: true, access_until: operation.access_until });
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message || 'Admin action failed';
    if (actionId) await db.from('samly_admin_actions').update({ status: 'failed', error: message }).eq('id', actionId).neq('status', 'done');
    return json({ error: message }, 400);
  }
});
