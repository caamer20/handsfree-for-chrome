import { readFile } from 'node:fs/promises';
import { test, expect, message, state } from './fixtures';

test('exports the saved library and reviews a merge without copying device settings or keys', async ({ context, control, worker }) => {
  const alias = { id: crypto.randomUUID(), name: 'Lab portal', url: 'https://handsfree.test/lab', searchUrl: '' };
  const macro = { id: crypto.randomUUID(), name: 'Morning sites', phrase: 'Open morning fixtures', urls: ['https://handsfree.test/lab'] };
  const routine = { id: crypto.randomUUID(), name: 'Reading mode', phrase: 'Read my fixture', steps: ['Zoom to 125 percent', 'Mute this tab'] };
  for (const request of [
    { target: 'background', type: 'SAVE_ALIAS', alias },
    { target: 'background', type: 'SAVE_MACRO', macro },
    { target: 'background', type: 'SAVE_ROUTINE', routine },
  ] as const) expect((await message(control, request)).ok).toBe(true);
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Workspace fixture</title>Research' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/lab'); await page.bringToFront();
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'save this workspace as Portable research' });
  await expect.poll(async () => (await state(control)).library?.workspaces.length).toBe(1);
  const workspaceId = (await state(control)).library!.workspaces[0]!.id;
  await worker.evaluate(() => chrome.storage.local.set({ backupSecretFixture: 'must-never-appear-in-export', log: [{ id: 'fixture', at: Date.now(), text: 'private fixture activity', ok: true }] }));
  const settingsBefore = (await state(control)).settings;
  await control.bringToFront(); await control.getByRole('button', { name: 'Library', exact: true }).click();
  await control.getByText('Back up or move your library', { exact: true }).click();
  const downloadPromise = control.waitForEvent('download');
  await control.getByRole('button', { name: 'Export library', exact: true }).click();
  const download = await downloadPromise; const path = await download.path(); expect(path).toBeTruthy();
  const json = await readFile(path!, 'utf8'); const backup = JSON.parse(json);
  expect(backup.format).toBe('handsfree-library'); expect(backup.version).toBe(2);
  for (const kind of ['aliases', 'macros', 'routines', 'workspaces']) expect(backup[kind]).toHaveLength(1);
  expect(json).not.toContain('must-never-appear-in-export'); expect(json).not.toContain('private fixture activity');
  expect(backup.settings).toBeUndefined(); expect(backup.suggestions).toBeUndefined();
  for (const request of [
    { target: 'background', type: 'DELETE_ALIAS', id: alias.id },
    { target: 'background', type: 'DELETE_MACRO', id: macro.id },
    { target: 'background', type: 'DELETE_ROUTINE', id: routine.id },
    { target: 'background', type: 'DELETE_WORKSPACE', id: workspaceId },
  ] as const) await message(control, request);
  const upload = { name: 'saved-library.json', mimeType: 'application/json', buffer: Buffer.from(json) };
  await control.locator('#import-library').setInputFiles(upload);
  await expect(control.locator('#library-import-summary')).toContainText('4 items to add');
  await control.getByText('View items', { exact: true }).click();
  await control.locator('#library-import-list summary').filter({ hasText: 'Lab portal' }).click();
  await expect(control.locator('#library-import-list')).toContainText('https://handsfree.test/lab');
  await control.locator('#library-import-list summary').filter({ hasText: 'Reading mode' }).click();
  await expect(control.locator('#library-import-list')).toContainText('Zoom to 125 percent');
  await expect(control.locator('#library-import-list')).toContainText('Mute this tab');
  await control.screenshot({ path: 'test-results/library-import-review.png', fullPage: true });
  expect((await state(control)).macros).toHaveLength(0);
  await control.locator('#cancel-library-import').click();
  expect((await state(control)).library?.aliases).toHaveLength(0);
  await control.locator('#import-library').setInputFiles(upload);
  await expect(control.locator('#confirm-library-import')).toBeEnabled();
  await control.locator('#confirm-library-import').click();
  await expect(control.locator('#library-backup-status')).toContainText('Library imported');
  const restored = await state(control);
  expect(restored.library?.aliases.map(item => item.name)).toEqual([alias.name]);
  expect(restored.macros.map(item => item.phrase)).toEqual([macro.phrase]);
  expect(restored.routines?.map(item => item.steps)).toEqual([routine.steps]);
  expect(restored.library?.workspaces.map(item => item.name)).toEqual(['Portable research']);
  expect(restored.settings).toEqual(settingsBefore);
  expect(restored.macros[0]!.id).not.toBe(macro.id);
  await control.locator('#import-library').setInputFiles(upload);
  await expect(control.locator('#library-import-summary')).toContainText('0 items to add');
  await expect(control.locator('#confirm-library-import')).toBeDisabled();
});

test('revalidates a reviewed import when the saved library changes before confirmation', async ({ control }) => {
  const incoming = { id: crypto.randomUUID(), name: 'Lab portal', url: 'https://handsfree.test/imported', searchUrl: '' };
  const json = JSON.stringify({ format: 'handsfree-library', version: 1, aliases: [incoming], macros: [], routines: [], workspaces: [] });
  await control.getByRole('button', { name: 'Library', exact: true }).click();
  await control.getByText('Back up or move your library', { exact: true }).click();
  await control.locator('#import-library').setInputFiles({ name: 'reviewed.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(control.locator('#confirm-library-import')).toBeEnabled();
  const existing = { ...incoming, id: crypto.randomUUID(), url: 'https://handsfree.test/existing' };
  await message(control, { target: 'background', type: 'SAVE_ALIAS', alias: existing });
  await control.locator('#confirm-library-import').click();
  await expect(control.locator('#library-backup-status')).toContainText('not imported');
  expect((await state(control)).library?.aliases).toEqual([existing]);
});
