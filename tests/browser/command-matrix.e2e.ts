import { test, expect, message, state, activateExtension } from './fixtures';

const cases = [
  ['Open a new tab', 'new'],
  ['Pin this tab', 'pin'],
  ['Unpin this tab', 'unpin'],
  ['Mute this tab', 'mute'],
  ['Unmute this tab', 'unmute'],
  ['Zoom in', 'zoom-in'],
  ['Zoom to 125 percent', 'zoom-set'],
  ['Reset zoom', 'zoom-reset'],
  ['Switch to the Research tab', 'find'],
  ['Next tab', 'next'],
  ['Previous tab', 'previous'],
  ['Last tab', 'last'],
  ['Go to tab two', 'index'],
  ['Move this tab to the end', 'move-end'],
  ['Move this tab right', 'move-right'],
  ['Duplicate this tab', 'duplicate'],
  ['Close this tab', 'close'],
  ['Close tab two', 'close-index'],
  ['Close all other tabs', 'close-others'],
  ['Reopen the last closed tab', 'reopen'],
  ['Bookmark this page', 'bookmark'],
  ['Group these tabs as Research', 'group'],
  ['Save this workspace as Research', 'workspace'],
  ['Save this for later', 'reading'],
  ['Fill the search box with black holes', 'fill'],
  ['Clear the search field', 'clear'],
  ['Check the Remember me checkbox', 'check'],
  ['Choose Canada from the Country dropdown', 'select'],
  ['Show links', 'links'],
  ['Scroll down a little', 'scroll'],
] as const;

for (const [command, check] of cases) test(`common task: ${command}`, async ({ context, control, worker, extensionId }, testInfo) => {
  await context.route('https://handsfree.test/**', route => {
    const title = route.request().url().endsWith('/research') ? 'Research' : route.request().url().endsWith('/notes') ? 'Notes' : 'Start page';
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>${title}</title><h1>${title}</h1><label>Search<input type="search" value="original"></label><label>Remember me<input type="checkbox"></label><label>Country<select><option>United States</option><option>Canada</option></select></label><a href="/notes">Notes link</a><div style="height:3000px">Browser test fixture</div>` });
  });
  const created = await worker.evaluate(() => chrome.windows.create({ type: 'normal', focused: true, url: ['https://handsfree.test/start', 'https://handsfree.test/research', 'https://handsfree.test/notes'] }));
  const windowId = created.id!; const ids = created.tabs!.map(tab => tab.id!);
  await worker.evaluate(async id => { await chrome.tabs.update(id, { active: true }); }, ids[0]!);
  await expect.poll(() => context.pages().some(page => page.url() === 'https://handsfree.test/start')).toBe(true);
  const page = context.pages().find(page => page.url() === 'https://handsfree.test/start')!;
  await page.waitForLoadState(); await page.bringToFront();
  if (check === 'unpin') await worker.evaluate(id => chrome.tabs.update(id, { pinned: true }), ids[0]!);
  if (check === 'unmute') await worker.evaluate(id => chrome.tabs.update(id, { muted: true }), ids[0]!);
  if (check === 'zoom-reset') await worker.evaluate(id => chrome.tabs.setZoom(id, 1.5), ids[0]!);
  if (check === 'reopen') await worker.evaluate(id => chrome.tabs.remove(id), ids[2]!);
  if (check === 'group') await worker.evaluate(id => chrome.tabs.highlight({ windowId: id, tabs: [0, 1] }), windowId);
  if (['fill', 'clear', 'check', 'select', 'links', 'scroll'].includes(check)) await activateExtension(page, extensionId);
  const started = performance.now();
  const reply = await message(control, { target: 'background', type: 'RUN_TEXT', text: command });
  expect(reply.ok).toBe(true);
  await expect.poll(async () => ['success', 'error', 'review', 'clarify'].includes((await state(control)).hud.phase)).toBe(true);
  if (check === 'close-others') {
    const review = (await state(control)).pending!; expect(review).toBeTruthy();
    await message(control, { target: 'background', type: 'REVIEW_PLAN', requestId: review.request.id, approved: true });
    const concrete = (await state(control)).pending;
    if (concrete) { expect(concrete.targets?.map(tab => tab.id).sort()).toEqual(ids.slice(1).sort()); await message(control, { target: 'background', type: 'REVIEW_PLAN', requestId: concrete.request.id, approved: true }); }
  }
  await expect.poll(async () => (await state(control)).hud, { message: command }).toMatchObject({ phase: 'success' });
  const elapsedMs = Math.round(performance.now() - started);
  const tabs = await worker.evaluate(id => chrome.tabs.query({ windowId: id }), windowId);
  const original = tabs.find(tab => tab.id === ids[0]);
  switch (check) {
    case 'new': expect(tabs).toHaveLength(4); expect(tabs.some(tab => !ids.includes(tab.id!) && tab.url === 'chrome://newtab/')).toBe(true); break;
    case 'pin': expect(original?.pinned).toBe(true); break;
    case 'unpin': expect(original?.pinned).toBe(false); break;
    case 'mute': expect(original?.mutedInfo?.muted).toBe(true); break;
    case 'unmute': expect(original?.mutedInfo?.muted).toBe(false); break;
    case 'zoom-in': expect(await worker.evaluate(id => chrome.tabs.getZoom(id), ids[0]!)).toBeGreaterThan(1); break;
    case 'zoom-set': expect(await worker.evaluate(id => chrome.tabs.getZoom(id), ids[0]!)).toBeCloseTo(1.25); break;
    case 'zoom-reset': expect(await worker.evaluate(id => chrome.tabs.getZoom(id), ids[0]!)).toBe(1); break;
    case 'find': case 'next': case 'index': expect(tabs.find(tab => tab.active)?.id).toBe(ids[1]); break;
    case 'previous': case 'last': expect(tabs.find(tab => tab.active)?.id).toBe(ids[2]); break;
    case 'move-end': expect(original?.index).toBe(2); break;
    case 'move-right': expect(original?.index).toBe(1); break;
    case 'duplicate': expect(tabs.filter(tab => tab.url === 'https://handsfree.test/start')).toHaveLength(2); break;
    case 'close': expect(tabs.some(tab => tab.id === ids[0])).toBe(false); expect(tabs).toHaveLength(2); break;
    case 'close-index': expect(tabs.some(tab => tab.id === ids[1])).toBe(false); expect(tabs).toHaveLength(2); break;
    case 'close-others': expect(tabs.map(tab => tab.id)).toEqual([ids[0]]); break;
    case 'reopen': expect(tabs.some(tab => tab.url === 'https://handsfree.test/notes')).toBe(true); expect(tabs).toHaveLength(3); break;
    case 'bookmark': expect(await worker.evaluate(() => chrome.bookmarks.search({ url: 'https://handsfree.test/start' }))).toHaveLength(1); break;
    case 'group': expect(original?.groupId).toBeGreaterThanOrEqual(0); expect((await worker.evaluate(id => chrome.tabGroups.get(id), original!.groupId)).title).toBe('Research'); break;
    case 'workspace': expect((await state(control)).library?.workspaces.find(item => item.name === 'Research')?.tabs).toHaveLength(3); break;
    case 'reading': expect(await worker.evaluate(() => chrome.readingList.query({ url: 'https://handsfree.test/start' }))).toHaveLength(1); break;
    case 'fill': await expect(page.locator('input[type="search"]')).toHaveValue('black holes'); break;
    case 'clear': await expect(page.locator('input[type="search"]')).toHaveValue(''); break;
    case 'check': await expect(page.locator('input[type="checkbox"]')).toBeChecked(); break;
    case 'select': await expect(page.locator('select')).toHaveValue('Canada'); break;
    case 'links': await expect(page.locator('#handsfree-page-overlay')).toBeAttached(); break;
    case 'scroll': await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0); break;
  }
  await testInfo.attach('command-timing', { body: JSON.stringify({ command, elapsedMs, input: 'typed', nativeChromeApis: true }), contentType: 'application/json' });
});
