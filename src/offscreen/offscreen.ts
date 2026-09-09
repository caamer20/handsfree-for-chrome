import { messageSchema, type Message, type Settings } from '../common/schema';
import type { Reply } from '../common/types';
import { send, errorText } from '../common/messaging';
import { parseCommand, stripTrigger } from '../common/command-parser';
import { SpeechSession } from './speech';
import { dictationControl, isNegatedCommand } from '../common/language';
import { interruptIntent } from '../common/expanded-parser';
import { IntentParser } from './intent-parser';

const speech = new SpeechSession();
const microphone = new SpeechSession();
const parser = new IntentParser();
let busy = false;
let disposed = false;
let dictating = false;
let feedbackActive = false;
let feedbackGeneration = 0;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
let audioContext: AudioContext | undefined;
interface Capture { id: string; settings: Settings; queue: string[]; pumping: boolean; heartbeat: ReturnType<typeof setInterval>; idle?: ReturnType<typeof setTimeout>; }
let capture: Capture | undefined;
const report = (message: Message): void => { void send(message).catch(() => undefined); };
const checked = (reply: Reply): Reply & { ok: true } => { if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : 'The command handler did not respond.'); return reply; };
async function process(requestId: string, settings: Settings, suppliedText?: string): Promise<boolean> {
  if (busy || disposed) return false;
  busy = true;
  try {
    const transcript = suppliedText ?? await speech.listen(settings.language, text => report({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId, text, final: false }));
    if (disposed) return false;
    const command = suppliedText === undefined ? stripTrigger(transcript, settings.triggerPhrase) : transcript;
    const acknowledgement = checked(await send({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId, text: command, final: true }));
    if (acknowledgement.handled || disposed) return !!(acknowledgement.pendingReview || acknowledgement.needsClarification);
    if (isNegatedCommand(command)) return false;
    const known = parseCommand(command);
    let reply: Reply;
    if (!known && settings.aiEnabled && settings.aiProvider !== 'local') {
      report({ target: 'background', type: 'ENGINE_STATUS', requestId, text: 'Interpreting with your AI provider…' });
      reply = await send({ target: 'background', type: 'PARSE_CLOUD', requestId, text: command });
    } else {
      const result = known ? { actions: known, source: 'grammar' as const } : await parser.parse(command, settings.aiEnabled, text => report({ target: 'background', type: 'ENGINE_STATUS', requestId, text }));
      if (disposed) return false;
      reply = await send({ target: 'background', type: 'EXECUTE_ACTIONS', requestId, ...result, transcript: command });
    }
    const result = checked(reply); return !!(result.pendingReview || result.needsClarification);
  } catch (error) {
    if (!disposed) await send({ target: 'background', type: 'ENGINE_ERROR', requestId, error: errorText(error) }).catch(() => undefined);
    return false;
  } finally { speech.cancel(); busy = false; }
}
function status(session: Capture, text: string): void { report({ target: 'background', type: 'CAPTURE_STATUS', sessionId: session.id, text, fatal: false }); }
async function pump(session: Capture): Promise<void> {
  if (session.pumping) return;
  session.pumping = true;
  clearTimeout(session.idle);
  try {
    while (!disposed && capture === session && session.queue.length) {
      const text = session.queue.shift(); if (!text) continue;
      const reply = checked(await send({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId: session.id, text }));
      if (disposed || capture !== session) break;
      const pendingReview = reply.pendingReview || reply.needsClarification || (reply.request ? await process(reply.request.id, session.settings, text) : false);
      // Speech heard before the review appeared cannot approve that review later.
      if (pendingReview) session.queue.length = 0;
    }
  } catch (error) { status(session, errorText(error)); }
  finally {
    session.pumping = false;
    if (!disposed && capture === session) session.idle = setTimeout(() => status(session, dictating ? 'Dictation on. Say “stop dictation” to return to commands.' : 'Listening… press the shortcut again to stop.'), 1800);
  }
}
function startCapture(id: string, settings: Settings): void {
  stopCapture();
  const session: Capture = { id, settings, queue: [], pumping: false, heartbeat: setInterval(() => report({ target: 'background', type: 'CAPTURE_HEARTBEAT', sessionId: id }), 20_000) };
  capture = session; listenCapture(session);
}
function listenCapture(session: Capture): void {
  const { id, settings } = session;
  try {
    microphone.startContinuous(settings.language, text => {
      if (disposed || capture !== session || feedbackActive) return;
      let controlText = text.trim();
      if (dictating) { try { controlText = stripTrigger(text, settings.triggerPhrase); } catch { /* Dictation controls also work without a trigger. */ } }
      if (dictating && !dictationControl(controlText)) {
        report({ target: 'background', type: 'DICTATION_TEXT', sessionId: id, text: text.slice(0, 2000) }); return;
      }
      let command: string;
      try { command = dictating ? dictationControl(controlText)! : stripTrigger(text, settings.triggerPhrase); } catch { return; } // Ignore speech without the configured trigger.
      if (!command.trim()) return;
      const intent = interruptIntent(command);
      if (intent) { session.queue.length = 0; report({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId: id, ...intent }); return; }
      if (session.queue.length >= 3) { status(session, 'Command queue is full. Wait for the current commands to finish.'); return; }
      session.queue.push(command); void pump(session);
    }, text => { if (!session.pumping) status(session, text); }, text => {
      stopCapture(); report({ target: 'background', type: 'CAPTURE_STATUS', sessionId: id, text, fatal: true });
    });
  } catch (error) { stopCapture(); report({ target: 'background', type: 'CAPTURE_STATUS', sessionId: id, text: errorText(error), fatal: true }); }
}
function stopCapture(): void {
  if (capture) { clearInterval(capture.heartbeat); clearTimeout(capture.idle); capture.queue.length = 0; }
  capture = undefined; dictating = false; microphone.cancel();
}
function stopFeedback(): void {
  feedbackGeneration++;
  clearTimeout(feedbackTimer); feedbackTimer = undefined;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  if (audioContext) { void audioContext.close().catch(() => undefined); audioContext = undefined; }
  feedbackActive = false;
}
function feedback(text: string, mode: 'sound' | 'speech'): void {
  if (disposed || dictating) return;
  stopFeedback(); feedbackActive = true;
  const generation = feedbackGeneration;
  const session = capture; microphone.cancel();
  const resume = (): void => { if (generation !== feedbackGeneration) return; stopFeedback(); if (!disposed && session && capture === session) listenCapture(session); };
  if (mode === 'speech' && typeof speechSynthesis !== 'undefined') {
    const voice = speechSynthesis.getVoices().find(voice => voice.localService && voice.lang.startsWith('en'));
    if (voice) {
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 220)); utterance.voice = voice; utterance.rate = 1.15;
      utterance.onend = resume; utterance.onerror = resume;
      feedbackTimer = setTimeout(resume, 15_000); speechSynthesis.speak(utterance); return;
    }
  }
  try {
    audioContext = new AudioContext(); const oscillator = audioContext.createOscillator(); const gain = audioContext.createGain();
    oscillator.frequency.value = 660; gain.gain.setValueAtTime(0.035, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.12);
    oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + 0.14);
  } catch { /* Feedback availability never blocks a command. */ }
  feedbackTimer = setTimeout(resume, 250);
}
const listener = (raw: unknown, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void): boolean => {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success || parsed.data.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== chrome.runtime.getURL('background.js'))) return false;
  const message = parsed.data;
  if (message.type === 'DICTATION_MODE') { if (dictating === message.enabled) { respond({ ok: true }); return false; } dictating = message.enabled; if (capture) { capture.queue.length = 0; status(capture, dictating ? 'Dictation on. Speak text; say “stop dictation” when finished.' : 'Listening for commands…'); } respond({ ok: true }); return false; }
  if (message.type === 'FEEDBACK') { feedback(message.text, message.mode); respond({ ok: true }); return false; }
  if (message.type === 'PING') { respond({ ok: true }); return false; }
  if (message.type === 'DISPOSE_ENGINE') {
    disposed = true; stopFeedback(); stopCapture(); speech.cancel();
    void parser.dispose().then(() => respond({ ok: true }), () => respond({ ok: true }));
    return true;
  }
  if (busy || capture) { respond({ ok: false, error: 'The engine is busy. Stop the current session first.' }); return false; }
  respond({ ok: true });
  if (message.type === 'START_LISTENING') {
    if (message.settings.listeningMode === 'continuous') startCapture(message.requestId, message.settings);
    else void process(message.requestId, message.settings);
  }
  if (message.type === 'PARSE_TEXT') void process(message.requestId, message.settings, message.text);
  return false;
};
chrome.runtime.onMessage.addListener(listener);
window.addEventListener('pagehide', () => { disposed = true; stopFeedback(); stopCapture(); speech.cancel(); void parser.dispose(); chrome.runtime.onMessage.removeListener(listener); }, { once: true });
