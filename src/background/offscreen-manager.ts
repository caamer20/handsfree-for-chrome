import { OFFSCREEN_PATH } from '../common/constants';
import { send, withTimeout } from '../common/messaging';

let lifecycle: Promise<void> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = lifecycle.then(operation, operation);
  lifecycle = result.then(() => undefined, () => undefined);
  return result;
}
export async function hasOffscreen(): Promise<boolean> {
  return (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)] })).length > 0;
}
export function ensureOffscreen(): Promise<void> {
  return serial(async () => {
    if (await hasOffscreen()) return;
    await chrome.offscreen.createDocument({ url: OFFSCREEN_PATH, reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WORKERS], justification: 'Recognize a requested voice command and interpret it with a bundled local language model.' });
  });
}
export function closeOffscreen(): Promise<void> {
  return serial(async () => {
    if (!(await hasOffscreen())) return;
    try { await withTimeout(send({ target: 'offscreen', type: 'DISPOSE_ENGINE' }), 1500, 'Engine shutdown timed out'); }
    catch { /* Closing the document also releases its audio and GPU resources. */ }
    finally { await chrome.offscreen.closeDocument(); }
  });
}
