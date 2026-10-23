// Production server: serves the built app from dist/ and the Gemini proxy, so the API key stays here.
// Run `npm run build`, then `npm start`. Keys come from the environment or from .env.local.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createGeminiProxy, geminiKeys } from './geminiProxy.ts';

try { process.loadEnvFile('.env.local'); } catch {} // Optional: the host's environment may set the keys instead

const DIST = resolve('dist');
const PORT = Number(process.env.PORT) || 3000;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

const keys = geminiKeys(process.env);
const proxy = createGeminiProxy(keys);

// A file from dist/, or index.html for any other page address
async function serveStatic(pathname: string): Promise<{ file: string; data: Buffer }> {
  const file = join(DIST, normalize(decodeURIComponent(pathname)).replace(/^([/\\]|\.\.)+/, ''));
  if (file.startsWith(DIST)) {
    try { if ((await stat(file)).isFile()) return { file, data: await readFile(file) }; } catch {}
  }
  const index = join(DIST, 'index.html');
  return { file: index, data: await readFile(index) };
}

createServer((req, res) => {
  proxy(req, res, async () => {
    try {
      const { file, data } = await serveStatic(new URL(req.url || '/', 'http://localhost').pathname);
      res.setHeader('content-type', TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
      // Built assets have hashed names and never change; index.html must always be fresh
      res.setHeader('cache-control', file.includes(`${join(DIST, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.end(data);
    } catch {
      res.statusCode = 500;
      res.end('The app has not been built. Run `npm run build` first.');
    }
  });
}).listen(PORT, () => {
  console.log(`Equilibria on http://localhost:${PORT} (${keys.length} Gemini key${keys.length === 1 ? '' : 's'})`);
});
