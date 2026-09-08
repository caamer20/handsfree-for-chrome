import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
await import('./verify-build.mjs');
await access('dist/models/smollm2-135m-quant/onnx/model_q4.onnx');
await access('dist/models/smollm2-135m-quant/onnx/model_quantized.onnx');
await mkdir('release', { recursive: true });
const zip = resolve('release/handsfree-for-chrome.zip');
// A fresh archive avoids retaining files removed by a later build.
const { rm } = await import('node:fs/promises');
await rm(zip, { force: true });
execFileSync('zip', ['-q', '-r', zip, '.', '-x', '*.DS_Store', '*/.gitkeep'], { cwd: resolve('dist') });
const data = await readFile(zip);
const sha = createHash('sha256').update(data).digest('hex');
await writeFile('release/SHA256SUMS', `${sha}  handsfree-for-chrome.zip\n`);
console.log(`Created ${zip} (${(data.length / 1024 / 1024).toFixed(1)} MiB)\nSHA256: ${sha}`);
