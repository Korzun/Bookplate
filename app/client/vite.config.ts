import path from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apiUrl = process.env['API_URL'] ?? 'http://localhost:3000';

/**
 * Keeps the browser's (or agent's) `Host` header — vite's string shorthand
 * would rewrite it to the API server's own, e.g. `server:3000` under docker.
 */
const keepHost = { target: apiUrl, changeOrigin: false };

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
      // The GraphQL endpoint the Apollo client migration will talk to —
      // same target as `/api`, same reasoning: dev serves the SPA off
      // vite's own port, so API/GraphQL calls need a same-origin proxy to
      // reach the real server. This entry is config-only (the plan's one
      // sanctioned client-side touch for this task); no client code
      // consumes it yet.
      '/graphql': apiUrl,
      // The MCP endpoint and its OAuth sign-in, so an agent can be pointed at
      // this dev port — the address the settings page shows it. The server
      // builds every URL it hands an agent from the request's Host, so these
      // forward it unchanged (`keepHost`): each advertised URL then lands back
      // here rather than on a hostname only the API server knows.
      // `/oauth/consent` is deliberately NOT in the list: it is a client
      // route vite serves.
      '/mcp': keepHost,
      '/.well-known/oauth-protected-resource': keepHost,
      '/.well-known/oauth-authorization-server': keepHost,
      '^/oauth/(authorize|token|register|revoke)': keepHost,
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
