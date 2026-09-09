import type { ChromeAction } from './schema';
import type { TargetContext } from './conversation';
import { describeAction } from './action-labels';
export type StepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'skipped';
export interface ProgressStep { label: string; status: StepStatus; target?: string; completedTargets: string[]; result?: string; }
export interface ExecutionProgress { id: string; name: string; status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'; steps: ProgressStep[]; updatedAt: number; }
export interface ProgressEvent { index: number; status: 'running' | 'completed' | 'target'; context: TargetContext; result?: string; }
export function makeProgress(id: string, name: string, actions: ChromeAction[]): ExecutionProgress {
  return { id, name: name.slice(0, 100), status: 'running', steps: actions.map(action => ({ label: describeAction(action), status: 'pending', completedTargets: [] })), updatedAt: Date.now() };
}
export function stopProgress(progress: ExecutionProgress, status: 'waiting' | 'failed' | 'cancelled', detail?: string): ExecutionProgress {
  const next = structuredClone(progress); next.status = status; next.updatedAt = Date.now();
  const current = next.steps.find(step => step.status === 'running' || step.status === 'waiting');
  if (current) { current.status = status; if (detail) current.result = detail.slice(0, 500); }
  if (status !== 'waiting') for (const step of next.steps) if (step.status === 'pending') step.status = 'skipped';
  return next;
}
