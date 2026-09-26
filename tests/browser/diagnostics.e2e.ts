import { readFile } from 'node:fs/promises';
import { test, expect, message, state } from './fixtures';

test('downloads a content-free diagnostic report without changing preferences, credentials, or permissions', async ({ control, worker }) => {
  const privateText = 'PRIVATE-DIAGNOSTIC-FIXTURE';
  const settings = { ...(await state(control)).settings, triggerPhrase: privateText, aiProvider: 'compatible' as const, aiEnabled: false, aiModel: privateText, aiBaseUrl: 'https://private-diagnostic.test/v1' };
  expect((await message(control, { target: 'background', type: 'SAVE_SETTINGS', settings })).ok).toBe(true);
  expect((await message(control, { target: 'background', type: 'SAVE_ALIAS', alias: { id: crypto.randomUUID(), name: privateText, url: 'https://private-diagnostic.test/content', searchUrl: '' } })).ok).toBe(true);
  await worker.evaluate(text => chrome.storage.local.set({ apiCredentials: { 'compatible:https://private-diagnostic.test': text }, log: [{ id: 'fixture', at: Date.now(), text, transcript: text, ok: false }] }), privateText);
  const before = await worker.evaluate(() => chrome.storage.local.get(null));
  const permissions = await worker.evaluate(() => chrome.permissions.getAll());
  await control.getByRole('button', { name: 'Settings', exact: true }).click();
  await control.getByText('Website access and troubleshooting', { exact: true }).click();
  const downloaded = control.waitForEvent('download');
  await control.getByRole('button', { name: 'Download diagnostic report', exact: true }).click();
  const file = await downloaded; const path = await file.path(); expect(path).toBeTruthy();
  const json = await readFile(path!, 'utf8'); const report = JSON.parse(json);
  expect(report.format).toBe('handsfree-diagnostics'); expect(report.version).toBe(1);
  expect(report.extension.version).toBe(await worker.evaluate(() => chrome.runtime.getManifest().version));
  expect(report.runtime.savedKeyPresent).toBe(true); expect(report.runtime.listening).toBe(false);
  expect(report.savedItemCounts.siteNicknames).toBe(1);
  expect(json).not.toContain(privateText); expect(json).not.toContain('private-diagnostic.test');
  expect(report.preferences.triggerPhrase).toBeUndefined(); expect(report.preferences.aiBaseUrl).toBeUndefined();
  expect(await worker.evaluate(() => chrome.storage.local.get(null))).toEqual(before);
  expect(await worker.evaluate(() => chrome.permissions.getAll())).toEqual(permissions);
  await expect(control.locator('#diagnostics-export-status')).toContainText('downloaded');
  await control.getByText('Inspect exported report', { exact: true }).click();
  await expect(control.locator('#diagnostics-report')).toHaveText(json);
  await control.screenshot({ path: 'test-results/diagnostic-report.png', fullPage: true });
});

test('offers the same diagnostic export from the welcome guide', async ({ context, control }) => {
  const welcome = context.pages().find(page => page.url().endsWith('/onboarding.html'))!;
  await welcome.bringToFront(); await welcome.getByText('More setup help', { exact: true }).click();
  const downloaded = welcome.waitForEvent('download');
  await welcome.getByRole('button', { name: 'Download diagnostic report', exact: true }).click();
  const file = await downloaded; const path = await file.path(); const report = JSON.parse(await readFile(path!, 'utf8'));
  expect(report.setup.spokenPracticePassed).toBe(false); expect(report.setup.microphonePreviouslyGranted).toBe(false);
  expect((await state(control)).listening).toBe(false);
  await expect(welcome.locator('#welcome-diagnostics-export-status')).toContainText('downloaded');
});
