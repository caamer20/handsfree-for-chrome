import { test as base, expect, message, state } from './fixtures';
import { chromium } from '@playwright/test';
import { mkdtemp, rm, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const sourceVersion = process.env.HANDSFREE_UPGRADE_VERSION ?? '1.8.0';
if (!['1.7.0', '1.8.0'].includes(sourceVersion)) throw new Error('HANDSFREE_UPGRADE_VERSION must be 1.7.0 or 1.8.0.');
const test = base.extend({
  extensionPath: async ({ browserName }, use) => {
    expect(browserName).toBe('chromium');
    if (!process.env.HANDSFREE_UPGRADE_ZIP) throw new Error(`Set HANDSFREE_UPGRADE_ZIP to the published ${sourceVersion === '1.7.0' ? 'v1.7.0-preview.1' : 'v1.8.0'} ZIP.`);
    const root = await mkdtemp(join(tmpdir(), 'handsfree-upgrade-'));
    try {
      await promisify(execFile)('unzip', ['-q', resolve(process.env.HANDSFREE_UPGRADE_ZIP), '-d', root]);
      expect(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')).version).toBe(sourceVersion);
      await use(root);
    } finally { await rm(root, { recursive: true, force: true }); }
  },
  profilePath: async ({ browserName }, use) => {
    expect(browserName).toBe('chromium');
    const path = await mkdtemp(join(tmpdir(), 'handsfree-upgrade-profile-'));
    try { await use(path); } finally { await rm(path, { recursive: true, force: true }); }
  },
});

test(`preserves published ${sourceVersion} preferences and library through upgrade and browser restart`, async ({ context, control, worker, extensionId, extensionPath, profilePath }) => {
  const destinationVersion = (JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { version: string }).version;
  expect(await worker.evaluate(() => chrome.runtime.getManifest().version)).toBe(sourceVersion);
  // Old release supplies its own settings schema, avoiding a disguised new-code migration test.
  const old = await state(control);
  const hasTranscript = Object.hasOwn(old, 'transcript');
  expect(old.settings).not.toHaveProperty('dictationPunctuation');
  const hasVoicePace = Object.hasOwn(old.settings, 'voicePace');
  const settings = { ...old.settings, language: 'en-GB' as const, feedback: 'sound' as const, reuseTabs: false, ...(hasVoicePace ? { voicePace: 'relaxed' as const } : {}) };
  expect((await message(control, { target: 'background', type: 'SAVE_SETTINGS', settings })).ok).toBe(true);
  const preservedSettings = {
    language: 'en-GB', feedback: 'sound', reuseTabs: false, mode: old.settings.mode,
    aiEnabled: old.settings.aiEnabled, listeningMode: old.settings.listeningMode, saveTranscripts: old.settings.saveTranscripts,
    voicePace: hasVoicePace ? 'relaxed' : 'natural', setupVoicePassed: old.settings.setupVoicePassed ?? false, dictationPunctuation: false,
  };
  const macro = { id: crypto.randomUUID(), name: 'Daily sites', phrase: 'daily sites', urls: ['https://example.com/'] };
  const routine = { id: crypto.randomUUID(), name: 'Daily task', phrase: 'daily task', steps: ['open a new tab', 'pin this tab'] };
  const alias = { id: crypto.randomUUID(), name: 'Upgrade portal', url: 'https://upgrade-fixture.test/portal', searchUrl: '' };
  expect((await message(control, { target: 'background', type: 'SAVE_MACRO', macro })).ok).toBe(true);
  expect((await message(control, { target: 'background', type: 'SAVE_ROUTINE', routine })).ok).toBe(true);
  expect((await message(control, { target: 'background', type: 'SAVE_ALIAS', alias })).ok).toBe(true);
  await context.route('https://upgrade-fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Upgrade reference</title><p>Preserved workspace fixture</p>' }));
  const reference = await context.newPage(); await reference.goto('https://upgrade-fixture.test/reference'); await reference.bringToFront();
  const saveWorkspaceCommand = 'save this workspace as Upgrade research';
  expect((await message(control, { target: 'background', type: 'RUN_TEXT', text: saveWorkspaceCommand })).ok).toBe(true);
  // Published releases can acknowledge RUN_TEXT before the offscreen parser
  // completes it. Wait for both the persisted result and that command's finish.
  await expect.poll(async () => {
    const current = await state(control);
    return {
      saved: current.library?.workspaces.some(item => item.name === 'Upgrade research') ?? false,
      phase: current.hud.phase,
      ...(hasTranscript ? { transcript: current.transcript } : {}),
    };
  }).toEqual({ saved: true, phase: 'success', ...(hasTranscript ? { transcript: saveWorkspaceCommand } : {}) });
  const workspace = (await state(control)).library?.workspaces.find(item => item.name === 'Upgrade research');
  expect(workspace).toBeDefined(); expect(workspace?.tabs).toEqual([{ url: 'https://upgrade-fixture.test/reference', title: 'Upgrade reference', pinned: false }]);
  expect(workspace).not.toHaveProperty('activeTabIndex'); expect(workspace).not.toHaveProperty('groups');
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
  await expect.poll(async () => (await state(upgraded)).settings).toMatchObject(preservedSettings);
  expect((await state(upgraded)).macros).toContainEqual(macro);
  expect((await state(upgraded)).routines).toContainEqual(routine);
  expect((await state(upgraded)).library?.aliases).toContainEqual(alias);
  expect((await state(upgraded)).library?.workspaces).toContainEqual(workspace);
  expect(await upgraded.evaluate(() => chrome.runtime.getManifest().version)).toBe(destinationVersion);
  await context.close();
  const restarted = await chromium.launchPersistentContext(profilePath, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  try {
    const reopened = await restarted.newPage(); await reopened.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await expect.poll(async () => (await state(reopened)).settings).toMatchObject(preservedSettings);
    const restored = await state(reopened);
    expect(restored.routines).toContainEqual(routine); expect(restored.macros).toContainEqual(macro);
    expect(restored.library?.aliases).toContainEqual(alias); expect(restored.library?.workspaces).toContainEqual(workspace);
    expect(await reopened.evaluate(() => chrome.runtime.getManifest().version)).toBe(destinationVersion);
    const beforeCount = await reopened.evaluate(async () => (await chrome.tabs.query({})).length);
    await message(reopened, { target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
    await expect.poll(async () => (await state(reopened)).hud.phase).toBe('success');
    await expect.poll(async () => reopened.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(beforeCount + 1);
  } finally { await restarted.close(); }
});
