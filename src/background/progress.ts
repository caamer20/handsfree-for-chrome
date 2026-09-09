import { makeProgress, stopProgress, type ExecutionProgress, type ProgressEvent } from '../common/progress';
import type { ChromeAction } from '../common/schema';
import { getSession, setSession } from './store';
export async function prepareProgress(id: string, name: string, actions: ChromeAction[]): Promise<(event: ProgressEvent) => Promise<void>> {
  let progress = (await getSession()).progress;
  if (!progress || progress.id !== id) progress = makeProgress(id, name, actions);
  else progress = structuredClone(progress);
  const offset = Math.max(0, progress.steps.length - actions.length);
  progress.status = 'running'; await setSession({ progress });
  return async event => {
    const current = await getSession(); if (current.progress?.id !== id) return;
    const next: ExecutionProgress = structuredClone(current.progress); const step = next.steps[offset + event.index]; if (!step) return;
    next.updatedAt = Date.now(); next.status = 'running';
    if (event.status === 'running') {
      step.status = 'running'; step.result = undefined;
      const tab = await chrome.tabs.get(event.context.tabId).catch(() => undefined);
      step.target = `${tab?.title || 'Tab ' + event.context.tabId}${event.context.tabIds && event.context.tabIds.length > 1 ? ` · ${event.context.tabIds.length} tabs` : ''}`.slice(0, 200);
    } else if (event.status === 'target') {
      if (event.result && step.completedTargets.length < 50) step.completedTargets.push(event.result.slice(0, 250));
    } else { step.status = 'completed'; step.result = event.result?.slice(0, 500); }
    if (next.steps.every(item => item.status === 'completed')) next.status = 'completed';
    await setSession({ progress: next });
  };
}
export async function pauseProgress(id: string, status: 'waiting' | 'failed' | 'cancelled', detail?: string): Promise<void> {
  const { progress } = await getSession();
  if (progress?.id === id && !['completed', 'failed', 'cancelled'].includes(progress.status)) await setSession({ progress: stopProgress(progress, status, detail) });
}
export async function completeReviewedProgress(id: string, result: string): Promise<void> {
  const { progress } = await getSession(); if (progress?.id !== id) return;
  const next = structuredClone(progress); const step = next.steps.find(item => item.status === 'waiting');
  if (step) { step.status = 'completed'; step.result = result; }
  next.status = next.steps.every(item => item.status === 'completed') ? 'completed' : 'running'; next.updatedAt = Date.now();
  await setSession({ progress: next });
}
