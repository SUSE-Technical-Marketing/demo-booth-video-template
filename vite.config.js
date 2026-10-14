import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'editor',
  base: './',
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 8765, strictPort: true },
  preview: { host: '127.0.0.1', port: 8765, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true },
  test: { environment: 'jsdom', include: ['src/**/*.test.js'], restoreMocks: true },
});
