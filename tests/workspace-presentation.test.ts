import { expect, it } from 'vitest';
import { workspaceDisplayTranscript } from '../src/common/workspace-presentation';
import { describeAction } from '../src/common/action-labels';
import { makeProgress } from '../src/common/progress';
import { decisionReadback } from '../src/common/decision-readback';
import type { ChromeAction } from '../src/common/schema';

const id = '00000000-0000-4000-8000-000000000001';
const workspaces = [{ id, name: 'Research & notes' }];
it.each([
  [`update ${id} workspace from this window`, 'update Research & notes workspace from this window'],
  [`recover ${id} workspace`, 'recover Research & notes workspace'],
  [`rename ${id} workspace`, 'rename Research & notes workspace'],
  [`discard previous version of ${id} workspace`, 'discard previous version of Research & notes workspace'],
  [`restore ${id} workspace`, 'restore Research & notes workspace'],
])('displays a Library workspace command using its saved name: %s', (input, expected) => {
  expect(workspaceDisplayTranscript(input, workspaces)).toBe(expected);
});
it.each([
  `type ${id}`, `fill Notes with ${id}`, `rename Research workspace to ${id}`, `rename ${id} workspace to ${id}`,
  `save this workspace as ${id}`, `Answered: ${id}`, `search Google for update ${id} workspace from this window`,
  `update ${id} workspace from this window then type ${id}`,
])('leaves UUIDs in literal payloads and non-Library transcripts unchanged: %s', input => {
  expect(workspaceDisplayTranscript(input, workspaces)).toBe(input);
});
it('leaves an unknown workspace reference visible without guessing another name', () => {
  const input = `rename ${id} workspace`; expect(workspaceDisplayTranscript(input, [])).toBe(input);
});
it('resolves only workspace target fields in action labels while preserving plan IDs and literal values', () => {
  const plan: ChromeAction[] = [
    { action: 'workspace_action', params: { operation: 'rename', name: id, new_name: id } },
    { action: 'page_action', params: { operation: 'type', text: id } },
    { action: 'workspace_action', params: { operation: 'save', name: id } },
  ];
  const before = structuredClone(plan);
  expect(describeAction(plan[0]!, workspaces)).toBe(`rename workspace Research & notes to ${id}`);
  expect(describeAction(plan[1]!, workspaces)).toContain(id);
  expect(describeAction(plan[2]!, workspaces)).toBe(`save workspace ${id}`);
  expect(makeProgress('request', 'Browser command', plan, workspaces).steps[0]!.label).toBe(`rename workspace Research & notes to ${id}`);
  const pending = { request: { id: 'request', tabId: 1, windowId: 1, startedAt: Date.now() }, actions: plan, transcript: 'review' };
  const first = decisionReadback(null, pending, 0, workspaces);
  const spoken = Array.from({ length: first.totalPages }, (_, page) => decisionReadback(null, pending, page, workspaces).text).join('\n');
  expect(spoken).toContain(`rename workspace Research & notes to ${id}`);
  expect(plan).toEqual(before);
});
