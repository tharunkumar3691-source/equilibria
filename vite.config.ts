import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createGeminiProxy, geminiKeys } from './server/geminiProxy.ts';

// Serves /api/gemini/... from the dev and preview servers. The Gemini keys stay on the server: none is
// written into the page's code. (In production, server/index.ts does the same.)
const geminiProxy = (keys: string[]): Plugin => {
  const proxy = createGeminiProxy(keys);
  return {
    name: 'gemini-proxy',
    configureServer: server => { server.middlewares.use(proxy); },
    configurePreviewServer: server => { server.middlewares.use(proxy); },
  };
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss(), geminiProxy(geminiKeys(env))],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
