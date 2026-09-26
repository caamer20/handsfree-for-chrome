import { test, expect, message, state } from './fixtures';
import { ExtensionTarget } from './extension-target';
import { installSpeechFixture } from './speech-fixture';
import { installReadbackFixture } from './readback-fixture';

test('keeps paged decision readback and cancellation usable in the native popup', async ({ context, control, worker }) => {
  const engine = await installSpeechFixture(control); await installReadbackFixture(engine);
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Notes ${new URL(route.request().url()).pathname} with a long descriptive title for the native popup</title>Decision fixture` }));
  for (const index of [1, 2, 3, 4]) { const page = await context.newPage(); await page.goto(`https://handsfree.test/decision-${index}`); }
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'pin Notes' });
  await expect.poll(async () => (await state(control)).question?.choices.length).toBe(4);
  const question = (await state(control)).question!;
  await worker.evaluate(() => chrome.action.openPopup());
  const popup = await ExtensionTarget.attach(control, '/popup.html');
  await expect.poll(() => popup.evaluate('document.body.dataset.surface')).toBe('popup');
  await expect.poll(() => popup.evaluate('document.querySelector("#decision-controls").hidden')).toBe(false);
  await popup.click('#read-decision');
  await expect.poll(async () => (await state(control)).decisionReadback?.page).toBe(0);
  await popup.click('#next-decision-page');
  await expect.poll(async () => (await state(control)).decisionReadback?.page).toBe(1);
  await popup.click('#previous-decision-page');
  await expect.poll(async () => (await state(control)).decisionReadback?.page).toBe(0);
  expect((await state(control)).question).toEqual(question);
  expect(await popup.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  await popup.screenshot('test-results/native-decision-popup.png');
  await popup.click('#cancel-decision');
  await expect.poll(async () => (await state(control)).question).toBeNull();
  expect((await worker.evaluate(() => chrome.tabs.query({ pinned: true }))).length).toBe(0);
  await popup.detach(); await engine.detach();
});
