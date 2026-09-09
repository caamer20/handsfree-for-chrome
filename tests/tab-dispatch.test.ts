import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchActions } from '../src/background/dispatcher';
import { parseCommand } from '../src/common/command-parser';
let open: chrome.tabs.Tab[];
const make = (id: number, index: number, windowId: number, title: string, extra: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab => ({ id, index, windowId, title, url: `https://example.com/${id}`, active: index === 0, pinned: false, ...extra } as chrome.tabs.Tab);
const tabs = { query: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn(), reload: vi.fn(), duplicate: vi.fn(), move: vi.fn() };
const windows = { update: vi.fn(), create: vi.fn() };
const sessions = { getRecentlyClosed: vi.fn(), restore: vi.fn() };
const initial = { tabId: 1, windowId: 10 };
beforeEach(() => {
  vi.resetAllMocks();
  open = [make(1, 0, 10, 'Welcome'), make(2, 1, 10, 'YouTube', { url: 'https://youtube.com/' }), make(3, 0, 20, 'GitHub', { url: 'https://github.com/' })];
  tabs.query.mockImplementation(async (filter: chrome.tabs.QueryInfo) => open.filter(tab => (filter.windowId === undefined || tab.windowId === filter.windowId) && (filter.active === undefined || tab.active === filter.active)));
  tabs.get.mockImplementation(async (id: number) => { const tab = open.find(tab => tab.id === id); if (!tab) throw new Error('Tab disappeared'); return tab; });
  tabs.remove.mockImplementation(async (ids: number[]) => { open = open.filter(tab => !ids.includes(tab.id!)); });
  tabs.update.mockImplementation(async (id: number, update: chrome.tabs.UpdateProperties) => ({ ...open.find(tab => tab.id === id), ...update }));
  tabs.move.mockImplementation(async (id: number, move: chrome.tabs.MoveProperties) => ({ ...open.find(tab => tab.id === id), index: move.index }));
  vi.stubGlobal('chrome', { tabs, windows, sessions });
});
it('executes “close xyz tab” against a named background tab without first activating it', async () => {
  open[1]!.title = 'xyz · project notes';
  await dispatchActions(parseCommand('close xyz tab'), initial);
  expect(tabs.remove).toHaveBeenCalledExactlyOnceWith([2]);
  expect(tabs.update).not.toHaveBeenCalled(); expect(windows.update).not.toHaveBeenCalled();
  expect(open.map(tab => tab.id)).toEqual([1, 3]);
});
it('closes a uniquely named tab in another window without closing the original tab', async () => {
  await dispatchActions(parseCommand('close GitHub tab'), initial);
  expect(tabs.remove).toHaveBeenCalledExactlyOnceWith([3]); expect(open.some(tab => tab.id === 1)).toBe(true);
});
it('does not close any tab when a name is ambiguous or absent', async () => {
  open.push(make(4, 1, 20, 'YouTube music'));
  await expect(dispatchActions(parseCommand('close YouTube tab'), initial)).rejects.toThrow('2 tabs match');
  await expect(dispatchActions(parseCommand('close Wikipedia tab'), initial)).rejects.toThrow('No tab matching');
  expect(tabs.remove).not.toHaveBeenCalled(); expect(tabs.update).not.toHaveBeenCalled();
});
it.each([
  ['mute YouTube tab', 'update', [2, { muted: true }]],
  ['pin YouTube tab', 'update', [2, { pinned: true }]],
  ['hard reload YouTube tab', 'reload', [2, { bypassCache: true }]],
])('targets the named tab for %s', async (command, method, args) => {
  await dispatchActions(parseCommand(command as string), initial);
  expect(tabs[method as 'update' | 'reload']).toHaveBeenCalledWith(...args as unknown[]);
});
it('closes plural name matches only in the targeted window', async () => {
  open.push(make(4, 2, 10, 'YouTube music'), make(5, 1, 20, 'YouTube videos'));
  await dispatchActions(parseCommand('close all YouTube tabs'), initial);
  expect(tabs.remove).toHaveBeenCalledExactlyOnceWith([2, 4]);
  expect(open.map(tab => tab.id)).toEqual([1, 3, 5]);
});
it('closes all tabs only in the original window', async () => {
  await dispatchActions(parseCommand('close all tabs'), initial);
  expect(tabs.remove).toHaveBeenCalledExactlyOnceWith([1, 2]); expect(open.map(tab => tab.id)).toEqual([3]);
});
it('uses current-window tab numbers, rejects out-of-range numbers, and does not focus before closing', async () => {
  await expect(dispatchActions(parseCommand('close tab 3'), initial)).rejects.toThrow('There are 2 tabs');
  expect(tabs.remove).not.toHaveBeenCalled();
  await dispatchActions(parseCommand('close tab 2'), initial);
  expect(tabs.remove).toHaveBeenCalledWith([2]); expect(tabs.update).not.toHaveBeenCalled();
});
it('wraps next/previous switching at either end of the window', async () => {
  await dispatchActions(parseCommand('next tab'), { tabId: 2, windowId: 10 });
  expect(tabs.update).toHaveBeenLastCalledWith(1, { active: true });
  await dispatchActions(parseCommand('previous tab'), initial);
  expect(tabs.update).toHaveBeenLastCalledWith(2, { active: true });
});
it('moves a named tab while respecting the pinned-tab boundary', async () => {
  await dispatchActions(parseCommand('move YouTube tab to the beginning'), initial);
  expect(tabs.move).toHaveBeenCalledWith(2, { index: 0 });
  tabs.move.mockClear(); open[0]!.pinned = true;
  await dispatchActions(parseCommand('move YouTube tab left'), initial);
  expect(tabs.move).not.toHaveBeenCalled();
  await expect(dispatchActions(parseCommand('move YouTube tab to position 1'), initial)).rejects.toThrow('Pinned tabs');
});
it('moves the targeted tab into a new window and adopts the returned context', async () => {
  windows.create.mockResolvedValue({ id: 30, tabs: [{ ...open[1], windowId: 30, active: true }] });
  const result = await dispatchActions(parseCommand('move YouTube tab to a new window'), initial);
  expect(windows.create).toHaveBeenCalledWith({ type: 'normal', focused: true, tabId: 2 });
  expect(result.context).toEqual({ tabId: 2, windowId: 30 });
});
it('reopens one recently closed tab, skipping closed windows', async () => {
  sessions.getRecentlyClosed.mockResolvedValue([{ window: { sessionId: 'closed-window' } }, { tab: { sessionId: 'closed-tab' } }]);
  sessions.restore.mockResolvedValue({ tab: make(9, 2, 10, 'Restored tab') });
  const result = await dispatchActions(parseCommand('reopen last closed tab'), initial);
  expect(sessions.restore).toHaveBeenCalledExactlyOnceWith('closed-tab');
  expect(result.context).toEqual({ tabId: 9, windowId: 10 });
});
it('reports when no individual closed tab is available', async () => {
  sessions.getRecentlyClosed.mockResolvedValue([{ window: { sessionId: 'closed-window' } }]);
  await expect(dispatchActions(parseCommand('undo close'), initial)).rejects.toThrow('No recently closed tab');
  expect(sessions.restore).not.toHaveBeenCalled();
});
