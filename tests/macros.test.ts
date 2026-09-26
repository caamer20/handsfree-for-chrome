import { beforeEach, expect, it, vi } from 'vitest';
import { findMacro, macroSchema, macrosSchema, normalizeMacroPhrase, upsertMacro } from '../src/common/macros';
import { dispatchMacro } from '../src/background/dispatcher';
import { emptyConversation } from '../src/common/conversation';
import { defaultSettings } from '../src/common/schema';
import type { ExecutionEnvironment } from '../src/background/execution';
const morning = { id: '30ad795c-a2d9-4185-8f46-470d611a6d6c', name: 'Daily morning', phrase: 'Open up my daily morning sites', urls: ['https://mail.google.com/', 'https://calendar.google.com/'] };

it('matches the complete custom phrase despite case, punctuation and polite framing', () => {
  expect(findMacro([morning], 'PLEASE, open up my DAILY morning sites!')).toBe(morning);
  expect(findMacro([morning], 'Could you open up my daily morning sites please?')).toBe(morning);
  expect(findMacro([morning], 'Do not open up my daily morning sites')).toBeUndefined();
  expect(findMacro([morning], 'open up my daily morning sites then close tab')).toBeUndefined();
  expect(findMacro([morning], 'morning sites')).toBeUndefined();
  expect(normalizeMacroPhrase('Open   my sites.')).toBe('open my sites');
});
it('normalizes bare domains and keeps the user’s site order', () => {
  expect(macroSchema.parse({ ...morning, urls: ['calendar.google.com', ' https://mail.google.com/ '] }).urls).toEqual(['https://calendar.google.com/', 'https://mail.google.com/']);
});
it.each(['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', 'chrome://settings', 'https://user:password@example.com', 'not a website'])('rejects unsafe or invalid macro URL %s', url => {
  expect(macroSchema.safeParse({ ...morning, urls: [url] }).success).toBe(false);
});
it('rejects empty macros, duplicate sites, punctuation-only triggers and oversized collections', () => {
  expect(macroSchema.safeParse({ ...morning, urls: [] }).success).toBe(false);
  expect(macroSchema.safeParse({ ...morning, urls: ['example.com', 'https://example.com/'] }).success).toBe(false);
  expect(macroSchema.safeParse({ ...morning, phrase: '!!!' }).success).toBe(false);
  expect(macroSchema.safeParse({ ...morning, urls: Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`) }).success).toBe(false);
  expect(macrosSchema.safeParse(Array.from({ length: 51 }, (_, i) => ({ ...morning, id: crypto.randomUUID(), phrase: `Routine ${i}` }))).success).toBe(false);
});
it('rejects normalized phrase collisions and updates only the selected macro', () => {
  const second = { ...morning, id: crypto.randomUUID(), name: 'Evening', phrase: 'Start my evening' };
  expect(() => upsertMacro([morning], { ...second, phrase: 'Open up my daily morning sites!' })).toThrow('already uses');
  const next = upsertMacro([morning, second], { ...morning, name: 'Morning work', urls: ['https://example.com/'] });
  expect(next).toHaveLength(2); expect(next[0]?.urls).toEqual(['https://example.com/']); expect(next[1]).toEqual(second);
});

const create = vi.fn<() => Promise<Partial<chrome.tabs.Tab>>>(async () => ({ id: 10, windowId: 9 }));
beforeEach(() => { vi.resetAllMocks(); create.mockResolvedValue({ id: 10, windowId: 9 }); vi.stubGlobal('chrome', { tabs: { create } }); });
it('opens more than eight macro sites in order in the original window, selecting only the first', async () => {
  const urls = Array.from({ length: 12 }, (_, i) => `https://example.com/${i}`);
  const result = await dispatchMacro({ ...morning, urls }, { tabId: 1, windowId: 9 });
  expect(create.mock.calls).toEqual(urls.map((url, i) => [{ url, windowId: 9, active: i === 0 }]));
  expect(result.text).toBe('Daily morning · Opened 12 sites');
  expect(result.context).toEqual({ tabId: 10, windowId: 9 });
});
it('validates every URL before the first side effect', async () => {
  await expect(dispatchMacro({ ...morning, urls: ['https://example.com', 'javascript:alert(1)'] }, { tabId: 1, windowId: 9 })).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});
it('reports partial execution and stops after an API failure', async () => {
  create.mockResolvedValueOnce({ id: 10, windowId: 9 }).mockRejectedValueOnce(new Error('Window closed'));
  await expect(dispatchMacro({ ...morning, urls: [...morning.urls, 'https://example.com/'] }, { tabId: 1, windowId: 9 })).rejects.toThrow('opened 1 of 3 sites');
  expect(create).toHaveBeenCalledTimes(2);
});
const environment = (): ExecutionEnvironment => ({ settings: structuredClone(defaultSettings), library: { aliases: [], workspaces: [], suggestions: [] }, macros: [], state: emptyConversation(), overrides: {}, operationId: crypto.randomUUID(), transcript: morning.phrase });
it('records a confirmed open before a progress callback fails', async () => {
  const env = environment();
  env.onProgress = async event => { if (event.status === 'completed') throw new Error('Progress unavailable'); };
  await expect(dispatchMacro(morning, { tabId: 1, windowId: 9 }, env)).rejects.toThrow('opened 1 of 2 sites');
  expect(env.state.targets.map(tab => tab.id)).toEqual([10]);
  expect(create).toHaveBeenCalledTimes(1);
});
it('reports each completed website on its actual created tab', async () => {
  const env = environment(); env.onProgress = vi.fn();
  create.mockResolvedValueOnce({ id: 10, windowId: 9 }).mockResolvedValueOnce({ id: 11, windowId: 9 });
  await dispatchMacro(morning, { tabId: 1, windowId: 9 }, env);
  expect(env.onProgress).toHaveBeenCalledWith({ index: 1, status: 'completed', context: { tabId: 11, windowId: 9 }, result: `Opened ${morning.urls[1]}` });
  expect(env.state.targets.map(tab => tab.id)).toEqual([10, 11]);
});
it('does not claim an unidentified created tab as confirmed', async () => {
  const env = environment(); env.onProgress = vi.fn();
  create.mockResolvedValueOnce({ windowId: 9 } as chrome.tabs.Tab);
  await expect(dispatchMacro(morning, { tabId: 1, windowId: 9 }, env)).rejects.toThrow('opened 0 of 2 sites. Stopped: Chrome did not identify');
  expect(env.state.targets).toEqual([]);
  expect(env.onProgress).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  expect(create).toHaveBeenCalledTimes(1);
});
it('honors Stop during a running progress callback before opening a site', async () => {
  const env = environment(); const controller = new AbortController(); env.signal = controller.signal;
  env.onProgress = async event => { if (event.status === 'running') controller.abort(); };
  await expect(dispatchMacro(morning, { tabId: 1, windowId: 9 }, env)).rejects.toThrow('opened 0 of 2 sites');
  expect(create).not.toHaveBeenCalled();
});
it('preserves the exact opened set when Stop arrives after a confirmed site', async () => {
  const env = environment(); const controller = new AbortController(); env.signal = controller.signal;
  env.onProgress = async event => { if (event.status === 'completed') controller.abort(); };
  await expect(dispatchMacro(morning, { tabId: 1, windowId: 9 }, env)).rejects.toThrow('opened 1 of 2 sites');
  expect(env.state.targets.map(tab => tab.id)).toEqual([10]);
  expect(create).toHaveBeenCalledTimes(1);
});
