// Production server: serves the built app from dist/, the API (credits, PayPal) and the Gemini proxy, so the
// keys stay here. Run `npm run build`, then `npm start`. Keys come from the environment or from .env.local.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createApi } from './api.ts';

try { process.loadEnvFile('.env.local'); } catch {} // Optional: the host's environment may set the keys instead

const DIST = resolve('dist');
const ASSETS = join(DIST, 'assets') + sep;
const PORT = Number(process.env.PORT) || 3000;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};

const { middleware: api, keys, paypalReady, webhookReady, flush } = createApi(process.env);

// A file from dist/, or index.html for any other page address (including malformed ones)
async function serveStatic(pathname: string): Promise<{ file: string; data: Buffer }> {
  let decoded = '';
  try { decoded = decodeURIComponent(pathname); } catch {}
  const file = join(DIST, normalize(decoded).replace(/^([/\\]|\.\.)+/, ''));
  if (file.startsWith(DIST + sep)) {
    try { if ((await stat(file)).isFile()) return { file, data: await readFile(file) }; } catch {}
  }
  const index = join(DIST, 'index.html');
  return { file: index, data: await readFile(index) };
}

const server = createServer((req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  api(req, res, async () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end();
      return;
    }
    try {
      const { file, data } = await serveStatic(new URL(req.url || '/', 'http://localhost').pathname);
      res.setHeader('content-type', TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
      // Built assets have hashed names and never change; index.html must always be fresh
      res.setHeader('cache-control', file.startsWith(ASSETS) ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.statusCode = 500;
      res.end('The app has not been built. Run `npm run build` first.');
    }
  });
});
server.listen(PORT, () => {
  console.log(`Equilibria on http://localhost:${PORT} (${keys.length} Gemini key${keys.length === 1 ? '' : 's'}, PayPal sandbox ${paypalReady ? `ready${webhookReady ? ' with webhook' : ''}` : 'not configured'})`);
});

// Hosts stop the service with SIGTERM on every redeploy: write any pending balances, then close
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
