// Equilibria's server API, shared by the Vite dev server (vite.config.ts) and production (server/index.ts):
//   GET  /api/credits                      balance, packs, the student pool, and the public PayPal client id
//   POST /api/credits/spend    {kind}      takes a credit and opens a generation pass
//   POST /api/credits/finish   {pass, ok}  closes the pass; a failed generation gets its credit back
//   POST /api/pool/claim                   a student with no credits left takes a few from the pay-it-forward pool
//   POST /api/paypal/orders    {pack, purpose}  creates a sandbox PayPal order (for yourself, or for the pool)
//   POST /api/paypal/orders/:id/capture    captures the approved order and adds its credits
//   POST /api/paypal/webhook               PayPal's own report of approved and completed payments (signature checked)
//   GET  /api/health                       for the host's health checks
//   /api/gemini/...                        the Gemini proxy, allowed only within a pass or the free assistant allowance
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCreditStore, packById, PACKS, type CreditStore, type Purpose } from './credits.ts';
import { createGeminiProxy, geminiKeys } from './geminiProxy.ts';
import { captureOrder, createOrder, PayPalError, paypalConfig, verifyWebhook, type CaptureResult } from './paypal.ts';

const DEVICE_COOKIE = 'eq_device';
const PASS_COOKIE = 'eq_pass';
const YEAR = 365 * 24 * 3600;

const cookies = (req: IncomingMessage): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) {
      try { out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim()); } catch {}
    }
  }
  return out;
};
// Behind a host's proxy (Render) the visitor's address is the first one in x-forwarded-for
const clientIp = (req: IncomingMessage) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

const isSecure = (req: IncomingMessage) => req.headers['x-forwarded-proto'] === 'https' || !!(req.socket as any).encrypted;
const cookie = (req: IncomingMessage, name: string, value: string, maxAge: number, path = '/') =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isSecure(req) ? '; Secure' : ''}`;
const addCookie = (res: ServerResponse, value: string) => {
  const existing = res.getHeader('set-cookie');
  res.setHeader('set-cookie', [...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []), value]);
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
};

async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<any> {
  // JSON only: a cross-site form cannot send it without the browser asking first
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw new Error('Expected JSON');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

const num = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) ? Number(value) : fallback);

export function createApi(env: Record<string, string | undefined>) {
  const store: CreditStore = createCreditStore({
    dataDir: env.DATA_DIR,
    freeCredits: num(env.FREE_CREDITS, 3),
    freeStartsPerIp: num(env.FREE_STARTS_PER_IP, 3),
    assistantCallsPerDay: num(env.ASSISTANT_CALLS_PER_DAY, 40),
    refundsPerDay: num(env.REFUNDS_PER_DAY, 5),
    dailyCallCap: num(env.DAILY_GEMINI_CALL_CAP, 3000),
    poolClaim: num(env.POOL_CLAIM_PER_DAY, 2),
  });
  const paypal = paypalConfig(env);
  const keys = geminiKeys(env);
  const gemini = createGeminiProxy(keys, req => {
    const jar = cookies(req);
    return store.authorizeCall(jar[DEVICE_COOKIE], jar[PASS_COOKIE]);
  });

  // The visitor's device, created (with its cookie) on first contact
  const deviceOf = (req: IncomingMessage, res: ServerResponse) => {
    const found = store.device(cookies(req)[DEVICE_COOKIE], clientIp(req));
    if (found.created) addCookie(res, cookie(req, DEVICE_COOKIE, found.id, YEAR));
    return found;
  };

  const summary = (id: string) => {
    const { device } = store.device(id, '');
    const pool = store.pool();
    return {
      credits: device.credits,
      purchased: device.purchased,
      sponsored: device.sponsored || 0,
      purchases: store.purchases(id),
      assistant: { used: store.assistantUsed(device), limit: store.assistantLimit },
      pool: {
        credits: pool.credits, donated: pool.donated, sponsors: pool.sponsors, used: pool.claimed || 0,
        perDay: store.poolPerDay, claimable: store.poolClaimLeft(device),
      },
    };
  };

  // Adds an order's credits once PayPal confirms it: a completed capture of exactly the pack's price, for the
  // device that started it. Used by the page's capture request and by the webhook, whichever comes first.
  const settle = (orderId: string, result: CaptureResult) => {
    const record = store.order(orderId);
    if (!record) return { ok: false as const, reason: 'UNKNOWN_ORDER' };
    const paid = result.captureStatus === 'COMPLETED' && result.currency === 'USD'
      && result.amount === record.amount && result.customId === record.device;
    if (!paid) return { ok: false as const, reason: result.captureStatus || result.status || 'NOT_COMPLETED' };
    return { ok: true as const, ...store.creditOrder(orderId, result.captureId || '') };
  };

  async function handleWebhook(req: IncomingMessage, res: ServerResponse) {
    if (!paypal?.webhookId) { json(res, 404, { error: 'WEBHOOK_NOT_CONFIGURED' }); return; }
    let event: any;
    try { event = await readJson(req, 256 * 1024); } catch { json(res, 400, { error: 'BAD_REQUEST' }); return; }
    if (!(await verifyWebhook(paypal, req.headers, event))) {
      console.warn('[paypal] Webhook signature did not verify; ignored.', event?.id);
      json(res, 400, { error: 'BAD_SIGNATURE' });
      return;
    }
    const resource = event?.resource || {};
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = resource.supplementary_data?.related_ids?.order_id;
      if (orderId && store.order(orderId)) {
        const outcome = settle(orderId, {
          status: 'COMPLETED', captureId: resource.id, captureStatus: resource.status,
          amount: resource.amount?.value, currency: resource.amount?.currency_code, customId: resource.custom_id,
        });
        console.info('[paypal] Webhook capture', orderId, outcome);
      }
    } else if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
      // The buyer approved, but the page never asked for the capture (closed tab, lost connection): capture here
      const orderId = resource.id;
      const record = orderId ? store.order(orderId) : undefined;
      if (record && record.status === 'created') {
        try { console.info('[paypal] Webhook approval captured', orderId, settle(orderId, await captureOrder(paypal, orderId))); }
        catch (error) { console.warn('[paypal] Webhook capture failed', orderId, error); }
      }
    }
    json(res, 200, { received: true });
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string) {
    const method = req.method || 'GET';

    if (path === '/api/paypal/webhook' && method === 'POST') { await handleWebhook(req, res); return; }

    // For the host's health checks: answers without creating a visitor
    if (path === '/api/health') { json(res, 200, { ok: true, ai: keys.length > 0, paypal: !!paypal }); return; }

    if (path === '/api/credits' && method === 'GET') {
      const { id } = deviceOf(req, res);
      json(res, 200, {
        ...summary(id),
        freeCredits: store.freeCredits,
        packs: PACKS,
        paypal: paypal ? { clientId: paypal.clientId, environment: 'sandbox' } : null,
        ai: { keys: keys.length },
      });
      return;
    }

    if (method !== 'POST') { json(res, 404, { error: 'NOT_FOUND' }); return; }
    let body: any;
    try { body = await readJson(req); } catch { json(res, 400, { error: 'BAD_REQUEST', message: 'Expected a small JSON body.' }); return; }
    const { id } = deviceOf(req, res);

    if (path === '/api/credits/spend') {
      const kind = ['video', 'text', 'problem'].includes(body.kind) ? body.kind : 'text';
      const pass = store.spend(id, kind);
      if (!pass) { json(res, 402, { error: 'NO_CREDITS', message: 'You are out of credits.', ...summary(id) }); return; }
      // The pass travels as a cookie, so every Gemini request of this generation carries it by itself
      addCookie(res, cookie(req, PASS_COOKIE, pass.id, Math.round((pass.expires - Date.now()) / 1000), '/api/gemini'));
      json(res, 200, { pass: pass.id, ...summary(id) });
      return;
    }

    if (path === '/api/credits/finish') {
      const { refunded } = store.finish(id, String(body.pass || ''), body.ok === true);
      if (cookies(req)[PASS_COOKIE] === body.pass) addCookie(res, cookie(req, PASS_COOKIE, '', 0, '/api/gemini'));
      json(res, 200, { refunded, ...summary(id) });
      return;
    }

    if (path === '/api/pool/claim') {
      const { claimed, reason } = store.claimFromPool(id);
      const messages: Record<string, string> = {
        HAS_CREDITS: 'You still have credits of your own; the pool is kept for students who have none.',
        CLAIMED_TODAY: 'You have already taken today’s share of the student pool. It refills as people sponsor it.',
        POOL_EMPTY: 'The student pool is empty right now. Anyone can refill it with "Gift to students" in the credits window.',
      };
      json(res, claimed ? 200 : 409, { claimed, error: reason, message: reason ? messages[reason] || reason : undefined, ...summary(id) });
      return;
    }

    if (path.startsWith('/api/paypal/')) {
      if (!paypal) { json(res, 503, { error: 'PAYPAL_NOT_CONFIGURED', message: 'PayPal is not set up on this server (PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET).' }); return; }
      try {
        if (path === '/api/paypal/orders') {
          const pack = packById(body.pack);
          if (!pack) { json(res, 400, { error: 'UNKNOWN_PACK', message: `There is no "${body.pack}" pack.` }); return; }
          const purpose: Purpose = body.purpose === 'pool' ? 'pool' : 'self';
          const description = purpose === 'pool'
            ? `Equilibria: sponsor ${pack.credits} credits for students`
            : `Equilibria ${pack.label}: ${pack.credits} credits`;
          const orderId = await createOrder(paypal, { amount: pack.price, description, packId: pack.id, device: id });
          store.recordOrder(orderId, { device: id, pack: pack.id, purpose, credits: pack.credits, amount: pack.price, status: 'created', createdAt: Date.now() });
          json(res, 200, { id: orderId, pack: pack.id, purpose, credits: pack.credits, price: pack.price });
          return;
        }
        const capture = /^\/api\/paypal\/orders\/([\w-]{5,64})\/capture$/.exec(path);
        if (capture) {
          const orderId = capture[1];
          const record = store.order(orderId);
          if (!record || record.device !== id) { json(res, 404, { error: 'UNKNOWN_ORDER', message: 'That order was not started here.' }); return; }
          const purpose = record.purpose || 'self';
          // The webhook may have settled it already
          if (record.status === 'credited') { json(res, 200, { added: record.credits, purpose, orderId, captureId: record.captureId, alreadyCredited: true, ...summary(id) }); return; }
          const result = await captureOrder(paypal, orderId);
          const outcome = settle(orderId, result);
          if (outcome.ok === false) {
            json(res, 402, { error: 'NOT_COMPLETED', message: `PayPal reports the payment as ${outcome.reason}; no credits were added.`, ...summary(id) });
            return;
          }
          json(res, 200, { added: record.credits, purpose, orderId, captureId: result.captureId, ...summary(id) });
          return;
        }
      } catch (error) {
        if (error instanceof PayPalError) {
          console.warn('[paypal]', error.status, error.issue, error.message, error.debugId);
          // A declined funding source can be retried in the same PayPal window (the page restarts it)
          json(res, error.issue === 'INSTRUMENT_DECLINED' ? 422 : 502, { error: error.issue || 'PAYPAL_ERROR', message: error.message, debugId: error.debugId });
          return;
        }
        console.error('[paypal]', error);
        json(res, 502, { error: 'PAYPAL_ERROR', message: 'Could not reach PayPal. Please try again.' });
        return;
      }
    }

    json(res, 404, { error: 'NOT_FOUND' });
  }

  // Connect-style middleware: the API, then the Gemini proxy, then whatever comes next (the page)
  const middleware = (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path === '/api/credits' || path === '/api/health' || /^\/api\/(credits|paypal|pool)\//.test(path)) {
      handle(req, res, path).catch(error => {
        console.error('[api]', error);
        if (!res.headersSent) json(res, 500, { error: 'SERVER_ERROR' });
      });
      return;
    }
    gemini(req, res, next);
  };
  return { middleware, keys, paypalReady: !!paypal, webhookReady: !!paypal?.webhookId, flush: store.flush };
}
