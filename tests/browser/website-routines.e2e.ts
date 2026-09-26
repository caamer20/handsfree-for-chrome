import { test, expect, message, state } from './fixtures';

test('resolves same-name website routines once and keeps all launched tabs for a plural follow-up', async ({ context, control, worker }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Routine fixture</title>Saved website' }));
  const first = { id: crypto.randomUUID(), name: 'Daily', phrase: 'daily first', urls: ['https://handsfree.test/first'] };
  const selected = { id: crypto.randomUUID(), name: 'Daily', phrase: 'daily second', urls: ['https://handsfree.test/second', 'https://handsfree.test/third'] };
  for (const macro of [first, selected]) expect((await message(control, { target: 'background', type: 'SAVE_MACRO', macro })).ok).toBe(true);
  const page = await context.newPage(); await page.goto('https://handsfree.test/added'); await page.bringToFront();
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'add this site to my Daily routine' });
  await expect.poll(async () => (await state(control)).question?.choices.length).toBe(2);
  const question = (await state(control)).question!;
  expect(question.choices[1]!.detail).toContain(selected.phrase);
  await message(control, { target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question.id, answer: 'second' });
  await expect.poll(async () => { const current = await state(control); return [current.hud.phase, current.question, current.macros.find(item => item.id === selected.id)?.urls]; }).toEqual(['success', null, [...selected.urls, 'https://handsfree.test/added']]);
  expect((await state(control)).macros.find(item => item.id === first.id)).toEqual(first);
  const before = (await worker.evaluate(() => chrome.tabs.query({}))).map(tab => tab.id);
  await message(control, { target: 'background', type: 'RUN_MACRO', id: selected.id });
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  await expect.poll(async () => (await worker.evaluate(() => chrome.tabs.query({}))).filter(tab => !before.includes(tab.id)).map(tab => tab.url || tab.pendingUrl)).toEqual([...selected.urls, 'https://handsfree.test/added']);
  const launched = (await worker.evaluate(() => chrome.tabs.query({}))).filter(tab => !before.includes(tab.id));
  expect(launched.filter(tab => tab.active).map(tab => tab.id)).toEqual([launched[0]!.id]);
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'mute them' });
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  await expect.poll(async () => (await worker.evaluate(() => chrome.tabs.query({}))).filter(tab => launched.some(item => item.id === tab.id)).map(tab => tab.mutedInfo?.muted)).toEqual([true, true, true]);
  const originals = (await worker.evaluate(() => chrome.tabs.query({}))).filter(tab => before.includes(tab.id));
  expect(originals.some(tab => tab.mutedInfo?.muted)).toBe(false);
});
