// Forwards the page's Gemini requests to Google, adding the real API key here on the server, so no key
// ever reaches the browser. The page names a key only by its slot ("slot-1", "slot-2", ...), which keeps
// the move-to-the-next-key-on-quota behaviour of lib/gemini.ts working.
// Used by the Vite dev and preview servers (vite.config.ts) and by the production server (server/index.ts).
import type { IncomingMessage, ServerResponse } from 'node:http';

const UPSTREAM = 'https://generativelanguage.googleapis.com';
export const PROXY_PREFIX = '/api/gemini';
// Only content generation passes through: the proxy cannot be used to manage files, tuned models, caches ...
const ALLOWED_PATH = /^\/v1beta\/models\/[\w.-]+:(generateContent|streamGenerateContent|countTokens)$/;
// Videos are sent inline (base64), so a request can be large
const MAX_BODY_BYTES = 60 * 1024 * 1024;

// Every Gemini key, in order: GEMINI_API_KEY, then GEMINI_API_KEY_2, _3, ...
export function geminiKeys(env: Record<string, string | undefined>): string[] {
  return [env.GEMINI_API_KEY, ...Object.keys(env)
    .filter(name => /^GEMINI_API_KEY_\d+$/.test(name))
    .sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop()))
    .map(name => env[name])]
    .filter((key): key is string => typeof key === 'string' && !!key.trim())
    .map(key => key.trim());
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};
// Errors in Google's own shape, so the page's quota and key checks read them the same way
const sendError = (res: ServerResponse, code: number, status: string, message: string) =>
  sendJson(res, code, { error: { code, status, message } });

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Decides whether one request may use Gemini (server/api.ts: credits and passes). Without it, every request may.
export type Authorize = (req: IncomingMessage) => { ok: true } | { ok: false; status: number; reason: string; message: string };

// Connect-style middleware: handles /api/gemini/..., passes everything else to next()
export function createGeminiProxy(keys: string[], authorize?: Authorize) {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith(PROXY_PREFIX + '/')) { next?.(); return; }
    const path = url.pathname.slice(PROXY_PREFIX.length);

    // The page asks how many keys there are (never the keys themselves)
    if (path === '/status') { sendJson(res, 200, { keys: keys.length }); return; }
    if (req.method !== 'POST' || !ALLOWED_PATH.test(path)) {
      sendError(res, 404, 'NOT_FOUND', 'This request is not available.');
      return;
    }
    const slot = /^slot-(\d+)$/.exec(String(req.headers['x-goog-api-key'] || ''));
    const key = slot ? keys[Number(slot[1]) - 1] : undefined;
    if (!key) {
      sendError(res, 401, 'UNAUTHENTICATED', 'Scene building is not set up on this server yet.');
      return;
    }
    // countTokens costs nothing, so only generation is metered
    if (authorize && !path.endsWith(':countTokens')) {
      const verdict = authorize(req);
      if (verdict.ok === false) { sendError(res, verdict.status, verdict.reason, verdict.message); return; }
    }

    let body: Buffer;
    try { body = await readBody(req); } catch {
      sendError(res, 413, 'INVALID_ARGUMENT', 'The request is too large.');
      return;
    }

    // When the page gives up (its timeout, or a newer request), stop waiting on Google too
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });
    try {
      const upstream = await fetch(UPSTREAM + path + url.search, {
        method: 'POST',
        headers: { 'content-type': String(req.headers['content-type'] || 'application/json'), 'x-goog-api-key': key },
        body,
        signal: abort.signal,
      });
      res.statusCode = upstream.status;
      const type = upstream.headers.get('content-type');
      if (type) res.setHeader('content-type', type);
      if (upstream.body) for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
      res.end();
    } catch (error: any) {
      if (abort.signal.aborted) return;
      if (!res.headersSent) sendError(res, 502, 'UNAVAILABLE', `Could not reach the AI service: ${error?.message || error}`);
      else res.end();
    }
  };
}
