import { beforeEach, expect, it, vi } from 'vitest';
import type { Message } from '../src/common/schema';
import type { Reply } from '../src/common/types';
import type { SessionState } from '../src/background/store';

type Listener = (raw: unknown, sender: chrome.runtime.MessageSender, respond: (reply: Reply) => void) => boolean;
let listener: Listener;
let local: Record<string, unknown>;
let session: Record<string, unknown>;
let open: chrome.tabs.Tab[];
let nextId: number;
let continuationBegin: (() => Promise<void>) | undefined;
const url = (path: string): string => `chrome-extension://test/${path}`;
const make = (id: number, windowId: number, index: number, active = false): chrome.tabs.Tab => ({ id, windowId, index, active, title: `Tab ${id}`, url: `https://example.com/${id}`, pinned: false } as chrome.tabs.Tab);
const get = (id: number): chrome.tabs.Tab => { const tab = open.find(tab => tab.id === id); if (!tab) throw new Error('Tab no longer exists'); return tab; };
const state = (): SessionState => session.session as SessionState;
const create = vi.fn<(props: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>>();
const remove = vi.fn<(ids: number | number[]) => Promise<void>>();
const update = vi.fn<(id: number, props: chrome.tabs.UpdateProperties) => Promise<chrome.tabs.Tab>>();
vi.mock('../src/background/offscreen-manager', () => ({ ensureOffscreen: vi.fn(async () => undefined), closeOffscreen: vi.fn(async () => undefined), hasOffscreen: vi.fn(async () => false) }));

async function request(message: Message): Promise<Reply> {
  return new Promise(resolve => { listener(message, { id: 'test', url: url('src/popup/popup.html') }, resolve); });
}
async function reviewRoutine(steps: string[]): Promise<string> {
  const routine = { id: crypto.randomUUID(), name: 'Reviewed workflow', phrase: 'Run my reviewed workflow', steps };
  expect(await request({ target: 'background', type: 'SAVE_ROUTINE', routine })).toMatchObject({ ok: true });
  expect(await request({ target: 'background', type: 'RUN_ROUTINE', id: routine.id })).toMatchObject({ ok: true });
  const id = state().pending!.request.id;
  await request({ target: 'background', type: 'REVIEW_PLAN', requestId: id, approved: true });
  expect(state().pending?.operation).toBeTruthy();
  return id;
}
const approve = (requestId: string): Promise<Reply> => request({ target: 'background', type: 'REVIEW_PLAN', requestId, approved: true });

beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks();
  local = { settings: { aiEnabled: false, feedback: 'none' } }; session = {}; nextId = 100; continuationBegin = undefined;
  open = [make(1, 1, 0, true), make(2, 1, 1), make(3, 1, 2), make(4, 2, 0, true)];
  const storage = (data: Record<string, unknown>) => ({ get: async () => structuredClone(data), set: async (patch: Record<string, unknown>) => {
    const next = patch.session as SessionState | undefined;
    if (data === session && next?.active && next.hud.phase === 'success') await continuationBegin?.();
    Object.assign(data, structuredClone(patch));
  }, setAccessLevel: vi.fn() });
  create.mockImplementation(async props => {
    const windowId = props.windowId ?? 1;
    if (!open.some(tab => tab.windowId === windowId)) throw new Error('Window no longer exists');
    const tab = { ...make(nextId++, windowId, open.filter(tab => tab.windowId === windowId).length, props.active ?? true), url: props.url };
    if (tab.active) open.filter(tab => tab.windowId === windowId).forEach(tab => { tab.active = false; });
    open.push(tab); return structuredClone(tab);
  });
  remove.mockImplementation(async ids => {
    const selected = Array.isArray(ids) ? ids : [ids]; open = open.filter(tab => !selected.includes(tab.id!));
    for (const windowId of new Set(open.map(tab => tab.windowId))) {
      const tabs = open.filter(tab => tab.windowId === windowId).sort((a, b) => a.index - b.index);
      tabs.forEach((tab, index) => { tab.index = index; });
      if (!tabs.some(tab => tab.active)) tabs[0]!.active = true;
    }
  });
  update.mockImplementation(async (id, props) => {
    const tab = get(id);
    if (props.active) open.filter(other => other.windowId === tab.windowId).forEach(other => { other.active = other.id === id; });
    if (props.pinned !== undefined) {
      tab.pinned = props.pinned;
      const others = open.filter(other => other.windowId === tab.windowId && other.id !== id).sort((a, b) => a.index - b.index);
      others.splice(others.filter(other => other.pinned).length, 0, tab); others.forEach((item, index) => { item.index = index; });
    }
    return structuredClone(tab);
  });
  vi.stubGlobal('chrome', {
    runtime: { id: 'test', getURL: url, onMessage: { addListener: (fn: Listener) => { listener = fn; } }, onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() }, sendMessage: vi.fn(async () => ({ ok: true })) },
    permissions: { contains: vi.fn(async () => true) },
    storage: { local: storage(local), session: storage(session) },
    commands: { onCommand: { addListener: vi.fn() }, getAll: vi.fn(async () => []) },
    tabs: {
      get: vi.fn(async (id: number) => structuredClone(get(id))), create, remove, update, sendMessage: vi.fn(async () => ({ ok: true })),
      query: vi.fn(async (filter: chrome.tabs.QueryInfo) => structuredClone(open.filter(tab => (filter.windowId === undefined || filter.windowId === tab.windowId) && (!filter.lastFocusedWindow || tab.windowId === 1) && (filter.active === undefined || filter.active === tab.active)))),
    },
    readingList: { query: vi.fn(async () => [1, 2, 3].map(index => ({ title: `Article ${index}`, url: `https://articles.example/${index}`, hasBeenRead: false, creationTime: 10 - index, lastUpdateTime: 10 - index }))) },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
    alarms: { onAlarm: { addListener: vi.fn() }, create: vi.fn(), clear: vi.fn() },
  });
  await import('../src/background/index');
});

it('pins the active survivor after reviewed selected tabs close', async () => {
  const id = await reviewRoutine(['Close tabs two and three', 'Pin this tab']);
  expect(state().pending?.targets?.map(tab => tab.id)).toEqual([2, 3]);
  await approve(id);
  expect(remove).toHaveBeenCalledWith([2, 3]); expect(get(1).pinned).toBe(true); expect(get(4).pinned).toBe(false);
  expect(state().progress?.steps.map(step => step.status)).toEqual(['completed', 'completed', 'completed']);
  expect(state().hud.phase).toBe('success');
});
it('pins the first newly opened article after review and preserves the originating tab', async () => {
  const id = await reviewRoutine(['Open my unread articles', 'Pin this tab']);
  await approve(id);
  expect(create).toHaveBeenCalledTimes(3); expect(get(100).pinned).toBe(true);
  expect([1, 101, 102].every(id => !get(id).pinned)).toBe(true);
  expect(state().progress?.steps.map(step => step.status)).toEqual(['completed', 'completed']);
});
it('keeps all reviewed articles available to the plural follow-up', async () => {
  const id = await reviewRoutine(['Open my unread articles', 'Pin them']);
  await approve(id);
  expect([100, 101, 102].every(id => get(id).pinned)).toBe(true); expect(get(1).pinned).toBe(false);
  expect(state().conversation.targets.map(tab => tab.id)).toEqual([100, 101, 102]);
});
it('stops after closing the whole reviewed window instead of changing another window', async () => {
  const id = await reviewRoutine(['Close all tabs', 'Pin this tab']);
  await approve(id);
  expect(open.map(tab => tab.id)).toEqual([4]); expect(get(4).pinned).toBe(false); expect(update).not.toHaveBeenCalled();
  expect(state().hud).toMatchObject({ phase: 'error', text: expect.stringContaining('No tab remains in that window') });
  expect(state().progress?.steps.map(step => step.status)).toEqual(['completed', 'skipped']);
  expect(state().conversation.targets).toEqual([]);
});
it('reports the exact opened count and never continues after a partial article-opening failure', async () => {
  const id = await reviewRoutine(['Open my unread articles', 'Pin this tab']);
  const openTab = create.getMockImplementation()!;
  create.mockImplementation(async props => { if (create.mock.calls.length === 3) throw new Error('Chrome refused another tab'); return openTab(props); });
  await approve(id);
  expect(open.filter(tab => tab.id! >= 100)).toHaveLength(2); expect(update).not.toHaveBeenCalled();
  expect(state().hud).toMatchObject({ phase: 'error', text: 'Opened 2 articles before stopping. Chrome refused another tab' });
  expect(state().progress?.steps.map(step => step.status)).toEqual(['failed', 'skipped']);
  expect(state().conversation.targets.map(tab => tab.id)).toEqual([100, 101]);
});
it.each(['close', 'open_reading'] as const)('does not continue when stopped during the final reviewed %s mutation', async operation => {
  const id = await reviewRoutine([operation === 'close' ? 'Close tabs two and three' : 'Open my unread articles', 'Pin this tab']);
  let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
  if (operation === 'close') {
    const closeTabs = remove.getMockImplementation()!;
    remove.mockImplementationOnce(async ids => { await closeTabs(ids); await paused; });
  } else {
    const openTab = create.getMockImplementation()!;
    create.mockImplementation(async props => { const tab = await openTab(props); if (create.mock.calls.length === 3) await paused; return tab; });
  }
  const running = approve(id);
  await vi.waitFor(() => expect(operation === 'close' ? remove : create).toHaveBeenCalledTimes(operation === 'close' ? 1 : 3));
  const stopping = request({ target: 'background', type: 'RUN_TEXT', text: 'stop' });
  release(); await Promise.all([running, stopping]);
  expect(update).not.toHaveBeenCalled();
  expect(state().progress?.status).toBe('cancelled');
  expect(state().progress?.steps.at(-1)?.status).toBe('skipped');
});
it('keeps Stop effective during the handoff from the reviewed action into its remaining plan', async () => {
  const id = await reviewRoutine(['Open my unread articles', 'Pin this tab']);
  let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
  let handingOff = false;
  continuationBegin = async () => { handingOff = true; await paused; };
  const running = approve(id);
  await vi.waitFor(() => expect(handingOff).toBe(true));
  const stopping = request({ target: 'background', type: 'RUN_TEXT', text: 'stop' });
  continuationBegin = undefined; release(); await Promise.all([running, stopping]);
  expect(create).toHaveBeenCalledTimes(3); expect(update).not.toHaveBeenCalled();
  expect(state().progress?.status).toBe('cancelled');
  expect(state().progress?.steps.map(step => step.status)).toEqual(['completed', 'skipped']);
});
