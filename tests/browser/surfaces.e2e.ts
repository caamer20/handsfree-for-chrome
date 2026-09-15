import { test, expect, state, message } from './fixtures';
import { ExtensionTarget } from './extension-target';
import { installSpeechFixture } from './speech-fixture';

test('opens the actual persistent side panel and keeps it available across tab changes', async ({ context, control }) => {
  await control.getByRole('button', { name: 'Keep open beside my tabs' }).click();
  const panel = await ExtensionTarget.attach(control, '/sidepanel.html');
  await expect.poll(() => panel.evaluate('document.readyState')).toBe('complete');
  await expect.poll(() => panel.evaluate('document.body.dataset.surface')).toBe('panel');
  await expect.poll(() => panel.evaluate('document.querySelector("#listen").textContent')).toContain('Set up microphone');
  expect(await panel.evaluate('document.querySelector("#panel-stop").hidden')).toBe(false);
  await panel.click('#command');
  await expect.poll(() => panel.evaluate('document.activeElement.id')).toBe('command');
  await panel.send('Input.insertText', { text: 'open a new tab' });
  expect(await panel.evaluate('document.querySelector("#command").value')).toBe('open a new tab');
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

test('opens the native extension popup at Chrome’s actual popup dimensions', async ({ control, worker }, testInfo) => {
  await worker.evaluate(() => chrome.action.openPopup());
  const popup = await ExtensionTarget.attach(control, '/popup.html');
  // A button exists before the module and stylesheet finish loading. Native Chrome
  // also resizes the widget after first render; measure the initialized surface.
  await expect.poll(() => popup.evaluate('document.readyState')).toBe('complete');
  await expect.poll(() => popup.evaluate('document.body.dataset.surface')).toBe('popup');
  await expect.poll(() => popup.evaluate('document.querySelector("#listen").textContent')).toContain('Set up microphone');
  // Chrome's native opening animation can report several transient viewport sizes
  // after document load. Require a stable half-second, then test the settled layout.
  let previous = ''; let stableSince = 0;
  await expect.poll(async () => {
    const current = await popup.evaluate<{ width: number; height: number; scrollWidth: number; inputBottom: number }>('({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, inputBottom: document.querySelector("#command").getBoundingClientRect().bottom })');
    const key = JSON.stringify(current);
    if (key !== previous) { previous = key; stableSince = performance.now(); }
    return performance.now() - stableSince >= 500 && current.scrollWidth <= current.width && current.inputBottom <= current.height;
  }, { intervals: [50, 100, 100] }).toBe(true);
  const sizes = await popup.evaluate<{ width: number; height: number; scrollWidth: number; inputBottom: number }[]>('(async () => { const sizes = []; for (let frame = 0; frame < 6; frame++) { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); sizes.push({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, inputBottom: document.querySelector("#command").getBoundingClientRect().bottom }); } return sizes; })()');
  await testInfo.attach('native-popup-layout', { body: JSON.stringify(sizes), contentType: 'application/json' });
  await popup.screenshot('test-results/native-popup.png'); await popup.detach();
  for (const size of sizes) {
    expect(size.width).toBeLessThanOrEqual(800); expect(size.height).toBeLessThanOrEqual(600); expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
    expect(size.inputBottom).toBeLessThanOrEqual(size.height);
  }
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
