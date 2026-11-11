// PayPal REST API (Orders v2), sandbox only: the hackathon rules require the sandbox, and no live key is
// ever used. The client secret stays here on the server; the page only receives the public client id.
// Docs: https://developer.paypal.com/docs/api/orders/v2/

export const PAYPAL_API = 'https://api-m.sandbox.paypal.com';

export interface PayPalConfig { clientId: string; clientSecret: string; webhookId?: string }

export function paypalConfig(env: Record<string, string | undefined>): PayPalConfig | null {
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  const webhookId = env.PAYPAL_WEBHOOK_ID?.trim() || undefined;
  return clientId && clientSecret ? { clientId, clientSecret, webhookId } : null;
}

export class PayPalError extends Error {
  status: number;
  issue?: string;
  debugId?: string;
  constructor(status: number, message: string, issue?: string, debugId?: string) {
    super(message);
    this.status = status;
    this.issue = issue;
    this.debugId = debugId;
  }
}

// One access token, reused until shortly before it expires
let cached: { token: string; expires: number; clientId: string } | null = null;
async function accessToken(config: PayPalConfig): Promise<string> {
  if (cached && cached.clientId === config.clientId && cached.expires > Date.now() + 60_000) return cached.token;
  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new PayPalError(502, `PayPal refused the sandbox credentials (${body.error_description || response.status}). Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.`);
  }
  cached = { token: body.access_token, expires: Date.now() + Number(body.expires_in || 0) * 1000, clientId: config.clientId };
  return cached.token;
}

async function call(config: PayPalConfig, method: string, path: string, body?: unknown, requestId?: string): Promise<any> {
  const response = await fetch(PAYPAL_API + path, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken(config)}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(requestId ? { 'paypal-request-id': requestId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const issue = data?.details?.[0]?.issue;
    const message = data?.details?.[0]?.description || data?.message || `PayPal answered ${response.status}`;
    throw new PayPalError(response.status, message, issue, data?.debug_id);
  }
  return data;
}

export interface OrderRequest { amount: string; description: string; packId: string; device: string }

// A digital-goods order with no shipping, paid straight away ("Pay Now")
export async function createOrder(config: PayPalConfig, request: OrderRequest): Promise<string> {
  const money = { currency_code: 'USD', value: request.amount };
  const order = await call(config, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: request.packId,
      custom_id: request.device,
      description: request.description,
      amount: { ...money, breakdown: { item_total: money } },
      items: [{ name: request.description, quantity: '1', unit_amount: money, category: 'DIGITAL_GOODS' }],
    }],
    application_context: { brand_name: 'Equilibria', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
  });
  return order.id;
}

export interface CaptureResult { status: string; captureId?: string; captureStatus?: string; amount?: string; currency?: string; customId?: string }

export const readCapture = (order: any): CaptureResult => {
  const unit = order?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    status: order?.status,
    captureId: capture?.id,
    captureStatus: capture?.status,
    amount: capture?.amount?.value,
    currency: capture?.amount?.currency_code,
    customId: capture?.custom_id ?? unit?.custom_id,
  };
};

// Captures an approved order. The request id makes a repeated capture (a retry, a double click) return
// the first result instead of charging twice; an order captured before is read back instead.
export async function captureOrder(config: PayPalConfig, orderId: string): Promise<CaptureResult> {
  try {
    return readCapture(await call(config, 'POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `capture-${orderId}`));
  } catch (error) {
    if (error instanceof PayPalError && error.issue === 'ORDER_ALREADY_CAPTURED') {
      return readCapture(await call(config, 'GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`));
    }
    throw error;
  }
}

// Asks PayPal whether a webhook delivery really came from PayPal, for this app's webhook
// (https://developer.paypal.com/api/webhooks/v1/#verify-webhook-signature_post)
export async function verifyWebhook(config: PayPalConfig, headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
  if (!config.webhookId) return false;
  const header = (name: string) => String(headers[name] || '');
  const result = await call(config, 'POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: header('paypal-auth-algo'),
    cert_url: header('paypal-cert-url'),
    transmission_id: header('paypal-transmission-id'),
    transmission_sig: header('paypal-transmission-sig'),
    transmission_time: header('paypal-transmission-time'),
    webhook_id: config.webhookId,
    webhook_event: event,
  });
  return result?.verification_status === 'SUCCESS';
}
