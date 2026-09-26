import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchActions, dispatchMacro } from '../src/background/dispatcher';
import { parseCommand } from '../src/common/command-parser';
import { defaultSettings } from '../src/common/schema';
import { ChoiceRequired, ReviewRequired, emptyConversation, type Question, type TargetContext } from '../src/common/conversation';
import { contextAfterClose, finalizeUndo, type ExecutionEnvironment } from '../src/background/execution';
import { answerChoice } from '../src/background/choices';
import { getLibrary, refreshSiteSuggestions } from '../src/background/library-store';
import type { ProgressEvent } from '../src/common/progress';
import { decisionReadback } from '../src/common/decision-readback';

let open: chrome.tabs.Tab[];
let groups: chrome.tabGroups.TabGroup[];
let storage: Record<string, unknown>;
let env: ExecutionEnvironment;
let nextId: number;
let reading: chrome.readingList.ReadingListEntry[];
const initial = { tabId: 1, windowId: 10 };
const make = (id: number, title: string, url: string, index: number, extra: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab => ({ id, title, url, index, windowId: 10, active: id === 1, pinned: false, groupId: -1, highlighted: id === 1, mutedInfo: { muted: false }, ...extra } as chrome.tabs.Tab);
const get = (id: number): chrome.tabs.Tab => { const tab = open.find(tab => tab.id === id); if (!tab) throw new Error('Tab no longer exists'); return tab; };
const tabs = { query: vi.fn(), get: vi.fn(), update: vi.fn(), create: vi.fn(), remove: vi.fn(), move: vi.fn(), group: vi.fn(), ungroup: vi.fn(), getZoom: vi.fn(), setZoom: vi.fn() };
const windows = { update: vi.fn(), create: vi.fn() };
const tabGroups = { query: vi.fn(), get: vi.fn(), update: vi.fn(), move: vi.fn() };
const reindex = (windowId: number): void => { open.filter(tab => tab.windowId === windowId).sort((a, b) => a.index - b.index).forEach((tab, index) => { tab.index = index; }); };
async function run(text: string, context: TargetContext = initial): Promise<void> {
  env.operationId = crypto.randomUUID(); env.transcript = text;
  await dispatchActions(parseCommand(text), context, env); await finalizeUndo(env);
}
beforeEach(() => {
  vi.resetAllMocks(); nextId = 100; storage = {}; groups = []; reading = [];
  open = [make(1, 'Welcome', 'https://example.com/', 0), make(2, 'Personal Gmail', 'https://mail.google.com/mail/u/0/', 1), make(3, 'YouTube', 'https://www.youtube.com/', 2), make(4, 'GitHub', 'https://github.com/', 0, { windowId: 20 })];
  env = { settings: structuredClone(defaultSettings), library: { aliases: [], workspaces: [], suggestions: [] }, macros: [], state: emptyConversation(), overrides: {}, operationId: crypto.randomUUID(), transcript: 'Test command' };
  tabs.query.mockImplementation(async (filter: chrome.tabs.QueryInfo) => structuredClone(open.filter(tab => (filter.windowId === undefined || filter.windowId === tab.windowId) && (filter.active === undefined || filter.active === tab.active) && (filter.audible === undefined || filter.audible === tab.audible) && (filter.highlighted === undefined || filter.highlighted === tab.highlighted))));
  tabs.get.mockImplementation(async (id: number) => structuredClone(get(id)));
  tabs.update.mockImplementation(async (id: number, props: chrome.tabs.UpdateProperties) => {
    const tab = get(id);
    if (props.active) open.filter(other => other.windowId === tab.windowId).forEach(other => { other.active = other.id === id; });
    if (props.muted !== undefined) tab.mutedInfo = { muted: props.muted };
    if (props.pinned !== undefined) {
      tab.pinned = props.pinned; const others = open.filter(other => other.windowId === tab.windowId && other.id !== id).sort((a, b) => a.index - b.index);
      const index = others.filter(other => other.pinned).length; others.splice(index, 0, tab); others.forEach((other, index) => { other.index = index; });
    }
    return structuredClone(tab);
  });
  tabs.create.mockImplementation(async (props: chrome.tabs.CreateProperties) => {
    const windowId = props.windowId ?? 10; const tab = make(nextId++, props.url ?? 'New tab', props.url ?? 'chrome://newtab/', open.filter(tab => tab.windowId === windowId).length, { active: props.active ?? true, windowId, pinned: props.pinned ?? false }); open.push(tab); return structuredClone(tab);
  });
  tabs.remove.mockImplementation(async (ids: number | number[]) => { const all = Array.isArray(ids) ? ids : [ids]; open = open.filter(tab => !all.includes(tab.id!)); });
  tabs.move.mockImplementation(async (id: number, props: chrome.tabs.MoveProperties) => {
    const tab = get(id); const oldWindow = tab.windowId; const windowId = props.windowId ?? oldWindow;
    const others = open.filter(other => other.windowId === windowId && other.id !== id).sort((a, b) => a.index - b.index);
    others.splice(props.index < 0 ? others.length : props.index, 0, tab); tab.windowId = windowId; others.forEach((other, index) => { other.index = index; });
    if (oldWindow !== windowId) reindex(oldWindow); return structuredClone(tab);
  });
  tabs.group.mockImplementation(async (props: chrome.tabs.GroupOptions) => {
    const id = props.groupId ?? nextId++; if (!props.groupId) groups.push({ id, title: '', color: 'blue', collapsed: false, windowId: props.createProperties?.windowId ?? 10 });
    for (const tabId of typeof props.tabIds === 'number' ? [props.tabIds] : props.tabIds ?? []) get(tabId).groupId = id;
    return id;
  });
  tabs.ungroup.mockImplementation(async (ids: number[]) => { for (const id of ids) get(id).groupId = -1; });
  tabs.getZoom.mockResolvedValue(1);
  windows.create.mockImplementation(async (props: chrome.windows.CreateData) => {
    const id = nextId++;
    if (props.tabId !== undefined) { get(props.tabId).windowId = id; return { id, tabs: [structuredClone(get(props.tabId))] }; }
    const urls = props.url ? Array.isArray(props.url) ? props.url : [props.url] : ['chrome://newtab/'];
    const created = []; for (const url of urls) created.push(await tabs.create({ url, windowId: id })); return { id, tabs: created };
  });
  tabGroups.query.mockImplementation(async () => structuredClone(groups));
  tabGroups.get.mockImplementation(async (id: number) => structuredClone(groups.find(group => group.id === id)));
  tabGroups.update.mockImplementation(async (id: number, props: Partial<chrome.tabGroups.TabGroup>) => { const group = groups.find(group => group.id === id)!; Object.assign(group, props); return structuredClone(group); });
  const local = { get: async () => structuredClone(storage), set: async (patch: Record<string, unknown>) => { Object.assign(storage, structuredClone(patch)); } };
  vi.stubGlobal('chrome', { tabs, windows, tabGroups, storage: { local }, permissions: { contains: vi.fn(async () => true) }, topSites: { get: vi.fn(async () => []) }, readingList: {
    query: vi.fn(async (filter: { hasBeenRead?: boolean; url?: string }) => reading.filter(item => (filter.hasBeenRead === undefined || filter.hasBeenRead === item.hasBeenRead) && (!filter.url || filter.url === item.url))),
    addEntry: vi.fn(async (entry: chrome.readingList.AddEntryOptions) => { reading.push({ ...entry, creationTime: Date.now(), lastUpdateTime: Date.now() }); }),
    updateEntry: vi.fn(async (entry: chrome.readingList.UpdateEntryOptions) => { Object.assign(reading.find(item => item.url === entry.url)!, entry); }),
  } });
});
it('reuses known sites across windows but opens an explicit extra tab', async () => {
  await run('open Gmail'); expect(tabs.create).not.toHaveBeenCalled(); expect(tabs.update).toHaveBeenCalledWith(2, { active: true });
  await run('open another Gmail tab'); expect(tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://mail.google.com/' }));
  await run('open GitHub'); expect(windows.update).toHaveBeenCalledWith(20, { focused: true });
});
it('asks which existing account to open when several site tabs match', async () => {
  open.push(make(5, 'Work Gmail', 'https://mail.google.com/mail/u/1/', 3));
  await expect(run('open Gmail')).rejects.toBeInstanceOf(ChoiceRequired);
  expect(tabs.update).not.toHaveBeenCalled(); expect(tabs.create).not.toHaveBeenCalled();
});
it('can stop dictation after switching to a restricted page', async () => {
  env.state.dictation = { tabId: 3, frameId: 0, token: crypto.randomUUID(), at: Date.now() };
  Object.assign(chrome.tabs, { sendMessage: vi.fn(async () => ({ ok: true, text: 'Cancelled' })) });
  get(1).url = 'chrome://extensions/'; await run('stop dictation');
  expect(env.state.dictation).toBeNull(); expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(3, { target: 'content', type: 'PAGE_CANCEL' }, { frameId: 0 });
});
it('asks for a category default and resumes with a chosen app', async () => {
  let question: ChoiceRequired | undefined;
  try { await run('open my music'); } catch (error) { question = error as ChoiceRequired; }
  expect(question).toBeInstanceOf(ChoiceRequired); expect(tabs.create).not.toHaveBeenCalled();
  env.overrides[question!.key] = question!.choices.find(choice => choice.id === 'spotify')!;
  await dispatchActions(question!.remaining, question!.context!, env); expect(tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://open.spotify.com/' }));
});
it('uses a chosen website routine ID even when display names match', async () => {
  env.macros = ['Start morning work', 'Start morning home'].map(phrase => ({ id: crypto.randomUUID(), name: 'Morning', phrase, urls: ['https://saved.example/'] }));
  storage.macros = structuredClone(env.macros);
  let question: ChoiceRequired | undefined;
  try { await run('add this site to Morning'); } catch (error) { question = error as ChoiceRequired; }
  expect(question).toBeInstanceOf(ChoiceRequired);
  expect(question!.choices.map(choice => choice.detail)).toEqual(['Say “Start morning work”', 'Say “Start morning home”']);
  env.overrides[question!.key] = question!.choices[1]!;
  await dispatchActions(question!.remaining, question!.context!, env);
  expect(storage.macros).toMatchObject([{ urls: ['https://saved.example/'] }, { urls: ['https://saved.example/', 'https://example.com/'] }]);
});
it('refuses a deleted named choice without falling back to a same-name routine', async () => {
  env.macros = [{ id: crypto.randomUUID(), name: 'Morning', phrase: 'Start morning work', urls: ['https://saved.example/'] }];
  env.overrides['macro:morning'] = { id: 'deleted', label: 'Morning', value: crypto.randomUUID() };
  await expect(run('add this site to Morning')).rejects.toThrow('no longer saved');
  expect(storage.macros).toBeUndefined();
});
it('keeps all website-routine tabs for plural follow-ups and the first for active context', async () => {
  const result = await dispatchMacro({ id: crypto.randomUUID(), name: 'Daily sites', phrase: 'Start daily sites', urls: ['https://one.example/', 'https://two.example/', 'https://three.example/'] }, initial, env);
  expect(result.context).toEqual({ tabId: 100, windowId: 10 });
  expect(env.state.targets.map(tab => tab.id)).toEqual([100, 101, 102]);
  await run('mute them');
  expect([100, 101, 102].map(id => get(id).mutedInfo?.muted)).toEqual([true, true, true]);
  expect(get(1).mutedInfo?.muted).toBe(false);
});
it('honors a personal alias, chosen default, and website search URL', async () => {
  await run('call this site my work dashboard'); env.library = await getLibrary();
  expect(env.library.aliases[0]).toMatchObject({ name: 'work dashboard', url: 'https://example.com/' });
  await run('open work dashboard'); expect(tabs.update).toHaveBeenCalledWith(1, { active: true });
  env.settings.siteDefaults.music = 'spotify'; await run('open my music');
  await run('search Wikipedia for black holes'); expect(tabs.create).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://en.wikipedia.org/w/index.php?search=black%20holes' }));
});
it('holds sticky physical tab references across active-tab changes and asks before plural close', async () => {
  await run('mute YouTube'); expect(get(3).mutedInfo?.muted).toBe(true);
  await run('pin it', { tabId: 4, windowId: 20 }); expect(get(3).pinned).toBe(true); expect(get(4).pinned).toBe(false);
  await run('mute Gmail and YouTube'); expect(env.state.targets.map(tab => tab.id)).toEqual([2, 3]);
  await expect(run('close those two')).rejects.toBeInstanceOf(ReviewRequired); expect(tabs.remove).not.toHaveBeenCalled();
});
it('preserves both newly opened sites for a plural follow-up', async () => {
  await run('open Gmail and Spotify'); expect(env.state.targets).toHaveLength(2);
  await run('pin them'); expect(env.state.targets.every(ref => get(ref.id).pinned)).toBe(true);
});
it('does not replay earlier steps after a named tab needs clarification', async () => {
  open.push(make(5, 'Work Gmail', 'https://mail.google.com/mail/u/1/', 3));
  let question: ChoiceRequired | undefined;
  try { await run('pin YouTube then mute Gmail'); } catch (error) { question = error as ChoiceRequired; }
  expect(question).toBeInstanceOf(ChoiceRequired); expect(question!.remaining.map(action => action.action)).toEqual(['find_tab', 'mute_tab']);
  expect(get(3).pinned).toBe(true); expect(get(2).mutedInfo?.muted).toBe(false);
  env.overrides[question!.key] = question!.choices.find(choice => choice.tabs?.[0]?.id === 5)!;
  await dispatchActions(question!.remaining, question!.context!, env); expect(get(5).mutedInfo?.muted).toBe(true);
  expect(tabs.update.mock.calls.filter(([id, props]) => id === 3 && props.pinned)).toHaveLength(1);
});
it('undoes a named kind without undoing another change in that command', async () => {
  await run('mute YouTube then move it left'); expect(get(3).index).toBe(1);
  await run('undo that move'); expect(get(3).index).toBe(2); expect(get(3).mutedInfo?.muted).toBe(true);
  await run('undo that mute'); expect(get(3).mutedInfo?.muted).toBe(false);
});
it('undoes pinning and repeated same-tab changes, but preserves later manual edits', async () => {
  await run('pin YouTube'); await run('undo'); expect(get(3).pinned).toBe(false); expect(get(3).index).toBe(2);
  await run('mute YouTube then unmute it'); await run('undo'); expect(get(3).mutedInfo?.muted).toBe(false);
  await run('mute YouTube'); get(3).mutedInfo = { muted: false };
  await expect(run('undo')).rejects.toThrow('latest state');
});
it('cancels a multi-target mutation between Chrome API calls', async () => {
  const controller = new AbortController(); env.signal = controller.signal;
  tabs.update.mockImplementationOnce(async () => { controller.abort(); return structuredClone(get(2)); });
  await expect(run('mute Gmail and YouTube')).rejects.toThrow('cancelled'); expect(tabs.update).toHaveBeenCalledOnce();
});
it('resolves the destination group before moving any tabs', async () => {
  groups = [{ id: 50, title: 'Research', windowId: 10, color: 'blue', collapsed: false }, { id: 51, title: 'Research', windowId: 20, color: 'red', collapsed: false }];
  await expect(run('move GitHub to Research group')).rejects.toBeInstanceOf(ChoiceRequired); expect(tabs.move).not.toHaveBeenCalled(); expect(tabs.group).not.toHaveBeenCalled();
  groups.pop(); await run('move GitHub to Research group'); expect(tabs.move).toHaveBeenCalledWith(4, { windowId: 10, index: -1 }); expect(get(4).groupId).toBe(50);
});
it('saves and restores workspace URLs, pinning, and named groups', async () => {
  groups = [{ id: 50, title: 'Research', windowId: 10, color: 'purple', collapsed: false }]; get(2).groupId = 50; get(3).groupId = 50; get(1).pinned = true;
  await run('save this workspace as Work'); env.library = await getLibrary(); expect(env.library.workspaces[0]?.tabs).toHaveLength(3);
  await run('restore my work tabs');
  const newWindow = windows.create.mock.results[0] ? (await windows.create.mock.results[0].value).id as number : -1;
  const restored = open.filter(tab => tab.windowId === newWindow); expect(restored.map(tab => tab.url)).toEqual(['https://example.com/', 'https://mail.google.com/mail/u/0/', 'https://www.youtube.com/']);
  expect(restored[0]?.pinned).toBe(true); expect(restored[1]?.groupId).toBe(restored[2]?.groupId); expect(groups.find(group => group.id === restored[1]?.groupId)).toMatchObject({ title: 'Research', color: 'purple' });
});
it('preserves the active tab plus distinct same-title and unnamed workspace groups', async () => {
  groups = [
    { id: 20, title: 'Research', windowId: 10, color: 'blue', collapsed: true },
    { id: 21, title: 'Research', windowId: 10, color: 'purple', collapsed: false },
    { id: 22, title: '', windowId: 10, color: 'orange', collapsed: true },
    { id: 23, title: '', windowId: 10, color: 'grey', collapsed: false },
  ];
  open = ['Pinned', 'First research', 'Active research', 'First unnamed', 'Second unnamed'].map((title, index) => make(index + 1, title, `https://page${index}.example/`, index, { pinned: index === 0, active: index === 2, groupId: index === 0 ? -1 : 19 + index }));
  await run('save this workspace as Research'); env.library = await getLibrary();
  const saved = env.library.workspaces[0]!;
  expect(saved.activeTabIndex).toBe(2); expect(saved.groups).toEqual(groups.map(group => ({ id: `group-${group.id}`, title: group.title, color: group.color, collapsed: group.collapsed })));
  expect(saved.tabs.map(tab => tab.groupId)).toEqual([undefined, 'group-20', 'group-21', 'group-22', 'group-23']);
  const result = await dispatchActions([{ action: 'workspace_action', params: { operation: 'restore', name: 'Research' } }], initial, env);
  const restored = open.filter(tab => tab.windowId === result.context.windowId).sort((a, b) => a.index - b.index);
  expect(result.context).toEqual({ tabId: restored[2]!.id, windowId: restored[2]!.windowId });
  expect(restored.filter(tab => tab.active).map(tab => tab.id)).toEqual([restored[2]!.id]);
  expect(new Set(restored.slice(1).map(tab => tab.groupId)).size).toBe(4);
  expect(restored.slice(1).map(tab => groups.find(group => group.id === tab.groupId))).toEqual([
    expect.objectContaining({ title: 'Research', color: 'blue', collapsed: true }), expect.objectContaining({ title: 'Research', color: 'purple', collapsed: false }),
    expect.objectContaining({ title: '', color: 'orange', collapsed: true }), expect.objectContaining({ title: '', color: 'grey', collapsed: false }),
  ]);
  expect(env.state.targets.map(tab => tab.id)).toEqual(restored.map(tab => tab.id));
});
it('targets the restored active tab for an implicit follow-up and all restored tabs for them', async () => {
  restoreFixture(); env.library.workspaces[0]!.activeTabIndex = 2;
  await run('restore Research workspace then mute this tab');
  const restored = open.filter(tab => tab.windowId !== 10 && tab.windowId !== 20);
  expect(restored.filter(tab => tab.mutedInfo?.muted).map(tab => tab.url)).toEqual(['https://charlie.example/']);
  expect(open.filter(tab => tab.windowId === 10 || tab.windowId === 20).every(tab => !tab.mutedInfo?.muted)).toBe(true);
  await run('restore Research workspace');
  const latest = env.state.targets.map(ref => ref.id); expect(latest).toHaveLength(3);
  await run('pin them'); expect(latest.every(id => get(id).pinned)).toBe(true);
});
it('previews exact duplicate copies while preserving pinned and active tabs', async () => {
  open.push(make(5, 'Copy', 'https://www.youtube.com/', 3), make(6, 'Pinned copy', 'https://www.youtube.com/', 4, { pinned: true }), make(7, 'Different query', 'https://www.youtube.com/?v=different', 5));
  let review: ReviewRequired | undefined; try { await run('show duplicate tabs'); } catch (error) { review = error as ReviewRequired; }
  expect(review).toBeInstanceOf(ReviewRequired); expect(review!.targets.map(tab => tab.id)).toEqual([3, 5]); expect(tabs.remove).not.toHaveBeenCalled();
});
it('keeps a meeting audible while muting other tabs and supports undo', async () => {
  await run('mute everything except this meeting'); expect(get(1).mutedInfo?.muted).toBe(false); expect(get(2).mutedInfo?.muted).toBe(true); expect(get(4).mutedInfo?.muted).toBe(true);
  await run('undo'); expect(open.every(tab => !tab.mutedInfo?.muted)).toBe(true);
});
it('saves reading entries and reviews the exact unread URLs before opening a batch', async () => {
  await run('save this for later'); expect(reading).toHaveLength(1);
  await run('mark this as read'); expect(reading[0]?.hasBeenRead).toBe(true);
  await run('mark this unread');
  let review: ReviewRequired | undefined; try { await run('open my unread articles'); } catch (error) { review = error as ReviewRequired; }
  expect(review).toBeInstanceOf(ReviewRequired); expect(review!.urls).toEqual(['https://example.com/']); expect(tabs.create).not.toHaveBeenCalled();
});
it('suggests only top-site origins and excludes saved/built-in sites and credentials', async () => {
  vi.mocked(chrome.topSites.get).mockResolvedValue([{ title: 'Private invoice', url: 'https://dashboard.example/invoice?token=private' }, { title: 'Duplicate', url: 'https://dashboard.example/settings' }, { title: 'Google', url: 'https://www.google.com/search?q=private' }, { title: 'Credentials', url: 'https://user:pass@private.example/' }]);
  const suggestions = await refreshSiteSuggestions(); expect(suggestions).toHaveLength(1); expect(suggestions[0]).toMatchObject({ name: 'dashboard.example', url: 'https://dashboard.example/' }); expect(JSON.stringify(storage)).not.toContain('private');
});
it('resolves spoken ordinals, exact UI choices, and account labels without guessing', () => {
  const question = { kind: 'tabs', choices: [{ id: '92', label: 'Personal Gmail' }, { id: '45', label: 'Work Gmail' }] } as Question;
  expect(answerChoice(question, 'The second one')?.id).toBe('45'); expect(answerChoice(question, 'No, the work account')?.id).toBe('45'); expect(answerChoice(question, 'choice:92')?.id).toBe('92'); expect(answerChoice(question, 'Gmail')).toBeUndefined();
});
it('applies a paraphrased mutation to the same named tab and reuses an unknown nickname as an existing title', async () => {
  await run('Could you get rid of the YouTube tab for me?'); expect(tabs.remove).toHaveBeenCalledWith([3]); expect(open.some(tab => tab.id === 1)).toBe(true);
  get(4).title = 'Design notes'; await run('Pull up Design notes'); expect(tabs.update).toHaveBeenCalledWith(4, { active: true }); expect(tabs.create).not.toHaveBeenCalled();
});
it('filters mutations by pin/mute state and keeps default scope within one window', async () => {
  get(2).pinned = true; get(4).pinned = true;
  await run('mute all pinned tabs'); expect(get(2).mutedInfo?.muted).toBe(true); expect(get(4).mutedInfo?.muted).toBe(false);
  get(4).mutedInfo = { muted: true }; await run('unmute all muted tabs across all windows'); expect(open.every(tab => !tab.mutedInfo?.muted)).toBe(true);
});
it('resolves every numbered target before a mutation and reviews filtered closure even with one tab', async () => {
  await expect(run('close tabs two through five')).rejects.toThrow('does not exist'); expect(tabs.remove).not.toHaveBeenCalled();
  await run('pin tabs one and three'); expect(get(1).pinned).toBe(true); expect(get(3).pinned).toBe(true); expect(get(2).pinned).toBe(false);
  get(2).mutedInfo = { muted: true }; await expect(run('close all muted tabs')).rejects.toBeInstanceOf(ReviewRequired); expect(tabs.remove).not.toHaveBeenCalled();
});
it('keeps named exceptions and asks before closing the remaining set', async () => {
  get(2).title = 'Work dashboard'; let preview: ReviewRequired | undefined;
  try { await run('close all tabs except Work dashboard'); } catch (error) { preview = error as ReviewRequired; }
  expect(preview).toBeInstanceOf(ReviewRequired); expect(preview!.targets.map(tab => tab.id)).toEqual([1, 3]); expect(tabs.remove).not.toHaveBeenCalled();
  await expect(run('close all tabs except GitHub')).rejects.toThrow('outside this set');
});
it('switches by multi-position offsets and counts from the right', async () => {
  await run('go forward two tabs'); expect(tabs.update).toHaveBeenLastCalledWith(3, { active: true });
  await run('go back two tabs'); expect(tabs.update).toHaveBeenLastCalledWith(2, { active: true });
  await run('switch to the second tab from the right'); expect(tabs.update).toHaveBeenLastCalledWith(2, { active: true });
});
it('moves several positions, records undo, and switches back to the prior target', async () => {
  await run('move the YouTube tab two places left'); expect(get(3).index).toBe(0); await run('undo that move'); expect(get(3).index).toBe(2);
  await run('open Gmail'); await run('open GitHub'); await run('switch back'); expect(tabs.update).toHaveBeenLastCalledWith(2, { active: true });
});
it.each([
  { side: 'before' as const, targets: [2, 1], anchor: 'Delta', expected: [3, 1, 2, 4, 5] },
  { side: 'after' as const, targets: [2, 1], anchor: 'Delta', expected: [3, 4, 1, 2, 5] },
  { side: undefined, targets: [2, 1], anchor: 'Delta', expected: [3, 4, 1, 2, 5] },
  { side: 'before' as const, targets: [5, 1], anchor: 'Charlie', expected: [2, 1, 5, 3, 4] },
  { side: 'after' as const, targets: [5, 1], anchor: 'Charlie', expected: [2, 3, 1, 5, 4] },
])('moves a selection $side its destination in visible order and restores the original order', async ({ side, targets, anchor, expected }) => {
  open = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((title, index) => make(index + 1, title, `https://${title.toLowerCase()}.example/`, index));
  const order = (): number[] => [...open].sort((a, b) => a.index - b.index).map(tab => tab.id!);
  await dispatchActions([{ action: 'move_beside', params: { query: anchor, side } }], { ...initial, tabId: targets[0]!, tabIds: targets }, env);
  await finalizeUndo(env);
  expect(order()).toEqual(expected);
  expect(env.state.undo[0]?.patches).toHaveLength(2);
  await run('undo that move');
  expect(order()).toEqual([1, 2, 3, 4, 5]);
});
it('replays repeated tab movements in reverse chronological order when undoing', async () => {
  open = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((title, index) => make(index + 1, title, `https://${title.toLowerCase()}.example/`, index));
  await dispatchActions([
    { action: 'move_tab', params: { position: 'right' } },
    { action: 'find_tab', params: { query: 'Charlie', auto_switch: false } },
    { action: 'move_tab', params: { position: 'first' } },
    { action: 'find_tab', params: { query: 'Alpha', auto_switch: false } },
    { action: 'move_tab', params: { position: 'last' } },
  ], initial, env);
  await finalizeUndo(env);
  const order = (): number[] => [...open].sort((a, b) => a.index - b.index).map(tab => tab.id!);
  expect(order()).toEqual([3, 2, 4, 1]);
  await run('undo that move');
  expect(order()).toEqual([1, 2, 3, 4]);
});
it.each([
  { targets: [1, 2], position: 'right' as const, steps: 1, expected: [3, 1, 2, 4, 5] },
  { targets: [4, 5], position: 'right' as const, steps: 1, expected: [1, 2, 3, 4, 5] },
  { targets: [1, 2], position: 'left' as const, steps: 1, expected: [1, 2, 3, 4, 5] },
  { targets: [2, 4], position: 'right' as const, steps: 1, expected: [1, 3, 2, 5, 4] },
  { targets: [2, 4], position: 'left' as const, steps: 1, expected: [2, 1, 4, 3, 5] },
  { targets: [2, 4], position: 'right' as const, steps: 10, expected: [1, 3, 5, 2, 4] },
  { targets: [2, 4], position: 'left' as const, steps: 10, expected: [2, 4, 1, 3, 5] },
  { targets: [4, 2], position: 'first' as const, expected: [2, 4, 1, 3, 5] },
  { targets: [4, 2], position: 'last' as const, expected: [1, 3, 5, 2, 4] },
  { targets: [5, 1], position: 'index' as const, index: 3, expected: [2, 3, 1, 5, 4] },
  { targets: [2, 4], position: 'index' as const, index: 4, expected: [1, 3, 5, 2, 4] },
])('keeps native batch order and undo for $position $steps $index', async ({ targets, position, steps, index, expected }) => {
  open = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((title, index) => make(index + 1, title, `https://${title.toLowerCase()}.example/`, index));
  const context = { tabId: targets[0]!, windowId: 10, tabIds: targets };
  const result = await dispatchActions([{ action: 'move_tab', params: { position, ...(steps ? { steps } : {}), ...(index ? { index } : {}) } }], context, env);
  await finalizeUndo(env);
  const order = (): number[] => [...open].sort((a, b) => a.index - b.index).map(tab => tab.id!);
  expect(order()).toEqual(expected); expect(result.context).toEqual(context); expect(env.state.targets.map(tab => tab.id)).toEqual(targets);
  if (env.state.undo.length) { await run('undo that move'); expect(order()).toEqual([1, 2, 3, 4, 5]); }
  else expect(result.text).toContain('already');
});
it('keeps a native batch inside its pinned boundary and rejects an impossible absolute block before moving', async () => {
  get(1).pinned = true; get(2).pinned = true;
  await dispatchActions([{ action: 'move_tab', params: { position: 'right' } }], { ...initial, tabIds: [1, 2] }, env);
  expect(get(1).index).toBe(0); expect(get(2).index).toBe(1); expect(tabs.move).not.toHaveBeenCalled();
  await expect(dispatchActions([{ action: 'move_tab', params: { position: 'index', index: 2 } }], { ...initial, tabIds: [1, 2] }, env)).rejects.toThrow('where they fit');
  expect(tabs.move).not.toHaveBeenCalled();
});
it('stops a native batch on an intervening manual move and keeps that change out of undo', async () => {
  open.push(make(5, 'Extra', 'https://extra.example/', 3));
  let changed = false;
  env.onProgress = async event => { if (event.status === 'target' && !changed) { changed = true; await tabs.move(event.context.tabId, { index: 3 }); } };
  await expect(dispatchActions([{ action: 'move_tab', params: { position: 'right' } }], { ...initial, tabIds: [1, 2] }, env)).rejects.toThrow('latest arrangement');
  expect(tabs.move.mock.calls.map(([id]) => id)).toEqual([2, 2]); expect(get(1).index).toBe(0); expect(get(2).index).toBe(3);
  await finalizeUndo(env); tabs.move.mockClear();
  await expect(run('undo that move')).rejects.toThrow('latest state'); expect(tabs.move).not.toHaveBeenCalled();
});
it.each([false, true])('detects manual drift after the final native batch callback, including no-op batches: %s', noop => {
  const events: ProgressEvent[] = []; let targets = 0;
  env.onProgress = async event => {
    events.push(event);
    if (event.status === 'target' && ++targets === 2) await tabs.move(event.context.tabId, { index: noop ? 0 : 2 });
  };
  return expect(dispatchActions([{ action: 'move_tab', params: { position: 'right' } }], { ...initial, tabIds: noop ? [2, 3] : [1, 2] }, env)).rejects.toThrow('latest arrangement').then(() => {
    expect(events.some(event => event.status === 'completed')).toBe(false);
    expect(get(noop ? 3 : 1).index).toBe(noop ? 0 : 2);
  });
});
it('rejects moving a selection beside itself or across pin boundaries before moving any tab', async () => {
  const context = { ...initial, tabIds: [1, 2] };
  await expect(dispatchActions([{ action: 'move_beside', params: { query: 'Gmail', side: 'after' } }], context, env)).rejects.toThrow('also selected');
  get(2).pinned = true;
  await expect(dispatchActions([{ action: 'move_beside', params: { query: 'YouTube', side: 'after' } }], context, env)).rejects.toThrow('same pin state');
  expect(tabs.move).not.toHaveBeenCalled();
});
it('keeps a pinned selection before unpinned tabs and restores its original order', async () => {
  open = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((title, index) => make(index + 1, title, `https://${title.toLowerCase()}.example/`, index, { pinned: index < 4 }));
  const order = (): number[] => [...open].sort((a, b) => a.index - b.index).map(tab => tab.id!);
  await dispatchActions([{ action: 'move_beside', params: { query: 'Delta', side: 'after' } }], { ...initial, tabIds: [2, 1] }, env);
  await finalizeUndo(env);
  expect(order()).toEqual([3, 4, 1, 2, 5]);
  expect(open.filter(tab => tab.pinned).map(tab => tab.id)).toEqual([1, 2, 3, 4]);
  await run('undo that move'); expect(order()).toEqual([1, 2, 3, 4, 5]);
});
it('moves selections across windows in order and returns them to their original positions', async () => {
  const order = (windowId: number): number[] => open.filter(tab => tab.windowId === windowId).sort((a, b) => a.index - b.index).map(tab => tab.id!);
  await dispatchActions([{ action: 'move_beside', params: { query: 'GitHub', side: 'after' } }], { ...initial, tabIds: [3, 2] }, env);
  await finalizeUndo(env);
  expect(order(10)).toEqual([1]); expect(order(20)).toEqual([4, 2, 3]);
  await run('undo that move'); expect(order(10)).toEqual([1, 2, 3]); expect(order(20)).toEqual([4]);
});
it('refuses an undo before moving anything if an original window closed', async () => {
  await dispatchActions([{ action: 'move_beside', params: { query: 'GitHub', side: 'after' } }], { ...initial, tabIds: [1, 2, 3] }, env);
  await finalizeUndo(env); tabs.move.mockClear();
  await expect(run('undo that move', { tabId: 4, windowId: 20 })).rejects.toThrow('original window is no longer open');
  expect(tabs.move).not.toHaveBeenCalled();
  expect(open.every(tab => tab.windowId === 20)).toBe(true);
});
it('keeps a later manual tab move when undoing a selection', async () => {
  await dispatchActions([{ action: 'move_beside', params: { query: 'YouTube', side: 'after' } }], { ...initial, tabIds: [1, 2] }, env);
  await finalizeUndo(env);
  await tabs.move(2, { index: 0 });
  tabs.move.mockClear();
  await expect(run('undo that move')).rejects.toThrow('latest state');
  expect(tabs.move).not.toHaveBeenCalled();
});
it.each([false, true])('keeps manual movement during a routine wait even when another move follows: %s', async moveAgain => {
  vi.useFakeTimers(); get(1).status = 'loading';
  let waiting = false; const getTab = tabs.get.getMockImplementation()!;
  tabs.get.mockImplementation(async (id: number) => { if (id === 1 && get(1).status === 'loading' && tabs.move.mock.calls.length) waiting = true; return getTab(id); });
  try {
    const running = dispatchActions([
      { action: 'move_tab', params: { position: 'right' } },
      { action: 'wait_for_page', params: {} },
      ...(moveAgain ? [{ action: 'move_tab' as const, params: { position: 'left' as const } }] : []),
    ], initial, env);
    await vi.waitFor(() => expect(waiting).toBe(true));
    await tabs.move(1, { index: 2 }); get(1).status = 'complete';
    await vi.advanceTimersByTimeAsync(250); await running; await finalizeUndo(env);
    expect(env.state.undo[0]?.positionConflict).toBe(true);
    const retainedIndex = get(1).index; tabs.move.mockClear();
    await expect(run('undo that move')).rejects.toThrow('latest state');
    expect(tabs.move).not.toHaveBeenCalled(); expect(get(1).index).toBe(retainedIndex);
  } finally { vi.useRealTimers(); }
});
it('accounts for indirect position shifts from several pins without treating them as manual moves', async () => {
  await run('pin Gmail and YouTube');
  expect(env.state.undo[0]?.positionConflict).not.toBe(true);
  await run('undo');
  expect([...open].filter(tab => tab.windowId === 10).sort((a, b) => a.index - b.index).map(tab => tab.id)).toEqual([1, 2, 3]);
  expect(open.every(tab => !tab.pinned)).toBe(true);
});
it('does not adopt a manual mute edit as part of the command during undo finalization', async () => {
  await dispatchActions([{ action: 'mute_tab', params: { mute: true } }], initial, env);
  get(1).mutedInfo = { muted: false };
  await finalizeUndo(env);
  tabs.update.mockClear();
  await expect(run('undo')).rejects.toThrow('latest state');
  expect(tabs.update).not.toHaveBeenCalled();
});
it('refuses to record or report an unconfirmed tab move', async () => {
  tabs.move.mockImplementationOnce(async (id: number) => structuredClone(get(id)));
  await expect(run('move Welcome after YouTube')).rejects.toThrow('did not confirm');
  expect(env.state.undo).toHaveLength(0);
});
it('does not report success when Chrome does not restore the saved tab position', async () => {
  await run('move YouTube left');
  tabs.move.mockImplementationOnce(async (id: number) => structuredClone(get(id)));
  await expect(run('undo that move')).rejects.toThrow('did not confirm the undo');
  expect(get(3).index).toBe(1); expect(env.state.undo).toHaveLength(1);
});
it('continues a reviewed selection closure on the active survivor in the same window', async () => {
  env.reviewed = true;
  const result = await dispatchActions([
    { action: 'close_tab', params: { target: 'current' } },
    { action: 'mute_tab', params: { mute: true } },
  ], { tabId: 2, windowId: 10, tabIds: [2, 3] }, env);
  expect(tabs.remove).toHaveBeenCalledWith([2, 3]);
  expect(get(1).mutedInfo?.muted).toBe(true);
  expect(result.context).toEqual(initial);
  expect(env.state.targets.map(tab => tab.id)).toEqual([1]);
});
it('stops after closing a whole selected window instead of using another window', async () => {
  env.reviewed = true; get(4).active = true;
  await expect(dispatchActions([
    { action: 'close_tab', params: { target: 'current' } },
    { action: 'mute_tab', params: { mute: true } },
  ], { ...initial, tabIds: [1, 2, 3] }, env)).rejects.toThrow('remaining steps were stopped');
  expect(tabs.remove).toHaveBeenCalledWith([1, 2, 3]);
  expect(get(4).mutedInfo?.muted).toBe(false);
  expect(tabs.update).not.toHaveBeenCalled();
  expect(env.state.targets).toEqual([]);
});
it('keeps close continuation in its original window after a survivor is manually moved away', async () => {
  get(2).windowId = 20;
  await tabs.remove(3);
  expect(await contextAfterClose({ tabId: 2, windowId: 10, tabIds: [2, 3] }, [3])).toEqual(initial);
});
it('lists tabs with choices and switches only after the user chooses one', async () => {
  let question: ChoiceRequired | undefined; try { await run('show me my open tabs'); } catch (error) { question = error as ChoiceRequired; }
  expect(question).toBeInstanceOf(ChoiceRequired); expect(question!.choices).toHaveLength(3); expect(tabs.update).not.toHaveBeenCalled();
  env.overrides[question!.key] = question!.choices[1]!; await dispatchActions(question!.remaining, question!.context!, env);
  expect(tabs.update).toHaveBeenCalledWith(2, { active: true });
});
it('sorts ungrouped tabs after existing groups, preserving pinned tabs and other windows', async () => {
  open = [make(1, 'Pinned', 'https://pinned.example/', 0, { pinned: true }), make(2, 'Zulu', 'https://z.example/', 1), make(3, 'Grouped B', 'https://b.example/', 2, { groupId: 20 }), make(5, 'Grouped A', 'https://a.example/', 3, { groupId: 20 }), make(6, 'Alpha', 'https://a.example/', 4), make(4, 'Other window', 'https://other.example/', 0, { windowId: 30 })];
  await run('sort tabs by title');
  expect(open.filter(tab => tab.windowId === 10).sort((a, b) => a.index - b.index).map(tab => tab.id)).toEqual([1, 3, 5, 6, 2]);
  expect(get(1).pinned).toBe(true); expect(get(3).groupId).toBe(20); expect(get(5).groupId).toBe(20); expect(get(4).windowId).toBe(30);
});
it('changes a named group color and removes only its tabs from that group', async () => {
  groups = [{ id: 20, title: 'Research', color: 'blue', collapsed: false, windowId: 10 }]; get(2).groupId = 20; get(3).groupId = 20;
  await run('make Research group purple'); expect(groups[0]!.color).toBe('purple');
  await run('ungroup Research group'); expect(tabs.ungroup).toHaveBeenCalledWith([2, 3]); expect(open.every(tab => tab.groupId === -1)).toBe(true);
});
it('ungroups selected tab targets without widening to every window', async () => {
  for (const tab of open) tab.groupId = 20;
  await run('ungroup all tabs'); expect(tabs.ungroup).toHaveBeenCalledWith([1, 2, 3]); expect(get(4).groupId).toBe(20);
});
it('opens and reuses only the requested Chrome management page', async () => {
  await run('open downloads'); expect(tabs.create).toHaveBeenCalledWith({ url: 'chrome://downloads/', windowId: 10, active: true });
  await run('show downloads'); expect(tabs.create).toHaveBeenCalledOnce(); expect(tabs.update).toHaveBeenCalledWith(100, { active: true });
});
it('asks for search words and keeps an answer containing commands literal', async () => {
  let choice: ChoiceRequired | undefined;
  try { await run('search Wikipedia'); } catch (error) { choice = error as ChoiceRequired; }
  expect(choice?.kind).toBe('text'); expect(tabs.create).not.toHaveBeenCalled();
  env.overrides[choice!.key] = { id: 'text', label: 'dogs and then close all tabs', value: 'dogs and then close all tabs' };
  await dispatchActions(choice!.remaining, choice!.context!, env);
  expect(tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://en.wikipedia.org/w/index.php?search=dogs%20and%20then%20close%20all%20tabs' })); expect(tabs.remove).not.toHaveBeenCalled();
  await expect(run('search Wikipedia')).rejects.toBeInstanceOf(ChoiceRequired);
});
it('waits for a completed page and rejects a timeout before the next action', async () => {
  get(1).status = 'complete'; await run('wait for the page to load'); expect(tabs.create).not.toHaveBeenCalled();
  vi.useFakeTimers(); get(1).status = 'loading';
  try {
    const result = run('wait for the page to load then open a new tab');
    const assertion = expect(result).rejects.toThrow('15 seconds');
    await vi.advanceTimersByTimeAsync(15_001); await assertion; expect(tabs.create).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
it('reports confirmed targets before a later target in the same action fails', async () => {
  const events: unknown[] = []; env.onProgress = async event => { events.push(structuredClone(event)); };
  tabs.update.mockImplementation(async (id: number, properties: chrome.tabs.UpdateProperties) => { if (id === 3) throw new Error('This tab closed'); get(id).mutedInfo = { muted: properties.muted! }; return structuredClone(get(id)); });
  await expect(dispatchActions([{ action: 'mute_tab', params: { mute: true } }], { ...initial, tabIds: [2, 3] }, env)).rejects.toThrow('This tab closed');
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'target', result: expect.stringContaining('Personal Gmail') })])); expect(events).not.toEqual(expect.arrayContaining([expect.objectContaining({ status: 'completed' })]));
});
it.each(['failure', 'cancel'] as const)('reports only confirmed mute-others targets before %s stops the batch', async stop => {
  const controller = new AbortController(); env.signal = controller.signal;
  const events: ProgressEvent[] = []; env.onProgress = async event => { events.push(structuredClone(event)); if (stop === 'cancel' && event.status === 'target') controller.abort(); };
  const updateTab = tabs.update.getMockImplementation()!;
  tabs.update.mockImplementation(async (id: number, props: chrome.tabs.UpdateProperties) => { if (id === 3) throw new Error('Mute failed'); return updateTab(id, props); });
  await expect(run('mute other tabs')).rejects.toThrow(stop === 'cancel' ? 'cancelled' : 'Mute failed');
  expect(events.filter(event => event.status === 'target').map(event => event.result)).toEqual(['Muted Personal Gmail']);
  expect(events.some(event => event.status === 'completed')).toBe(false);
  expect(get(2).mutedInfo?.muted).toBe(true); expect(get(3).mutedInfo?.muted).toBe(false); expect(get(4).mutedInfo?.muted).toBe(false);
});
it('does not report a mute-others target when Chrome leaves it unmuted', async () => {
  const events: ProgressEvent[] = []; env.onProgress = async event => { events.push(event); };
  tabs.update.mockImplementationOnce(async (id: number) => structuredClone(get(id)));
  await expect(run('mute other tabs')).rejects.toThrow('did not confirm');
  expect(events.filter(event => event.status === 'target')).toEqual([]); expect(env.state.undo).toEqual([]);
});
it('reports the exact confirmed sorted tabs when a later move fails', async () => {
  const events: ProgressEvent[] = []; env.onProgress = async event => { events.push(event); };
  const moveTab = tabs.move.getMockImplementation()!;
  tabs.move.mockImplementation(async (id: number, props: chrome.tabs.MoveProperties) => { if (id === 1) throw new Error('Move failed'); return moveTab(id, props); });
  await expect(run('sort tabs by title')).rejects.toThrow('Move failed');
  expect(events.filter(event => event.status === 'target').map(event => event.result)).toEqual(['Moved Personal Gmail to position 3']);
  expect(events.some(event => event.status === 'completed')).toBe(false);
  expect(get(2).index).toBe(2);
});
it('does not report a sorted target when Chrome keeps its original position', async () => {
  const events: ProgressEvent[] = []; env.onProgress = async event => { events.push(event); };
  tabs.move.mockImplementationOnce(async (id: number) => structuredClone(get(id)));
  await expect(run('sort tabs by title')).rejects.toThrow('did not confirm');
  expect(events.filter(event => event.status === 'target')).toEqual([]);
});
function restoreFixture(): void {
  env.library.workspaces = [{ id: crypto.randomUUID(), name: 'Research', createdAt: Date.now(), tabs: [
    { title: 'Alpha', url: 'https://alpha.example/', pinned: true },
    { title: 'Bravo', url: 'https://bravo.example/', pinned: false, group: 'Reading', color: 'blue' },
    { title: 'Charlie', url: 'https://charlie.example/', pinned: false, group: 'Reading', color: 'blue' },
  ] }];
}
it('reports the precise opened workspace tabs when a later open fails', async () => {
  restoreFixture(); const events: ProgressEvent[] = []; env.onProgress = async event => { events.push(event); };
  const createTab = tabs.create.getMockImplementation()!;
  tabs.create.mockImplementation(async (props: chrome.tabs.CreateProperties) => { if (props.url === 'https://charlie.example/') throw new Error('Open failed'); return createTab(props); });
  await expect(run('restore Research workspace')).rejects.toThrow('Opened 2 of 3 workspace tabs');
  expect(events.filter(event => event.status === 'target').map(event => event.result)).toEqual(['Opened Alpha', 'Opened Bravo']);
  expect(events.some(event => event.status === 'completed')).toBe(false); expect(tabs.update).not.toHaveBeenCalled();
});
it('distinguishes opening workspace tabs from restoring their pins and groups', async () => {
  restoreFixture(); const events: ProgressEvent[] = []; env.onProgress = async event => { events.push(event); };
  await run('restore Research workspace');
  expect(events.filter(event => event.status === 'target').map(event => event.result)).toEqual([
    'Opened Alpha', 'Opened Bravo', 'Opened Charlie', 'Pinned Alpha', 'Grouped Bravo', 'Grouped Charlie', 'Restored group Reading · blue', 'Activated Alpha',
  ]);
  expect(events.at(-1)?.status).toBe('completed');
  const restored = env.state.targets.map(ref => get(ref.id));
  expect(restored[0]?.active).toBe(true); expect(restored.slice(1).every(tab => !tab.active)).toBe(true);
  expect(restored[1]?.groupId).toBe(restored[2]?.groupId);
});
it('reports opened workspace tabs without claiming an unconfirmed pin completed', async () => {
  restoreFixture(); const events: ProgressEvent[] = []; env.onProgress = async event => { events.push(event); };
  tabs.update.mockImplementationOnce(async (id: number) => structuredClone(get(id)));
  await expect(run('restore Research workspace')).rejects.toThrow('did not confirm');
  expect(events.filter(event => event.status === 'target').map(event => event.result)).toEqual(['Opened Alpha', 'Opened Bravo', 'Opened Charlie']);
  expect(tabs.group).not.toHaveBeenCalled();
});
it('keeps confirmed workspace grouping details when assigning the group name fails', async () => {
  restoreFixture(); const events: ProgressEvent[] = []; env.onProgress = async event => { events.push(event); };
  tabGroups.update.mockRejectedValueOnce(new Error('Group name failed'));
  await expect(run('restore Research workspace')).rejects.toThrow('Group name failed');
  expect(events.filter(event => event.status === 'target').map(event => event.result)).toEqual([
    'Opened Alpha', 'Opened Bravo', 'Opened Charlie', 'Pinned Alpha', 'Grouped Bravo', 'Grouped Charlie',
  ]);
  expect(events.some(event => event.status === 'completed')).toBe(false);
});
it('stops workspace restore before changing group metadata when cancelled after grouping', async () => {
  restoreFixture(); const controller = new AbortController(); env.signal = controller.signal;
  const events: ProgressEvent[] = []; env.onProgress = async event => { events.push(event); if (event.status === 'target' && event.result?.startsWith('Grouped')) controller.abort(); };
  await expect(run('restore Research workspace')).rejects.toThrow('cancelled');
  expect(tabs.group).toHaveBeenCalledOnce(); expect(tabGroups.update).not.toHaveBeenCalled();
  expect(events.filter(event => event.status === 'target').map(event => event.result)).toEqual(['Opened Alpha', 'Opened Bravo', 'Opened Charlie', 'Pinned Alpha', 'Grouped Bravo', 'Grouped Charlie']);
  expect(events.some(event => event.status === 'completed')).toBe(false);
});
it('does not claim activation completed if Chrome keeps a different workspace tab active', async () => {
  restoreFixture(); env.library.workspaces[0]!.activeTabIndex = 2;
  const events: ProgressEvent[] = []; env.onProgress = async event => { events.push(event); };
  const updateTab = tabs.update.getMockImplementation()!;
  tabs.update.mockImplementation(async (id: number, props: chrome.tabs.UpdateProperties) => props.active ? structuredClone(get(id)) : updateTab(id, props));
  await expect(run('restore Research workspace')).rejects.toThrow('did not confirm the workspace’s active tab');
  expect(events.filter(event => event.status === 'target').map(event => event.result)).not.toContain('Activated Charlie');
  expect(events.some(event => event.status === 'completed')).toBe(false);
});
it('waits for a field in the same document and stops as soon as it appears', async () => {
  vi.useFakeTimers(); let probes = 0;
  Object.assign(chrome, { scripting: { executeScript: vi.fn(async () => [{ frameId: 0, documentId: 'doc-one' }]) } });
  Object.assign(chrome.tabs, { sendMessage: vi.fn(async (_id: number, message: { type: string }) => message.type === 'PAGE_PROBE' ? { ok: true, text: 'ready', focused: true } : { ok: true, text: 'Field readiness', editable: ++probes === 3 }) });
  try {
    const result = run('wait for the Search field'); await vi.advanceTimersByTimeAsync(501); await result; expect(probes).toBe(3);
    const calls = vi.mocked(chrome.scripting.executeScript).mock.calls;
    expect(calls.filter(([options]) => 'files' in options)).toHaveLength(1);
    expect(calls.filter(([options]) => 'func' in options)).toHaveLength(2);
    expect(tabs.update).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
async function workspaceQuestion(text: string, context: TargetContext = initial): Promise<ChoiceRequired> {
  try { await run(text, context); } catch (error) { expect(error).toBeInstanceOf(ChoiceRequired); return error as ChoiceRequired; }
  throw new Error('Expected a workspace replacement question');
}
async function answerWorkspace(question: ChoiceRequired, index = 0): Promise<void> {
  env.overrides[question.key] = question.choices[index]!;
  await dispatchActions(question.remaining, question.context!, env);
}
it('reviews same-name workspace saves with exact replacement counts and keeps one previous snapshot', async () => {
  await run('save this workspace as Research'); const original = structuredClone((await getLibrary()).workspaces[0]!);
  open = open.filter(tab => tab.id !== 3);
  const question = await workspaceQuestion('save this workspace as research');
  expect(question.prompt).toContain('(3 saved tabs) with these 2 tabs');
  expect((await getLibrary()).workspaces[0]).toEqual(original);
  await answerWorkspace(question);
  const updated = (await getLibrary()).workspaces[0]!;
  expect(updated.id).toBe(original.id); expect(updated.name).toBe('Research'); expect(updated.tabs).toHaveLength(2);
  expect(updated.previous?.tabs).toEqual(original.tabs); expect(updated.previous).not.toHaveProperty('previous');
});
it('can keep an existing workspace without changing its saved or previous version', async () => {
  await run('save this workspace as Research'); const before = structuredClone(storage);
  open = open.filter(tab => tab.id !== 3);
  await answerWorkspace(await workspaceQuestion('update Research workspace'), 1);
  expect(storage).toEqual(before);
});
it('recovers a reviewed previous workspace version without opening or closing tabs', async () => {
  await run('save this workspace as Research');
  open = open.filter(tab => tab.id !== 3);
  await answerWorkspace(await workspaceQuestion('update Research workspace'));
  const question = await workspaceQuestion('restore previous version of Research workspace');
  expect(question.prompt).toContain('(3 tabs), replacing the current 2 saved tabs');
  expect((await getLibrary()).workspaces[0]!.tabs).toHaveLength(2);
  await answerWorkspace(question);
  const recovered = (await getLibrary()).workspaces[0]!;
  expect(recovered.tabs).toHaveLength(3); expect(recovered.previous?.tabs).toHaveLength(2); expect(recovered.previous).not.toHaveProperty('previous');
  expect(tabs.create).not.toHaveBeenCalled(); expect(tabs.remove).not.toHaveBeenCalled();
});
it('updates explicitly selected tabs and preserves their active tab and group metadata in history', async () => {
  groups = [{ id: 6, title: 'Sources', color: 'blue', collapsed: false, windowId: 10 }]; get(2).groupId = 6;
  await run('save this workspace as Research');
  const original = (await getLibrary()).workspaces[0]!;
  await answerWorkspace(await workspaceQuestion(`update ${original.id} workspace`, { ...initial, tabIds: [2, 3] }));
  const updated = (await getLibrary()).workspaces[0]!;
  expect(updated.tabs.map(tab => tab.url)).toEqual([get(2).url, get(3).url]); expect(updated.groups?.[0]?.title).toBe('Sources');
  expect(updated.previous?.activeTabIndex).toBe(0); expect(updated.previous?.groups).toEqual(original.groups);
});
it.each(['url', 'navigation pending', 'pin', 'order', 'window', 'active', 'new tab', 'group'] as const)('refuses a workspace update after the proposed source changes: %s', async change => {
  groups = [{ id: 6, title: 'Sources', color: 'blue', collapsed: false, windowId: 10 }]; get(2).groupId = 6;
  await run('save this workspace as Research'); get(1).title = 'Reviewed source title'; const question = await workspaceQuestion('update Research workspace'); const before = structuredClone(storage);
  if (change === 'url') get(2).url = 'https://changed.example/';
  else if (change === 'navigation pending') get(2).pendingUrl = 'https://pending.example/';
  else if (change === 'pin') get(2).pinned = true;
  else if (change === 'order') { get(2).index = 2; get(3).index = 1; }
  else if (change === 'window') get(2).windowId = 20;
  else if (change === 'active') { get(1).active = false; get(2).active = true; }
  else if (change === 'new tab') open.push(make(5, 'Added after review', 'https://new.example/', 3));
  else groups[0]!.collapsed = true;
  await expect(answerWorkspace(question)).rejects.toThrow('source tabs changed');
  expect(storage).toEqual(before);
});
it.each(['update', 'recover'] as const)('refuses a stale saved workspace approval for %s', async operation => {
  await run('save this workspace as Research'); get(2).title = 'Second version'; await answerWorkspace(await workspaceQuestion('update Research workspace'));
  if (operation === 'update') get(2).title = 'Third version';
  const question = await workspaceQuestion(`${operation} Research workspace`);
  (storage.library as typeof env.library).workspaces[0]!.tabs[0]!.title = 'Newer saved title';
  const before = structuredClone(storage);
  await expect(answerWorkspace(question)).rejects.toThrow('saved workspace changed'); expect(storage).toEqual(before);
});
it('does not recreate a deleted workspace when answering a save-collision review', async () => {
  await run('save this workspace as Research'); get(2).title = 'Reviewed source title'; const question = await workspaceQuestion('save this workspace as Research');
  (storage.library as typeof env.library).workspaces = [];
  await expect(answerWorkspace(question)).rejects.toThrow('saved workspace changed'); expect((await getLibrary()).workspaces).toEqual([]);
});
it('requires an existing workspace for update and a previous version for recovery', async () => {
  await expect(run('update Missing workspace')).rejects.toThrow('No workspace');
  await run('save this workspace as Research');
  await expect(run('recover Research workspace')).rejects.toThrow('no previous saved version');
});
it('saves only one chosen current tab when answering which tabs to save', async () => {
  const question = await workspaceQuestion('save these tabs as One selected tab');
  expect(question.prompt).toContain('current tab or all tabs');
  await answerWorkspace(question);
  expect((await getLibrary()).workspaces[0]!.tabs.map(tab => tab.url)).toEqual([get(1).url]);
});
it('saves the actual highlighted selection and honors explicit whole-window updates', async () => {
  get(1).highlighted = false; get(2).highlighted = true; get(3).highlighted = true;
  await run('save these tabs as Selected');
  expect((await getLibrary()).workspaces[0]!.tabs.map(tab => tab.url)).toEqual([get(2).url, get(3).url]);
  await answerWorkspace(await workspaceQuestion('update Selected workspace from this window', { ...initial, tabIds: [2, 3] }));
  expect((await getLibrary()).workspaces[0]!.tabs).toHaveLength(3);
});
it('keeps the useful previous version when updating an unchanged workspace', async () => {
  await run('save this workspace as Research'); open = open.filter(tab => tab.id !== 3);
  await answerWorkspace(await workspaceQuestion('update Research workspace')); const before = structuredClone(storage);
  await run('update Research workspace'); expect(storage).toEqual(before);
  expect((await getLibrary()).workspaces[0]!.previous?.tabs).toHaveLength(3);
});
it('reviews full proposed tab addresses, pin state, active tab and separate group metadata', async () => {
  await run('save this workspace as Research');
  groups = [{ id: 6, title: 'Research <script>', color: 'purple', collapsed: true, windowId: 10 }, { id: 7, title: 'Research <script>', color: 'blue', collapsed: false, windowId: 10 }];
  get(1).pinned = true; get(2).groupId = 6; get(3).groupId = 7; get(1).active = false; get(3).active = true;
  get(2).url = `https://reference.example/${'a'.repeat(900)}?private=value`; get(2).title = 'A full <script> literal title';
  const question = await workspaceQuestion('update Research workspace');
  expect(question.choices[0]!.detail).toBe([
    'Proposed saved version:', 'Active tab: 3',
    'Group 1: Research <script> · purple · Collapsed', 'Group 2: Research <script> · blue · Expanded',
    `Tab 1: Welcome · ${get(1).url} · Pinned`,
    `Tab 2: A full <script> literal title · ${get(2).url} · Unpinned · Group 1`,
    `Tab 3: YouTube · ${get(3).url} · Unpinned · Group 2`,
  ].join('\n'));
  const spokenQuestion: Question = { id: crypto.randomUUID(), prompt: question.prompt, choices: question.choices, kind: 'workspace', key: question.key, request: { ...initial, id: crypto.randomUUID(), startedAt: Date.now() }, context: initial, actions: question.remaining, overrides: {}, at: Date.now() };
  const first = decisionReadback(spokenQuestion, null); const pages = Array.from({ length: first.totalPages }, (_, page) => decisionReadback(spokenQuestion, null, page));
  expect(pages.every(page => page.segments.every(segment => segment.length <= 400))).toBe(true);
  expect(pages.map(page => page.text).join('\n')).toContain('?private=value');
  expect(pages.map(page => page.text).join('\n')).toContain('Unpinned · Group 2');
});
it.each(['navigate', 'close', 'move', 'regroup'] as const)('rejects source divergence during the group metadata wait: %s', async change => {
  await run('save this workspace as Research'); get(1).title = 'Reviewed source';
  const question = await workspaceQuestion('update Research workspace'); const before = structuredClone(storage);
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  tabGroups.query.mockImplementationOnce(async () => { entered(); await waiting; return structuredClone(groups); });
  const rejected = expect(answerWorkspace(question)).rejects.toThrow('source tabs changed while capturing');
  await started;
  if (change === 'navigate') get(2).url = 'https://changed-during-query.example/';
  else if (change === 'close') open = open.filter(tab => tab.id !== 2);
  else if (change === 'move') get(2).windowId = 20;
  else { groups.push({ id: 8, title: 'New group', color: 'red', collapsed: false, windowId: 10 }); get(2).groupId = 8; }
  release(); await rejected; expect(storage).toEqual(before);
});
it('does not save a reviewed workspace when Stop arrives during source capture', async () => {
  await run('save this workspace as Research'); get(1).title = 'Reviewed source';
  const question = await workspaceQuestion('update Research workspace'); const before = structuredClone(storage);
  const controller = new AbortController(); env.signal = controller.signal;
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  tabGroups.query.mockImplementationOnce(async () => { entered(); await waiting; return structuredClone(groups); });
  const rejected = expect(answerWorkspace(question)).rejects.toThrow('cancelled');
  await started; controller.abort(); release(); await rejected; expect(storage).toEqual(before);
});
async function workspaceWithHistory(): Promise<void> {
  await run('save this workspace as Research'); open = open.filter(tab => tab.id !== 3);
  await answerWorkspace(await workspaceQuestion('update Research workspace'));
}
it('renames saved workspaces using inline literal names and preserves both snapshots', async () => {
  await workspaceWithHistory(); const saved = (await getLibrary()).workspaces[0]!;
  await run('rename Research workspace to Notes then close all tabs');
  expect((await getLibrary()).workspaces).toEqual([{ ...saved, name: 'Notes then close all tabs' }]);
  expect(tabs.remove).not.toHaveBeenCalled(); expect(tabs.create).not.toHaveBeenCalled();
});
it('never executes command words in the name of a later rename step', async () => {
  await workspaceWithHistory();
  await run('mute this tab then rename Research workspace to Notes then close this tab');
  expect(get(1).mutedInfo?.muted).toBe(true);
  expect((await getLibrary()).workspaces[0]!.name).toBe('Notes then close this tab'); expect(tabs.remove).not.toHaveBeenCalled();
});
it('asks for a literal name and rejects saved state changes while that question is open', async () => {
  await workspaceWithHistory(); const saved = (await getLibrary()).workspaces[0]!;
  const question = await workspaceQuestion(`rename ${saved.id} workspace`); expect(question.kind).toBe('name');
  (storage.library as typeof env.library).workspaces[0]!.previous!.tabs[0]!.title = 'Newer history'; const before = structuredClone(storage);
  env.overrides[question.key] = { id: 'name', label: 'Physics', value: 'Physics' };
  await expect(dispatchActions(question.remaining, question.context!, env)).rejects.toThrow('saved workspace changed'); expect(storage).toEqual(before);
});
it('uses a freeform rename answer as data and consumes its expected snapshot', async () => {
  await workspaceWithHistory(); const saved = (await getLibrary()).workspaces[0]!;
  const question = await workspaceQuestion(`rename ${saved.id} workspace`);
  env.overrides[question.key] = { id: 'name', label: 'Do not close tabs', value: 'Do not close tabs' };
  await dispatchActions(question.remaining, question.context!, env);
  expect((await getLibrary()).workspaces).toEqual([{ ...saved, name: 'Do not close tabs' }]);
  expect(Object.keys(env.overrides).filter(key => key.includes('workspace:rename:'))).toEqual([]); expect(tabs.remove).not.toHaveBeenCalled();
});
it('keeps exact workspace names containing workspace from selecting a shorter saved name', async () => {
  await run('save this workspace as Physics'); await run('save this workspace as Physics workspace');
  await run('rename Physics workspace workspace to Notes');
  expect((await getLibrary()).workspaces.map(workspace => workspace.name)).toEqual(['Physics', 'Notes']);
});
it('reviews exact previous contents, allows Keep, and discards only after an explicit choice', async () => {
  await workspaceWithHistory(); const saved = structuredClone((await getLibrary()).workspaces[0]!);
  const first = await workspaceQuestion('discard previous version of Research workspace');
  expect(first.prompt).toContain('(3 tabs)'); expect(first.prompt).toContain('2 current saved tabs');
  expect(first.choices[0]!.detail).toContain('Tab 3: YouTube · https://www.youtube.com/ · Unpinned');
  expect((await getLibrary()).workspaces[0]).toEqual(saved);
  await answerWorkspace(first, 1); expect((await getLibrary()).workspaces[0]).toEqual(saved);
  await answerWorkspace(await workspaceQuestion('discard the previous saved version of Research workspace'));
  const expected = { ...saved }; delete expected.previous;
  expect((await getLibrary()).workspaces[0]).toEqual(expected); expect(tabs.remove).not.toHaveBeenCalled(); expect(tabs.create).not.toHaveBeenCalled();
});
it('refuses to discard a previous version that changed after review', async () => {
  await workspaceWithHistory(); const question = await workspaceQuestion('discard previous version of Research workspace');
  (storage.library as typeof env.library).workspaces[0]!.previous!.tabs[0]!.url = 'https://newer-private.example/'; const before = structuredClone(storage);
  await expect(answerWorkspace(question)).rejects.toThrow('saved workspace changed'); expect(storage).toEqual(before);
});
it('does not discard history when Stop has arrived before the choice resumes', async () => {
  await workspaceWithHistory(); const question = await workspaceQuestion('discard previous version of Research workspace'); const before = structuredClone(storage);
  const controller = new AbortController(); env.signal = controller.signal; controller.abort();
  await expect(answerWorkspace(question)).rejects.toThrow('cancelled'); expect(storage).toEqual(before);
});
it('explains when a workspace has no previous saved version to discard', async () => {
  await run('save this workspace as Research'); const before = structuredClone(storage);
  await expect(run('discard previous version of Research workspace')).rejects.toThrow('no previous saved version'); expect(storage).toEqual(before);
});
