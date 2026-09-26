import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, type Message } from '../src/common/schema';
import type { Reply } from '../src/common/types';
import type { SessionState } from '../src/background/store';
import { ensureOffscreen } from '../src/background/offscreen-manager';

type Listener = (raw: unknown, sender: chrome.runtime.MessageSender, respond: (reply: Reply) => void) => boolean;
let listener: Listener;
let alarmListener: (alarm: chrome.alarms.Alarm) => void;
let local: Record<string, unknown>;
let session: Record<string, unknown>;
const create = vi.fn(async () => ({ id: 11, windowId: 1 }));
const close = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn(async () => undefined), closeOffscreen: close, hasOffscreen: vi.fn(async () => true) }));
const url = (path: string): string => `chrome-extension://test/${path}`;
const savedSession = (): SessionState => session.session as SessionState;
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
async function pendingVoiceReview(): Promise<string> {
  local.settings = { micGranted: true, reviewAiActions: true };
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  const sessionId = savedSession().capture!.id;
  const result = await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'fresh tab' }, 'src/offscreen/offscreen.html');
  if (!result.ok || !result.request) throw Error('Missing request');
  await request({ target: 'background', type: 'EXECUTE_ACTIONS', requestId: result.request.id, source: 'model', transcript: 'fresh tab', actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }] }, 'src/offscreen/offscreen.html');
  return sessionId;
}
it.each([
  ['confirm command', ['cancel command']],
  ['confirm command', ['stop listening']],
  ['confirm command', ['do not confirm command']],
  ['no', ['confirm command']],
])('retains a pending plan when spoken review answers conflict: %s', async (text, alternatives) => {
  const sessionId = await pendingVoiceReview(); const pending = structuredClone(savedSession().pending);
  expect(await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text, alternatives }, 'src/offscreen/offscreen.html')).toEqual({ ok: true, handled: true, pendingReview: true });
  expect(create).not.toHaveBeenCalled(); expect(savedSession().pending).toEqual(pending);
  expect(savedSession().hud).toMatchObject({ phase: 'review', text: expect.stringContaining('conflicting') });
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'confirm command' }, 'src/offscreen/offscreen.html');
  expect(create).toHaveBeenCalledOnce(); expect(savedSession().pending).toBeNull();
});
it('allows equivalent review alternatives without silently using an unsupported primary', async () => {
  const sessionId = await pendingVoiceReview();
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'conform command', alternatives: ['confirm command'] }, 'src/offscreen/offscreen.html');
  expect(create).not.toHaveBeenCalled(); expect(savedSession().pending).not.toBeNull();
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'confirm command', alternatives: ['yes please', 'go ahead', 'unrecognized noise'] }, 'src/offscreen/offscreen.html');
  expect(create).toHaveBeenCalledOnce(); expect(savedSession().pending).toBeNull();
});
it('cancels a review when cancellation is the primary transcript despite an approval alternative', async () => {
  const sessionId = await pendingVoiceReview();
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'cancel command', alternatives: ['confirm command'] }, 'src/offscreen/offscreen.html');
  expect(create).not.toHaveBeenCalled(); expect(savedSession().pending).toBeNull(); expect(close).toHaveBeenCalledOnce();
});
async function pendingVoiceTabChoice(): Promise<string> {
  const open = [{ id: 1, windowId: 1, title: 'Welcome', url: 'https://example.com/', pinned: false }, { id: 2, windowId: 1, title: 'Personal Gmail', url: 'https://mail.google.com/mail/u/0/', pinned: false }, { id: 3, windowId: 1, title: 'Work Gmail', url: 'https://mail.google.com/mail/u/1/', pinned: false }];
  vi.mocked(chrome.tabs.query).mockImplementation(async filter => (filter.active ? [open[0]!] : open) as chrome.tabs.Tab[]);
  vi.mocked(chrome.tabs.get).mockImplementation(async id => structuredClone(open.find(tab => tab.id === id)) as chrome.tabs.Tab);
  Object.assign(chrome.tabs, { update: vi.fn(async (id: number, props: chrome.tabs.UpdateProperties) => { Object.assign(open.find(tab => tab.id === id)!, props); return open.find(tab => tab.id === id)! as chrome.tabs.Tab; }) });
  local.settings = { micGranted: true };
  await request({ target: 'background', type: 'TOGGLE_LISTENING' }); const sessionId = savedSession().capture!.id;
  const result = await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'pin Gmail' }, 'src/offscreen/offscreen.html');
  if (!result.ok || !result.request) throw Error('Missing request');
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: result.request.id, text: 'pin Gmail', spoken: true, final: true }, 'src/offscreen/offscreen.html');
  expect(savedSession().question?.choices).toHaveLength(2);
  return sessionId;
}
it.each([['second'], ['cancel command'], ['do not choose first'], ['not the first one']])('retains the original question when spoken options conflict: %s', async alternative => {
  const sessionId = await pendingVoiceTabChoice(); const question = structuredClone(savedSession().question);
  expect(await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'first', alternatives: [alternative] }, 'src/offscreen/offscreen.html')).toEqual({ ok: true, handled: true, needsClarification: true });
  expect(savedSession().question).toEqual(question); expect(chrome.tabs.update).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'second', alternatives: ['the work account'] }, 'src/offscreen/offscreen.html');
  expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(3, { pinned: true }); expect(savedSession().question).toBeNull();
});
it('keeps a numbered question unanswered when negation is the primary transcript', async () => {
  const sessionId = await pendingVoiceTabChoice(); const question = structuredClone(savedSession().question);
  expect(await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'do not choose first', alternatives: ['first'] }, 'src/offscreen/offscreen.html')).toMatchObject({ needsClarification: true });
  expect(savedSession().question).toEqual(question); expect(chrome.tabs.update).not.toHaveBeenCalled();
});
it('keeps primary stop immediate during a numbered question even if an alternative names a choice', async () => {
  const sessionId = await pendingVoiceTabChoice();
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'stop', alternatives: ['first'] }, 'src/offscreen/offscreen.html');
  expect(savedSession().question).toBeNull(); expect(chrome.tabs.update).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});
it('resolves equivalent spoken option numbers without selecting an unsupported primary', async () => {
  const sessionId = await pendingVoiceTabChoice();
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'fist', alternatives: ['first'] }, 'src/offscreen/offscreen.html');
  expect(chrome.tabs.update).not.toHaveBeenCalled(); expect(savedSession().question).not.toBeNull();
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'first', alternatives: ['the first one', 'option 1', 'unrecognized noise'] }, 'src/offscreen/offscreen.html');
  expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(2, { pinned: true });
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
async function voiceAfterPin() {
  const tab = { id: 1, windowId: 1, index: 0, title: 'Example', url: 'https://example.com/', pinned: false, mutedInfo: { muted: false } };
  vi.mocked(chrome.tabs.get).mockImplementation(async () => structuredClone(tab) as chrome.tabs.Tab);
  vi.mocked(chrome.tabs.query).mockImplementation(async () => [structuredClone(tab)] as chrome.tabs.Tab[]);
  Object.assign(chrome.tabs, { remove: vi.fn(), update: vi.fn(async (_id: number, properties: chrome.tabs.UpdateProperties) => {
    Object.assign(tab, properties); if (properties.muted !== undefined) tab.mutedInfo = { muted: properties.muted };
    return structuredClone(tab) as chrome.tabs.Tab;
  }) });
  local.settings = { micGranted: true };
  await request({ target: 'background', type: 'TOGGLE_LISTENING' }); const sessionId = savedSession().capture!.id;
  const result = await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'pin this tab' }, 'src/offscreen/offscreen.html');
  if (!result.ok || !result.request) throw Error('Missing request');
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: result.request.id, text: 'pin this tab', spoken: true, final: true }, 'src/offscreen/offscreen.html');
  expect(tab.pinned).toBe(true); expect(savedSession().conversation.lastUndoId).toBe(result.request.id);
  return { tab, sessionId };
}
it.each(['actually close it instead', 'cancel command', 'do not mute it'])('cancels conflicting corrections without undo or replacement: %s', async alternative => {
  const { tab, sessionId } = await voiceAfterPin();
  await request({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId, replacement: 'mute it', alternatives: [alternative], stopListening: false }, 'src/offscreen/offscreen.html');
  expect(tab).toMatchObject({ pinned: true, mutedInfo: { muted: false } }); expect(chrome.tabs.update).toHaveBeenCalledOnce(); expect(chrome.tabs.remove).not.toHaveBeenCalled();
  expect(savedSession().capture?.id).not.toBe(sessionId); expect(savedSession().hud.text).toContain('Repeat the full correction');
  const feedback = savedSession().hud;
  await request({ target: 'background', type: 'CAPTURE_STATUS', sessionId, text: 'Old session listening', fatal: false }, 'src/offscreen/offscreen.html');
  expect(savedSession().hud).toEqual(feedback);
  await request({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId, replacement: 'close it', stopListening: false }, 'src/offscreen/offscreen.html');
  expect(chrome.tabs.update).toHaveBeenCalledOnce(); expect(chrome.tabs.remove).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});
it('applies a correction when its recognized alternatives have the same meaning', async () => {
  const { tab, sessionId } = await voiceAfterPin();
  await request({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId, replacement: 'mute it', alternatives: ['actually silence it instead'], stopListening: false }, 'src/offscreen/offscreen.html');
  expect(tab).toMatchObject({ pinned: false, mutedInfo: { muted: true } });
  expect(chrome.tabs.update).toHaveBeenCalledTimes(3); expect(chrome.tabs.remove).not.toHaveBeenCalled();
});
it('keeps plain stop immediate and never treats its alternatives as replacements', async () => {
  const { tab, sessionId } = await voiceAfterPin();
  await request({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId, alternatives: ['actually close it instead'], stopListening: false }, 'src/offscreen/offscreen.html');
  expect(tab.pinned).toBe(true); expect(chrome.tabs.update).toHaveBeenCalledOnce(); expect(chrome.tabs.remove).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});
it('does not undo an earlier successful action for an unsupported correction', async () => {
  const { tab, sessionId } = await voiceAfterPin();
  await request({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId, replacement: 'scroll backwards in time', stopListening: false }, 'src/offscreen/offscreen.html');
  expect(tab.pinned).toBe(true); expect(chrome.tabs.update).toHaveBeenCalledOnce(); expect(savedSession().hud.text).toContain('Try the correction');
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
it('compares the actual values of conflicting spoken freeform answers', async () => {
  const template = { ...routine, phrase: 'Research {topic}', steps: ['Search Wikipedia for {topic}', 'Fill {field} field with {topic}'] };
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: template });
  local.settings = { micGranted: true };
  await request({ target: 'background', type: 'TOGGLE_LISTENING' }); const sessionId = savedSession().capture!.id;
  const result = await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'Research cats' }, 'src/offscreen/offscreen.html');
  if (!result.ok || !result.request) throw Error('Missing request');
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: result.request.id, text: 'Research cats', spoken: true, final: true }, 'src/offscreen/offscreen.html');
  const question = structuredClone(savedSession().question); expect(question?.routineInput?.name).toBe('field');
  expect(await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'Notes', alternatives: ['Search'] }, 'src/offscreen/offscreen.html')).toMatchObject({ needsClarification: true });
  expect(savedSession().question).toEqual(question); expect(savedSession().pending).toBeNull();
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'Notes', alternatives: ['Notes'] }, 'src/offscreen/offscreen.html');
  expect(savedSession().question).toBeNull(); expect(savedSession().pending?.actions[1]).toMatchObject({ action: 'page_action', params: { query: 'Notes' } }); expect(create).not.toHaveBeenCalled();
});
it('preserves negation as literal data when answering a routine text input', async () => {
  const template = { ...routine, phrase: 'Research {topic}', steps: ['Search Wikipedia for {topic}', 'Fill {field} field with {topic}'] };
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: template });
  local.settings = { micGranted: true }; await request({ target: 'background', type: 'TOGGLE_LISTENING' }); const sessionId = savedSession().capture!.id;
  const result = await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'Research cats' }, 'src/offscreen/offscreen.html');
  if (!result.ok || !result.request) throw Error('Missing request');
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: result.request.id, text: 'Research cats', spoken: true, final: true }, 'src/offscreen/offscreen.html');
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'do not close tabs', alternatives: ['do not close tabs'] }, 'src/offscreen/offscreen.html');
  expect(savedSession().question).toBeNull(); expect(savedSession().pending?.actions[1]).toMatchObject({ action: 'page_action', params: { query: 'do not close tabs' } }); expect(create).not.toHaveBeenCalled();
});
it('preserves negation as the literal name of a saved workspace', async () => {
  Object.assign(chrome, { tabGroups: { query: vi.fn(async () => []) } });
  vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 1, windowId: 1, index: 0, title: 'Example', url: 'https://example.com/', pinned: false, active: true }] as chrome.tabs.Tab[]);
  local.settings = { micGranted: true }; await request({ target: 'background', type: 'TOGGLE_LISTENING' }); const sessionId = savedSession().capture!.id;
  const result = await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'save this workspace' }, 'src/offscreen/offscreen.html');
  if (!result.ok || !result.request) throw Error('Missing request');
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: result.request.id, text: 'save this workspace', spoken: true, final: true }, 'src/offscreen/offscreen.html');
  expect(savedSession().question?.kind).toBe('name');
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'do not close tabs', alternatives: ['do not close tabs'] }, 'src/offscreen/offscreen.html');
  expect(local.library).toMatchObject({ workspaces: [expect.objectContaining({ name: 'do not close tabs' })] }); expect(savedSession().question).toBeNull();
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

it('verifies a real setup action only after a final spoken setup transcript', async () => {
  local.settings = { micGranted: true, aiEnabled: true, triggerPhrase: 'hey browser' };
  vi.mocked(chrome.tabs.get).mockImplementation(async id => ({ id, windowId: 1, index: 0, title: id === 11 ? 'New Tab' : 'Welcome', url: id === 11 ? 'chrome://newtab/' : 'https://example.com/', pinned: false }) as chrome.tabs.Tab);
  expect((await request({ target: 'background', type: 'START_VOICE_SETUP', pace: 'relaxed' }, 'src/popup/onboarding.html')).ok).toBe(true);
  const id = savedSession().active!.id;
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'START_LISTENING', settings: expect.objectContaining({ listeningMode: 'single', aiEnabled: false, triggerPhrase: '', voicePace: 'relaxed' }) }));
  await request({ target: 'background', type: 'ENGINE_LISTENING', requestId: id }, 'src/offscreen/offscreen.html');
  expect(savedSession().voiceSetup?.stage).toBe('speech');
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: id, text: 'open a new', final: false }, 'src/offscreen/offscreen.html');
  expect(create).not.toHaveBeenCalled();
  const final: Message = { target: 'background', type: 'VOICE_TRANSCRIPT', requestId: id, text: 'open a new tab', final: true, spoken: true };
  expect(await request(final, 'src/offscreen/offscreen.html')).toMatchObject({ ok: true, handled: true });
  await request(final, 'src/offscreen/offscreen.html');
  expect(create).toHaveBeenCalledExactlyOnceWith({ url: 'chrome://newtab/', windowId: 1, active: false });
  expect(savedSession().voiceSetup).toMatchObject({ status: 'passed', stage: 'complete', tabId: 11, transcript: 'open a new tab' });
  expect(local.settings).toMatchObject({ setupVoicePassed: true, setupCommandPassed: true, voicePace: 'relaxed', aiEnabled: true, triggerPhrase: 'hey browser' });
});
it.each(['close this tab', 'open a new tab then close this tab', 'do not open a new tab'])('never executes a different or compound command during spoken setup: %s', async text => {
  local.settings = { micGranted: true };
  await request({ target: 'background', type: 'START_VOICE_SETUP' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text, final: true, spoken: true }, 'src/offscreen/offscreen.html');
  expect(create).not.toHaveBeenCalled(); expect(local.settings).toMatchObject({ setupVoicePassed: false });
  expect(savedSession().voiceSetup).toMatchObject({ status: 'failed', stage: 'interpretation' });
});
it('does not mark spoken setup passed when Chrome cannot verify the resulting tab', async () => {
  local.settings = { micGranted: true };
  await request({ target: 'background', type: 'START_VOICE_SETUP' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'open a new tab', final: true, spoken: true }, 'src/offscreen/offscreen.html');
  expect(create).toHaveBeenCalledOnce(); expect(local.settings).toMatchObject({ setupVoicePassed: false });
  expect(savedSession().voiceSetup).toMatchObject({ status: 'failed', stage: 'browser' });
});
it('cancels spoken setup and ignores a late final result', async () => {
  local.settings = { micGranted: true };
  await request({ target: 'background', type: 'START_VOICE_SETUP' }); const id = savedSession().active!.id;
  await request({ target: 'background', type: 'CANCEL_VOICE_SETUP', id });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: id, text: 'open a new tab', final: true, spoken: true }, 'src/offscreen/offscreen.html');
  expect(create).not.toHaveBeenCalled(); expect(savedSession().voiceSetup?.status).toBe('cancelled'); expect(close).toHaveBeenCalledOnce();
});
it('keeps typed setup separate and refuses spoken practice before permission', async () => {
  expect((await request({ target: 'background', type: 'START_VOICE_SETUP' })).ok).toBe(false);
  expect(chrome.alarms.create).not.toHaveBeenCalled(); expect(savedSession()?.active).toBeUndefined();
  await request({ target: 'background', type: 'RUN_SETUP_COMMAND' });
  expect(local.settings).toMatchObject({ setupCommandPassed: true, setupVoicePassed: false });
});
it('asks before choosing between two meaningfully different speech transcripts', async () => {
  const tab = { id: 1, windowId: 1, index: 0, title: 'Example', url: 'https://example.com/', pinned: false };
  vi.mocked(chrome.tabs.get).mockImplementation(async () => ({ ...tab }) as chrome.tabs.Tab);
  Object.assign(chrome.tabs, { update: vi.fn(async (_id: number, properties: chrome.tabs.UpdateProperties) => { Object.assign(tab, properties); return { ...tab } as chrome.tabs.Tab; }) });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'await speech' }); const id = savedSession().active!.id;
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: id, text: 'mute this tab', alternatives: ['pin this tab'], spoken: true, final: true }, 'src/offscreen/offscreen.html');
  const question = savedSession().question!;
  expect(question.kind).toBe('speech'); expect(question.choices.map(choice => choice.label)).toEqual(['mute this tab', 'pin this tab']); expect(chrome.tabs.update).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question.id, answer: 'second' }, 'src/popup/sidepanel.html');
  expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(1, { pinned: true }); expect(savedSession().hud.phase).toBe('success');
  expect((await request({ target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question.id, answer: 'first' })).ok).toBe(false);
});
it('requires a choice when a lower-ranked transcript is the only supported command', async () => {
  await request({ target: 'background', type: 'RUN_TEXT', text: 'await speech' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'pen this tab', alternatives: ['pin this tab'], spoken: true, final: true }, 'src/offscreen/offscreen.html');
  expect(savedSession().question?.choices.map(choice => choice.label)).toEqual(['pin this tab']); expect(create).not.toHaveBeenCalled();
});
it.each(['stop', 'cancel command', 'stop listening'])('does not close a tab while the recognized alternative is %s', async alternative => {
  Object.assign(chrome.tabs, { remove: vi.fn(async () => undefined) });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'await speech' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'close this tab', alternatives: [alternative], spoken: true, final: true }, 'src/offscreen/offscreen.html');
  const question = savedSession().question!; expect(question.kind).toBe('speech'); expect(question.choices.map(choice => choice.label)).toEqual(['close this tab', alternative]); expect(chrome.tabs.remove).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question.id, answer: 'second' });
  expect(chrome.tabs.remove).not.toHaveBeenCalled(); expect(savedSession().question).toBeNull(); expect(savedSession().active).toBeNull();
});
it('keeps a primary spoken stop immediate despite a destructive alternative in single-command interpretation', async () => {
  Object.assign(chrome.tabs, { remove: vi.fn(async () => undefined) });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'await speech' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'stop', alternatives: ['close this tab'], spoken: true, final: true }, 'src/offscreen/offscreen.html');
  expect(savedSession().active).toBeNull(); expect(savedSession().question).toBeNull(); expect(chrome.tabs.remove).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});
it('retains stop as literal search data rather than a cancellation decision', async () => {
  await request({ target: 'background', type: 'RUN_TEXT', text: 'await speech' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'search Google for stop', alternatives: ['search Google for stop'], spoken: true, final: true }, 'src/offscreen/offscreen.html');
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://www.google.com/search?q=stop' })); expect(savedSession().question).toBeNull();
});
it('preserves completed steps and resumes only after an explicit site grant and resume', async () => {
  const tab = { id: 1, windowId: 1, index: 0, title: 'Example', url: 'https://example.com/', pinned: false };
  vi.mocked(chrome.tabs.get).mockImplementation(async id => ({ ...tab, id }) as chrome.tabs.Tab);
  Object.assign(chrome.tabs, { update: vi.fn(async (_id: number, properties: chrome.tabs.UpdateProperties) => { Object.assign(tab, properties); return { ...tab } as chrome.tabs.Tab; }) });
  const inject = vi.fn(async (): Promise<chrome.scripting.InjectionResult[]> => { throw new Error('Missing host permission'); });
  Object.assign(chrome, { scripting: { executeScript: inject } });
  vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
  await request({ target: 'background', type: 'RUN_TEXT', text: 'pin this tab then scroll down then open a new tab' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'pin this tab then scroll down then open a new tab', final: true }, 'src/offscreen/offscreen.html');
  const recovery = savedSession().recovery!;
  expect(recovery.kind).toBe('site-access'); expect(recovery.actions.map(action => action.action)).toEqual(['page_action', 'create_tab']);
  expect(savedSession().progress?.steps.map(step => step.status)).toEqual(['completed', 'failed', 'skipped']);
  expect((await request({ target: 'background', type: 'RESUME_COMMAND', id: recovery.id })).ok).toBe(false);
  expect(create).not.toHaveBeenCalled();
  vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
  inject.mockResolvedValue([{ frameId: 0, documentId: 'test-document' }]);
  vi.mocked(chrome.tabs.sendMessage).mockResolvedValue({ ok: true, text: 'Scrolled down', focused: true });
  await request({ target: 'background', type: 'RESUME_COMMAND', id: recovery.id });
  expect(chrome.tabs.update).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
  expect(savedSession().progress?.steps.map(step => step.status)).toEqual(['completed', 'completed', 'completed']);
  expect((await request({ target: 'background', type: 'RESUME_COMMAND', id: recovery.id })).ok).toBe(false);
});
type RecoveryInput = 'typed' | 'continuous' | 'single';
async function recoveryCommand(mode: RecoveryInput, text: string, alternatives?: string[]): Promise<Reply> {
  if (mode === 'typed') return request({ target: 'background', type: 'RUN_TEXT', text });
  if (mode === 'continuous') {
    if (!savedSession()?.capture) await request({ target: 'background', type: 'TOGGLE_LISTENING' });
    const reply = await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId: savedSession().capture!.id, text, alternatives }, 'src/offscreen/offscreen.html');
    return reply.ok && reply.request ? request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: reply.request.id, text, alternatives, final: true, spoken: true }, 'src/offscreen/offscreen.html') : reply;
  }
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  return request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text, alternatives, final: true, spoken: true }, 'src/offscreen/offscreen.html');
}
async function blockedSiteCommand(mode: RecoveryInput = 'typed') {
  local.settings = { micGranted: true, listeningMode: mode === 'single' ? 'single' : 'continuous' };
  const tab = { id: 1, windowId: 1, index: 0, title: 'Example', url: 'https://example.com/', pinned: false };
  vi.mocked(chrome.tabs.get).mockImplementation(async id => ({ ...tab, id }) as chrome.tabs.Tab);
  Object.assign(chrome.tabs, { update: vi.fn(async (_id: number, properties: chrome.tabs.UpdateProperties) => { Object.assign(tab, properties); return { ...tab } as chrome.tabs.Tab; }) });
  const inject = vi.fn(async (): Promise<chrome.scripting.InjectionResult[]> => { throw new Error('Missing host permission'); });
  Object.assign(chrome, { scripting: { executeScript: inject } });
  vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
  await request({ target: 'background', type: 'RUN_TEXT', text: 'pin this tab then scroll down then open a new tab' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'pin this tab then scroll down then open a new tab', final: true }, 'src/offscreen/offscreen.html');
  expect(savedSession().recovery?.kind).toBe('site-access');
  return { tab, allow: () => {
    vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
    inject.mockResolvedValue([{ frameId: 0, documentId: 'test-document' }]);
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValue({ ok: true, text: 'Scrolled down', focused: true });
  } };
}
it.each<RecoveryInput>(['typed', 'continuous', 'single'])('recovers remaining steps through %s commands only after site access is granted', async mode => {
  const fixture = await blockedSiteCommand(mode); const recovery = structuredClone(savedSession().recovery); const progress = structuredClone(savedSession().progress);
  const denied = await recoveryCommand(mode, 'resume remaining steps');
  expect(denied.ok).toBe(true); if (mode !== 'typed') expect(denied).toMatchObject({ handled: true, resetCapture: true });
  expect(savedSession().recovery).toEqual(recovery); expect(savedSession().progress).toEqual(progress);
  expect(savedSession().hud.text).toContain('Allow the requested site'); expect(create).not.toHaveBeenCalled(); expect(savedSession().active).toBeNull();
  fixture.allow();
  await recoveryCommand(mode, 'resume remaining steps', mode === 'typed' ? undefined : ['please resume the remaining steps']);
  expect(chrome.tabs.update).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce(); expect(savedSession().recovery).toBeNull();
  expect(savedSession().progress?.steps.map(step => step.status)).toEqual(['completed', 'completed', 'completed']);
  await recoveryCommand(mode, 'resume remaining steps');
  expect(create).toHaveBeenCalledOnce(); expect(savedSession().active).toBeNull(); expect(savedSession().hud.text).toContain('no command waiting for recovery');
});
it.each(['choose another tab', 'cancel command', 'do not resume remaining steps'])('retains recovery when spoken resume conflicts with %s', async alternative => {
  const fixture = await blockedSiteCommand('continuous'); fixture.allow(); const recovery = structuredClone(savedSession().recovery);
  expect(await recoveryCommand('continuous', 'resume remaining steps', [alternative])).toMatchObject({ ok: true, handled: true, resetCapture: true });
  expect(savedSession().recovery).toEqual(recovery); expect(savedSession().question).toBeNull(); expect(savedSession().pending).toBeNull();
  expect(create).not.toHaveBeenCalled(); expect(savedSession().hud.text).toContain('different recovery choices');
  await recoveryCommand('continuous', 'resume remaining steps'); expect(create).toHaveBeenCalledOnce();
});
it.each(['expired', 'navigated'])('keeps %s recovery blocked through voice controls', async reason => {
  const fixture = await blockedSiteCommand('continuous'); fixture.allow();
  if (reason === 'expired') savedSession().recovery!.at = Date.now() - 6 * 60_000;
  else fixture.tab.url = 'https://example.com/changed';
  const recovery = structuredClone(savedSession().recovery);
  await recoveryCommand('continuous', 'resume remaining steps');
  expect(savedSession().recovery).toEqual(recovery); expect(create).not.toHaveBeenCalled();
  expect(savedSession().hud.text).toContain(reason === 'expired' ? 'expired' : 'page changed');
});
it.each<RecoveryInput>(['typed', 'continuous'])('chooses a new recovery target through %s commands and resumes only after an answer', async mode => {
  local.settings = { micGranted: true };
  const tab = { id: 1, windowId: 1, index: 0, title: 'Example', url: 'https://example.com/', pinned: false };
  vi.mocked(chrome.tabs.get).mockImplementation(async () => ({ ...tab }) as chrome.tabs.Tab);
  vi.mocked(chrome.tabs.query).mockResolvedValue([tab] as chrome.tabs.Tab[]);
  Object.assign(chrome.tabs, { update: vi.fn(async (_id: number, properties: chrome.tabs.UpdateProperties) => { Object.assign(tab, properties); return { ...tab } as chrome.tabs.Tab; }) });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'pin missingtarget' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'pin missingtarget', final: true }, 'src/offscreen/offscreen.html');
  const original = savedSession().recovery!.request.id;
  await recoveryCommand(mode, 'choose another tab');
  expect(savedSession().recovery).toBeNull(); expect(savedSession().question?.request.id).toBe(original); expect(chrome.tabs.update).not.toHaveBeenCalled();
  if (mode === 'typed') await request({ target: 'background', type: 'RUN_TEXT', text: 'first' });
  else await recoveryCommand(mode, 'first');
  expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(1, { pinned: true });
});
it('keeps unrelated speech in single-command mode separate from an older recovery', async () => {
  await blockedSiteCommand('single');
  await recoveryCommand('single', 'open a new tab');
  expect(create).toHaveBeenCalledOnce(); expect(savedSession().recovery).toBeNull();
  expect(savedSession().progress?.steps).toHaveLength(1);
});
async function saveRecoveryPhrase(kind: 'macro' | 'routine', phrase: string): Promise<void> {
  const id = crypto.randomUUID();
  if (kind === 'macro') await request({ target: 'background', type: 'SAVE_MACRO', macro: { id, name: 'Saved phrase', phrase, urls: ['https://saved.example/'] } });
  else await request({ target: 'background', type: 'SAVE_ROUTINE', routine: { id, name: 'Saved phrase', phrase, steps: ['Open https://saved.example/'] } });
}
it.each((['macro', 'routine'] as const).flatMap(kind => (['typed', 'continuous', 'single'] as const).flatMap(mode => ['resume remaining steps', 'choose another tab'].map(phrase => ({ kind, mode, phrase })))))('preserves a saved $kind phrase without recovery via $mode: $phrase', async ({ kind, mode, phrase }) => {
  await saveRecoveryPhrase(kind, phrase);
  local.settings = { micGranted: true, listeningMode: mode === 'single' ? 'single' : 'continuous' };
  create.mockImplementationOnce(async () => { expect(savedSession().active).not.toBeNull(); return { id: 11, windowId: 1 }; });
  await recoveryCommand(mode, phrase);
  if (kind === 'routine') {
    expect(savedSession().pending?.routine).toBe(true); expect(create).not.toHaveBeenCalled();
    await request({ target: 'background', type: 'REVIEW_PLAN', requestId: savedSession().pending!.request.id, approved: true });
  }
  expect(create).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://saved.example/' }));
  expect(savedSession().hud.phase).toBe('success'); expect(savedSession().active).toBeNull();
});
it.each(['macro', 'routine'] as const)('gives an existing recovery priority over a saved %s resume phrase', async kind => {
  await saveRecoveryPhrase(kind, 'resume remaining steps');
  const fixture = await blockedSiteCommand('continuous'); fixture.allow();
  await recoveryCommand('continuous', 'resume remaining steps');
  expect(savedSession().recovery).toBeNull(); expect(savedSession().pending).toBeNull();
  expect(create).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: 'chrome://newtab/' }));
});
it.each(['macro', 'routine'] as const)('gives an existing recovery priority over a saved %s retarget phrase', async kind => {
  await saveRecoveryPhrase(kind, 'choose another tab'); local.settings = { micGranted: true };
  await request({ target: 'background', type: 'RUN_TEXT', text: 'pin missingtarget' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'pin missingtarget', final: true }, 'src/offscreen/offscreen.html');
  expect(savedSession().recovery?.kind).toBe('missing-target');
  await recoveryCommand('continuous', 'choose another tab');
  expect(savedSession().question?.prompt).toContain('remaining command'); expect(savedSession().pending).toBeNull(); expect(create).not.toHaveBeenCalled();
});
it('refuses to resume if the target navigated after the blocked command', async () => {
  const tab = { id: 1, windowId: 1, index: 0, title: 'Example', url: 'https://example.com/', pinned: false };
  vi.mocked(chrome.tabs.get).mockImplementation(async () => ({ ...tab }) as chrome.tabs.Tab);
  Object.assign(chrome, { scripting: { executeScript: vi.fn(async () => { throw new Error('Missing permission'); }) } });
  vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
  await request({ target: 'background', type: 'RUN_TEXT', text: 'scroll down' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'scroll down', final: true }, 'src/offscreen/offscreen.html');
  const id = savedSession().recovery!.id;
  tab.url = 'https://example.com/different'; vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
  const reply = await request({ target: 'background', type: 'RESUME_COMMAND', id });
  expect(reply).toMatchObject({ ok: false, error: expect.stringContaining('page changed') });
});
it('offers a new target explicitly and validates the chosen tab before continuing', async () => {
  const tab = { id: 1, windowId: 1, index: 0, title: 'Example', url: 'https://example.com/', pinned: false };
  vi.mocked(chrome.tabs.get).mockImplementation(async () => ({ ...tab }) as chrome.tabs.Tab);
  vi.mocked(chrome.tabs.query).mockResolvedValue([tab] as chrome.tabs.Tab[]);
  Object.assign(chrome.tabs, { update: vi.fn(async (_id: number, properties: chrome.tabs.UpdateProperties) => { Object.assign(tab, properties); return { ...tab } as chrome.tabs.Tab; }) });
  await request({ target: 'background', type: 'RUN_TEXT', text: 'pin missingtarget' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'pin missingtarget', final: true }, 'src/offscreen/offscreen.html');
  expect(savedSession().recovery?.kind).toBe('missing-target');
  await request({ target: 'background', type: 'CHOOSE_RECOVERY_TAB', id: savedSession().recovery!.id });
  expect(chrome.tabs.update).not.toHaveBeenCalled();
  const question = savedSession().question!;
  tab.url = 'https://example.com/changed';
  await request({ target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question.id, answer: 'first' });
  expect(chrome.tabs.update).not.toHaveBeenCalled(); expect(savedSession().hud.text).toContain('chosen tab changed');
});
it('does not offer automatic resume when Chrome cannot confirm a mutation', async () => {
  chrome.tabs.update = vi.fn(async () => ({ id: 1, windowId: 1 }) as chrome.tabs.Tab);
  await request({ target: 'background', type: 'RUN_TEXT', text: 'pin this tab' });
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: savedSession().active!.id, text: 'pin this tab', final: true }, 'src/offscreen/offscreen.html');
  expect(savedSession().recovery).toMatchObject({ kind: 'unknown-outcome', actions: [] });
  expect((await request({ target: 'background', type: 'RESUME_COMMAND', id: savedSession().recovery!.id })).ok).toBe(false);
  expect(chrome.tabs.update).toHaveBeenCalledOnce();
});
it('allows basic preferences to be saved while an unused AI configuration is incomplete', async () => {
  const settings = { ...defaultSettings, aiEnabled: false, aiProvider: 'compatible' as const, aiBaseUrl: '', aiModel: '', language: 'en-GB' as const };
  expect((await request({ target: 'background', type: 'SAVE_SETTINGS', settings })).ok).toBe(true);
  const reply = await request({ target: 'background', type: 'GET_STATE' });
  expect(reply.ok && reply.state?.settings.language).toBe('en-GB'); expect(reply.ok && reply.state?.hasApiKey).toBe(false);
  expect(chrome.permissions.contains).not.toHaveBeenCalled();
});

async function singleDecisionReview(): Promise<NonNullable<SessionState['pending']>> {
  local.settings = { micGranted: true, listeningMode: 'single', feedback: 'none' };
  const template = { id: crypto.randomUUID(), name: 'Single decision', phrase: 'My single decision', steps: ['Open a new tab'] };
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: template });
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  const active = savedSession().active!;
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: active.id, text: template.phrase, final: true, spoken: true }, 'src/offscreen/offscreen.html');
  return structuredClone(savedSession().pending!);
}
async function decisionSpeech(text: string, alternatives?: string[]): Promise<Reply> {
  const sessionId = savedSession().capture!.id;
  return request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text, alternatives }, 'src/offscreen/offscreen.html');
}
it('listens for one pending single-command review answer without replacing its original target or expiry', async () => {
  const pending = await singleDecisionReview(); expect(savedSession().capture).toBeNull(); expect(savedSession().active).toBeNull();
  vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 99, windowId: 9 }] as chrome.tabs.Tab[]);
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  expect(savedSession().pending).toEqual(pending);
  expect(savedSession().capture).toMatchObject({ decisionId: pending.request.id, decisionKind: 'review' });
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'START_DECISION_LISTENING', decisionId: pending.request.id }));
  const sessionId = savedSession().capture!.id;
  await decisionSpeech('confirm command', ['go ahead']);
  expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ windowId: 1 }));
  expect(savedSession().pending).toBeNull(); expect(savedSession().capture).toBeNull();
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'confirm command' }, 'src/offscreen/offscreen.html');
  expect(create).toHaveBeenCalledOnce();
});
it('requires another one-shot answer after conflicting readback/approval alternatives and preserves original expiry', async () => {
  const pending = await singleDecisionReview();
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id });
  await decisionSpeech('confirm command', ['read the command']);
  expect(create).not.toHaveBeenCalled(); expect(savedSession().pending).toEqual(pending); expect(savedSession().capture).toBeNull();
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id });
  await decisionSpeech('read the command', ['confirm command']);
  expect(create).not.toHaveBeenCalled(); expect(savedSession().pending).toEqual(pending);
  expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.filter(([message]) => (message as unknown as Message).type === 'SPEAK_READBACK')).toHaveLength(0);
});
it('retains a pending decision on microphone timeout, ignores late errors, and never extends expiry', async () => {
  const pending = await singleDecisionReview();
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id });
  const first = savedSession().capture!.id;
  await request({ target: 'background', type: 'DECISION_LISTENING_ERROR', sessionId: first, decisionId: pending.request.id, error: 'Listening timed out.' }, 'src/offscreen/offscreen.html');
  expect(savedSession().capture).toBeNull(); expect(savedSession().pending).toEqual(pending);
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id });
  const second = savedSession().capture!.id;
  await request({ target: 'background', type: 'DECISION_LISTENING_ERROR', sessionId: first, decisionId: pending.request.id, error: 'Old callback' }, 'src/offscreen/offscreen.html');
  expect(savedSession().capture?.id).toBe(second);
  savedSession().pending!.request.startedAt = Date.now() - 6 * 60_000;
  expect((await decisionSpeech('confirm command')).ok).toBe(false); expect(create).not.toHaveBeenCalled();
  expect((await request({ target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'repeat' })).ok).toBe(false);
  expect((await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id })).ok).toBe(false);
});
it('keeps single-decision stop immediate and does not restart continuous capture', async () => {
  const pending = await singleDecisionReview();
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id });
  await decisionSpeech('stop', ['confirm command']);
  expect(savedSession().capture).toBeNull(); expect(savedSession().pending).toBeNull(); expect(create).not.toHaveBeenCalled();
  expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.filter(([message]) => (message as unknown as Message).type === 'START_LISTENING')).toHaveLength(1);
});
it('reads a pending review only on explicit request even with feedback off, preserving decision and progress', async () => {
  const pending = await singleDecisionReview(); const progress = structuredClone(savedSession().progress);
  expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.filter(([message]) => (message as unknown as Message).type === 'FEEDBACK')).toHaveLength(0);
  await request({ target: 'background', type: 'RUN_TEXT', text: 'read the command' });
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SPEAK_READBACK', segments: expect.arrayContaining(['Step 1. Open a new tab']) }));
  expect(savedSession().pending).toEqual(pending); expect(savedSession().progress).toEqual(progress); expect(create).not.toHaveBeenCalled();
  const first = structuredClone(savedSession().decisionReadback);
  await request({ target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'repeat' });
  expect(savedSession().decisionReadback).toMatchObject({ page: first!.page, totalPages: first!.totalPages, text: first!.text });
  expect(savedSession().decisionReadback?.readbackId).not.toBe(first!.readbackId); expect(savedSession().pending).toEqual(pending);
  const state = await request({ target: 'background', type: 'GET_STATE' }); expect(state.ok && state.state?.decisionReadback?.text).toContain('Step 1. Open a new tab');
});
it('treats readback wording as literal freeform input and cancels a pending listener when the UI answers', async () => {
  local.settings = { micGranted: true, listeningMode: 'single' };
  const template = { id: crypto.randomUUID(), name: 'Text input', phrase: 'Research {topic}', steps: ['Search Wikipedia for {topic}'] };
  await request({ target: 'background', type: 'SAVE_ROUTINE', routine: template });
  await request({ target: 'background', type: 'RUN_ROUTINE', id: template.id });
  const question = structuredClone(savedSession().question!);
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: question.id });
  await decisionSpeech('read the choices');
  expect(savedSession().pending?.actions[0]).toMatchObject({ action: 'search_site', params: { query: 'read the choices' } });
  expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.filter(([message]) => (message as unknown as Message).type === 'SPEAK_READBACK')).toHaveLength(0);
  await request({ target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  await request({ target: 'background', type: 'RUN_ROUTINE', id: template.id });
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: savedSession().question!.id });
  const sessionId = savedSession().capture!.id;
  await request({ target: 'background', type: 'ANSWER_CLARIFICATION', questionId: savedSession().question!.id, answer: 'literal user data' });
  expect(savedSession().capture).toBeNull(); expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ target: 'offscreen', type: 'CANCEL_DECISION_AUDIO' });
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'close all tabs' }, 'src/offscreen/offscreen.html');
  expect(savedSession().pending?.actions[0]).toMatchObject({ action: 'search_site', params: { query: 'literal user data' } });
});
it('refuses stale decision IDs and keeps decisions intact when microphone permission is missing', async () => {
  const pending = await singleDecisionReview(); local.settings = { micGranted: false };
  expect((await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id })).ok).toBe(false);
  expect((await request({ target: 'background', type: 'READ_DECISION', decisionId: crypto.randomUUID(), direction: 'repeat' })).ok).toBe(false);
  expect(savedSession().pending).toEqual(pending); expect(create).not.toHaveBeenCalled();
});
it('pages structured choices without renumbering or answering, then accepts a bounded one-shot numbered answer', async () => {
  const tabs = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, windowId: 1, index, title: index ? `Gmail account ${index}` : 'Welcome', url: index ? `https://mail.google.com/mail/u/${index}/` : 'https://example.com/', pinned: false }));
  vi.mocked(chrome.tabs.query).mockImplementation(async filter => (filter.active ? [tabs[0]!] : tabs) as chrome.tabs.Tab[]);
  vi.mocked(chrome.tabs.get).mockImplementation(async id => tabs.find(tab => tab.id === id)! as chrome.tabs.Tab);
  Object.assign(chrome.tabs, { update: vi.fn(async (id: number, patch: chrome.tabs.UpdateProperties) => Object.assign(tabs.find(tab => tab.id === id)!, patch)) });
  local.settings = { micGranted: true, listeningMode: 'single' };
  await request({ target: 'background', type: 'TOGGLE_LISTENING' });
  const active = savedSession().active!;
  await request({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId: active.id, text: 'pin Gmail', final: true, spoken: true }, 'src/offscreen/offscreen.html');
  const question = structuredClone(savedSession().question!); expect(question.choices).toHaveLength(4);
  await request({ target: 'background', type: 'READ_DECISION', decisionId: question.id, direction: 'repeat' });
  await request({ target: 'background', type: 'READ_DECISION', decisionId: question.id, direction: 'next' });
  await request({ target: 'background', type: 'READ_DECISION', decisionId: question.id, direction: 'next' });
  expect(savedSession().decisionReadback?.text).toContain('Option 4. Gmail account 4');
  expect(savedSession().question).toEqual(question); expect(chrome.tabs.update).not.toHaveBeenCalled();
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: question.id });
  await decisionSpeech('four', ['option 4']);
  expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(5, { pinned: true });
  expect(savedSession().capture).toBeNull(); expect(savedSession().question).toBeNull(); expect(savedSession().decisionReadback).toBeUndefined();
});
it('reports only the current readback completion and ignores stale notices during a newer listener', async () => {
  const pending = await singleDecisionReview();
  await request({ target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'repeat' });
  const first = savedSession().decisionReadback!.readbackId!;
  await request({ target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'repeat' });
  const second = savedSession().decisionReadback!.readbackId!; const before = structuredClone(savedSession().hud);
  await request({ target: 'background', type: 'READBACK_FINISHED', readbackId: first, error: 'Old playback failed' }, 'src/offscreen/offscreen.html');
  expect(savedSession().hud).toEqual(before);
  await request({ target: 'background', type: 'READBACK_FINISHED', readbackId: second }, 'src/offscreen/offscreen.html');
  expect(savedSession().hud.text).toContain('Page 1 of 1 read'); expect(savedSession().pending).toEqual(pending);
  await request({ target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'repeat' });
  const third = savedSession().decisionReadback!.readbackId!;
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id });
  const listening = structuredClone(savedSession().hud); const capture = structuredClone(savedSession().capture);
  await request({ target: 'background', type: 'READBACK_FINISHED', readbackId: third }, 'src/offscreen/offscreen.html');
  expect(savedSession().hud).toEqual(listening); expect(savedSession().capture).toEqual(capture);
  await request({ target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  const stopped = structuredClone(savedSession().hud);
  await request({ target: 'background', type: 'READBACK_FINISHED', readbackId: third, error: 'Very late error' }, 'src/offscreen/offscreen.html');
  expect(savedSession().hud).toEqual(stopped); expect(savedSession().decisionReadback).toBeUndefined();
});
it('refreshes engine activity for explicit readback/listening without extending decision expiry', async () => {
  const pending = await singleDecisionReview(); savedSession().lastActivity = 0;
  await request({ target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'repeat' });
  expect(savedSession().lastActivity).toBeGreaterThan(0); expect(savedSession().pending).toEqual(pending);
  const readbackId = savedSession().decisionReadback!.readbackId!;
  await request({ target: 'background', type: 'READBACK_FINISHED', readbackId, error: 'Readback timed out before this page finished.' }, 'src/offscreen/offscreen.html');
  expect(savedSession().hud.text).toContain('timed out'); expect(savedSession().pending).toEqual(pending);
  close.mockClear(); alarmListener({ name: 'handsfree-idle', scheduledTime: Date.now() }); await request({ target: 'background', type: 'GET_STATE' });
  expect(close).not.toHaveBeenCalled();
  savedSession().lastActivity = 0;
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id });
  expect(savedSession().lastActivity).toBeGreaterThan(0); expect(savedSession().pending).toEqual(pending);
});

async function settleDecisionOperations(): Promise<void> { for (let index = 0; index < 100; index++) await Promise.resolve(); }
it.each(['listen', 'readback'] as const)('cancels %s startup before unresolved ensure and drops queued readback without late audio or HUD', async mode => {
  const pending = await singleDecisionReview(); let release: () => void = () => undefined; let entered = false;
  vi.mocked(ensureOffscreen).mockImplementationOnce(() => { entered = true; return new Promise<void>(resolve => { release = resolve; }); });
  vi.mocked(chrome.runtime.sendMessage).mockClear();
  const starting = request(mode === 'listen' ? { target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id } : { target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'repeat' });
  await settleDecisionOperations(); expect(entered).toBe(true);
  const queued = request({ target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'next' });
  await request({ target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  expect(savedSession().pending).toBeNull(); expect(savedSession().capture).toBeNull(); expect(close).toHaveBeenCalled();
  const stopped = structuredClone(savedSession().hud);
  release(); await Promise.all([starting, queued]); await settleDecisionOperations();
  expect(savedSession().hud).toEqual(stopped);
  expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.filter(([value]) => ['START_DECISION_LISTENING', 'SPEAK_READBACK'].includes((value as unknown as Message).type))).toHaveLength(0);
});
it.each(['listen', 'readback'] as const)('cancels %s with an unresolved start acknowledgement and ignores its late result', async mode => {
  const pending = await singleDecisionReview(); let release: (reply: Reply) => void = () => undefined; let entered = false;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((message: Message) => {
    if (message.type === 'START_DECISION_LISTENING' || message.type === 'SPEAK_READBACK') { entered = true; return new Promise<Reply>(resolve => { release = resolve; }); }
    return Promise.resolve({ ok: true });
  }) as typeof chrome.runtime.sendMessage);
  const starting = request(mode === 'listen' ? { target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id } : { target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'repeat' });
  await settleDecisionOperations(); expect(entered).toBe(true);
  await request({ target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  const stopped = structuredClone(savedSession().hud);
  expect(savedSession().pending).toBeNull(); expect(savedSession().capture).toBeNull();
  release({ ok: true }); await starting; await settleDecisionOperations();
  expect(savedSession().hud).toEqual(stopped); expect(savedSession().decisionReadback).toBeUndefined(); expect(create).not.toHaveBeenCalled();
});
it.each(['listen', 'readback'] as const)('bounds a stalled %s engine startup while retaining the original decision', async mode => {
  const pending = await singleDecisionReview(); vi.useFakeTimers();
  let release: () => void = () => undefined;
  vi.mocked(ensureOffscreen).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  try {
    const starting = request(mode === 'listen' ? { target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id } : { target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'repeat' });
    await settleDecisionOperations(); await vi.advanceTimersByTimeAsync(10_001); await starting;
    expect(savedSession().pending).toEqual(pending); expect(savedSession().capture).toBeNull(); expect(savedSession().hud.text).toContain('did not start');
    release(); await settleDecisionOperations(); expect(create).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
it('preserves decision and readback correlations through service-worker reload without replay after Stop', async () => {
  const pending = await singleDecisionReview();
  await request({ target: 'background', type: 'READ_DECISION', decisionId: pending.request.id, direction: 'repeat' });
  const readbackId = savedSession().decisionReadback!.readbackId!;
  vi.resetModules(); await import('../src/background/index');
  await request({ target: 'background', type: 'READBACK_FINISHED', readbackId }, 'src/offscreen/offscreen.html');
  expect(savedSession().hud.text).toContain('Page 1 of 1 read'); expect(savedSession().pending).toEqual(pending);
  await request({ target: 'background', type: 'LISTEN_DECISION', decisionId: pending.request.id });
  const sessionId = savedSession().capture!.id;
  vi.resetModules(); await import('../src/background/index');
  await request({ target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  const stopped = structuredClone(savedSession().hud);
  await request({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'confirm command' }, 'src/offscreen/offscreen.html');
  await request({ target: 'background', type: 'READBACK_FINISHED', readbackId }, 'src/offscreen/offscreen.html');
  expect(create).not.toHaveBeenCalled(); expect(savedSession().hud).toEqual(stopped);
});

const startupModes = ['typed', 'continuous', 'single', 'setup'] as const;
type StartupMode = typeof startupModes[number];
function startupMessage(mode: StartupMode): Message {
  local.settings = { ...defaultSettings, micGranted: true, listeningMode: mode === 'continuous' ? 'continuous' : 'single' };
  return mode === 'typed' ? { target: 'background', type: 'RUN_TEXT', text: 'open a new tab' }
    : mode === 'setup' ? { target: 'background', type: 'START_VOICE_SETUP' }
      : { target: 'background', type: 'TOGGLE_LISTENING' };
}
it.each(startupModes)('stops %s before unresolved engine startup and drops earlier queued starts', async mode => {
  let release: () => void = () => undefined; let entered = false;
  vi.mocked(ensureOffscreen).mockImplementationOnce(() => { entered = true; return new Promise<void>(resolve => { release = resolve; }); });
  const starting = request(startupMessage(mode));
  await settleDecisionOperations(); expect(entered).toBe(true);
  const activeId = savedSession().active?.id ?? savedSession().capture!.id;
  const queued = request({ target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
  const queuedSetup = request({ target: 'background', type: 'START_VOICE_SETUP' });
  await request(mode === 'setup' ? { target: 'background', type: 'CANCEL_VOICE_SETUP', id: activeId } : { target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  const stopped = structuredClone(savedSession().hud);
  expect(savedSession().active).toBeNull(); expect(savedSession().capture).toBeNull(); expect(close).toHaveBeenCalled();
  if (mode === 'setup') expect(savedSession().voiceSetup?.status).toBe('cancelled');
  release(); await Promise.all([starting, queued, queuedSetup]); await settleDecisionOperations();
  expect(savedSession().hud).toEqual(stopped);
  expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.filter(([value]) => ['START_LISTENING', 'PARSE_TEXT'].includes((value as unknown as Message).type))).toHaveLength(0);
  await request({ target: 'background', type: 'EXECUTE_ACTIONS', requestId: activeId, source: 'grammar', transcript: 'open a new tab', actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }] }, 'src/offscreen/offscreen.html');
  expect(create).not.toHaveBeenCalled(); expect(savedSession().hud).toEqual(stopped);
});
it.each(startupModes)('stops %s before its startup acknowledgement and ignores late failures and callbacks', async mode => {
  let release: (reply: Reply) => void = () => undefined; let entered = false;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((message: Message) => {
    if (message.type === 'START_LISTENING' || message.type === 'PARSE_TEXT') { entered = true; return new Promise<Reply>(resolve => { release = resolve; }); }
    return Promise.resolve({ ok: true });
  }) as typeof chrome.runtime.sendMessage);
  const starting = request(startupMessage(mode));
  await settleDecisionOperations(); expect(entered).toBe(true);
  const activeId = savedSession().active?.id ?? savedSession().capture!.id;
  await request(mode === 'setup' ? { target: 'background', type: 'CANCEL_VOICE_SETUP', id: activeId } : { target: 'background', type: 'TOGGLE_LISTENING' });
  const stopped = structuredClone(savedSession().hud);
  expect(savedSession().active).toBeNull(); expect(savedSession().capture).toBeNull();
  release({ ok: false, error: 'Late startup failure' }); await starting; await settleDecisionOperations();
  await request({ target: 'background', type: 'ENGINE_LISTENING', requestId: activeId }, 'src/offscreen/offscreen.html');
  await request({ target: 'background', type: 'EXECUTE_ACTIONS', requestId: activeId, source: 'grammar', transcript: 'open a new tab', actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }] }, 'src/offscreen/offscreen.html');
  expect(savedSession().hud).toEqual(stopped); expect(create).not.toHaveBeenCalled();
  if (mode === 'setup') expect(savedSession().voiceSetup?.status).toBe('cancelled');
});
it.each(startupModes)('bounds unresolved %s engine creation without launching late work', async mode => {
  vi.useFakeTimers(); let release: () => void = () => undefined;
  vi.mocked(ensureOffscreen).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  try {
    const starting = request(startupMessage(mode));
    await settleDecisionOperations(); await vi.advanceTimersByTimeAsync(10_001);
    expect(await starting).toEqual({ ok: false, error: 'The voice engine did not start. Try again.' });
    expect(savedSession().active).toBeNull(); expect(savedSession().capture).toBeNull(); expect(savedSession().hud.phase).toBe('error');
    if (mode === 'setup') expect(savedSession().voiceSetup?.status).toBe('failed');
    release(); await settleDecisionOperations();
    expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.filter(([value]) => ['START_LISTENING', 'PARSE_TEXT'].includes((value as unknown as Message).type))).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
it.each(startupModes)('revalidates %s request ownership after engine creation', async mode => {
  let release: () => void = () => undefined;
  vi.mocked(ensureOffscreen).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const starting = request(startupMessage(mode)); await settleDecisionOperations();
  if (mode === 'setup') savedSession().voiceSetup!.status = 'cancelled';
  else if (mode === 'continuous') savedSession().capture = null;
  else savedSession().active = null;
  release(); await starting;
  expect(vi.mocked(chrome.runtime.sendMessage).mock.calls.filter(([value]) => ['START_LISTENING', 'PARSE_TEXT'].includes((value as unknown as Message).type))).toHaveLength(0);
  expect(create).not.toHaveBeenCalled();
});
