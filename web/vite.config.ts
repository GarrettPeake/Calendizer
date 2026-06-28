import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The playground imports the Calendizer library directly from ../src so it stays
// live against the real solver. esbuild transpiles the TS sources on the fly.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      calendizer: path.resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    fs: {
      // allow importing the library source that lives outside the web/ root
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
