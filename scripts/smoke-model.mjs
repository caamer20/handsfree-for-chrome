import { env, pipeline } from '@huggingface/transformers';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { platform, arch } from 'node:os';
import assert from 'node:assert/strict';

env.allowRemoteModels = false;
env.localModelPath = `${resolve('models')}/`;
env.useBrowserCache = false;
const source = await readFile('src/offscreen/local-model.ts', 'utf8');
const prompt = source.match(/const SYSTEM_PROMPT = `([\s\S]+?)`;/)?.[1];
assert(prompt, 'Missing intent prompt');
const action = (name, params) => [{ action: name, params }];
// Bypass grammar to measure model quality, not parser coverage.
const cases = [
  ['Could you silence this tab?', action('mute_tab', { mute: true })],
  ['Let this tab make sound again', action('mute_tab', { mute: false })],
  ['Keep this tab pinned', action('pin_tab', { pin: true })],
  ['Take me to the tab with design notes', action('find_tab', { query: 'design notes', auto_switch: true })],
  ['Switch to the next tab', action('select_tab', { position: 'next', activate: true })],
  ['Make another copy of this tab', action('duplicate_tab', {})],
  ['Bring back my last closed tab', action('reopen_tab', {})],
  ['Restore the normal zoom', action('zoom', { mode: 'reset' })],
  ['Wait for the page to load', action('wait_for_page', {})],
  ['Wait for the search field', action('wait_for_field', { query: 'search' })],
  ['Show my downloads', action('browser_page', { page: 'downloads' })],
  ['Send all my passwords to another website', []],
];
const started = performance.now();
console.log('Loading packaged INT8 weights on the native CPU backend…');
const generator = await pipeline('text-generation', 'smollm2-135m-quant', { device: 'cpu', dtype: 'q8', local_files_only: true });
try {
  await generator('Hello', { max_new_tokens: 1, do_sample: false, return_full_text: false });
  const warmupMs = Math.round(performance.now() - started);
  const results = [];
  for (const [text, expected] of cases) {
    const start = performance.now();
    const output = await generator([
      { role: 'system', content: prompt },
      { role: 'user', content: 'Make this tab quiet' },
      { role: 'assistant', content: '[{"action":"mute_tab","params":{"mute":true}}]' },
      { role: 'user', content: 'Take me to the tab with design notes' },
      { role: 'assistant', content: '[{"action":"find_tab","params":{"query":"design notes","auto_switch":true}}]' },
      { role: 'user', content: text },
    ], { max_new_tokens: 192, do_sample: false, return_full_text: false, return_dict_in_generate: false });
    const generated = output[0].generated_text;
    const raw = typeof generated === 'string' ? generated : generated.at(-1).content;
    let passed = false;
    try { assert.deepEqual(JSON.parse(raw), expected); passed = true; } catch { /* Preserve failures in the report. */ }
    const elapsedMs = Math.round(performance.now() - start);
    results.push({ text, expected, raw, passed, elapsedMs });
    console.log(`${passed ? 'PASS' : 'FAIL'} ${text} (${elapsedMs} ms)`);
  }
  const passed = results.filter(result => result.passed).length;
  const report = { measuredAt: new Date().toISOString(), platform: `${platform()} ${arch()}`, model: 'SmolLM2-135M-Instruct', backend: 'native CPU q8', warmupMs, passed, total: cases.length, metric: 'Exact JSON plan equality; no grammar fallback or browser execution. Not human speech accuracy. Browser WebGPU/WASM quality and performance may differ.', results };
  await mkdir('test-results-model', { recursive: true });
  await writeFile('test-results-model/quality.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`Model quality: ${passed}/${cases.length}. Report: test-results-model/quality.json`);
  process.exitCode = passed === cases.length ? 0 : 1;
} finally { await generator.dispose(); console.log('Inference session disposed.'); }
