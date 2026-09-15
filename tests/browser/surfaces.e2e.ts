import { test, expect, state, message } from './fixtures';
import { ExtensionTarget } from './extension-target';
import { installSpeechFixture } from './speech-fixture';

test('opens the actual persistent side panel and keeps it available across tab changes', async ({ context, control }) => {
  await control.getByRole('button', { name: 'Keep open beside my tabs' }).click();
  const panel = await ExtensionTarget.attach(control, '/sidepanel.html');
  await expect.poll(() => panel.evaluate('document.body.dataset.surface')).toBe('panel');
  expect(await panel.evaluate('document.querySelector("#panel-stop").hidden')).toBe(false);
  await panel.click('#command'); await panel.send('Input.insertText', { text: 'open a new tab' });
  const another = await context.newPage(); await another.goto('about:blank'); await another.bringToFront();
  expect(await panel.evaluate('document.querySelector("#command").getBoundingClientRect().width')).toBeGreaterThan(0);
  expect(await panel.evaluate('document.querySelector("#command").value')).toBe('open a new tab');
  await panel.click('#command-form button');
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  const engine = await installSpeechFixture(control);
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  await expect.poll(() => panel.evaluate('document.querySelector("#panel-stop").disabled')).toBe(false);
  await panel.click('#panel-stop');
  await expect.poll(async () => (await state(control)).listening).toBe(false);
  expect((await state(control)).engineOpen).toBe(false);
  await engine.detach();
  await panel.screenshot('test-results/side-panel.png'); await panel.detach();
});

test('opens the native extension popup at Chrome’s actual popup dimensions', async ({ control, worker }) => {
  await worker.evaluate(() => chrome.action.openPopup());
  const popup = await ExtensionTarget.attach(control, '/popup.html');
  await expect.poll(() => popup.evaluate('document.querySelector("#listen")?.getBoundingClientRect().width ?? 0')).toBeGreaterThan(0);
  const size = await popup.evaluate<{ width: number; height: number; scrollWidth: number }>('({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth })');
  expect(size.width).toBeLessThanOrEqual(800); expect(size.height).toBeLessThanOrEqual(600); expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
  expect(await popup.evaluate<boolean>('document.querySelector("#command").getBoundingClientRect().bottom <= innerHeight')).toBe(true);
  await popup.screenshot('test-results/native-popup.png'); await popup.detach();
});

test('makes website-opening routines a type of routine and keeps AI advanced', async ({ control }) => {
  await control.getByRole('button', { name: 'Library', exact: true }).click();
  await control.getByRole('button', { name: 'Routines', exact: true }).click();
  await control.getByRole('button', { name: 'Open websites', exact: true }).click();
  await expect(control.getByRole('button', { name: '+ New website routine' })).toBeVisible();
  await control.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(control.locator('#voice-pace')).toBeVisible(); await expect(control.locator('#ai')).not.toBeVisible();
  expect((await state(control)).localAiAvailable).toBe(false);
  await control.locator('#advanced-settings>summary').click();
  await control.locator('#ai').check();
  await expect(control.locator('#ai-provider option[value="local"]')).toBeDisabled();
});
