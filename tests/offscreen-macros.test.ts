import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/common/schema';
import type { Message } from '../src/common/schema';
const { parse, listen } = vi.hoisted(() => ({ parse: vi.fn(async () => ({ actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }], source: 'grammar' })), listen: vi.fn(async () => 'Hey HandsFree, open up my daily morning sites') }));
vi.mock('../src/offscreen/intent-parser', () => ({ IntentParser: class { parse = parse; dispose = vi.fn(); } }));
vi.mock('../src/offscreen/speech', () => ({ SpeechSession: class { listen = listen; cancel = vi.fn(); } }));
type Listener = (message: Message, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void) => boolean;
let listener: Listener;
const sendMessage = vi.fn(async (message: Message) => ({ ok: true, handled: message.type === 'VOICE_TRANSCRIPT' && message.final }));
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('chrome', { runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}`, sendMessage, onMessage: { addListener: (fn: Listener) => { listener = fn; }, removeListener: vi.fn() } } });
  await import('../src/offscreen/offscreen');
});
it('strips the global wake phrase and bypasses AI/grammar when the worker handles a voice macro', async () => {
  listener({ target: 'offscreen', type: 'START_LISTENING', requestId: crypto.randomUUID(), settings: { ...defaultSettings, listeningMode: 'single', triggerPhrase: 'Hey HandsFree' } }, { id: 'test' }, vi.fn());
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'VOICE_TRANSCRIPT', text: 'open up my daily morning sites', final: true })));
  expect(parse).not.toHaveBeenCalled();
  expect(sendMessage.mock.calls.some(([message]) => message.type === 'EXECUTE_ACTIONS')).toBe(false);
});
