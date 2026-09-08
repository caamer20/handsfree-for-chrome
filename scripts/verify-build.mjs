import assert from 'node:assert/strict';
import { readFile, access, glob } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, 'HandsFree for Chrome');
assert(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"));
assert(!manifest.content_security_policy.extension_pages.includes('https:'));
for (const file of [manifest.background.service_worker, manifest.action.default_popup, 'content.js', ...Object.values(manifest.icons)]) await access(`dist/${file}`);
for await (const file of glob('dist/**/*.html')) {
  const html = await readFile(file, 'utf8');
  assert(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), `Inline script in ${file}`);
  assert(!/\son\w+=/i.test(html), `Inline handler in ${file}`);
}
console.log('MV3 package verified: local scripts, strict CSP, all entry points and icons present.');
