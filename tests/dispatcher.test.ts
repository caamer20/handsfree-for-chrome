import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchActions } from '../src/background/dispatcher';
const tabs = { get: vi.fn(), query: vi.fn(), update: vi.fn(), create: vi.fn(), remove: vi.fn() };
const windows = { update: vi.fn() };
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('chrome', { tabs, windows }); });
it('finds tabs across all windows and focuses both window and tab', async () => {
  tabs.query.mockResolvedValue([{ id: 8, windowId: 4, title: 'Design notes', url: 'https://example.com' }]);
  await dispatchActions([{ action: 'find_tab', params: { query: 'design' } }], { tabId: 1, windowId: 2 });
  expect(tabs.query).toHaveBeenCalledWith({});
  expect(windows.update).toHaveBeenCalledWith(4, { focused: true });
  expect(tabs.update).toHaveBeenCalledWith(8, { active: true });
});
it('validates the whole plan before changing Chrome', async () => {
  await expect(dispatchActions([{ action: 'create_tab', params: { url: 'https://example.com' } }, { action: 'zoom', params: { mode: 'set' } }], { tabId: 1, windowId: 2 })).rejects.toThrow();
  expect(tabs.create).not.toHaveBeenCalled();
});
it('anchors a command to the original tab and closes only tabs on its right', async () => {
  tabs.get.mockResolvedValue({ id: 2, index: 1, windowId: 9 });
  tabs.query.mockResolvedValueOnce([{ id: 1, index: 0 }, { id: 2, index: 1 }, { id: 3, index: 2 }]).mockResolvedValueOnce([{ id: 2, windowId: 9 }]);
  await dispatchActions([{ action: 'close_tab', params: { target: 'right' } }], { tabId: 2, windowId: 9 });
  expect(tabs.remove).toHaveBeenCalledWith([3]);
});
