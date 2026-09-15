import { test, expect, message, state } from './fixtures';
import { emitSpeech, installSpeechFixture } from './speech-fixture';

test('recreates the real offscreen engine after explicit sleep', async ({ control }) => {
  for (let cycle = 0; cycle < 3; cycle++) {
    await message(control, { target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
    await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
    expect((await state(control)).engineOpen).toBe(true);
    await message(control, { target: 'background', type: 'SLEEP_ENGINE' });
    await expect.poll(async () => (await state(control)).engineOpen).toBe(false);
  }
});

test('wakes a stopped Chrome service worker with preferences intact', async ({ context, control, extensionId }) => {
  const settings = { ...(await state(control)).settings, language: 'en-GB' as const, voicePace: 'relaxed' as const };
  await message(control, { target: 'background', type: 'SAVE_SETTINGS', settings });
  const cdp = await context.newCDPSession(control);
  let versionId: string | undefined;
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => { versionId = versions.find(version => version.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && version.runningStatus === 'running')?.versionId ?? versionId; });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => !!versionId).toBe(true);
  await cdp.send('ServiceWorker.stopWorker', { versionId: versionId! });
  await cdp.detach();
  await expect.poll(async () => (await state(control)).settings).toMatchObject({ language: 'en-GB', voicePace: 'relaxed' });
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
});

for (const [code, expected] of [['not-allowed', /microphone|permission/i], ['audio-capture', /microphone/i]] as const) {
  test(`handles synthetic speech failure ${code} and allows a typed recovery`, async ({ control }) => {
    const engine = await installSpeechFixture(control);
    await message(control, { target: 'background', type: 'MICROPHONE_READY' });
    await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
    await expect.poll(async () => (await state(control)).listening).toBe(true);
    await engine.evaluate(`globalThis.__handsfreeTestSpeech.current.onerror({ error: ${JSON.stringify(code)} })`);
    await expect.poll(async () => (await state(control)).hud.phase).toBe('error');
    expect((await state(control)).hud.text).toMatch(expected);
    expect((await state(control)).listening).toBe(false);
    await message(control, { target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
    await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
    await engine.detach();
  });
}

test('asks about conflicting ASR alternatives before opening any tab', async ({ control, worker }) => {
  const engine = await installSpeechFixture(control);
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  const before = await worker.evaluate(() => chrome.tabs.query({}));
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  await emitSpeech(engine, 'open a new tab', ['close this tab']);
  await expect.poll(async () => (await state(control)).hud.phase).toBe('clarify');
  expect((await worker.evaluate(() => chrome.tabs.query({}))).map(tab => tab.id)).toEqual(before.map(tab => tab.id));
  const question = (await state(control)).question!;
  await message(control, { target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question.id, answer: 'first' });
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  expect(await worker.evaluate(() => chrome.tabs.query({}))).toHaveLength(before.length + 1);
  await engine.detach();
});

test('requires the trigger, discards a partial command on network loss, and stops continuous speech', async ({ control, worker }) => {
  const engine = await installSpeechFixture(control);
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  await message(control, { target: 'background', type: 'SAVE_SETTINGS', settings: { ...(await state(control)).settings, listeningMode: 'continuous', triggerPhrase: 'hey browser', voicePace: 'relaxed' } });
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  const before = await worker.evaluate(() => chrome.tabs.query({}));
  await emitSpeech(engine, 'open a new tab');
  await expect.poll(() => engine.evaluate('globalThis.__handsfreeTestSpeech.current.results.length')).toBe(1);
  // A bounded wait spans the selected 1.6-second utterance pause; no trigger means no action.
  await control.waitForTimeout(1800);
  expect(await worker.evaluate(() => chrome.tabs.query({}))).toHaveLength(before.length);
  await emitSpeech(engine, 'hey browser close', [], false);
  await engine.evaluate('globalThis.__handsfreeTestSpeech.current.onerror({ error: "network" }); globalThis.__handsfreeTestSpeech.current.onend()');
  await expect.poll(() => engine.evaluate('globalThis.__handsfreeTestSpeech.starts')).toBeGreaterThan(1);
  await emitSpeech(engine, 'hey browser open a new tab');
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  expect(await worker.evaluate(() => chrome.tabs.query({}))).toHaveLength(before.length + 1);
  await message(control, { target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  expect((await state(control)).listening).toBe(false);
  expect((await state(control)).engineOpen).toBe(false);
  await engine.detach();
});
