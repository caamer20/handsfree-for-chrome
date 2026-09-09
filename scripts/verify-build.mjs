import assert from 'node:assert/strict';
import { readFile, access, glob } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
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
assert.equal(manifest.content_security_policy.extension_pages.split(';')[0], "script-src 'self' 'wasm-unsafe-eval'");
assert(!manifest.host_permissions?.length);
assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*']);
assert.deepEqual(manifest.optional_permissions, ['topSites']);
assert(manifest.permissions.includes('tabGroups') && manifest.permissions.includes('readingList'));
for (const file of [manifest.background.service_worker, manifest.action.default_popup, 'content.js', ...Object.values(manifest.icons)]) await access(`dist/${file}`);
for await (const file of glob('dist/**/*.html')) {
  const html = await readFile(file, 'utf8');
  assert(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), `Inline script in ${file}`);
  assert(!/\son\w+=/i.test(html), `Inline handler in ${file}`);
}
console.log('MV3 package verified: local scripts, strict CSP, all entry points and icons present.');
