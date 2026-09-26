import { test, expect, message, state } from './fixtures';

test('restores the active tab and distinct same-named or unnamed groups', async ({ context, control, worker }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Workspace page</title>Saved page' }));
  const firstPage = context.waitForEvent('page');
  const original = await worker.evaluate(() => chrome.windows.create({ type: 'normal', focused: true, url: 'about:blank' }));
  const windowId = original.id!; const ids = [original.tabs![0]!.id!];
  const first = await firstPage; await first.goto('https://handsfree.test/one');
  for (const name of ['two', 'three', 'four', 'five']) {
    const nextPage = context.waitForEvent('page');
    const tab = await worker.evaluate(id => chrome.tabs.create({ windowId: id, url: 'about:blank', active: false }), windowId);
    ids.push(tab.id!); await (await nextPage).goto(`https://handsfree.test/${name}`);
  }
  await worker.evaluate(async ids => {
    await chrome.tabs.update(ids[0]!, { pinned: true });
    const first = await chrome.tabs.group({ tabIds: [ids[1]!, ids[2]!] });
    await chrome.tabGroups.update(first, { title: 'Shared name', color: 'blue', collapsed: true });
    const second = await chrome.tabs.group({ tabIds: [ids[3]!] });
    await chrome.tabGroups.update(second, { title: 'Shared name', color: 'green', collapsed: false });
    const unnamed = await chrome.tabs.group({ tabIds: [ids[4]!] });
    await chrome.tabGroups.update(unnamed, { title: '', color: 'red', collapsed: true });
    await chrome.tabs.update(ids[3]!, { active: true });
  }, ids);
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'Save this workspace as Exact workspace' });
  await expect.poll(async () => (await state(control)).library?.workspaces.length).toBe(1);
  const saved = (await state(control)).library!.workspaces[0]!;
  expect(saved.activeTabIndex).toBe(3); expect(saved.groups).toHaveLength(3);
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'Restore Exact workspace workspace then mute this tab' });
  await expect.poll(async () => { const current = await state(control); return [current.transcript, current.progress?.status]; }).toEqual(['Restore Exact workspace workspace then mute this tab', 'completed']);
  const restored = await worker.evaluate(async originalId => {
    const windows = await chrome.windows.getAll({ populate: true });
    const window = windows.find(window => window.id !== originalId && window.tabs?.length === 5 && window.tabs.every(tab => (tab.url ?? tab.pendingUrl)?.startsWith('https://handsfree.test/')));
    if (!window) return null;
    return { tabs: window.tabs!, groups: await chrome.tabGroups.query({ windowId: window.id! }) };
  }, windowId);
  expect(restored).toBeTruthy();
  const tabs = restored!.tabs.sort((a, b) => a.index - b.index);
  expect(tabs.map(tab => tab.url ?? tab.pendingUrl)).toEqual(saved.tabs.map(tab => tab.url));
  expect(tabs[0]!.pinned).toBe(true);
  expect(tabs.findIndex(tab => tab.active)).toBe(3);
  expect(tabs.filter(tab => tab.mutedInfo?.muted).map(tab => tab.index)).toEqual([3]);
  expect(tabs[1]!.groupId).toBe(tabs[2]!.groupId);
  expect(new Set(tabs.slice(1).map(tab => tab.groupId)).size).toBe(3);
  expect(restored!.groups.map(group => ({ title: group.title ?? '', color: group.color, collapsed: group.collapsed })).sort((a, b) => a.color.localeCompare(b.color))).toEqual([
    { title: 'Shared name', color: 'blue', collapsed: true },
    { title: 'Shared name', color: 'green', collapsed: false },
    { title: '', color: 'red', collapsed: true },
  ]);
});
