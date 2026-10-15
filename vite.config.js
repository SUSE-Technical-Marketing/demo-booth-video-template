import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'editor',
  base: './',
  plugins: [vue()],
  // The Export dialog talks to the local export service (render/server.py); /api is proxied so the page stays same-origin.
  server: { host: '127.0.0.1', port: 8765, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8766' } },
  preview: { host: '127.0.0.1', port: 8765, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8766' } },
  build: { outDir: '../dist', emptyOutDir: true },
  test: { environment: 'jsdom', include: ['src/**/*.test.js'], restoreMocks: true },
});
