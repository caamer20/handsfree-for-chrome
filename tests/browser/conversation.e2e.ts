import { test, expect, message, state } from './fixtures';
import { emitSpeech, installSpeechFixture } from './speech-fixture';
import { installReadbackFixture } from './readback-fixture';

test('reads all choices and completes a single-command question with one fresh spoken answer', async ({ context, control, worker }) => {
  const engine = await installSpeechFixture(control); await installReadbackFixture(engine);
  const settings = (await state(control)).settings;
  await message(control, { target: 'background', type: 'SAVE_SETTINGS', settings: { ...settings, listeningMode: 'single', feedback: 'none' } });
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Research notes ${new URL(route.request().url()).pathname.slice(1)}</title>Research fixture` }));
  for (const index of [1, 2, 3, 4]) { const page = await context.newPage(); await page.goto(`https://handsfree.test/${index}`); }
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  await emitSpeech(engine, 'pin Research notes');
  await expect.poll(async () => (await state(control)).question?.choices.length).toBe(4);
  const question = (await state(control)).question!;
  await expect.poll(async () => (await state(control)).listening).toBe(false);
  await control.bringToFront(); await control.locator('#read-decision').click();
  await expect(control.locator('#decision-readback-text')).toContainText('Page 1 of 3');
  await control.locator('#next-decision-page').click(); await expect(control.locator('#decision-readback-text')).toContainText('Page 2 of 3');
  await control.locator('#next-decision-page').click(); await expect(control.locator('#decision-readback-text')).toContainText('Option 4.');
  await expect.poll(() => engine.evaluate('globalThis.__handsfreeReadback.join(" ")')).toContain('Option 4.');
  expect((await state(control)).question).toEqual(question);
  await control.locator('#listen-decision').click(); await emitSpeech(engine, 'four', ['one']);
  await expect.poll(async () => (await state(control)).listening).toBe(false);
  expect((await state(control)).question?.id).toBe(question.id);
  expect((await worker.evaluate(() => chrome.tabs.query({ pinned: true }))).length).toBe(0);
  await control.locator('#listen-decision').click(); await emitSpeech(engine, 'four', ['option 4']);
  await expect.poll(async () => (await state(control)).question).toBeNull();
  const targetId = question.choices[3]!.tabs![0]!.id;
  await expect.poll(async () => (await worker.evaluate(() => chrome.tabs.query({ pinned: true }))).map(tab => tab.id)).toEqual([targetId]);
  expect((await state(control)).listening).toBe(false); await engine.detach();
});

test('keeps a single-command review pending through explicit readback and conflicting confirmation', async ({ control, worker }) => {
  const engine = await installSpeechFixture(control); await installReadbackFixture(engine);
  const settings = (await state(control)).settings;
  await message(control, { target: 'background', type: 'SAVE_SETTINGS', settings: { ...settings, listeningMode: 'single', feedback: 'none' } });
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  const routine = { id: crypto.randomUUID(), name: 'Conversation fixture', phrase: 'Open conversation fixture', steps: ['Open a new tab'] };
  await message(control, { target: 'background', type: 'SAVE_ROUTINE', routine });
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' }); await emitSpeech(engine, routine.phrase);
  await expect.poll(async () => !!(await state(control)).pending).toBe(true);
  const pending = (await state(control)).pending!; const before = (await worker.evaluate(() => chrome.tabs.query({}))).length;
  expect(await engine.evaluate('globalThis.__handsfreeReadback.length')).toBe(0);
  await control.bringToFront(); await control.locator('#read-decision').click();
  await expect(control.locator('#decision-readback-text')).toContainText('Step 1. Open a new tab');
  expect((await state(control)).pending).toEqual(pending);
  await control.locator('#listen-decision').click(); await emitSpeech(engine, 'confirm command', ['read the command']);
  await expect.poll(async () => (await state(control)).listening).toBe(false);
  expect((await state(control)).pending).toEqual(pending); expect((await worker.evaluate(() => chrome.tabs.query({}))).length).toBe(before);
  await control.locator('#listen-decision').click(); await emitSpeech(engine, 'confirm command', ['go ahead']);
  await expect.poll(async () => (await state(control)).pending).toBeNull();
  await expect.poll(async () => (await worker.evaluate(() => chrome.tabs.query({}))).length).toBe(before + 1);
  expect((await state(control)).listening).toBe(false); await engine.detach();
});
