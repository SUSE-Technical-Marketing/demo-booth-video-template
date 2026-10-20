import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// The interactive page the Export dialog packages next to a video. scripts/build-player.mjs then folds the script,
// styles, font and logo into the single dist-player/player.html, which keeps working when opened from a folder.
export default defineConfig({
  root: 'editor',
  base: './',
  plugins: [vue()],
  build: {
    outDir: '../dist-player',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { input: resolve(import.meta.dirname, 'editor/player.html') },
  },
});
