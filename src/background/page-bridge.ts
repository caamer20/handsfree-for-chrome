import type { Message } from '../common/schema';
import type { PageParams } from '../common/expanded-schema';
import { pageResultSchema, type PageResult } from '../common/page';
import type { PageRef } from '../common/conversation';
import { checkCancelled } from '../common/conversation';
import { withTimeout } from '../common/messaging';

async function message(ref: PageRef, payload: Message): Promise<PageResult> {
  const raw: unknown = await withTimeout(chrome.tabs.sendMessage(ref.tabId, payload, { frameId: ref.frameId, ...(ref.documentId ? { documentId: ref.documentId } : {}) }), 8000, 'The page did not respond. Try reloading it.');
  const result = pageResultSchema.safeParse(raw);
  if (!result.success) throw new Error('The page returned an invalid response. Reload it, then try again.');
  return result.data;
}
async function frame(tabId: number, preferred?: PageRef | null): Promise<PageRef> {
  if (preferred?.tabId === tabId) {
    try { await message(preferred, { target: 'content', type: 'PAGE_PROBE' }); return preferred; } catch { throw new Error('The page changed. Focus the field or show links again.'); }
  }
  let frames: chrome.scripting.InjectionResult[];
  try { frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }); }
  catch {
    try { frames = await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); }
    catch {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      let host = 'this site'; try { host = new URL(tab?.url ?? '').hostname; } catch { /* Keep plain fallback. */ }
      throw new Error(`Page controls need access to ${host}. Open HandsFree Settings and allow this site. Chrome internal pages cannot use page controls.`);
    }
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
  return message(ref, { target: 'content', type: 'PAGE_DICTATE', text, token: ref.token });
}
export async function cancelPage(ref: PageRef | null): Promise<void> { if (ref) await message(ref, { target: 'content', type: 'PAGE_CANCEL' }).catch(() => undefined); }
