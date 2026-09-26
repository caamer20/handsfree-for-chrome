import { beforeEach, expect, it, vi } from 'vitest';
import { discardPreviousWorkspace, getLibrary, renameWorkspace, replaceWorkspace, saveAlias, saveWorkspace } from '../src/background/library-store';
import { saveMacro } from '../src/background/store';
import { saveRoutine } from '../src/background/routine-store';
import { workspaceSnapshot, type Workspace } from '../src/common/library';

const original: Workspace = { id: '00000000-0000-4000-8000-000000000001', name: 'Research', createdAt: 1, tabs: [{ title: 'Original', url: 'https://old.example/', pinned: false }] };
let storage: Record<string, unknown>; const set = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); storage = {};
  set.mockImplementation(async patch => { Object.assign(storage, structuredClone(patch)); });
  vi.stubGlobal('chrome', { storage: { local: { get: async () => structuredClone(storage), set } } });
});
it('never overwrites an existing workspace through the create-only store API', async () => {
  await saveWorkspace(original); set.mockClear();
  await expect(saveWorkspace({ ...original, id: crypto.randomUUID(), name: 'RESEARCH!' })).rejects.toThrow('already saved');
  expect((await getLibrary()).workspaces).toEqual([original]); expect(set).not.toHaveBeenCalled();
});
it('retains only the most recent prior snapshot through repeated updates', async () => {
  await saveWorkspace(original);
  const second = { ...workspaceSnapshot(original), createdAt: 2, tabs: [{ title: 'Second', url: 'https://second.example/', pinned: true }] };
  await replaceWorkspace(original, second);
  const current = (await getLibrary()).workspaces[0]!;
  const third = { ...second, createdAt: 3, tabs: [{ title: 'Third', url: 'https://third.example/', pinned: false }] };
  await replaceWorkspace(current, third);
  const saved = (await getLibrary()).workspaces[0]!;
  expect(saved.id).toBe(original.id); expect(saved.tabs).toEqual(third.tabs); expect(saved.previous).toEqual(second);
  expect(JSON.stringify(saved)).not.toContain('old.example');
});
it('serializes competing reviewed replacements and rejects the stale one', async () => {
  await saveWorkspace(original);
  const first = { ...workspaceSnapshot(original), createdAt: 2 };
  const second = { ...workspaceSnapshot(original), createdAt: 3 };
  const results = await Promise.allSettled([replaceWorkspace(original, first), replaceWorkspace(original, second)]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  expect((await getLibrary()).workspaces[0]!.createdAt).toBe(2);
});
it('preserves aliases saved alongside a workspace replacement', async () => {
  await saveWorkspace(original);
  const alias = { id: crypto.randomUUID(), name: 'Portal', url: 'https://portal.example/', searchUrl: '' };
  await Promise.all([replaceWorkspace(original, { ...workspaceSnapshot(original), createdAt: 2 }), saveAlias(alias)]);
  const library = await getLibrary(); expect(library.aliases).toEqual([alias]); expect(library.workspaces[0]!.previous).toEqual(workspaceSnapshot(original));
});
it('keeps both versions intact after an atomic storage failure and permits a later retry', async () => {
  await saveWorkspace(original); const before = structuredClone(storage); set.mockRejectedValueOnce(new Error('Quota exceeded'));
  await expect(replaceWorkspace(original, { ...workspaceSnapshot(original), createdAt: 2 })).rejects.toThrow('previous version are unchanged');
  expect(storage).toEqual(before);
  await replaceWorkspace(original, { ...workspaceSnapshot(original), createdAt: 2 }); expect((await getLibrary()).workspaces[0]!.createdAt).toBe(2);
});
it.each(['macro', 'routine'] as const)('rechecks spoken collisions inside the shared write queue with %s first', async first => {
  const macro = { id: crypto.randomUUID(), name: 'Sites', phrase: 'Start daily work', urls: ['https://work.example/'] };
  const routine = { id: crypto.randomUUID(), name: 'Work', phrase: macro.phrase, steps: ['Mute this tab'] };
  const writes = first === 'macro' ? [saveMacro(macro), saveRoutine(routine)] : [saveRoutine(routine), saveMacro(macro)];
  const results = await Promise.allSettled(writes); expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
});
it('renames a workspace without changing its identity, current snapshot or previous snapshot', async () => {
  const saved = { ...original, previous: { ...workspaceSnapshot(original), createdAt: 0 } }; await saveWorkspace(saved);
  await renameWorkspace(saved, 'Physics');
  expect((await getLibrary()).workspaces).toEqual([{ ...saved, name: 'Physics' }]);
});
it('rejects normalized duplicate workspace names and invalid rename lengths without writes', async () => {
  const other = { ...original, id: crypto.randomUUID(), name: 'Physics' }; await saveWorkspace(original); await saveWorkspace(other); set.mockClear();
  await expect(renameWorkspace(original, ' PHYSICS! ')).rejects.toThrow('already saved');
  await expect(renameWorkspace(original, 'x'.repeat(61))).rejects.toThrow();
  await expect(renameWorkspace(original, ' ')).rejects.toThrow();
  expect(set).not.toHaveBeenCalled(); expect((await getLibrary()).workspaces).toEqual([original, other]);
});
it('discards only the previous saved version and never creates replacement history', async () => {
  const saved = { ...original, previous: { ...workspaceSnapshot(original), createdAt: 0 } }; await saveWorkspace(saved);
  await discardPreviousWorkspace(saved);
  expect((await getLibrary()).workspaces).toEqual([original]);
  await expect(discardPreviousWorkspace(original)).rejects.toThrow('no previous saved version');
});
it.each(['rename', 'discard'] as const)('refuses a stale expected workspace before %s', async operation => {
  const saved = { ...original, previous: { ...workspaceSnapshot(original), createdAt: 0 } }; await saveWorkspace(saved);
  await replaceWorkspace(saved, { ...workspaceSnapshot(saved), createdAt: 3 }); const before = structuredClone(storage); set.mockClear();
  await expect(operation === 'rename' ? renameWorkspace(saved, 'Physics') : discardPreviousWorkspace(saved)).rejects.toThrow('saved workspace changed');
  expect(storage).toEqual(before); expect(set).not.toHaveBeenCalled();
});
it.each(['rename', 'discard'] as const)('checks cancellation after the queued storage read for %s', async operation => {
  const saved = { ...original, previous: { ...workspaceSnapshot(original), createdAt: 0 } }; await saveWorkspace(saved);
  const before = structuredClone(storage); set.mockClear(); const stopped = (): void => { throw new Error('Command cancelled'); };
  await expect(operation === 'rename' ? renameWorkspace(saved, 'Physics', stopped) : discardPreviousWorkspace(saved, stopped)).rejects.toThrow('cancelled');
  expect(storage).toEqual(before); expect(set).not.toHaveBeenCalled();
});
it.each(['rename', 'discard'] as const)('preserves every saved field if Chrome rejects the %s write', async operation => {
  const saved = { ...original, previous: { ...workspaceSnapshot(original), createdAt: 0 } }; await saveWorkspace(saved);
  const before = structuredClone(storage); set.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(operation === 'rename' ? renameWorkspace(saved, 'Physics') : discardPreviousWorkspace(saved)).rejects.toThrow('unchanged');
  expect(storage).toEqual(before);
});
