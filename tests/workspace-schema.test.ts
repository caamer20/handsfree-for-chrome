import { expect, it } from 'vitest';
import { workspaceSchema, workspaceSnapshot, type Workspace } from '../src/common/library';

const legacy: Workspace = { id: '00000000-0000-4000-8000-000000000001', name: 'Old research', createdAt: 100, tabs: [
  { title: 'Reference', url: 'https://reference.example/', pinned: false, group: 'Research', color: 'blue' },
  { title: 'Other', url: 'https://other.example/', pinned: false },
] };
const current = (): Workspace => ({ ...structuredClone(legacy), activeTabIndex: 1, groups: [{ id: 'saved-group', title: 'Research', color: 'blue', collapsed: true }], tabs: [{ ...legacy.tabs[0]!, groupId: 'saved-group' }, legacy.tabs[1]!] });

it('accepts existing workspaces without the new optional metadata', () => { expect(workspaceSchema.parse(legacy)).toEqual(legacy); });
it('round-trips active-tab and group-identity metadata', () => { expect(workspaceSchema.parse(current())).toEqual(current()); });
it('keeps one independently validated previous snapshot without allowing recursive history', () => {
  const workspace = { ...current(), previous: workspaceSnapshot(legacy) };
  expect(workspaceSchema.parse(workspace)).toEqual(workspace);
  expect(() => workspaceSchema.parse({ ...workspace, previous: { ...workspace.previous, previous: workspace.previous } })).toThrow('Unrecognized key');
  expect(() => workspaceSchema.parse({ ...workspace, previous: { ...workspace.previous, activeTabIndex: 2 } })).toThrow('active tab');
  expect(() => workspaceSchema.parse({ ...workspace, previous: { ...workspace.previous, tabs: [{ ...workspace.previous.tabs[0], groupId: 'saved-group' }] } })).toThrow('unknown saved group');
});
it.each([-1, 2, 0.5, 100])('rejects an invalid active tab index %s', activeTabIndex => { expect(() => workspaceSchema.parse({ ...current(), activeTabIndex })).toThrow(); });
it('rejects a tab reference to an absent group without silently dropping it', () => {
  const workspace = current(); workspace.tabs[0]!.groupId = 'missing'; expect(() => workspaceSchema.parse(workspace)).toThrow('unknown saved group');
  delete workspace.groups; expect(() => workspaceSchema.parse(workspace)).toThrow('unknown saved group');
});
it('rejects duplicate group IDs and groups without members', () => {
  const duplicate = current(); duplicate.groups!.push({ ...duplicate.groups![0]!, title: 'Different' }); expect(() => workspaceSchema.parse(duplicate)).toThrow('unique ID');
  const empty = current(); empty.groups!.push({ id: 'empty', title: '', color: 'grey', collapsed: false }); expect(() => workspaceSchema.parse(empty)).toThrow('at least one tab');
});
it('rejects impossible pinned group membership and misleading legacy labels', () => {
  const pinned = current(); pinned.tabs[0]!.pinned = true; expect(() => workspaceSchema.parse(pinned)).toThrow('Pinned tabs');
  const mismatch = current(); mismatch.tabs[0]!.group = 'Different'; expect(() => workspaceSchema.parse(mismatch)).toThrow('must match');
});
it('permits distinct group identities with the same or empty titles', () => {
  const workspace = current();
  workspace.groups = [{ id: 'first', title: '', color: 'blue', collapsed: true }, { id: 'second', title: '', color: 'blue', collapsed: false }];
  workspace.tabs = workspace.tabs.map((tab, index) => ({ ...tab, groupId: index === 0 ? 'first' : 'second', group: '', color: 'blue' }));
  expect(workspaceSchema.parse(workspace).groups).toHaveLength(2);
});
