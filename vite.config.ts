import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __LOCAL_AI_AVAILABLE__: JSON.stringify(mode === 'local-ai') },
  resolve: { alias: mode === 'local-ai' ? [] : [{ find: /^\.\/local-model$/, replacement: resolve('src/offscreen/local-model-unavailable.ts') }] },
  build: {
    outDir: mode === 'local-ai' ? 'dist-local-ai' : 'dist',
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
}));
