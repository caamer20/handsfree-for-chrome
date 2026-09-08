import { build } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
await build();
await build({ configFile: false, build: { emptyOutDir: false, target: 'es2022', lib: { entry: 'src/content/index.ts', name: 'HandsFreeHUD', formats: ['iife'], fileName: () => 'content.js' } } });
await cp('src/manifest.json', 'dist/manifest.json');
await mkdir('dist/models', { recursive: true });
await cp('models/smollm2-135m-quant', 'dist/models/smollm2-135m-quant', { recursive: true });
await mkdir('dist/ort', { recursive: true });
// Executable ONNX runtime assets must ship with MV3, never come from a CDN.
const { glob } = await import('node:fs/promises');
for await (const file of glob('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*')) {
  if (/\.(wasm|mjs)$/.test(file)) await cp(file, `dist/ort/${file.split('/').at(-1)}`);
}
