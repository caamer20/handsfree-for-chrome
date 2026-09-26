import { test, expect, message, state } from './fixtures';
import { emitSpeech, installSpeechFixture } from './speech-fixture';

test('requires an unambiguous spoken review answer before opening a routine tab', async ({ control, worker }) => {
  const engine = await installSpeechFixture(control);
  const routine = { id: crypto.randomUUID(), name: 'One fresh tab', phrase: 'My fresh tab', steps: ['Open a new tab'] };
  await message(control, { target: 'background', type: 'SAVE_ROUTINE', routine });
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  const before = await worker.evaluate(() => chrome.tabs.query({}));
  await emitSpeech(engine, routine.phrase);
  await expect.poll(async () => !!(await state(control)).pending).toBe(true);
  const requestId = (await state(control)).pending!.request.id;
  await emitSpeech(engine, 'confirm command', ['cancel command']);
  await expect.poll(async () => (await state(control)).hud.text).toContain('conflicting');
  expect((await state(control)).pending?.request.id).toBe(requestId);
  expect(await worker.evaluate(() => chrome.tabs.query({}))).toHaveLength(before.length);
  await emitSpeech(engine, 'confirm command', ['go ahead']);
  await expect.poll(async () => (await state(control)).pending).toBeNull();
  await expect.poll(async () => (await worker.evaluate(() => chrome.tabs.query({}))).length).toBe(before.length + 1);
  await message(control, { target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  await engine.detach();
});

test('does not close a tab when the speech alternatives include cancellation', async ({ control, worker }) => {
  const engine = await installSpeechFixture(control);
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  const before = (await worker.evaluate(() => chrome.tabs.query({}))).map(tab => tab.id);
  await emitSpeech(engine, 'close this tab', ['stop']);
  await expect.poll(async () => (await state(control)).question?.kind).toBe('speech');
  expect((await worker.evaluate(() => chrome.tabs.query({}))).map(tab => tab.id)).toEqual(before);
  expect((await state(control)).question?.choices.map(choice => choice.value)).toContain('stop');
  await message(control, { target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  expect((await worker.evaluate(() => chrome.tabs.query({}))).map(tab => tab.id)).toEqual(before);
  await engine.detach();
});

test('preserves keyboard focus on a clarification choice through unrelated updates', async ({ context, control, worker }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Research notes</title>Notes' }));
  for (const path of ['one', 'two']) { const page = await context.newPage(); await page.goto(`https://handsfree.test/${path}`); }
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'pin Research notes' });
  await expect.poll(async () => !!(await state(control)).question).toBe(true);
  await control.bringToFront();
  const choice = control.locator('#question-choices button').nth(1); await choice.focus();
  await worker.evaluate(() => chrome.storage.local.set({ uiRefreshFixture: Date.now() }));
  await expect(control.locator('#question-choices button')).toHaveCount(2);
  // Observe the actual refresh, then assert node identity/focus survived it.
  await control.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  await expect(choice).toBeFocused();
  await choice.press('Enter');
  await expect.poll(async () => (await state(control)).question).toBeNull();
  await expect.poll(async () => (await worker.evaluate(() => chrome.tabs.query({}))).filter(tab => tab.url?.startsWith('https://handsfree.test/') && tab.pinned).length).toBe(1);
});

test('keeps an expanded saved routine open through background tab updates', async ({ control, worker }) => {
  const routine = { id: crypto.randomUUID(), name: 'Keep this preview', phrase: 'Preview fixture', steps: ['Open a new tab', 'Pin this tab'] };
  await message(control, { target: 'background', type: 'SAVE_ROUTINE', routine });
  await control.getByRole('button', { name: 'Library', exact: true }).click();
  await control.getByRole('button', { name: 'Routines', exact: true }).click();
  const details = control.locator('#routine-list details'); await details.locator('summary').click();
  await worker.evaluate(() => chrome.storage.local.set({ uiRefreshFixture: Date.now() }));
  await control.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  await expect(details).toHaveAttribute('open', '');
});

test('keeps recovery visible while listening and retargets unfinished steps by voice', async ({ context, control, worker }) => {
  const engine = await installSpeechFixture(control);
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Existing notes</title>Notes' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/recover'); await page.bringToFront();
  const tab = (await worker.evaluate(() => chrome.tabs.query({}))).find(tab => tab.url === 'https://handsfree.test/recover')!;
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'pin this tab then mute the unavailable zygomorphic draft tab' });
  await expect.poll(async () => (await state(control)).recovery?.kind).toBe('missing-target');
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  await expect.poll(async () => (await state(control)).hud.phase).toBe('listening');
  await expect(control.locator('#recovery-card')).toBeVisible();
  // A manual change proves the completed pin step is never replayed by recovery.
  await worker.evaluate(id => chrome.tabs.update(id, { pinned: false }), tab.id!);
  await emitSpeech(engine, 'choose another tab');
  await expect.poll(async () => !!(await state(control)).question).toBe(true);
  const question = (await state(control)).question!;
  const index = question.choices.findIndex(choice => choice.tabs?.[0]?.id === tab.id); expect(index).toBeGreaterThanOrEqual(0);
  await emitSpeech(engine, String(index + 1));
  await expect.poll(async () => (await worker.evaluate(id => chrome.tabs.get(id), tab.id!)).mutedInfo?.muted).toBe(true);
  expect((await worker.evaluate(id => chrome.tabs.get(id), tab.id!)).pinned).toBe(false);
  await expect.poll(async () => (await state(control)).progress?.steps.every(step => step.status === 'completed')).toBe(true);
  await message(control, { target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  await engine.detach();
});
