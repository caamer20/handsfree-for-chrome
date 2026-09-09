import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseCloud } from '../src/background/cloud-parser';
import { getApiKey, saveApiKey } from '../src/background/credentials';
import { providerEndpoint, type ProviderConfig, type Provider } from '../src/common/providers';
import { decodeCloudPlan } from '../src/common/ai-plan';
const config = (aiProvider: Provider): ProviderConfig => ({ aiProvider, aiModel: 'fixture-model', aiBaseUrl: 'https://llm.example/v1' });
const plan = { actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/', active: null } }] };
const output = JSON.stringify(plan);
const fixtures = {
  openai: { status: 'completed', output: [{ content: [{ type: 'output_text', text: output }] }] },
  anthropic: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'browser_plan', input: plan }] },
  gemini: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: output }] } }] },
  compatible: { choices: [{ finish_reason: 'stop', message: { content: output } }] },
};
let local: Record<string, unknown>;
const fetcher = vi.fn<typeof fetch>();
const contains = vi.fn(async () => true);
beforeEach(() => {
  vi.clearAllMocks(); local = {};
  vi.stubGlobal('chrome', { storage: { local: { get: async () => local, set: async (patch: Record<string, unknown>) => { Object.assign(local, patch); }, setAccessLevel: vi.fn() } }, permissions: { contains } });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(['openai', 'anthropic', 'gemini', 'compatible'] as const)('converts %s structured responses into executable, validated actions', async provider => {
  await saveApiKey(config(provider), 'fixture-secret');
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(fixtures[provider])));
  expect(await parseCloud(config(provider), 'open a new tab')).toEqual([{ action: 'create_tab', params: { url: 'chrome://newtab/' } }]);
  const [url, init] = fetcher.mock.calls[0] ?? [];
  expect(url).toBe(providerEndpoint(config(provider)).href);
  expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  expect(String(init?.body)).not.toContain('fixture-secret');
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  if (provider === 'openai') { expect(body).toMatchObject({ store: false, text: { format: { type: 'json_schema', strict: true } } }); expect(init?.headers).toHaveProperty('Authorization', 'Bearer fixture-secret'); }
  if (provider === 'anthropic') { expect(body).toMatchObject({ tool_choice: { type: 'tool', name: 'browser_plan' } }); expect(init?.headers).toHaveProperty('x-api-key', 'fixture-secret'); }
  if (provider === 'gemini') { expect(body).toMatchObject({ generationConfig: { responseFormat: { text: { mimeType: 'application/json' } } } }); expect(init?.headers).toHaveProperty('x-goog-api-key', 'fixture-secret'); }
  if (provider === 'compatible') expect(body).toMatchObject({ response_format: { type: 'json_object' }, stream: false });
});
it.each([401, 403, 429, 500, 400])('reports HTTP %s without echoing provider bodies or credentials', async status => {
  await saveApiKey(config('openai'), 'fixture-secret');
  fetcher.mockResolvedValueOnce(new Response('Your key fixture-secret failed', { status }));
  await expect(parseCloud(config('openai'), 'open a new tab')).rejects.toThrow(`HTTP ${status}`);
  fetcher.mockResolvedValueOnce(new Response('Your key fixture-secret failed', { status }));
  await expect(parseCloud(config('openai'), 'open a new tab')).rejects.not.toThrow('fixture-secret');
});
it('never sends a saved key to a changed compatible API host', async () => {
  await saveApiKey(config('compatible'), 'fixture-secret');
  expect(await getApiKey({ ...config('compatible'), aiBaseUrl: 'https://different.example/v1' })).toBeUndefined();
  await expect(parseCloud({ ...config('compatible'), aiBaseUrl: 'https://different.example/v1' }, 'open a new tab')).rejects.toThrow('Add your API key');
  expect(fetcher).not.toHaveBeenCalled();
});
it('requires optional host access before sending credentials', async () => {
  await saveApiKey(config('openai'), 'fixture-secret');
  contains.mockResolvedValueOnce(false);
  await expect(parseCloud(config('openai'), 'open a new tab')).rejects.toThrow('API access is not allowed');
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects invented destinations, unsupported actions, and incomplete output', async () => {
  await saveApiKey(config('compatible'), 'fixture-secret');
  const answer = (content: unknown, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: JSON.stringify(content) } }] }));
  fetcher.mockResolvedValueOnce(answer({ actions: [{ action: 'create_tab', params: { url: 'https://unrequested.example/' } }] }));
  await expect(parseCloud(config('compatible'), 'open a new tab')).rejects.toThrow('invented a destination');
  fetcher.mockResolvedValueOnce(answer({ actions: [{ action: 'run_script', params: { code: 'alert(1)' } }] }));
  await expect(parseCloud(config('compatible'), 'open a new tab')).rejects.toThrow('invalid action plan');
  fetcher.mockResolvedValueOnce(answer(plan, 'length'));
  await expect(parseCloud(config('compatible'), 'open a new tab')).rejects.toThrow('did not finish');
});
it('times out stalled inference and aborts its fetch', async () => {
  vi.useFakeTimers(); await saveApiKey(config('openai'), 'fixture-secret');
  fetcher.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }));
  const result = expect(parseCloud(config('openai'), 'open a new tab')).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(25_001); await result;
  expect(vi.getTimerCount()).toBe(0);
});
it('rejects oversized responses and unsafe endpoints', async () => {
  await saveApiKey(config('openai'), 'fixture-secret');
  fetcher.mockResolvedValueOnce(new Response('too big', { headers: { 'content-length': '900000' } }));
  await expect(parseCloud(config('openai'), 'open a new tab')).rejects.toThrow('too large');
  for (const aiBaseUrl of ['http://llm.example', 'https://user:pass@llm.example', 'https://llm.example?key=secret']) expect(() => providerEndpoint({ ...config('compatible'), aiBaseUrl })).toThrow('HTTPS');
});
it('accepts JSON wrappers and strips nullable unused params without weakening action validation', () => {
  expect(decodeCloudPlan('```json\n' + output + '\n```')).toEqual([{ action: 'create_tab', params: { url: 'chrome://newtab/' } }]);
  expect(() => decodeCloudPlan({ actions: [] })).toThrow('could not map');
  expect(() => decodeCloudPlan({ actions: [{ action: 'zoom', params: { mode: 'set', factor: null } }] })).toThrow('invalid action plan');
});
