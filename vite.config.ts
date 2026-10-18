import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Every Gemini key, in order: GEMINI_API_KEY, then GEMINI_API_KEY_2, _3, ... The app moves on to the
    // next one when a key runs out of quota.
    const keys = [env.GEMINI_API_KEY, ...Object.keys(env)
        .filter(name => /^GEMINI_API_KEY_\d+$/.test(name))
        .sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop()))
        .map(name => env[name])]
        .filter(key => typeof key === 'string' && key.trim())
        .map(key => key.trim());
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(keys[0] || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(keys[0] || ''),
        'process.env.API_KEYS': JSON.stringify(keys)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
