import assert from 'node:assert/strict';
import { readFile, access, glob, stat } from 'node:fs/promises';
export const outDir = process.argv.includes('--local-ai') ? 'dist-local-ai' : 'dist';
const manifest = JSON.parse(await readFile(`${outDir}/manifest.json`, 'utf8'));
const info = JSON.parse(await readFile(`${outDir}/build-info.json`, 'utf8'));
const localAi = info.edition === 'local-ai';
assert.equal(info.edition, outDir === 'dist' ? 'standard' : 'local-ai');
assert.equal(info.version, manifest.version);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(manifest.version, pkg.version, 'Built extension version differs from package.json');
assert.equal(lock.version, pkg.version, 'Lockfile root version differs');
assert.equal(lock.packages[''].version, pkg.version, 'Lockfile package version differs');
for (const [name, entry] of Object.entries(lock.packages)) {
  if (name && entry.resolved?.startsWith('https://registry.npmjs.org/')) assert(new URL(entry.resolved).pathname.endsWith(`-${entry.version}.tgz`), `Lockfile version does not match the pinned archive: ${name}`);
}
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, 'HandsFree for Chrome');
assert(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
assert.equal(manifest.content_security_policy.extension_pages.split(';')[0], localAi ? "script-src 'self' 'wasm-unsafe-eval'" : "script-src 'self'");
assert(!manifest.host_permissions?.length);
assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*']);
assert.deepEqual(manifest.optional_permissions, ['topSites']);
assert(manifest.permissions.includes('tabGroups') && manifest.permissions.includes('readingList'));
for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.side_panel?.default_path ?? 'src/popup/sidepanel.html', 'content.js', ...Object.values(manifest.icons)]) await access(`${outDir}/${file}`);
for await (const file of glob(`${outDir}/**/*.html`)) {
  const html = await readFile(file, 'utf8');
  assert(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), `Inline script in ${file}`);
  assert(!/\son\w+=/i.test(html), `Inline handler in ${file}`);
}
let bytes = 0;
for await (const file of glob(`${outDir}/**/*`)) {
  const details = await stat(file); if (!details.isFile()) continue;
  bytes += details.size;
  if (/\.(js|html)$/.test(file)) assert(!/__handsfreeTestSpeech|developerPrivate|playwright/i.test(await readFile(file, 'utf8')), `Test-only code leaked into package: ${file}`);
  if (!localAi) assert(!/\.(onnx|wasm|mjs)$/.test(file) && !/\/(ort|models)\//.test(file), `AI runtime leaked into standard edition: ${file}`);
}
if (localAi) {
  for (const name of ['model_q4.onnx', 'model_quantized.onnx']) await access(`${outDir}/models/smollm2-135m-quant/onnx/${name}`);
} else assert(bytes < 5 * 1024 * 1024, 'Standard edition exceeds its 5 MiB unpacked size budget');
console.log(`MV3 ${info.edition} package verified: local scripts, strict CSP, all entry points; ${(bytes / 1024 / 1024).toFixed(2)} MiB unpacked.`);
