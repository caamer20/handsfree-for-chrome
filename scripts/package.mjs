import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const { outDir } = await import('./verify-build.mjs');
const name = outDir === 'dist' ? 'handsfree-for-chrome.zip' : 'handsfree-for-chrome-local-ai.zip';
await mkdir('release', { recursive: true });
const zip = resolve(`release/${name}`);
// A fresh archive avoids retaining files removed by a later build.
const { rm } = await import('node:fs/promises');
await rm(zip, { force: true });
execFileSync('zip', ['-q', '-r', zip, '.', '-x', '*.DS_Store', '*/.gitkeep'], { cwd: resolve(outDir) });
const data = await readFile(zip);
const sha = createHash('sha256').update(data).digest('hex');
const previous = await readFile('release/SHA256SUMS', 'utf8').catch(() => '');
const entries = previous.trim().split('\n').filter(line => line && !line.endsWith(`  ${name}`));
entries.push(`${sha}  ${name}`);
await writeFile('release/SHA256SUMS', entries.sort().join('\n') + '\n');
console.log(`Created ${zip} (${(data.length / 1024 / 1024).toFixed(1)} MiB)\nSHA256: ${sha}`);
