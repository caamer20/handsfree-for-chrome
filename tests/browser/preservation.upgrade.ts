import { test as base, expect, message, state } from './fixtures';
import { chromium } from '@playwright/test';
import { mkdtemp, rm, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const test = base.extend({
  extensionPath: async ({ browserName }, use) => {
    expect(browserName).toBe('chromium');
    if (!process.env.HANDSFREE_UPGRADE_ZIP) throw new Error('Set HANDSFREE_UPGRADE_ZIP to the published v1.7.0-preview.1 ZIP.');
    const root = await mkdtemp(join(tmpdir(), 'handsfree-upgrade-'));
    try {
      await promisify(execFile)('unzip', ['-q', resolve(process.env.HANDSFREE_UPGRADE_ZIP), '-d', root]);
      expect(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')).version).toBe('1.7.0');
      await use(root);
    } finally { await rm(root, { recursive: true, force: true }); }
  },
  profilePath: async ({ browserName }, use) => {
    expect(browserName).toBe('chromium');
    const path = await mkdtemp(join(tmpdir(), 'handsfree-upgrade-profile-'));
    try { await use(path); } finally { await rm(path, { recursive: true, force: true }); }
  },
});

test('preserves actual v1.7 preferences and both routine types through upgrade and browser restart', async ({ context, control, worker, extensionId, extensionPath, profilePath }) => {
  expect(await worker.evaluate(() => chrome.runtime.getManifest().version)).toBe('1.7.0');
  // Old release supplies its own settings schema, avoiding a disguised new-code migration test.
  const old = await state(control);
  expect((await message(control, { target: 'background', type: 'SAVE_SETTINGS', settings: { ...old.settings, language: 'en-GB', feedback: 'sound', reuseTabs: false } })).ok).toBe(true);
  const macro = { id: crypto.randomUUID(), name: 'Daily sites', phrase: 'daily sites', urls: ['https://example.com/'] };
  const routine = { id: crypto.randomUUID(), name: 'Daily task', phrase: 'daily task', steps: ['open a new tab', 'pin this tab'] };
  expect((await message(control, { target: 'background', type: 'SAVE_MACRO', macro })).ok).toBe(true);
  expect((await message(control, { target: 'background', type: 'SAVE_ROUTINE', routine })).ok).toBe(true);
  await rm(extensionPath, { recursive: true }); await cp(resolve('dist'), extensionPath, { recursive: true });
  const manager = await context.newPage(); await manager.goto('chrome://extensions/');
  await manager.evaluate(async id => {
    const api = chrome as unknown as { developerPrivate: { updateProfileConfiguration(options: { inDeveloperMode: boolean }): Promise<void>; reload(id: string, options: { failQuietly: boolean; populateErrorForUnpacked: boolean }): Promise<unknown> } };
    await api.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
    const error = await api.developerPrivate.reload(id, { failQuietly: true, populateErrorForUnpacked: true });
    if (error) throw new Error(JSON.stringify(error));
  }, extensionId);
  // Chrome closes extension pages while reloading; open a fresh page in the same profile.
  const upgraded = await context.newPage(); await upgraded.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect.poll(async () => (await state(upgraded)).settings).toMatchObject({ language: 'en-GB', feedback: 'sound', reuseTabs: false, voicePace: 'natural', setupVoicePassed: false });
  expect((await state(upgraded)).macros).toContainEqual(macro);
  expect((await state(upgraded)).routines).toContainEqual(routine);
  expect(await upgraded.evaluate(() => chrome.runtime.getManifest().version)).toBe('1.8.0');
  await context.close();
  const restarted = await chromium.launchPersistentContext(profilePath, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  try {
    const reopened = await restarted.newPage(); await reopened.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await expect.poll(async () => (await state(reopened)).settings.language).toBe('en-GB');
    expect((await state(reopened)).routines).toContainEqual(routine); expect((await state(reopened)).macros).toContainEqual(macro);
    await message(reopened, { target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
    await expect.poll(async () => (await state(reopened)).hud.phase).toBe('success');
  } finally { await restarted.close(); }
});
