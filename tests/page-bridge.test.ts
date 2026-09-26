import { beforeEach, expect, it, vi } from 'vitest';
import { cancelPage, dictate, pageCommand } from '../src/background/page-bridge';

const inject = vi.fn(); const send = vi.fn(); const contains = vi.fn();
const ref = { tabId: 1, frameId: 3, documentId: 'chosen-frame', token: 'page-token', at: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  inject.mockResolvedValue([{ frameId: 3, documentId: 'chosen-frame', result: true }]);
  send.mockResolvedValue({ ok: true, text: 'Done' }); contains.mockResolvedValue(false);
  vi.stubGlobal('chrome', { scripting: { executeScript: inject }, tabs: { sendMessage: send, get: vi.fn(async () => ({ id: 1, url: 'https://example.com/' })) }, permissions: { contains } });
});

it('rechecks the exact numbered target document before using a retained controller', async () => {
  await pageCommand(1, { operation: 'activate', index: 1 }, ref);
  expect(inject).toHaveBeenCalledWith({ target: { tabId: 1, documentIds: ['chosen-frame'] }, func: expect.any(Function) });
  expect(send).toHaveBeenLastCalledWith(1, { target: 'content', type: 'PAGE_COMMAND', command: { operation: 'activate', index: 1 }, token: 'page-token' }, { frameId: 3, documentId: 'chosen-frame' });
});

it('blocks numbered page actions after host access is removed even if their controller still responds', async () => {
  inject.mockRejectedValue(new Error('Cannot access contents of URL'));
  await expect(pageCommand(1, { operation: 'activate', index: 1 }, ref)).rejects.toMatchObject({ kind: 'site-access', beforeEffects: true });
  expect(send).not.toHaveBeenCalled();
});

it('rechecks access for every dictated chunk and stops sending text after revocation', async () => {
  await dictate(ref, 'allowed'); expect(send).toHaveBeenLastCalledWith(1, { target: 'content', type: 'PAGE_DICTATE', text: 'allowed', token: 'page-token' }, { frameId: 3, documentId: 'chosen-frame' });
  send.mockClear(); inject.mockRejectedValue(new Error('Cannot access contents of URL'));
  await expect(dictate(ref, 'must not enter')).rejects.toMatchObject({ kind: 'site-access' }); expect(send).not.toHaveBeenCalled();
});

it('preserves temporary activeTab grants without requiring an optional stored host grant', async () => {
  contains.mockResolvedValue(false);
  await pageCommand(1, { operation: 'next_heading' }, ref); await dictate(ref, 'text');
  expect(contains).not.toHaveBeenCalled(); expect(inject).toHaveBeenCalledTimes(2);
});

it('refuses changed or missing frames and a revoked embedded frame despite top-level access', async () => {
  inject.mockResolvedValue([{ frameId: 3, documentId: 'new-document' }]);
  await expect(dictate(ref, 'not here')).rejects.toMatchObject({ kind: 'page-changed' }); expect(send).not.toHaveBeenCalled();
  inject.mockRejectedValue(new Error('Frame access denied')); contains.mockResolvedValue(true);
  await expect(pageCommand(1, { operation: 'activate', index: 1 }, ref)).rejects.toMatchObject({ kind: 'page-changed' }); expect(send).not.toHaveBeenCalled();
});

it('still allows cleanup of a retained controller after access removal', async () => {
  inject.mockRejectedValue(new Error('No permission')); await cancelPage(ref);
  expect(inject).not.toHaveBeenCalled(); expect(send).toHaveBeenCalledWith(1, { target: 'content', type: 'PAGE_CANCEL' }, { frameId: 3, documentId: 'chosen-frame' });
});
