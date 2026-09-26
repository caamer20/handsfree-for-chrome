import { test, expect, state } from './fixtures';

test('installs the production package and executes a typed command through the real engine', async ({ control, context, worker }) => {
  const errors: string[] = [];
  control.on('pageerror', error => errors.push(error.message));
  expect((await state(control)).settings.aiEnabled).toBe(false);
  const before = new Set((await worker.evaluate(() => chrome.tabs.query({}))).map(tab => tab.id));
  await control.locator('#command').fill('open a new tab');
  await control.getByRole('button', { name: 'Run typed command' }).click();
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  // tabs.create resolves before Chrome necessarily commits the new tab's URL.
  // Wait for that navigation while still requiring exactly one new tab.
  await expect.poll(async () => (await worker.evaluate(() => chrome.tabs.query({})))
    .filter(tab => !before.has(tab.id)).map(tab => tab.url)).toEqual(['chrome://newtab/']);
  expect(context.pages().length).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('saves preferences in the real popup and restores them after reopening', async ({ control, context, extensionId }) => {
  await control.getByRole('button', { name: 'Settings', exact: true }).click();
  await control.locator('#language').selectOption('en-GB');
  await control.getByRole('button', { name: 'Save preferences' }).click();
  await expect(control.locator('#saved')).toHaveText('Preferences saved.');
  await control.close();
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/src/popup/popup.html?settings=1`);
  await expect(reopened.locator('#language')).toHaveValue('en-GB');
});
