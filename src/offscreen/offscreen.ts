import { messageSchema, type Message, type Settings } from '../common/schema';
import { send, errorText } from '../common/messaging';
import { stripTrigger } from '../common/command-parser';
import { SpeechSession } from './speech';
import { IntentParser } from './intent-parser';

const speech = new SpeechSession();
const parser = new IntentParser();
let busy = false;
let disposed = false;
const report = (message: Message): void => { void send(message).catch(() => undefined); };
async function process(requestId: string, settings: Settings, suppliedText?: string): Promise<void> {
  if (busy || disposed) { report({ target: 'background', type: 'ENGINE_ERROR', requestId, error: 'The engine is busy. Try again.' }); return; }
  busy = true;
  try {
    const transcript = suppliedText ?? await speech.listen(settings.language, text => report({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId, text, final: false }));
    if (disposed) return;
    const command = suppliedText === undefined ? stripTrigger(transcript, settings.triggerPhrase) : transcript;
    report({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId, text: command, final: true });
    const result = await parser.parse(command, settings.aiEnabled, text => report({ target: 'background', type: 'ENGINE_STATUS', requestId, text }));
    if (!disposed) await send({ target: 'background', type: 'EXECUTE_ACTIONS', requestId, ...result, transcript: command });
  } catch (error) {
    if (!disposed) report({ target: 'background', type: 'ENGINE_ERROR', requestId, error: errorText(error) });
  } finally { speech.cancel(); busy = false; }
}
const listener = (raw: unknown, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void): boolean => {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success || parsed.data.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== chrome.runtime.getURL('background.js'))) return false;
  const message = parsed.data;
  if (message.type === 'PING') { respond({ ok: true }); return false; }
  if (message.type === 'DISPOSE_ENGINE') {
    disposed = true; speech.cancel();
    void parser.dispose().then(() => respond({ ok: true }), () => respond({ ok: true }));
    return true;
  }
  respond({ ok: true });
  if (message.type === 'START_LISTENING') void process(message.requestId, message.settings);
  if (message.type === 'PARSE_TEXT') void process(message.requestId, message.settings, message.text);
  return false;
};
chrome.runtime.onMessage.addListener(listener);
window.addEventListener('pagehide', () => { disposed = true; speech.cancel(); void parser.dispose(); chrome.runtime.onMessage.removeListener(listener); }, { once: true });
