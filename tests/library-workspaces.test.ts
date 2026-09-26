// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { LibraryPanel } from '../src/popup/library';
import { defaultSettings } from '../src/common/schema';
import type { AppState } from '../src/common/types';

const perform = vi.fn(async () => true);
const workspace = { id: '00000000-0000-4000-8000-000000000001', name: 'Research', createdAt: 2, tabs: [{ title: 'Current', url: 'https://current.example/', pinned: false }], previous: { createdAt: 1, tabs: [{ title: '<script>Previous</script>', url: 'https://old.example/', pinned: true }] } };
const state = (): AppState => ({ settings: structuredClone(defaultSettings), macros: [], hud: { phase: 'idle', text: 'Ready' }, log: [], pending: null, shortcut: '', engineOpen: false, listening: false, hasApiKey: false, library: { aliases: [], suggestions: [], workspaces: [structuredClone(workspace)] } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Option', function (label: string, value: string) { const option = document.createElement('option'); option.textContent = label; option.value = value; return option; });
  document.body.innerHTML = ['new-alias', 'cancel-alias', 'alias-form', 'refresh-sites', 'refresh-reading', 'site-count', 'builtin-sites', 'alias-list', 'suggestions-wrap', 'site-suggestions', 'workspace-list', 'site-defaults'].map(id => `<div id="${id}"></div>`).join('');
});
it('offers an exact-ID workspace update and recovery while safely showing the previous snapshot', async () => {
  new LibraryPanel(perform, vi.fn()).render(state());
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#workspace-list button'));
  buttons.find(button => button.textContent === 'Update from this window')!.click(); await Promise.resolve();
  expect(perform).toHaveBeenLastCalledWith({ target: 'background', type: 'RUN_TEXT', text: `update ${workspace.id} workspace from this window` });
  buttons.find(button => button.textContent === 'Recover previous saved version')!.click(); await Promise.resolve();
  expect(perform).toHaveBeenLastCalledWith({ target: 'background', type: 'RUN_TEXT', text: `recover ${workspace.id} workspace` });
  buttons.find(button => button.textContent === 'Rename')!.click(); await Promise.resolve();
  expect(perform).toHaveBeenLastCalledWith({ target: 'background', type: 'RUN_TEXT', text: `rename ${workspace.id} workspace` });
  buttons.find(button => button.textContent === 'Discard previous saved version')!.click(); await Promise.resolve();
  expect(perform).toHaveBeenLastCalledWith({ target: 'background', type: 'RUN_TEXT', text: `discard previous version of ${workspace.id} workspace` });
  expect(document.querySelector('#workspace-list')!.textContent).toContain('Previous saved version · 1 tabs');
  expect(document.querySelector('#workspace-list')!.textContent).toContain('<script>Previous</script>');
  expect(document.querySelector('#workspace-list script')).toBeNull();
});
it('disables workspace launches and edits while a decision is pending', () => {
  const current = state(); current.hud = { phase: 'clarify', text: 'Choose' }; current.question = { id: 'q', choices: [], prompt: 'Choose', kind: 'workspace', key: 'key', request: { id: 'r', startedAt: 1, tabId: 1, windowId: 1 }, context: { tabId: 1, windowId: 1 }, actions: [], overrides: {}, at: 1 };
  new LibraryPanel(perform, vi.fn()).render(current);
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#workspace-list button')).filter(button => button.textContent !== 'Delete');
  expect(buttons).toHaveLength(5); expect(buttons.every(button => button.disabled)).toBe(true);
});
it('keeps legacy workspaces usable without offering an unavailable previous version', () => {
  const current = state(); delete current.library!.workspaces[0]!.previous;
  new LibraryPanel(perform, vi.fn()).render(current);
  expect(document.querySelector('#workspace-list')!.textContent).toContain('Restore in new window');
  expect(document.querySelector('#workspace-list')!.textContent).not.toContain('Recover previous saved version');
  expect(document.querySelector('#workspace-list')!.textContent).not.toContain('Discard previous saved version');
});
