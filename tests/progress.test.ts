import { expect, it, vi } from 'vitest';
import { pauseProgress, prepareProgress } from '../src/background/progress';
import type { SessionState } from '../src/background/store';

it('retains every confirmed target beyond fifty when a batch stops partway through', async () => {
  let saved: SessionState | undefined;
  vi.stubGlobal('chrome', { tabs: { get: async () => ({ title: 'Research' }) }, storage: { session: {
    get: async () => ({ session: structuredClone(saved) }),
    set: async ({ session }: { session: SessionState }) => { saved = structuredClone(session); },
  } } });
  const update = await prepareProgress('restore', 'Restore Research', [
    { action: 'workspace_action', params: { operation: 'restore', name: 'Research' } },
    { action: 'pin_tab', params: { pin: true } },
  ]);
  const context = { tabId: 1, windowId: 1 };
  await update({ index: 0, status: 'running', context });
  for (let index = 1; index <= 75; index++) await update({ index: 0, status: 'target', context, result: `Opened article ${index}` });
  await pauseProgress('restore', 'failed', 'Chrome refused another tab');
  expect(saved?.progress?.steps[0]?.completedTargets).toEqual(Array.from({ length: 75 }, (_, index) => `Opened article ${index + 1}`));
  expect(saved?.progress?.steps.map(step => step.status)).toEqual(['failed', 'skipped']);
});
