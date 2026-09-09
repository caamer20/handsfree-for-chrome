import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, type Message } from '../src/common/schema';
import type { Reply } from '../src/common/types';

type Listener = (raw: unknown, sender: chrome.runtime.MessageSender, respond: (reply: Reply) => void) => boolean;
let listener: Listener;
let alarmListener: (alarm: chrome.alarms.Alarm) => void;
let local: Record<string, unknown>;
let session: Record<string, unknown>;
const create = vi.fn(async () => ({ id: 11, windowId: 1 }));
const close = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn(async () => undefined), closeOffscreen: close, hasOffscreen: vi.fn(async () => true) }));
const url = (path: string): string => `chrome-extension://test/${path}`;
async function request(message: Message, path = 'src/popup/popup.html'): Promise<Reply> {
  return new Promise(resolve => { listener(message, { id: 'test', url: url(path) }, resolve); });
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); local = {}; session = {};
  const storage = (data: Record<string, unknown>) => ({ get: async () => ({ ...data }), set: async (patch: Record<string, unknown>) => { Object.assign(data, patch); }, setAccessLevel: vi.fn() });
  vi.stubGlobal('chrome', {
    runtime: { id: 'test', getURL: url, onMessage: { addListener: (fn: Listener) => { listener = fn; } }, onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() }, sendMessage: vi.fn(async () => ({ ok: true })) },
    permissions: { contains: vi.fn(async () => true) },
    storage: { local: storage(local), session: storage(session) },
    commands: { onCommand: { addListener: vi.fn() }, getAll: vi.fn(async () => []) },
    tabs: { get: vi.fn(async (id: number) => ({ id, windowId: 1, index: 0, title: "Test tab", url: "https://example.com/", pinned: false })), query: vi.fn(async () => [{ id: 1, windowId: 1 }]), sendMessage: vi.fn(async () => ({ ok: true })), create },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
    alarms: { onAlarm: { addListener: (fn: typeof alarmListener) => { alarmListener = fn; } }, create: vi.fn(), clear: vi.fn() },
  });
  await import('../src/background/index');
});
it('rejects messages originating in a web content script', async () => {
  expect(await request({ target: 'background', type: 'RUN_TEXT', text: 'open a new tab' }, 'untrusted.html')).toEqual({ ok: false, error: 'Untrusted message source' });
  expect(create).not.toHaveBeenCalled();
});
it('ignores stale results and prevents replay after execution', async () => {
  await request({ target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
  const reply = await request({ target: 'background', type: 'GET_STATE' }); expect(reply.ok).toBe(true);
  const active = (session.session as { active: { id: string } }).active;
  const message: Message = { target: 'background', type: 'EXECUTE_ACTIONS', requestId: crypto.randomUUID(), source: 'grammar', transcript: 'open a new tab', actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }] };
  await request(message, 'src/offscreen/offscreen.html'); expect(create).not.toHaveBeenCalled();
  await request({ ...message, requestId: active.id }, 'src/offscreen/offscreen.html');
  await request({ ...message, requestId: active.id }, 'src/offscreen/offscreen.html');
  expect(create).toHaveBeenCalledOnce();
});
it('honors the review-every-AI preference and consumes approval once', async () => {
  local.settings = { reviewAiActions: true };
  await request({ target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
  const active = (session.session as { active: { id: string } }).active;
  await request({ target: 'background', type: 'EXECUTE_ACTIONS', requestId: active.id, source: 'model', transcript: 'open a new tab', actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }] }, 'src/offscreen/offscreen.html');
  expect(create).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'REVIEW_PLAN', requestId: active.id, approved: true });
  expect(create).toHaveBeenCalledOnce();
  expect((await request({ target: 'background', type: 'REVIEW_PLAN', requestId: active.id, approved: true })).ok).toBe(false);
});
it('cancelling invalidates the active request and disposes the engine', async () => {
  await request({ target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  expect((session.session as { active: unknown }).active).toBeNull();
  expect(close).toHaveBeenCalledOnce();
});
const macro = { id: 'af8d78d3-9ec7-4875-b266-931526755767', name: 'Daily morning', phrase: 'open up my daily morning sites', urls: ['https://mail.google.com/', 'https://calendar.google.com/'] };
it('persists macros across worker restarts and leaves preferences and other macros intact', async () => {
  local.settings = { aiEnabled: false };
  expect((await request({ target: 'background', type: 'SAVE_MACRO', macro })).ok).toBe(true);
  const second = { ...macro, id: crypto.randomUUID(), phrase: 'evening sites' };
  await request({ target: 'background', type: 'SAVE_MACRO', macro: second });
  vi.resetModules(); await import('../src/background/index');
  const state = await request({ target: 'background', type: 'GET_STATE' });
  expect(state.ok && state.state?.macros).toHaveLength(2);
  await request({ target: 'background', type: 'SAVE_MACRO', macro: { ...macro, name: 'Updated morning' } });
  await request({ target: 'background', type: 'DELETE_MACRO', id: second.id });
  expect(local.macros).toEqual([{ ...macro, name: 'Updated morning' }]);
  expect(local.settings).toEqual({ aiEnabled: false });
});
it('rejects duplicate phrases against the latest saved collection', async () => {
  await request({ target: 'background', type: 'SAVE_MACRO', macro });
  const reply = await request({ target: 'background', type: 'SAVE_MACRO', macro: { ...macro, id: crypto.randomUUID(), phrase: 'PLEASE open up my daily morning sites!' } });
  expect(reply).toEqual({ ok: false, error: 'Another macro already uses that command. Choose a different phrase.' });
  expect(local.macros).toHaveLength(1);
});
it.each(['Open up my daily morning sites', 'open a new tab'])('runs typed macro "%s" before built-in parsing without microphone permission or AI', async phrase => {
  await request({ target: 'background', type: 'SAVE_MACRO', macro: { ...macro, phrase } });
  await request({ target: 'background', type: 'RUN_TEXT', text: `${phrase}!` });
  expect(create).toHaveBeenCalledTimes(2);
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  expect((session.session as { active: unknown }).active).toBeNull();
});
it('runs saved macros by ID and rejects deleted IDs without opening tabs', async () => {
  await request({ target: 'background', type: 'SAVE_MACRO', macro });
  await request({ target: 'background', type: 'RUN_MACRO', id: macro.id });
  expect(create).toHaveBeenCalledTimes(2);
  await request({ target: 'background', type: 'DELETE_MACRO', id: macro.id });
  expect((await request({ target: 'background', type: 'RUN_MACRO', id: macro.id })).ok).toBe(false);
  expect(create).toHaveBeenCalledTimes(2);
});
it('handles final voice transcripts exactly once and tells the offscreen parser to stop', async () => {
  await request({ target: 'background', type: 'SAVE_MACRO', macro });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'a command being transcribed' });
  const active = (session.session as { active: { id: string } }).active;
  const message: Message = { target: 'background', type: 'VOICE_TRANSCRIPT', requestId: active.id, text: macro.phrase, final: true };
  expect(await request(message, 'src/offscreen/offscreen.html')).toEqual({ ok: true, handled: true });
  expect(await request(message, 'src/offscreen/offscreen.html')).toEqual({ ok: true, handled: true });
  expect(create).toHaveBeenCalledTimes(2);
});
it('does not execute interim speech or allow untrusted macro mutations', async () => {
  await request({ target: 'background', type: 'SAVE_MACRO', macro });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'a command being transcribed' });
  const active = (session.session as { active: { id: string } }).active;
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: active.id, text: macro.phrase, final: false }, 'src/offscreen/offscreen.html');
  expect(create).not.toHaveBeenCalled();
  expect((await request({ target: 'background', type: 'DELETE_MACRO', id: macro.id }, 'untrusted.html')).ok).toBe(false);
  expect(local.macros).toHaveLength(1);
});
it('executes a validated AI plan immediately by default and clears the original HUD', async () => {
  await request({ target: 'background', type: 'RUN_TEXT', text: 'give me a fresh tab please' });
  const active = (session.session as { active: { id: string } }).active;
  const result = await request({ target: 'background', type: 'EXECUTE_ACTIONS', requestId: active.id, source: 'model', transcript: 'give me a fresh tab please', actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }] }, 'src/offscreen/offscreen.html');
  expect(result).toEqual({ ok: true }); expect(create).toHaveBeenCalledOnce();
  expect((session.session as { pending: unknown }).pending).toBeNull();
  expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ state: expect.objectContaining({ phase: 'success' }) }));
});
it('keeps AI tab closing behind review even when automatic execution is on', async () => {
  await request({ target: 'background', type: 'RUN_TEXT', text: 'get rid of this tab' });
  const active = (session.session as { active: { id: string } }).active;
  expect(await request({ target: 'background', type: 'EXECUTE_ACTIONS', requestId: active.id, source: 'model', transcript: 'get rid of this tab', actions: [{ action: 'close_tab', params: { target: 'current' } }] }, 'src/offscreen/offscreen.html')).toEqual({ ok: true, pendingReview: true });
});
it('keeps the mic session on across commands and anchors each to the current tab', async () => {
  local.settings = { micGranted: true };
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  const capture = (session.session as { capture: { id: string } }).capture;
  const first = await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId: capture.id, text: 'open a new tab' }, 'src/offscreen/offscreen.html');
  expect(first.ok && first.request?.tabId).toBe(1);
  if (!first.ok || !first.request) throw Error('Missing request');
  await request({ target: 'background', type: 'EXECUTE_ACTIONS', requestId: first.request.id, source: 'grammar', transcript: 'open a new tab', actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }] }, 'src/offscreen/offscreen.html');
  vi.mocked(chrome.tabs.query).mockResolvedValueOnce([{ id: 11, windowId: 1 } as chrome.tabs.Tab]);
  const second = await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId: capture.id, text: 'zoom in' }, 'src/offscreen/offscreen.html');
  expect(second.ok && second.request?.tabId).toBe(11);
  const state = await request({ target: 'background', type: 'GET_STATE' });
  expect(state.ok && state.state?.listening).toBe(true);
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  expect((session.session as { capture: unknown; active: unknown })).toMatchObject({ capture: null, active: null });
  expect(await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId: capture.id, text: 'open a new tab' }, 'src/offscreen/offscreen.html')).toEqual({ ok: true, handled: true });
});
it('accepts explicit voice confirmation and rejects unrelated phrases while review is pending', async () => {
  local.settings = { micGranted: true, reviewAiActions: true };
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  const sessionId = (session.session as { capture: { id: string } }).capture.id;
  const result = await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'fresh tab' }, 'src/offscreen/offscreen.html');
  if (!result.ok || !result.request) throw Error('Missing request');
  await request({ target: 'background', type: 'EXECUTE_ACTIONS', requestId: result.request.id, source: 'model', transcript: 'fresh tab', actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }] }, 'src/offscreen/offscreen.html');
  expect(await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'open another tab' }, 'src/offscreen/offscreen.html')).toEqual({ ok: true, handled: true, pendingReview: true });
  expect(create).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'confirm command' }, 'src/offscreen/offscreen.html');
  expect(create).toHaveBeenCalledOnce();
});
it('stores a key separately from settings and never includes it in the popup state', async () => {
  const settings = { ...defaultSettings, aiProvider: 'openai' as const, aiModel: 'test-model' };
  expect(await request({ target: 'background', type: 'SAVE_SETTINGS', settings, apiKey: 'test-private-key' })).toEqual({ ok: true });
  const state = await request({ target: 'background', type: 'GET_STATE' });
  expect(state.ok && state.state?.hasApiKey).toBe(true);
  expect(JSON.stringify(state)).not.toContain('test-private-key');
  expect(local.settings).toEqual(settings);
  await request({ target: 'background', type: 'REMOVE_API_KEY' });
  const cleared = await request({ target: 'background', type: 'GET_STATE' });
  expect(cleared.ok && cleared.state?.hasApiKey).toBe(false);
});
it('stops promptly during a cloud request and drops a late provider result', async () => {
  local.settings = { aiEnabled: true, aiProvider: 'openai', aiModel: 'test-model', micGranted: true };
  local.apiCredentials = { 'openai:https://api.openai.com': 'fixture-key' };
  let complete: ((response: Response) => void) | undefined;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  await request({ target: 'background', type: 'RUN_TEXT', text: 'give me a fresh tab' });
  const requestId = (session.session as { active: { id: string } }).active.id;
  const pending = request({ target: 'background', type: 'PARSE_CLOUD', requestId, text: 'give me a fresh tab' }, 'src/offscreen/offscreen.html');
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  expect((session.session as { active: unknown }).active).toBeNull();
  complete?.(new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '{"actions":[{"action":"create_tab","params":{"url":"chrome://newtab/"}}]}' }] }] })));
  await pending;
  expect(create).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('does not put an active continuous microphone to sleep after three idle minutes', async () => {
  local.settings = { micGranted: true, mode: 'power-saver' };
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  (session.session as { lastActivity: number }).lastActivity = Date.now() - 4 * 60_000;
  alarmListener({ name: 'handsfree-idle', scheduledTime: Date.now() });
  const state = await request({ target: 'background', type: 'GET_STATE' });
  expect(state.ok && state.state?.listening).toBe(true);
  expect(close).not.toHaveBeenCalled();
});
it('clears a lost microphone session when its heartbeat expires', async () => {
  local.settings = { micGranted: true };
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  (session.session as { capture: { lastSeen: number } }).capture.lastSeen = Date.now() - 70_000;
  alarmListener({ name: 'handsfree-capture-heartbeat', scheduledTime: Date.now() });
  const state = await request({ target: 'background', type: 'GET_STATE' });
  expect(state.ok && state.state?.listening).toBe(false);
  expect(state.ok && state.state?.hud.text).toContain('stopped responding');
  expect(close).toHaveBeenCalledOnce();
});
it('cancels between native Chrome actions even while the serialized dispatcher is awaiting a call', async () => {
  await request({ target: 'background', type: 'RUN_TEXT', text: 'open some tabs' });
  const active = (session.session as { active: { id: string } }).active;
  let finishCreate: ((tab: { id: number; windowId: number }) => void) | undefined;
  create.mockImplementationOnce(() => new Promise(resolve => { finishCreate = resolve; }));
  const execution = request({ target: 'background', type: 'EXECUTE_ACTIONS', requestId: active.id, source: 'grammar', transcript: 'open three tabs', actions: Array.from({ length: 3 }, () => ({ action: 'create_tab' as const, params: { url: 'chrome://newtab/' } })) }, 'src/offscreen/offscreen.html');
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  const cancel = request({ target: 'background', type: 'TOGGLE_LISTENING' });
  finishCreate?.({ id: 11, windowId: 1 });
  await Promise.all([execution, cancel]);
  expect(create).toHaveBeenCalledOnce(); expect((session.session as { active: unknown }).active).toBeNull();
});
it('asks for a tab choice, resumes only the unfinished actions, and consumes the answer once', async () => {
  const open = [{ id: 1, windowId: 1, title: 'Welcome', url: 'https://example.com/', pinned: false }, { id: 2, windowId: 1, title: 'Personal Gmail', url: 'https://mail.google.com/mail/u/0/', pinned: false }, { id: 3, windowId: 1, title: 'Work Gmail', url: 'https://mail.google.com/mail/u/1/', pinned: false }];
  vi.mocked(chrome.tabs.query).mockImplementation(async filter => (filter.active ? [open[0]!] : open) as chrome.tabs.Tab[]);
  vi.mocked(chrome.tabs.get).mockImplementation(async id => structuredClone(open.find(tab => tab.id === id)) as chrome.tabs.Tab);
  Object.assign(chrome.tabs, { update: vi.fn(async (id: number, props: chrome.tabs.UpdateProperties) => { Object.assign(open.find(tab => tab.id === id)!, props); return open.find(tab => tab.id === id)! as chrome.tabs.Tab; }) });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'pin Gmail' });
  const active = (session.session as { active: { id: string } }).active;
  expect(await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: active.id, text: 'pin Gmail', final: true }, 'src/offscreen/offscreen.html')).toMatchObject({ ok: true, needsClarification: true });
  const state = await request({ target: 'background', type: 'GET_STATE' }); const question = state.ok ? state.state?.question : undefined;
  expect(question?.choices).toHaveLength(2); expect(chrome.tabs.update).not.toHaveBeenCalled();
  const answer = { target: 'background' as const, type: 'ANSWER_CLARIFICATION' as const, questionId: question!.id, answer: 'No, the work account' };
  expect(await request(answer)).toMatchObject({ ok: true }); expect(chrome.tabs.update).toHaveBeenCalledWith(3, { pinned: true });
  expect((await request(answer)).ok).toBe(false); expect(chrome.tabs.update).toHaveBeenCalledOnce();
});
it('rejects a duplicate cleanup when a reviewed copy has become active', async () => {
  const open = [{ id: 1, windowId: 1, title: 'First', url: 'https://example.com/', active: true, pinned: false }, { id: 2, windowId: 1, title: 'Copy', url: 'https://example.com/', active: false, pinned: false }];
  vi.mocked(chrome.tabs.query).mockImplementation(async filter => (filter.active ? [open[0]!] : open) as chrome.tabs.Tab[]);
  vi.mocked(chrome.tabs.get).mockImplementation(async id => structuredClone(open.find(tab => tab.id === id)) as chrome.tabs.Tab);
  chrome.tabs.remove = vi.fn();
  await request({ target: 'background', type: 'RUN_TEXT', text: 'show duplicate tabs' });
  const active = (session.session as { active: { id: string } }).active;
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: active.id, text: 'show duplicate tabs', final: true }, 'src/offscreen/offscreen.html');
  const state = await request({ target: 'background', type: 'GET_STATE' }); expect(state.ok && state.state?.pending?.targets?.map(tab => tab.id)).toEqual([2]);
  open[1]!.active = true;
  await request({ target: 'background', type: 'REVIEW_PLAN', requestId: active.id, approved: true });
  expect(chrome.tabs.remove).not.toHaveBeenCalled(); const after = await request({ target: 'background', type: 'GET_STATE' }); expect(after.ok && after.state?.hud.text).toContain('reviewed tab changed');
});
it('corrects a pending ambiguous command without acting on the unrelated active tab', async () => {
  const open = [{ id: 1, windowId: 1, title: 'Welcome', url: 'https://example.com/', pinned: false }, { id: 2, windowId: 1, title: 'Personal Gmail', url: 'https://mail.google.com/mail/u/0/', pinned: false }, { id: 3, windowId: 1, title: 'Work Gmail', url: 'https://mail.google.com/mail/u/1/', pinned: false }];
  vi.mocked(chrome.tabs.query).mockImplementation(async filter => (filter.active ? [open[0]!] : open) as chrome.tabs.Tab[]);
  vi.mocked(chrome.tabs.get).mockImplementation(async id => structuredClone(open.find(tab => tab.id === id)) as chrome.tabs.Tab);
  Object.assign(chrome.tabs, { update: vi.fn(async (id: number, props: chrome.tabs.UpdateProperties) => { Object.assign(open.find(tab => tab.id === id)!, props); return open.find(tab => tab.id === id)! as chrome.tabs.Tab; }) });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'mute Gmail' });
  const active = (session.session as { active: { id: string } }).active;
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: active.id, text: 'mute Gmail', final: true }, 'src/offscreen/offscreen.html');
  await request({ target: 'background', type: 'RUN_TEXT', text: 'Actually, pin it instead' });
  expect(chrome.tabs.update).not.toHaveBeenCalled();
  const state = await request({ target: 'background', type: 'GET_STATE' }); const question = state.ok && state.state?.question;
  expect(question && question.actions.at(-1)).toMatchObject({ action: 'pin_tab' });
  await request({ target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question ? question.id : '', answer: 'The second one' });
  expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(3, { pinned: true }); expect(open[0]!.pinned).toBe(false);
});

it('handles a negated final transcript locally without invoking cloud AI or executing tabs', async () => {
  local.settings = { aiEnabled: true, aiProvider: 'openai', aiModel: 'test-model' };
  await request({ target: 'background', type: 'RUN_TEXT', text: "Don't close Gmail" });
  const active = (session.session as { active: { id: string } }).active;
  expect(await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: active.id, text: "Don't close Gmail", final: true }, 'src/offscreen/offscreen.html')).toEqual({ ok: true, handled: true });
  expect(create).not.toHaveBeenCalled(); expect((session.session as { active: unknown; hud: { text: string } }).active).toBeNull();
  expect((session.session as { hud: { text: string } }).hud.text).toContain('No changes made');
});
it('accepts a typed conversational approval only for the pending review', async () => {
  local.settings = { reviewAiActions: true };
  await request({ target: 'background', type: 'RUN_TEXT', text: 'fresh tab' });
  const active = (session.session as { active: { id: string } }).active;
  await request({ target: 'background', type: 'EXECUTE_ACTIONS', requestId: active.id, source: 'model', transcript: 'fresh tab', actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }] }, 'src/offscreen/offscreen.html');
  expect(create).not.toHaveBeenCalled(); await request({ target: 'background', type: 'RUN_TEXT', text: 'Yes please' });
  expect(create).toHaveBeenCalledOnce(); expect((session.session as { pending: unknown }).pending).toBeNull();
});
const routine = { id: 'b65b5c60-17d4-4e32-bbc8-cf39a5aa102a', name: 'Research', phrase: 'start my research', steps: ['Open a new tab', 'Search Wikipedia', 'Open a new tab'] };
it('saves routines across worker restarts, validates every step, and isolates phrase collisions', async () => {
  expect((await request({ target: 'background', type: 'SAVE_ROUTINE', routine })).ok).toBe(true);
  expect((await request({ target: 'background', type: 'SAVE_ROUTINE', routine: { ...routine, steps: ['Open a new tab', 'build a spaceship'] } })).ok).toBe(false);
  expect((await request({ target: 'background', type: 'SAVE_ROUTINE', routine: { ...routine, id: crypto.randomUUID(), phrase: 'please START MY RESEARCH!' } })).ok).toBe(false);
  expect((await request({ target: 'background', type: 'SAVE_MACRO', macro: { ...macro, phrase: routine.phrase } })).ok).toBe(false);
  await request({ target: 'background', type: 'SAVE_MACRO', macro });
  expect((await request({ target: 'background', type: 'SAVE_ROUTINE', routine: { ...routine, phrase: macro.phrase } })).ok).toBe(false);
  vi.resetModules(); await import('../src/background/index');
  const state = await request({ target: 'background', type: 'GET_STATE' }); expect(state.ok && state.state?.routines).toEqual([routine]);
  expect(create).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'DELETE_ROUTINE', id: routine.id }); expect(local.routines).toEqual([]); expect(local.macros).toHaveLength(1);
  expect((await request({ target: 'background', type: 'RUN_ROUTINE', id: routine.id })).ok).toBe(false);
});
it('previews a routine without the voice engine and resumes remaining steps exactly once after an answer', async () => {
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'Please start my research' });
  const pending = (session.session as { pending: { request: { id: string } } }).pending;
  expect(pending).toBeTruthy(); expect(create).not.toHaveBeenCalled(); expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'REVIEW_PLAN', requestId: pending.request.id, approved: true });
  expect(create).toHaveBeenCalledTimes(1);
  const question = (session.session as { question: { id: string; kind: string } }).question;
  expect(question.kind).toBe('text');
  await request({ target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question.id, answer: 'black holes and then close all tabs' });
  expect(create).toHaveBeenCalledTimes(3);
  expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: 'https://en.wikipedia.org/w/index.php?search=black%20holes%20and%20then%20close%20all%20tabs' }));
  expect((session.session as { pending: unknown; question: unknown; active: unknown })).toMatchObject({ pending: null, question: null, active: null });
  expect((await request({ target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question.id, answer: 'again' })).ok).toBe(false);
  expect(create).toHaveBeenCalledTimes(3);
});
it('handles routine speech before AI and lets dismissal leave every step untouched', async () => {
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'a command being transcribed' });
  const active = (session.session as { active: { id: string } }).active;
  expect(await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: active.id, final: true, text: routine.phrase }, 'src/offscreen/offscreen.html')).toMatchObject({ ok: true, handled: true, pendingReview: true });
  expect(create).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'REVIEW_PLAN', requestId: active.id, approved: false }); expect(create).not.toHaveBeenCalled();
  expect((session.session as { pending: unknown }).pending).toBeNull();
});
it('stops a routine at its first failed step and never runs later steps', async () => {
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: { ...routine, steps: ['Open a new tab', 'Focus the missing field', 'Open a new tab'] } });
  await request({ target: 'background', type: 'RUN_ROUTINE', id: routine.id });
  const pending = (session.session as { pending: { request: { id: string } } }).pending;
  await request({ target: 'background', type: 'REVIEW_PLAN', requestId: pending.request.id, approved: true });
  expect(create).toHaveBeenCalledOnce(); expect((session.session as { hud: { phase: string; text: string } }).hud).toMatchObject({ phase: 'error', text: expect.stringContaining('Stopped:') });
});
it('requires concrete bulk-close review inside a routine and preserves the remaining steps', async () => {
  const remove = vi.fn(async () => undefined); Object.assign(chrome.tabs, { remove });
  vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 1, windowId: 1, index: 0, url: 'https://example.com/', title: 'Keep' }, { id: 2, windowId: 1, index: 1, url: 'https://example.com/', title: 'Close me' }] as chrome.tabs.Tab[]);
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: { ...routine, steps: ['Close all other tabs', 'Open a new tab'] } });
  await request({ target: 'background', type: 'RUN_ROUTINE', id: routine.id });
  const id = (session.session as { pending: { request: { id: string } } }).pending.request.id;
  await request({ target: 'background', type: 'REVIEW_PLAN', requestId: id, approved: true });
  const pending = (session.session as { pending: { operation: string; targets: { id: number }[]; actions: unknown[] } }).pending;
  expect(pending.operation).toBe('close'); expect(pending.targets.map(tab => tab.id)).toEqual([2]); expect(pending.actions).toHaveLength(1);
  expect(remove).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'REVIEW_PLAN', requestId: id, approved: true });
  expect(remove).toHaveBeenCalledWith([2]); expect(create).toHaveBeenCalledOnce();
});
it('cancels during a routine page wait without running the next step', async () => {
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: { ...routine, steps: ['Wait for the page to load', 'Open a new tab'] } });
  await request({ target: 'background', type: 'RUN_ROUTINE', id: routine.id });
  const id = (session.session as { pending: { request: { id: string } } }).pending.request.id;
  const running = request({ target: 'background', type: 'REVIEW_PLAN', requestId: id, approved: true });
  await vi.waitFor(() => expect(chrome.tabs.get).toHaveBeenCalled());
  await request({ target: 'background', type: 'RUN_TEXT', text: 'stop' }); await running;
  expect(create).not.toHaveBeenCalled(); expect((session.session as { active: unknown }).active).toBeNull();
});
it('collects missing routine inputs before a concrete preview and treats answers as data', async () => {
  const template = { ...routine, phrase: 'Research {topic}', steps: ['Search Wikipedia for {topic}', 'Fill {field} field with {topic}'] };
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: template });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'Research cats then close all tabs!' });
  const question = (session.session as { question: { id: string; routineInput: { name: string } } }).question;
  expect(question.routineInput.name).toBe('field'); expect(create).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question.id, answer: 'Notes' });
  const pending = (session.session as { pending: { actions: { action: string; params: Record<string, string> }[] } }).pending;
  expect(pending.actions).toHaveLength(2); expect(pending.actions[0]!.params.query).toBe('cats then close all tabs!'); expect(pending.actions[1]!.params).toMatchObject({ query: 'Notes', text: 'cats then close all tabs!' }); expect(create).not.toHaveBeenCalled();
});
it('imports routines atomically and refuses collisions between variable and literal phrases', async () => {
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine });
  const valid = { ...routine, id: crypto.randomUUID(), name: 'Second', phrase: 'Another thing' };
  const conflict = { ...routine, id: crypto.randomUUID(), name: 'Third' };
  expect((await request({ target: 'background', type: 'IMPORT_ROUTINES', routines: [valid, conflict] })).ok).toBe(false); expect(local.routines).toEqual([routine]);
  expect((await request({ target: 'background', type: 'IMPORT_ROUTINES', routines: [valid] })).ok).toBe(true); expect(local.routines).toHaveLength(2);
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: { ...routine, id: crypto.randomUUID(), name: 'Parameterized', phrase: 'Research {topic}', steps: ['Search Wikipedia for {topic}'] } });
  expect((await request({ target: 'background', type: 'SAVE_MACRO', macro: { ...macro, phrase: 'Research cats' } })).ok).toBe(false);
});
it('exposes live command progress during a slow native action without waiting for its completion', async () => {
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: { ...routine, steps: ['Open a new tab', 'Open a new tab'] } });
  await request({ target: 'background', type: 'RUN_ROUTINE', id: routine.id });
  const id = (session.session as { pending: { request: { id: string } } }).pending.request.id;
  let release: () => void = () => undefined;
  create.mockImplementationOnce(async () => new Promise(resolve => { release = () => resolve({ id: 11, windowId: 1 }); }));
  const executing = request({ target: 'background', type: 'REVIEW_PLAN', requestId: id, approved: true });
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const live = await request({ target: 'background', type: 'GET_STATE' });
  expect(live.ok && live.state?.progress?.steps.map(step => step.status)).toEqual(['running', 'pending']);
  release(); await executing;
  const done = await request({ target: 'background', type: 'GET_STATE' }); expect(done.ok && done.state?.progress?.status).toBe('completed'); expect(done.ok && done.state?.progress?.steps.map(step => step.status)).toEqual(['completed', 'completed']);
});
it('keeps completed steps and skips remaining steps when a routine is cancelled at clarification', async () => {
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine }); await request({ target: 'background', type: 'RUN_ROUTINE', id: routine.id });
  const id = (session.session as { pending: { request: { id: string } } }).pending.request.id;
  await request({ target: 'background', type: 'REVIEW_PLAN', requestId: id, approved: true });
  const waiting = await request({ target: 'background', type: 'GET_STATE' }); expect(waiting.ok && waiting.state?.progress?.steps.map(step => step.status)).toEqual(['completed', 'waiting', 'pending']);
  await request({ target: 'background', type: 'RUN_TEXT', text: 'stop' });
  const stopped = await request({ target: 'background', type: 'GET_STATE' }); expect(stopped.ok && stopped.state?.progress?.status).toBe('cancelled'); expect(stopped.ok && stopped.state?.progress?.steps.map(step => step.status)).toEqual(['completed', 'cancelled', 'skipped']); expect(create).toHaveBeenCalledOnce();
});
it('reports the failed step without claiming skipped steps succeeded', async () => {
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: { ...routine, steps: ['Open a new tab', 'Open a new tab', 'Open a new tab'] } });
  await request({ target: 'background', type: 'RUN_ROUTINE', id: routine.id });
  const id = (session.session as { pending: { request: { id: string } } }).pending.request.id;
  create.mockResolvedValueOnce({ id: 11, windowId: 1 }).mockRejectedValueOnce(new Error('Chrome could not create this tab'));
  await request({ target: 'background', type: 'REVIEW_PLAN', requestId: id, approved: true });
  const state = await request({ target: 'background', type: 'GET_STATE' }); expect(state.ok && state.state?.progress?.steps.map(step => step.status)).toEqual(['completed', 'failed', 'skipped']); expect(create).toHaveBeenCalledTimes(2);
});
it('runs the guided browser command without AI or microphone access and verifies its success', async () => {
  expect(await request({ target: 'background', type: 'RUN_SETUP_COMMAND' })).toMatchObject({ ok: true, message: expect.stringContaining('Practice passed') });
  expect(create).toHaveBeenCalledWith({ url: 'chrome://newtab/', active: false, windowId: 1 }); expect(local.settings).toMatchObject({ setupCommandPassed: true, micGranted: false }); expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
it('readiness checks explain missing configuration without requesting permissions or calling AI', async () => {
  const result = await request({ target: 'background', type: 'GET_DIAGNOSTICS' });
  expect(result.ok && result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Keyboard shortcut', status: 'attention' }), expect.objectContaining({ title: 'Microphone setup', status: 'attention' })]));
  expect(create).not.toHaveBeenCalled(); expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});

it('records successful microphone setup without changing provider settings or testing a connection', async () => {
  local.settings = { ...defaultSettings, aiProvider: 'compatible', aiBaseUrl: 'https://provider.example/v1', aiModel: 'chosen-model' };
  const reply = await request({ target: 'background', type: 'MICROPHONE_READY' }, 'src/popup/onboarding.html');
  expect(reply.ok).toBe(true); expect(local.settings).toMatchObject({ micGranted: true, aiProvider: 'compatible', aiModel: 'chosen-model' }); expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
