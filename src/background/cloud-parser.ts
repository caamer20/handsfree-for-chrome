import { CLOUD_PROMPT, PLAN_SCHEMA, decodeCloudPlan } from '../common/ai-plan';
import { PROVIDER_LABELS, providerEndpoint, providerOrigin, validateProvider, type ProviderConfig } from '../common/providers';
import type { ChromeAction } from '../common/schema';
import { validateGrounding } from '../offscreen/grounding';
import { getApiKey } from './credentials';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const textOf = (value: unknown): string => typeof value === 'string' ? value : '';
const LIMIT = 256 * 1024;
function payload(config: ProviderConfig, transcript: string, key: string): { headers: Record<string, string>; body: Json } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  switch (config.aiProvider) {
    case 'openai':
      headers.Authorization = `Bearer ${key}`;
      return { headers, body: { model: config.aiModel, instructions: CLOUD_PROMPT, input: transcript, store: false, max_output_tokens: 4096, text: { format: { type: 'json_schema', name: 'browser_plan', strict: true, schema: PLAN_SCHEMA } } } };
    case 'anthropic':
      headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; headers['anthropic-dangerous-direct-browser-access'] = 'true';
      return { headers, body: { model: config.aiModel, max_tokens: 4096, system: CLOUD_PROMPT, messages: [{ role: 'user', content: transcript }], tools: [{ name: 'browser_plan', description: 'Return the complete ordered browser action plan for the user command. Only supported Chrome actions are accepted. The extension validates and executes this plan.', input_schema: PLAN_SCHEMA }], tool_choice: { type: 'tool', name: 'browser_plan' } } };
    case 'gemini':
      headers['x-goog-api-key'] = key;
      return { headers, body: { systemInstruction: { parts: [{ text: CLOUD_PROMPT }] }, contents: [{ role: 'user', parts: [{ text: transcript }] }], generationConfig: { maxOutputTokens: 4096, responseFormat: { text: { mimeType: 'application/json', schema: PLAN_SCHEMA } } } } };
    case 'compatible':
      headers.Authorization = `Bearer ${key}`;
      return { headers, body: { model: config.aiModel, messages: [{ role: 'system', content: `${CLOUD_PROMPT}\nJSON schema: ${JSON.stringify(PLAN_SCHEMA)}` }, { role: 'user', content: transcript }], response_format: { type: 'json_object' }, max_tokens: 4096, stream: false } };
    case 'local': throw new Error('Select an API provider in Settings.');
  }
}
function extract(config: ProviderConfig, value: unknown): unknown {
  const data = object(value);
  switch (config.aiProvider) {
    case 'openai': {
      if (data.status === 'incomplete' || data.status === 'failed') throw new Error('The AI response was incomplete. Choose another model or shorten the command.');
      return array(data.output).flatMap(item => array(object(item).content)).filter(item => object(item).type === 'output_text').map(item => textOf(object(item).text)).join('');
    }
    case 'anthropic': {
      if (data.stop_reason === 'max_tokens') throw new Error('The AI response was incomplete. Choose another model or shorten the command.');
      const calls = array(data.content).filter(item => object(item).type === 'tool_use' && object(item).name === 'browser_plan');
      if (calls.length !== 1) throw new Error('The AI did not return one complete browser plan. Try again.');
      return object(calls[0]).input;
    }
    case 'gemini': {
      const candidate = object(array(data.candidates)[0]);
      if (candidate.finishReason && candidate.finishReason !== 'STOP') throw new Error('The AI could not complete that command. Try another phrase or model.');
      return array(object(candidate.content).parts).filter(item => !object(item).thought).map(item => textOf(object(item).text)).join('');
    }
    case 'compatible': {
      const choice = object(array(data.choices)[0]);
      if (choice.finish_reason && choice.finish_reason !== 'stop') throw new Error('The AI did not finish a browser plan. Try another phrase or model.');
      return object(choice.message).content;
    }
    case 'local': return undefined;
  }
}
async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > LIMIT) { await response.body?.cancel().catch(() => undefined); throw new Error('The AI response was too large.'); }
  if (!response.body) throw new Error('The API returned an empty response.');
  const reader = response.body.getReader(); let bytes = 0; let raw = ''; const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > LIMIT) throw new Error('The AI response was too large.');
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  try { return JSON.parse(raw) as unknown; } catch { throw new Error('The API returned invalid JSON. Check the provider and base URL.'); }
}
export async function parseCloud(config: ProviderConfig, transcript: string, signal?: AbortSignal): Promise<ChromeAction[]> {
  validateProvider(config);
  const key = await getApiKey(config);
  if (!key) throw new Error('Add your API key in Settings, then save preferences.');
  if (!(await chrome.permissions.contains({ origins: [providerOrigin(config)] }))) throw new Error('API access is not allowed. Open Settings and save preferences to grant access.');
  const controller = new AbortController(); let timedOut = false;
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25_000);
  try {
    const request = payload(config, transcript, key);
    let response: Response;
    try {
      response = await fetch(providerEndpoint(config).href, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch { throw new Error(controller.signal.aborted ? timedOut ? 'The AI provider timed out. Try again.' : 'Command cancelled.' : 'Could not reach the AI provider. Check your connection, API address, and access permission.'); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const reason = response.status === 401 || response.status === 403 ? 'Check your API key and model access.' : response.status === 429 ? 'Rate limit or quota reached. Check your provider billing and try later.' : response.status === 400 || response.status === 404 ? 'Check the model ID and whether it supports structured responses.' : 'Try again shortly.';
      throw new Error(`${PROVIDER_LABELS[config.aiProvider]} returned HTTP ${response.status}. ${reason}`);
    }
    let value: unknown;
    try { value = await readJson(response); }
    catch (error) { if (controller.signal.aborted) throw new Error(timedOut ? 'The AI provider timed out. Try again.' : 'Command cancelled.'); throw error; }
    if (controller.signal.aborted) throw new Error('Command cancelled.');
    return validateGrounding(decodeCloudPlan(extract(config, value)), transcript);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
