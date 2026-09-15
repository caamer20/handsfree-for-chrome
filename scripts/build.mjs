import { build } from 'vite';
import { cp, mkdir, readFile, writeFile, glob } from 'node:fs/promises';
const localAi = process.argv.includes('--local-ai');
const outDir = localAi ? 'dist-local-ai' : 'dist';
await build({ mode: localAi ? 'local-ai' : 'production' });
await build({ configFile: false, build: { outDir, emptyOutDir: false, target: 'es2022', lib: { entry: 'src/content/index.ts', name: 'HandsFreeHUD', formats: ['iife'], fileName: () => 'content.js' } } });
const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
if (!localAi) {
  manifest.content_security_policy.extension_pages = "script-src 'self'; object-src 'self'; connect-src 'self' https:;";
  delete manifest.cross_origin_embedder_policy;
  delete manifest.cross_origin_opener_policy;
}
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(`${outDir}/build-info.json`, JSON.stringify({ edition: localAi ? 'local-ai' : 'standard', version: manifest.version }) + '\n');
// The persistent panel and popup share one implementation and one relative-asset layout.
await cp(`${outDir}/src/popup/popup.html`, `${outDir}/src/popup/sidepanel.html`);
if (localAi) {
  await mkdir(`${outDir}/models`, { recursive: true });
  await cp('models/smollm2-135m-quant', `${outDir}/models/smollm2-135m-quant`, { recursive: true });
  await mkdir(`${outDir}/ort`, { recursive: true });
  // Executable runtime assets always ship locally with the optional edition.
  for await (const file of glob('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*')) {
    if (/\.(wasm|mjs)$/.test(file)) await cp(file, `${outDir}/ort/${file.split('/').at(-1)}`);
  }
}
console.log(`Built ${localAi ? 'optional local-AI' : 'lightweight standard'} edition in ${outDir}/`);
