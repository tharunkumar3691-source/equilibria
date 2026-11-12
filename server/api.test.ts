// End-to-end test of server/api.ts with PayPal and Gemini replaced by fakes (no network, no real keys).
// Run: npm test
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const { createApi } = await import('./api.ts');

// --- Fake PayPal + Gemini ---
const realFetch = globalThis.fetch;
const orders = new Map<string, { amount: string; customId: string; captured: boolean }>();
let nextOrder = 1;
let captureAmountOverride: string | null = null;
let webhookVerdict = 'SUCCESS';
const calls: string[] = [];
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://api-m.sandbox.paypal.com')) {
    const path = url.slice('https://api-m.sandbox.paypal.com'.length);
    calls.push(`${init.method} ${path}`);
    if (path === '/v1/oauth2/token') return reply(200, { access_token: 'tok', expires_in: 3600 });
    if (path === '/v2/checkout/orders' && init.method === 'POST') {
      const body = JSON.parse(init.body);
      const id = `ORDER${nextOrder++}TEST`;
      orders.set(id, { amount: body.purchase_units[0].amount.value, customId: body.purchase_units[0].custom_id, captured: false });
      return reply(201, { id, status: 'CREATED' });
    }
    const cap = /^\/v2\/checkout\/orders\/(\w+)\/capture$/.exec(path);
    if (cap) {
      const o = orders.get(cap[1])!;
      assert.equal(init.headers['paypal-request-id'], `capture-${cap[1]}`);
      o.captured = true;
      return reply(201, { id: cap[1], status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: `CAP-${cap[1]}`, status: 'COMPLETED', amount: { value: captureAmountOverride ?? o.amount, currency_code: 'USD' }, custom_id: o.customId }] } }] });
    }
    if (path === '/v1/notifications/verify-webhook-signature') return reply(200, { verification_status: webhookVerdict });
    return reply(404, { message: 'unknown fake path ' + path });
  }
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    calls.push('GEMINI');
    return reply(200, { candidates: [] });
  }
  return realFetch(input, init);
}) as typeof fetch;

const dataDir = mkdtempSync(join(tmpdir(), 'eq-test-'));
const api = createApi({
  DATA_DIR: dataDir, PAYPAL_CLIENT_ID: 'cid', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_WEBHOOK_ID: 'wh',
  GEMINI_API_KEY: 'gkey', ASSISTANT_CALLS_PER_DAY: '2',
});
const server = createServer((req, res) => api.middleware(req, res, () => { res.statusCode = 404; res.end('page'); }));
await new Promise<void>(r => server.listen(0, r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;

// A browser: keeps its cookies
const browser = () => {
  const jar = new Map<string, string>();
  const fn = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const cookiePath = (p: string) => [...jar].filter(([k]) => k !== 'eq_pass' || p.startsWith('/api/gemini')).map(([k, v]) => `${k}=${v}`).join('; ');
    const response = await realFetch(base + path, {
      method,
      headers: { cookie: cookiePath(path), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of response.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (/Max-Age=0/.test(c)) jar.delete(k); else jar.set(k, v);
    }
    const text = await response.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch {}
    return { status: response.status, data };
  };
  return Object.assign(fn, { jar });
};

let passed = 0;
const step = async (name: string, fn: () => Promise<void>) => { await fn(); passed++; console.log('ok  ', name); };

const alice = browser();
const bob = browser();

await step('new visitor gets 3 credits and the PayPal client id', async () => {
  const r = await alice('GET', '/api/credits');
  assert.equal(r.status, 200);
  assert.equal(r.data.credits, 3);
  assert.equal(r.data.paypal.clientId, 'cid');
  assert.equal(r.data.pool.credits, 0);
  assert.ok(!JSON.stringify(r.data).includes('secret'));
});

let orderId = '';
await step('create a starter order (Orders v2) for yourself', async () => {
  const r = await alice('POST', '/api/paypal/orders', { pack: 'starter', purpose: 'self' });
  assert.equal(r.status, 200);
  assert.equal(r.data.price, '2.00');
  orderId = r.data.id;
});

await step('another browser cannot capture it', async () => {
  const r = await bob('POST', `/api/paypal/orders/${orderId}/capture`, {});
  assert.equal(r.status, 404);
});

await step('capture adds 10 credits', async () => {
  const r = await alice('POST', `/api/paypal/orders/${orderId}/capture`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 10);
  assert.equal(r.data.credits, 13);
});

await step('capturing again adds nothing', async () => {
  const r = await alice('POST', `/api/paypal/orders/${orderId}/capture`, {});
  assert.equal(r.data.alreadyCredited, true);
  assert.equal(r.data.credits, 13);
});

await step('a capture for the wrong amount adds nothing', async () => {
  const o = await alice('POST', '/api/paypal/orders', { pack: 'starter' });
  captureAmountOverride = '0.01';
  const r = await alice('POST', `/api/paypal/orders/${o.data.id}/capture`, {});
  captureAmountOverride = null;
  assert.equal(r.status, 402);
  assert.equal(r.data.credits, 13);
});

await step('sponsoring the pool (class pack) fills the pool, not the balance', async () => {
  const o = await alice('POST', '/api/paypal/orders', { pack: 'class', purpose: 'pool' });
  const r = await alice('POST', `/api/paypal/orders/${o.data.id}/capture`, {});
  assert.equal(r.data.purpose, 'pool');
  assert.equal(r.data.credits, 13);
  assert.equal(r.data.pool.credits, 50);
  assert.equal(r.data.pool.sponsors, 1);
  assert.equal(r.data.sponsored, 50);
});

await step('a visitor with credits cannot take from the pool', async () => {
  const r = await alice('POST', '/api/pool/claim', {});
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'HAS_CREDITS');
});

await step('spending: 3 generations, then out of credits', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await bob('POST', '/api/credits/spend', { kind: 'text' })).status, 200);
  const r = await bob('POST', '/api/credits/spend', { kind: 'text' });
  assert.equal(r.status, 402);
  assert.equal(r.data.error, 'NO_CREDITS');
});

await step('a student with 0 credits takes 2 from the pool, once a day', async () => {
  const r = await bob('POST', '/api/pool/claim', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.claimed, 2);
  assert.equal(r.data.credits, 2);
  assert.equal(r.data.pool.credits, 48);
  for (let i = 0; i < 2; i++) await bob('POST', '/api/credits/spend', { kind: 'text' });
  const again = await bob('POST', '/api/pool/claim', {});
  assert.equal(again.status, 409);
  assert.equal(again.data.error, 'CLAIMED_TODAY');
});

await step('Gemini: free assistant allowance, then refused', async () => {
  const before = calls.filter(c => c === 'GEMINI').length;
  const gem = () => alice('POST', '/api/gemini/v1beta/models/gemini-x:generateContent', {}, { 'x-goog-api-key': 'slot-1' });
  assert.equal((await gem()).status, 200);
  assert.equal((await gem()).status, 200);
  const third = await gem();
  assert.equal(third.status, 402);
  assert.equal(third.data.error.status, 'ASSISTANT_LIMIT');
  assert.equal(calls.filter(c => c === 'GEMINI').length - before, 2);
});

await step('Gemini: a generation pass lets the scene through; a failed scene is refunded once', async () => {
  const spent = await alice('POST', '/api/credits/spend', { kind: 'problem' });
  assert.equal(spent.data.credits, 12);
  const r = await alice('POST', '/api/gemini/v1beta/models/gemini-x:generateContent', {}, { 'x-goog-api-key': 'slot-1' });
  assert.equal(r.status, 200);
  const fin = await alice('POST', '/api/credits/finish', { pass: spent.data.pass, ok: false });
  assert.equal(fin.data.refunded, true);
  assert.equal(fin.data.credits, 13);
  const again = await alice('POST', '/api/credits/finish', { pass: spent.data.pass, ok: false });
  assert.equal(again.data.refunded, false);
  const after = await alice('POST', '/api/gemini/v1beta/models/gemini-x:generateContent', {}, { 'x-goog-api-key': 'slot-1' });
  assert.equal(after.status, 402, 'closed pass and used-up allowance');
});

await step('a visitor with no cookie cannot use Gemini', async () => {
  const r = await realFetch(base + '/api/gemini/v1beta/models/gemini-x:generateContent', { method: 'POST', headers: { 'x-goog-api-key': 'slot-1', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 402);
});

await step('webhook: a verified capture credits an order the page never captured', async () => {
  const o = await bob('POST', '/api/paypal/orders', { pack: 'starter' });
  const event = {
    id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { id: 'CAP-X', status: 'COMPLETED', amount: { value: '2.00', currency_code: 'USD' }, custom_id: orders.get(o.data.id)!.customId, supplementary_data: { related_ids: { order_id: o.data.id } } },
  };
  const r = await realFetch(base + '/api/paypal/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  assert.equal(r.status, 200);
  const status = await bob('GET', '/api/credits');
  assert.equal(status.data.credits, 10);
  // The page's late capture request then adds nothing more
  const late = await bob('POST', `/api/paypal/orders/${o.data.id}/capture`, {});
  assert.equal(late.data.alreadyCredited, true);
  assert.equal(late.data.credits, 10);
});

await step('webhook: approval of an uncaptured order is captured by the server', async () => {
  const o = await bob('POST', '/api/paypal/orders', { pack: 'starter' });
  const event = { id: 'WH-2', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: o.data.id } };
  const r = await realFetch(base + '/api/paypal/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  assert.equal(r.status, 200);
  assert.equal((await bob('GET', '/api/credits')).data.credits, 20);
});

await step('webhook: a forged delivery is rejected', async () => {
  const o = await bob('POST', '/api/paypal/orders', { pack: 'class' });
  webhookVerdict = 'FAILURE';
  const event = { id: 'WH-3', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: o.data.id } };
  const r = await realFetch(base + '/api/paypal/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  webhookVerdict = 'SUCCESS';
  assert.equal(r.status, 400);
  assert.equal((await bob('GET', '/api/credits')).data.credits, 20);
});

await step('unknown pack and non-JSON bodies are refused', async () => {
  assert.equal((await alice('POST', '/api/paypal/orders', { pack: 'gold' })).status, 400);
  const r = await realFetch(base + '/api/credits/spend', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'kind=text' });
  assert.equal(r.status, 400);
});

await step('the health check answers without creating a visitor', async () => {
  const r = await realFetch(base + '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.headers.getSetCookie().length, 0);
  assert.deepEqual(await r.json(), { ok: true, ai: true, paypal: true });
});

await step('payments are saved at once: a restart straight after keeps them', async () => {
  // No waiting for the batched write: money changes are written immediately
  const again = createApi({ DATA_DIR: dataDir, PAYPAL_CLIENT_ID: 'cid', PAYPAL_CLIENT_SECRET: 'secret', GEMINI_API_KEY: 'gkey' });
  const s2 = createServer((req, res) => again.middleware(req, res));
  await new Promise<void>(r => s2.listen(0, r));
  const port2 = (s2.address() as any).port;
  const r = await realFetch(`http://127.0.0.1:${port2}/api/credits`, { headers: { cookie: `eq_device=${alice.jar.get('eq_device')}` } });
  const data: any = await r.json();
  assert.equal(data.credits, 13);
  assert.equal(data.pool.credits, 48);
  s2.close();
});

console.log(`\n${passed} checks passed`);
server.close();
process.exit(0);
