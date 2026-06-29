import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The playground imports the Calendizer library's TYPES directly from ../src.
// API/feed requests are proxied to the Worker (`wrangler dev` on :8787) in
// development; in production the Worker serves this built SPA and the API itself.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      calendizer: path.resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    fs: { allow: [path.resolve(__dirname, '..')] },
    proxy: {
      '/api': 'http://localhost:8787',
      '/feed': 'http://localhost:8787',
    },
  },
});
