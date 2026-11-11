// The page's side of credits and PayPal (the server side is server/api.ts). Balances live on the server;
// the page only asks for them, spends one when a generation starts, and reports how the generation ended.

export interface Pack { id: string; credits: number; price: string; label: string; note: string }
export type Purpose = 'self' | 'pool';
export interface PoolStatus { credits: number; donated: number; sponsors: number; claimable: number }
export interface CreditStatus {
  credits: number;
  purchased: number;
  sponsored: number;              // Credits this browser has given to the student pool
  assistant: { used: number; limit: number };
  pool: PoolStatus;               // The pay-it-forward pool for students who cannot pay
  freeCredits: number;
  packs: Pack[];
  paypal: { clientId: string; environment: 'sandbox' } | null;
  ai: { keys: number };
}
export type Balance = Pick<CreditStatus, 'credits' | 'purchased' | 'sponsored' | 'assistant' | 'pool'>;
// A PayPal order made before the PayPal window opens (by the assistant), so the buttons pay exactly that order
export interface PreparedOrder { id: string; pack: string; purpose: Purpose; credits: number; price: string }

export class CreditError extends Error {
  code: string;
  status: number;
  balance?: Balance;
  constructor(status: number, code: string, message: string, balance?: Balance) {
    super(message);
    this.status = status;
    this.code = code;
    this.balance = balance;
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const balance = typeof data.credits === 'number'
      ? { credits: data.credits, purchased: data.purchased, sponsored: data.sponsored, assistant: data.assistant, pool: data.pool }
      : undefined;
    throw new CreditError(response.status, data.error || 'ERROR', data.message || `The server answered ${response.status}.`, balance);
  }
  return data as T;
}

export const loadCredits = () => request<CreditStatus>('/api/credits');

// Takes one credit for a generation. Throws CreditError with code NO_CREDITS when there are none.
export const spendCredit = (kind: 'video' | 'text' | 'problem') =>
  request<Balance & { pass: string }>('/api/credits/spend', { kind });

// Closes the generation's pass. ok=false (the scene never passed its checks, or the request failed) gives the credit back.
export const finishGeneration = (pass: string, ok: boolean) =>
  request<Balance & { refunded: boolean }>('/api/credits/finish', { pass, ok });

// Takes today's share of the student pool (only when this browser has no credits of its own)
export const claimFromPool = () => request<Balance & { claimed: number }>('/api/pool/claim', {});

export const createPayPalOrder = (pack: string, purpose: Purpose = 'self') =>
  request<PreparedOrder>('/api/paypal/orders', { pack, purpose });
export const capturePayPalOrder = (orderId: string) =>
  request<Balance & { added: number; purpose: Purpose; captureId?: string; alreadyCredited?: boolean }>(`/api/paypal/orders/${encodeURIComponent(orderId)}/capture`, {});

// PayPal's JavaScript SDK, loaded once, only when someone opens the checkout
let sdk: Promise<any> | null = null;
export function loadPayPalSdk(clientId: string): Promise<any> {
  if ((window as any).paypal) return Promise.resolve((window as any).paypal);
  sdk ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const params = new URLSearchParams({ 'client-id': clientId, currency: 'USD', intent: 'capture', components: 'buttons' });
    script.src = `https://www.paypal.com/sdk/js?${params}`;
    script.async = true;
    script.onload = () => ((window as any).paypal ? resolve((window as any).paypal) : reject(new Error('PayPal did not load.')));
    script.onerror = () => { sdk = null; script.remove(); reject(new Error('Could not load PayPal. Check your connection and try again.')); };
    document.head.appendChild(script);
  });
  return sdk;
}
