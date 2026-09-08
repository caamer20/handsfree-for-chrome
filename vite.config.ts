import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        background: resolve('src/background/index.ts'),
        popup: resolve('src/popup/popup.html'),
        offscreen: resolve('src/offscreen/offscreen.html'),
        onboarding: resolve('src/popup/onboarding.html'),
      },
      output: { entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js' },
    },
  },
});
