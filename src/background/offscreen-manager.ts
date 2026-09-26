import { OFFSCREEN_PATH } from '../common/constants';
import { send, withTimeout } from '../common/messaging';

let lifecycle: Promise<void> = Promise.resolve();
let ownership = 0;
const startups = new Set<Promise<void>>();
let retirement: Promise<boolean> | undefined;
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = lifecycle.then(operation, operation);
  lifecycle = result.then(() => undefined, () => undefined);
  return result;
}
export async function hasOffscreen(): Promise<boolean> {
  return (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)] })).length > 0;
}
export function ensureOffscreen(): Promise<void> {
  const requestedOwner = ++ownership;
  const result = serial(async () => {
    const retiring = retirement;
    if (retiring) {
      if (await retiring && await hasOffscreen()) await chrome.offscreen.closeDocument();
      if (retirement === retiring) retirement = undefined;
    }
    if (retirement && ownership !== requestedOwner) return;
    const existing = await hasOffscreen();
    if (retirement && ownership !== requestedOwner) return;
    if (existing) {
      // The worker may have restarted after disposing an old document but
      // before closing it. Existence alone does not mean its listeners work.
      const healthy = await withTimeout(send({ target: 'offscreen', type: 'PING' }), 1500, 'Voice engine health check timed out').then(reply => reply.ok, () => false);
      if (retirement && ownership !== requestedOwner) return;
      if (healthy) return;
      await chrome.offscreen.closeDocument();
    }
    if (retirement && ownership !== requestedOwner) return;
    await chrome.offscreen.createDocument({ url: OFFSCREEN_PATH, reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WORKERS], justification: 'Listen during a user-toggled voice session and interpret browser commands with optional bundled local AI.' });
  });
  startups.add(result);
  void result.then(() => startups.delete(result), () => startups.delete(result));
  return result;
}
export function closeOffscreen(): Promise<void> {
  const closingOwner = ++ownership;
  if (startups.size) {
    // Stop must not wait for an unresponsive createDocument. Retire its eventual
    // result only when no newer ensure has claimed the offscreen document.
    // An existing engine may already be speaking while getContexts is delayed.
    // Dispose it without waiting for that query. A newer owner must replace an
    // engine that received disposal rather than adopt its closed listeners.
    const disposing = send({ target: 'offscreen', type: 'DISPOSE_ENGINE' }).then(reply => reply.ok, () => false);
    const retiring = withTimeout(disposing, 1500, 'Engine shutdown timed out').catch(() => true);
    retirement = retiring;
    void Promise.allSettled([...startups, retiring]).then(() => {
      if (ownership === closingOwner) return closeOffscreen();
    }).catch(() => undefined);
    return retiring.then(() => undefined);
  }
  return serial(async () => {
    const retiring = retirement;
    if (!(await hasOffscreen())) { if (retirement === retiring) retirement = undefined; return; }
    try { await withTimeout(send({ target: 'offscreen', type: 'DISPOSE_ENGINE' }), 1500, 'Engine shutdown timed out'); }
    catch { /* Closing the document also releases its audio and GPU resources. */ }
    finally { await chrome.offscreen.closeDocument(); if (retirement === retiring) retirement = undefined; }
  });
}
