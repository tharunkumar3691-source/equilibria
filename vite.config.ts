import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createApi } from './server/api.ts';

// Serves /api/... (credits, PayPal, and the Gemini proxy) from the dev and preview servers. The Gemini
// keys and the PayPal secret stay on the server: none is written into the page's code.
// (In production, server/index.ts does the same.)
const serverApi = (env: Record<string, string>): Plugin => {
  let api: ReturnType<typeof createApi> | null = null;
  const middleware = (req: any, res: any, next: () => void) => (api ??= createApi(env)).middleware(req, res, next);
  return {
    name: 'equilibria-api',
    configureServer: server => { server.middlewares.use(middleware); },
    configurePreviewServer: server => { server.middlewares.use(middleware); },
  };
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss(), serverApi(env)],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
