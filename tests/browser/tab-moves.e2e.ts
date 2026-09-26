import { test, expect, message, state } from './fixtures';

test('moves a selected tab block in stable order and undoes it without changing selection identity', async ({ control, worker }) => {
  const window = await worker.evaluate(() => chrome.windows.create({ type: 'normal', focused: true, url: ['about:blank', 'about:blank', 'about:blank'] }));
  const windowId = window.id!;
  const order = async (): Promise<number[]> => worker.evaluate(async id => (await chrome.tabs.query({ windowId: id })).sort((a, b) => a.index - b.index).map(tab => tab.id!), windowId);
  await expect.poll(async () => (await order()).length).toBe(3);
  const original = await order();
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), original[0]!);
  const run = async (text: string): Promise<void> => {
    const previous = (await state(control)).progress?.id;
    expect((await message(control, { target: 'background', type: 'RUN_TEXT', text })).ok).toBe(true);
    await expect.poll(async () => { const current = await state(control); return [current.progress?.id !== previous, current.transcript, current.progress?.status]; }).toEqual([true, text, 'completed']);
  };
  await run('mute tabs one and two');
  const selected = original.slice(0, 2);
  expect((await state(control)).contextTargets?.map(tab => tab.id)).toEqual(selected);
  await run('move them right');
  expect(await order()).toEqual([original[2], original[0], original[1]]);
  expect((await state(control)).contextTargets?.map(tab => tab.id)).toEqual(selected);
  await run('move them right'); // Already at the boundary: never reverse the selected pair.
  expect(await order()).toEqual([original[2], original[0], original[1]]);
  await run('undo that move'); expect(await order()).toEqual(original);
  await run('move them to the end'); expect(await order()).toEqual([original[2], original[0], original[1]]);
  await run('move them to the beginning'); expect(await order()).toEqual(original);
  await run('undo that move'); expect(await order()).toEqual([original[2], original[0], original[1]]);
});
