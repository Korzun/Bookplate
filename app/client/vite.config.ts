import path from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apiUrl = process.env['API_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': apiUrl,
      '/logout': apiUrl,
      // The GraphQL endpoint the Apollo client migration will talk to —
      // same target as `/api`, same reasoning: dev serves the SPA off
      // vite's own port, so API/GraphQL calls need a same-origin proxy to
      // reach the real server. This entry is config-only (the plan's one
      // sanctioned client-side touch for this task); no client code
      // consumes it yet.
      '/graphql': apiUrl,
    },
    watch: process.env['DOCKER'] ? { usePolling: true } : {},
    host: true,
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setup.ts'],
  },
});
