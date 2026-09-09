import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchActions } from '../src/background/dispatcher';
import { parseCommand } from '../src/common/command-parser';
import { defaultSettings } from '../src/common/schema';
import { ChoiceRequired, ReviewRequired, emptyConversation, type Question } from '../src/common/conversation';
import { finalizeUndo, type ExecutionEnvironment } from '../src/background/execution';
import { answerChoice } from '../src/background/choices';
import { getLibrary, refreshSiteSuggestions } from '../src/background/library-store';

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
async function run(text: string, context = initial): Promise<void> {
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
it('waits for a field in the same document and stops as soon as it appears', async () => {
  vi.useFakeTimers(); let probes = 0;
  Object.assign(chrome, { scripting: { executeScript: vi.fn(async () => [{ frameId: 0, documentId: 'doc-one' }]) } });
  Object.assign(chrome.tabs, { sendMessage: vi.fn(async (_id: number, message: { type: string }) => message.type === 'PAGE_PROBE' ? { ok: true, text: 'ready', focused: true } : { ok: true, text: 'Field readiness', editable: ++probes === 3 }) });
  try { const result = run('wait for the Search field'); await vi.advanceTimersByTimeAsync(501); await result; expect(probes).toBe(3); expect(chrome.scripting.executeScript).toHaveBeenCalledOnce(); expect(tabs.update).not.toHaveBeenCalled(); } finally { vi.useRealTimers(); }
});
