import { messageSchema } from '../common/schema';
import { FloatingHud } from './hud';
// executeScript can be called repeatedly; install exactly one HUD and listener per document.
if (!document.getElementById('handsfree-chrome-hud-root')) {
  const hud = new FloatingHud();
  const listener = (raw: unknown, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void): boolean => {
    const parsed = messageSchema.safeParse(raw);
    if (sender.id !== chrome.runtime.id || sender.tab || !parsed.success || parsed.data.type !== 'HUD_STATE') return false;
    hud.update(parsed.data.state); respond({ ok: true }); return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('pagehide', event => { if (!event.persisted) { hud.destroy(); chrome.runtime.onMessage.removeListener(listener); } });
}
