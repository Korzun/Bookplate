import path from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

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
