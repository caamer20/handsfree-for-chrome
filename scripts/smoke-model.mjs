import { env, pipeline } from '@huggingface/transformers';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

env.allowRemoteModels = false;
env.localModelPath = `${resolve('models')}/`;
env.useBrowserCache = false;
const source = await readFile('src/offscreen/intent-parser.ts', 'utf8');
const prompt = source.match(/const SYSTEM_PROMPT = `([\s\S]+?)`;/)?.[1];
assert(prompt, 'Missing intent prompt');
const started = performance.now();
console.log('Loading the packaged INT8 model on the native CPU backend…');
const generator = await pipeline('text-generation', 'smollm2-135m-quant', { device: 'cpu', dtype: 'q8', local_files_only: true });
try {
  await generator('Hello', { max_new_tokens: 1, do_sample: false, return_full_text: false });
  console.log(`Model warmed in ${Math.round(performance.now() - started)}ms`);
  const output = await generator([
    { role: 'system', content: prompt },
    { role: 'user', content: 'Make this tab quiet' },
    { role: 'assistant', content: '[{"action":"mute_tab","params":{"mute":true}}]' },
    { role: 'user', content: 'Take me to the tab with design notes' },
    { role: 'assistant', content: '[{"action":"find_tab","params":{"query":"design notes","auto_switch":true}}]' },
    { role: 'user', content: 'Could you silence this tab?' },
  ], { max_new_tokens: 192, do_sample: false, return_full_text: false, return_dict_in_generate: false });
  const generated = output[0].generated_text;
  const text = typeof generated === 'string' ? generated : generated.at(-1).content;
  console.log('Generated plan:', text);
  let semanticMatch = false;
  try { assert.deepEqual(JSON.parse(text), [{ action: 'mute_tab', params: { mute: true } }]); semanticMatch = true; } catch { /* Record the model limitation without an uncaught native-runtime error. */ }
  console.log(`Weight loading and inference: PASS. Semantic evaluation: ${semanticMatch ? 'PASS' : 'FAIL (experimental model; output must not auto-execute)'}.`);
  process.exitCode = semanticMatch ? 0 : 1;
} finally { await generator.dispose(); console.log('Inference session disposed.'); }
