import { messageSchema } from '../common/schema';
import { PageController } from './page-controller';
import { FloatingHud } from './hud';
// executeScript can be called repeatedly; install exactly one HUD and listener per document.
if (!document.getElementById('handsfree-chrome-hud-root')) {
  const hud = new FloatingHud();
  const page = new PageController();
  const listener = (raw: unknown, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void): boolean => {
    const parsed = messageSchema.safeParse(raw);
    if (sender.id !== chrome.runtime.id || sender.tab || !parsed.success || parsed.data.target !== 'content') return false;
    const message = parsed.data;
    if (message.type === 'HUD_STATE') { hud.update(message.state); respond({ ok: true }); return false; }
    if (message.type === 'PAGE_PROBE') { respond(page.probe()); return false; }
    if (message.type === 'PAGE_CANCEL') { page.cancel(); respond({ ok: true, text: 'Stopped' }); return false; }
    if (message.type === 'PAGE_DICTATE') { respond(page.dictate(message.text, message.token)); return false; }
    if (message.type === 'PAGE_COMMAND') { void page.execute(message.command, message.token).then(respond, () => respond({ ok: false, text: 'This page could not complete that action.' })); return true; }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('pagehide', event => { if (!event.persisted) { hud.destroy(); page.destroy(); chrome.runtime.onMessage.removeListener(listener); } });
}
