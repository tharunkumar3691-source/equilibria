// Credits: what a scene generation costs, kept on the server so the page cannot change its own balance.
// Each browser is one "device" (a random id in an HttpOnly cookie, no account needed). New devices start
// with a few free credits. Spending a credit opens a short-lived "generation pass": the Gemini proxy only
// forwards a scene's requests while that pass is open. A generation that fails (the scene never passes its
// physics check) gives its credit back: verified-or-free.
// Stored as one JSON file (DATA_DIR/credits.json). Losing it only resets balances to the free credits.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Pack { id: string; credits: number; price: string; label: string; note: string }
// Sandbox prices in USD. The amounts are checked again when a payment is captured.
export const PACKS: Pack[] = [
  { id: 'starter', credits: 10, price: '2.00', label: 'Starter', note: '10 scenes or solved problems' },
  { id: 'class', credits: 50, price: '8.00', label: 'Class pack', note: '50 credits for a study group or class' },
];
export const packById = (id: unknown) => PACKS.find(p => p.id === id);

export interface Device {
  credits: number;
  createdAt: number;
  assistant: { day: string; calls: number };   // Free assistant requests (chat edits) used today
  refunds: DayCount;                            // Credits given back today for failed generations
  purchased: number;                            // Credits bought for this device, all time
  sponsored?: number;                           // Credits this device bought for the student pool, all time
  claims?: DayCount;                            // Pool credits taken today
}
// Who an order's credits go to: the buyer, or the pay-it-forward pool for students who cannot pay
export type Purpose = 'self' | 'pool';
export interface OrderRecord {
  device: string;
  pack: string;
  purpose?: Purpose;
  credits: number;
  amount: string;
  status: 'created' | 'credited';
  createdAt: number;
  creditedAt?: number;
  captureId?: string;
}
interface Store {
  devices: Record<string, Device>;
  orders: Record<string, OrderRecord>;
  grants: { day: string; byIp: Record<string, number> };   // Free starts given today, per address
  usage: { day: string; geminiCalls: number };              // Every forwarded Gemini request today
  pool: { credits: number; donated: number; sponsors: number; claimed: number };   // The pay-it-forward pool
}
export interface Pass { id: string; device: string; callsLeft: number; expires: number; kind: string; closed: boolean }

export interface CreditOptions {
  dataDir?: string;
  freeCredits?: number;         // Credits a new device starts with
  freeStartsPerIp?: number;     // New devices per address per day that get them
  assistantCallsPerDay?: number; // Gemini requests per device per day outside a generation pass (chat edits)
  refundsPerDay?: number;       // Failed generations per device per day that get their credit back
  dailyCallCap?: number;        // Gemini requests per day for the whole server, a last guard on the bill
  poolClaim?: number;           // Pool credits one device may take per day, once its own run out
}

const today = () => new Date().toISOString().slice(0, 10);
const newId = (bytes = 18) => randomBytes(bytes).toString('base64url');
// One generation makes several Gemini requests (design, test repairs, review, improvement), and each can
// fall back across models when one is overloaded. Best-quality mode allows up to 4 minutes per request.
const PASS_CALLS = 100;
const PASS_MS = 30 * 60 * 1000;

type DayCount = { day: string; count: number };

export function createCreditStore(options: CreditOptions = {}) {
  const dir = resolve(options.dataDir || 'data');
  const file = join(dir, 'credits.json');
  const freeCredits = options.freeCredits ?? 3;
  const freeStartsPerIp = options.freeStartsPerIp ?? 3;
  const assistantLimit = options.assistantCallsPerDay ?? 40;
  const refundLimit = options.refundsPerDay ?? 5;
  const dailyCap = options.dailyCallCap ?? 3000;
  const poolClaim = options.poolClaim ?? 2;

  let store: Store = {
    devices: {}, orders: {}, grants: { day: today(), byIp: {} }, usage: { day: today(), geminiCalls: 0 },
    pool: { credits: 0, donated: 0, sponsors: 0, claimed: 0 },
  };
  try { store = { ...store, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch {}
  const passes = new Map<string, Pass>();

  // The whole store is written to a temporary file and then swapped in, so a crash never leaves half a file
  const write = () => {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file + '.tmp', JSON.stringify(store));
      renameSync(file + '.tmp', file);
    } catch (error) { console.error('[credits] Could not save', error); }
  };
  // Everyday changes are batched (at most one write per half second); money changes are written at once
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; write(); }, 500);
  };
  const saveNow = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    write();
  };
  // A pending batch is written before the process stops (a host restarting or redeploying the service)
  const flush = () => { if (timer) saveNow(); };

  const fresh = <T extends { day: string }>(entry: T | undefined, reset: T): T => (entry && entry.day === today() ? entry : reset);

  // The device behind a cookie, or a new one (with free credits while this address has starts left today)
  function device(id: string | undefined, ip: string): { id: string; device: Device; created: boolean } {
    if (id && store.devices[id]) return { id, device: store.devices[id], created: false };
    store.grants = fresh(store.grants, { day: today(), byIp: {} });
    const starts = store.grants.byIp[ip] || 0;
    store.grants.byIp[ip] = starts + 1;
    const created: Device = {
      credits: starts < freeStartsPerIp ? freeCredits : 0,
      createdAt: Date.now(),
      assistant: { day: today(), calls: 0 },
      refunds: { day: today(), count: 0 },
      purchased: 0,
    };
    const newDeviceId = newId();
    store.devices[newDeviceId] = created;
    save();
    return { id: newDeviceId, device: created, created: true };
  }

  const assistantUsed = (d: Device) => fresh(d.assistant, { day: today(), calls: 0 }).calls;

  // Takes one credit and opens a pass for one generation
  function spend(deviceId: string, kind: string): Pass | null {
    const d = store.devices[deviceId];
    if (!d || d.credits < 1) return null;
    d.credits -= 1;
    const pass: Pass = { id: newId(), device: deviceId, callsLeft: PASS_CALLS, expires: Date.now() + PASS_MS, kind, closed: false };
    passes.set(pass.id, pass);
    saveNow();
    return pass;
  }

  // Closes a pass. A failed generation gets its credit back (up to a few a day, so it cannot be farmed).
  function finish(deviceId: string, passId: string, ok: boolean): { refunded: boolean } {
    const pass = passes.get(passId);
    if (!pass || pass.device !== deviceId || pass.closed) return { refunded: false };
    pass.closed = true;
    passes.delete(passId);
    const d = store.devices[deviceId];
    if (ok || !d) return { refunded: false };
    d.refunds = fresh(d.refunds, { day: today(), count: 0 });
    if (d.refunds.count >= refundLimit) return { refunded: false };
    d.refunds.count += 1;
    d.credits += 1;
    saveNow();
    return { refunded: true };
  }

  // Decides whether one Gemini request may go through. Inside an open pass it uses the pass; otherwise it
  // is an assistant request (a chat edit), which is free up to a daily number per device.
  function authorizeCall(deviceId: string | undefined, passId: string | undefined):
    { ok: true } | { ok: false; status: number; reason: string; message: string } {
    store.usage = fresh(store.usage, { day: today(), geminiCalls: 0 });
    if (store.usage.geminiCalls >= dailyCap) {
      return { ok: false, status: 429, reason: 'SERVER_DAILY_LIMIT', message: 'Equilibria has reached its AI limit for today. The demos still work; please try again tomorrow.' };
    }
    const d = deviceId ? store.devices[deviceId] : undefined;
    if (!d) return { ok: false, status: 402, reason: 'NO_DEVICE', message: 'Reload the page to start a session, then try again.' };

    const pass = passId ? passes.get(passId) : undefined;
    if (pass && !pass.closed && pass.device === deviceId && pass.expires > Date.now() && pass.callsLeft > 0) {
      pass.callsLeft -= 1;
      store.usage.geminiCalls += 1;
      save();
      return { ok: true };
    }
    d.assistant = fresh(d.assistant, { day: today(), calls: 0 });
    if (d.assistant.calls >= assistantLimit) {
      return { ok: false, status: 402, reason: 'ASSISTANT_LIMIT', message: `You have used today's ${assistantLimit} free assistant requests. Creating a new scene uses a credit instead.` };
    }
    d.assistant.calls += 1;
    store.usage.geminiCalls += 1;
    save();
    return { ok: true };
  }

  // --- PayPal orders ---
  function recordOrder(orderId: string, record: OrderRecord) { store.orders[orderId] = record; saveNow(); }
  const order = (orderId: string): OrderRecord | undefined => store.orders[orderId];

  // Adds a paid order's credits exactly once, however many times the capture is reported (the page and the
  // webhook both report it). Pool orders fill the pay-it-forward pool instead of the buyer's balance.
  function creditOrder(orderId: string, captureId: string): { added: number; purpose: Purpose } {
    const record = store.orders[orderId];
    if (!record) return { added: 0, purpose: 'self' };
    const purpose = record.purpose || 'self';
    const d = store.devices[record.device];
    if (record.status === 'credited' || !d) return { added: 0, purpose };
    record.status = 'credited';
    record.creditedAt = Date.now();
    record.captureId = captureId;
    if (purpose === 'pool') {
      store.pool.credits += record.credits;
      store.pool.donated += record.credits;
      if (!d.sponsored) store.pool.sponsors += 1;
      d.sponsored = (d.sponsored || 0) + record.credits;
    } else {
      d.credits += record.credits;
      d.purchased += record.credits;
    }
    saveNow();
    return { added: record.credits, purpose };
  }

  // A student whose own credits ran out takes a few from the pool (a small amount per day, so it is shared)
  function claimFromPool(deviceId: string): { claimed: number; reason?: string } {
    const d = store.devices[deviceId];
    if (!d) return { claimed: 0, reason: 'NO_DEVICE' };
    if (d.credits > 0) return { claimed: 0, reason: 'HAS_CREDITS' };
    const claims = d.claims = fresh(d.claims, { day: today(), count: 0 });
    if (claims.count >= poolClaim) return { claimed: 0, reason: 'CLAIMED_TODAY' };
    const amount = Math.min(poolClaim - claims.count, store.pool.credits);
    if (amount < 1) return { claimed: 0, reason: 'POOL_EMPTY' };
    store.pool.credits -= amount;
    store.pool.claimed += amount;
    claims.count += amount;
    d.credits += amount;
    saveNow();
    return { claimed: amount };
  }
  const pool = () => ({ ...store.pool });
  const poolClaimLeft = (d: Device) => Math.max(0, poolClaim - fresh(d.claims, { day: today(), count: 0 }).count);

  // Passes that expired are forgotten
  setInterval(() => {
    const now = Date.now();
    for (const [id, pass] of passes) if (pass.expires < now) passes.delete(id);
  }, 60 * 1000).unref();

  return {
    device, spend, finish, authorizeCall, recordOrder, order, creditOrder, claimFromPool, pool, poolClaimLeft,
    assistantUsed, assistantLimit, freeCredits, flush,
  };
}
export type CreditStore = ReturnType<typeof createCreditStore>;
