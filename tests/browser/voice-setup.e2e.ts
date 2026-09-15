import { test, expect, state } from './fixtures';
import { emitSpeech, installSpeechFixture } from './speech-fixture';
test.use({ mediaPermission: 'allow' });

test('completes spoken setup through real extension messaging with synthetic ASR output', async ({ control, context, worker }) => {
  const engine = await installSpeechFixture(control);
  const welcome = context.pages().find(page => page.url().endsWith('/onboarding.html'))!;
  await welcome.bringToFront(); await welcome.locator('#grant-mic').click();
  await expect(welcome.locator('#start-voice-practice')).toBeEnabled();
  const before = await worker.evaluate(() => chrome.tabs.query({}));
  await welcome.locator('#start-voice-practice').click();
  await expect(welcome.locator('#voice-practice-status')).toContainText('Listening');
  await emitSpeech(engine, 'open a new tab');
  await expect(welcome.locator('#spoken-setup')).toHaveAttribute('data-status', 'passed');
  expect((await state(control)).settings.setupVoicePassed).toBe(true);
  const after = await worker.evaluate(() => chrome.tabs.query({}));
  expect(after.length).toBe(before.length + 1); expect(after.find(tab => !before.some(old => old.id === tab.id))?.url).toBe('chrome://newtab/');
  expect(await engine.evaluate('globalThis.__handsfreeTestSpeech.current.stopped')).toBe(true);
  await welcome.screenshot({ path: 'test-results/spoken-setup.png', fullPage: true }); await engine.detach();
});

test('shows speech interpretation failure without performing a different action', async ({ control, context, worker }) => {
  const engine = await installSpeechFixture(control);
  const welcome = context.pages().find(page => page.url().endsWith('/onboarding.html'))!;
  await welcome.bringToFront(); await welcome.locator('#grant-mic').click(); await expect(welcome.locator('#start-voice-practice')).toBeEnabled();
  const before = await worker.evaluate(() => chrome.tabs.query({}));
  await welcome.locator('#start-voice-practice').click(); await emitSpeech(engine, 'close this tab');
  await expect(welcome.locator('#spoken-setup')).toHaveAttribute('data-status', 'failed');
  await expect(welcome.locator('#voice-practice-status')).toContainText('No command was run');
  expect((await worker.evaluate(() => chrome.tabs.query({}))).map(tab => tab.id)).toEqual(before.map(tab => tab.id));
  expect((await state(control)).settings.setupVoicePassed).toBe(false); await engine.detach();
});
