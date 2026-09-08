import { beforeEach, expect, it, vi } from 'vitest';
import type { Message } from '../src/common/schema';
import type { Reply } from '../src/common/types';

type Listener = (raw: unknown, sender: chrome.runtime.MessageSender, respond: (reply: Reply) => void) => boolean;
let listener: Listener;
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
    storage: { local: storage(local), session: storage(session) },
    commands: { onCommand: { addListener: vi.fn() }, getAll: vi.fn(async () => []) },
    tabs: { query: vi.fn(async () => [{ id: 1, windowId: 1 }]), sendMessage: vi.fn(async () => ({ ok: true })), create },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
    alarms: { onAlarm: { addListener: vi.fn() }, create: vi.fn(), clear: vi.fn() },
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
it('requires approval for AI plans and consumes approval once', async () => {
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
