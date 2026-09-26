import type { Message } from '../common/schema';
import type { PageParams } from '../common/expanded-schema';
import { pageResultSchema, type PageResult } from '../common/page';
import type { PageRef } from '../common/conversation';
import { checkCancelled } from '../common/conversation';
import { withTimeout } from '../common/messaging';
import { CommandFailure } from '../common/recovery';

async function message(ref: PageRef, payload: Message): Promise<PageResult> {
  const raw: unknown = await withTimeout(chrome.tabs.sendMessage(ref.tabId, payload, { frameId: ref.frameId, ...(ref.documentId ? { documentId: ref.documentId } : {}) }), 8000, 'The page did not respond. Try reloading it.');
  const result = pageResultSchema.safeParse(raw);
  if (!result.success) throw new Error('The page returned an invalid response. Reload it, then try again.');
  return result.data;
}
async function inaccessible(tabId: number): Promise<never> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  let url: URL | undefined; try { url = new URL(tab?.url ?? ''); } catch { /* No current site. */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.hostname === 'chromewebstore.google.com' || (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'))) throw new CommandFailure('restricted-page', 'Chrome protects this page from extensions. Switch to a regular website to use page controls.');
  const origin = `${url.origin}/*`;
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (granted) throw new CommandFailure('page-changed', 'Chrome could not reach this page frame even though site access is allowed. Reload the page, then try a fresh command.');
  throw new CommandFailure('site-access', `Allow access to ${url.hostname} to continue this page command. The blocked step has not run.`, true, origin, url.href);
}
/** Existing content scripts still receive messages after host access is revoked.
 * Recheck through Chrome's injection gate, which also recognizes activeTab grants.
 */
async function allowed(ref: PageRef): Promise<PageRef> {
  let frames: chrome.scripting.InjectionResult[];
  try {
    frames = await withTimeout(chrome.scripting.executeScript({ target: { tabId: ref.tabId, ...(ref.documentId ? { documentIds: [ref.documentId] } : { frameIds: [ref.frameId] }) }, func: () => true }), 8000, 'The page access check did not respond.');
  } catch { return inaccessible(ref.tabId); }
  const current = frames.find(frame => frame.frameId === ref.frameId && (!ref.documentId || frame.documentId === ref.documentId));
  if (!current) throw new CommandFailure('page-changed', 'The page changed. Focus the field or show the page targets again.');
  return { ...ref, ...(current.documentId ? { documentId: current.documentId } : {}) };
}
async function frame(tabId: number, preferred?: PageRef | null): Promise<PageRef> {
  if (preferred?.tabId === tabId) {
    const current = await allowed(preferred);
    try { await message(current, { target: 'content', type: 'PAGE_PROBE' }); return current; } catch { throw new CommandFailure('page-changed', 'The page changed. Focus the field or show links again.'); }
  }
  let frames: chrome.scripting.InjectionResult[];
  try { frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }); }
  catch {
    try { frames = await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); }
    catch { return inaccessible(tabId); }
  }
  const refs = frames.map(item => ({ tabId, frameId: item.frameId, documentId: item.documentId, at: Date.now() }));
  const probes = await Promise.allSettled(refs.map(async ref => ({ ref, probe: await message(ref, { target: 'content', type: 'PAGE_PROBE' }) })));
  const ready = probes.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const selected = ready.find(item => item.probe.focused && item.probe.editable) ?? ready.find(item => item.probe.focused) ?? ready.find(item => item.ref.frameId === 0) ?? ready[0];
  if (!selected) throw new Error('No accessible page frame was found. Open the embedded page directly or allow its site in Settings.');
  return selected.ref;
}
export async function pageCommand(tabId: number, command: PageParams, preferred?: PageRef | null, signal?: AbortSignal): Promise<{ result: PageResult; ref: PageRef }> {
  checkCancelled(signal); const ref = await frame(tabId, preferred); checkCancelled(signal);
  const result = await message(ref, { target: 'content', type: 'PAGE_COMMAND', command, ...(ref.token ? { token: ref.token } : {}) });
  checkCancelled(signal);
  if (!result.ok) throw new Error(result.text);
  return { result, ref: { ...ref, ...(result.token ? { token: result.token } : {}), at: Date.now() } };
}
export async function dictate(ref: PageRef, text: string): Promise<PageResult> {
  if (!ref.token) throw new Error('Start dictation in a text field first.');
  const current = await allowed(ref);
  return message(current, { target: 'content', type: 'PAGE_DICTATE', text, token: ref.token });
}
export async function cancelPage(ref: PageRef | null): Promise<void> { if (ref) await message(ref, { target: 'content', type: 'PAGE_CANCEL' }).catch(() => undefined); }
