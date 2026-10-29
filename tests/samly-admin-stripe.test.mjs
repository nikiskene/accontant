import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../supabase/functions/samly-admin-user-action/index.ts', import.meta.url), 'utf8').replace(/^import .*\n/, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const founder = 'c0a1df38-31e5-4feb-9c31-82ad11cc9af0';
const user = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
async function run({ action = 'grant_month', status = 'active', schedule = null, stripeFailure = false, done = false } = {}) {
  const calls = []; let handler;
  const operation = { status: done ? 'done' : 'pending', access_until: '2027-01-31T12:00:00Z' };
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: founder } } }), admin: { getUserById: async () => ({ data: { user: {} } }), deleteUser: async (...args) => { calls.push(['delete', ...args]); return {}; } } },
    from(table) { const chain = { select() { return chain; }, eq() { return chain; }, neq() { return Promise.resolve({}); }, maybeSingle: async () => ({ data: { id: 'account', stripe_subscription_id: 'sub_test' } }), upsert: async () => { calls.push(['block']); return {}; }, update() { calls.push(['failed']); return chain; } }; return chain; },
    rpc: async (name, args) => { calls.push([name, args]); return { data: name === 'samly_begin_admin_action' ? operation : null }; },
  };
  vm.runInNewContext(compiled, { createClient: () => db, Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } }, Response, URLSearchParams, Date, Math, Error, fetch: async (url, options) => {
    calls.push(['stripe', options.method, options.body?.toString(), options.headers]);
    return new Response(JSON.stringify(options.method === 'GET' ? { id: 'sub_test', status, schedule, current_period_end: 1798761600 } : stripeFailure ? { error: { message: 'Fixture Stripe error' } } : { id: 'sub_test' }), { status: options.method !== 'GET' && stripeFailure ? 400 : 200 });
  } });
  const response = await handler(new Request('https://example.com', { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, user_id: user, request_id: id, confirmation_email: 'fixture@example.com' }) }));
  return { response, calls, body: await response.json() };
}
test('paid gift delays renewal without proration and uses stable idempotency key', async () => {
  const { response, calls } = await run(); assert.equal(response.status, 200);
  const update = calls.find(c => c[0] === 'stripe' && c[1] === 'POST');
  const form = new URLSearchParams(update[2]); assert.equal(form.get('proration_behavior'), 'none');
  assert.equal(Number(form.get('trial_end')), Date.parse('2027-01-31T12:00:00Z') / 1000);
  assert.equal(update[3]['Idempotency-Key'], `samly-month-${id}`);
  assert.ok(calls.some(c => c[0] === 'samly_complete_admin_action'));
});
test('scheduled subscriptions fail before changing billing', async () => {
  const { response, calls } = await run({ schedule: 'schedule_test' }); assert.equal(response.status, 400);
  assert.equal(calls.filter(c => c[0] === 'stripe').length, 1);
  assert.ok(!calls.some(c => c[0] === 'samly_complete_admin_action'));
});
test('canceled subscription receives local gift without restarting billing', async () => {
  const { response, calls } = await run({ status: 'canceled' }); assert.equal(response.status, 200);
  assert.equal(calls.filter(c => c[0] === 'stripe').length, 1);
});
test('completed retry does not modify Stripe twice', async () => {
  const { response, calls } = await run({ done: true }); assert.equal(response.status, 200);
  assert.equal(calls.filter(c => c[0] === 'stripe').length, 1);
});
test('deletion cancels billing before removing access, without final invoice or proration', async () => {
  const { response, calls } = await run({ action: 'delete_user' }); assert.equal(response.status, 200);
  const cancel = calls.findIndex(c => c[0] === 'stripe' && c[1] === 'DELETE');
  assert.equal(calls[cancel][2], 'invoice_now=false&prorate=false');
  assert.ok(cancel < calls.findIndex(c => c[0] === 'block'));
  assert.deepEqual(calls.find(c => c[0] === 'delete'), ['delete', user, true]);
});
test('Stripe failure prevents access deletion and records retryable failure', async () => {
  const { response, calls } = await run({ action: 'delete_user', stripeFailure: true }); assert.equal(response.status, 400);
  assert.ok(!calls.some(c => c[0] === 'block' || c[0] === 'delete' || c[0] === 'samly_complete_admin_action'));
  assert.ok(calls.some(c => c[0] === 'failed'));
});
