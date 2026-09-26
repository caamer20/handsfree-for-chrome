import { messageSchema, type Message, type Settings } from '../common/schema';
import type { Reply } from '../common/types';
import { send, errorText } from '../common/messaging';
import { parseCommand, stripTrigger } from '../common/command-parser';
import { SpeechSession } from './speech';
import { dictationControl, isNegatedCommand } from '../common/language';
import { interruptIntent } from '../common/expanded-parser';
import { IntentParser } from './intent-parser';
import { formatDictation } from '../common/dictation-format';

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
interface Utterance { text: string; alternatives?: string[]; }
interface Capture { id: string; settings: Settings; queue: Utterance[]; pumping: boolean; heartbeat: ReturnType<typeof setInterval>; idle?: ReturnType<typeof setTimeout>; }
let capture: Capture | undefined;
let captureGeneration = 0;
let decisionGeneration = 0;
let decisionListening: { sessionId: string; decisionId: string } | undefined;
const report = (message: Message): void => { void send(message).catch(() => undefined); };
const checked = (reply: Reply): Reply & { ok: true } => { if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : 'The command handler did not respond.'); return reply; };
async function process(requestId: string, settings: Settings, suppliedText?: string, suppliedAlternatives?: string[], spoken = suppliedText === undefined): Promise<boolean> {
  if (busy || disposed) return false;
  busy = true;
  try {
    let alternatives = suppliedAlternatives ?? [];
    const transcript = suppliedText ?? await speech.listen(settings.language, text => report({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId, text, final: false }), {
      pace: settings.voicePace,
      onStart: () => report({ target: 'background', type: 'ENGINE_LISTENING', requestId }),
      onAlternatives: candidates => { alternatives = candidates.flatMap(text => { try { return [stripTrigger(text, settings.triggerPhrase)]; } catch { return []; } }); },
    });
    if (disposed) return false;
    const command = suppliedText === undefined ? stripTrigger(transcript, settings.triggerPhrase) : transcript;
    const acknowledgement = checked(await send({ target: 'background', type: 'VOICE_TRANSCRIPT', requestId, text: command, final: true, ...(spoken ? { spoken: true } : {}), ...(alternatives.length ? { alternatives } : {}) }));
    if (acknowledgement.handled || disposed) return !!(acknowledgement.pendingReview || acknowledgement.needsClarification || acknowledgement.resetCapture);
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
    const result = checked(reply); return !!(result.pendingReview || result.needsClarification || result.resetCapture);
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
      const utterance = session.queue.shift(); if (!utterance) continue;
      const reply = checked(await send({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId: session.id, text: utterance.text, ...(utterance.alternatives?.length ? { alternatives: utterance.alternatives } : {}) }));
      if (disposed || capture !== session) break;
      const pendingReview = reply.pendingReview || reply.needsClarification || reply.resetCapture || (reply.request ? await process(reply.request.id, session.settings, utterance.text, utterance.alternatives, true) : false);
      // Queued and still-buffered speech from before the prompt cannot answer it later.
      if (pendingReview) {
        session.queue.length = 0;
        if (!disposed && capture === session) {
          captureGeneration++; microphone.cancel();
          if (!feedbackActive) listenCapture(session);
        }
      }
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
  const generation = ++captureGeneration;
  const current = (): boolean => !disposed && capture === session && generation === captureGeneration;
  try {
    microphone.startContinuous(settings.language, (text, alternatives) => {
      if (!current() || feedbackActive) return;
      let controlText = text.trim();
      if (dictating) { try { controlText = stripTrigger(text, settings.triggerPhrase); } catch { /* Dictation controls also work without a trigger. */ } }
      if (dictating && !dictationControl(controlText)) {
        const formatted = formatDictation(text, settings.dictationPunctuation);
        // Formatting data must not create a page-side dictation undo control.
        const undo = /^(?:scratch that|undo last dictation)[.!?]*$/i;
        const payload = formatted !== text && undo.test(formatted.trim()) && !undo.test(text.trim()) ? `literal ${formatted}` : formatted;
        report({ target: 'background', type: 'DICTATION_TEXT', sessionId: id, text: payload.slice(0, 2000) }); return;
      }
      let command: string;
      try { command = dictating ? dictationControl(controlText)! : stripTrigger(text, settings.triggerPhrase); } catch { return; } // Ignore speech without the configured trigger.
      if (!command.trim()) return;
      const candidates = alternatives?.flatMap(text => { try { return [stripTrigger(text, settings.triggerPhrase)]; } catch { return []; } });
      const intent = interruptIntent(command);
      if (intent) { session.queue.length = 0; report({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId: id, ...intent, ...(intent.replacement && candidates?.length ? { alternatives: candidates } : {}) }); return; }
      if (session.queue.length >= 3) { status(session, 'Command queue is full. Wait for the current commands to finish.'); return; }
      session.queue.push({ text: command, ...(candidates?.length ? { alternatives: candidates } : {}) }); void pump(session);
    }, text => { if (current() && !session.pumping) status(session, text); }, text => {
      if (!current()) return;
      stopCapture(); report({ target: 'background', type: 'CAPTURE_STATUS', sessionId: id, text, fatal: true });
    }, { pace: settings.voicePace, immediate: text => {
      if (dictating) return false;
      try { const intent = interruptIntent(stripTrigger(text, settings.triggerPhrase)); return !!intent && !intent.replacement; } catch { return false; }
    } });
  } catch (error) { stopCapture(); report({ target: 'background', type: 'CAPTURE_STATUS', sessionId: id, text: errorText(error), fatal: true }); }
}
function stopCapture(): void {
  captureGeneration++;
  if (capture) { clearInterval(capture.heartbeat); clearTimeout(capture.idle); capture.queue.length = 0; }
  capture = undefined; dictating = false; microphone.cancel();
}
function cancelDecisionListening(): void {
  decisionGeneration++;
  if (decisionListening) { decisionListening = undefined; speech.cancel(); busy = false; }
}
async function listenDecision(sessionId: string, decisionId: string, settings: Settings): Promise<void> {
  stopFeedback(); cancelDecisionListening(); microphone.cancel(); busy = true;
  const generation = decisionGeneration; decisionListening = { sessionId, decisionId };
  const current = (): boolean => !disposed && generation === decisionGeneration && decisionListening?.sessionId === sessionId;
  let alternatives: string[] = [];
  try {
    const transcript = await speech.listen(settings.language, () => undefined, {
      pace: settings.voicePace,
      onAlternatives: values => { if (current()) alternatives = values.flatMap(value => { try { return [stripTrigger(value, settings.triggerPhrase)]; } catch { return []; } }); },
      immediate: value => { try { const intent = interruptIntent(stripTrigger(value, settings.triggerPhrase)); return !!intent && !intent.replacement; } catch { return false; } },
    });
    if (!current()) return;
    const text = stripTrigger(transcript, settings.triggerPhrase);
    decisionListening = undefined; busy = false;
    const immediate = interruptIntent(text);
    if (immediate && !immediate.replacement) await send({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId, ...immediate });
    else await send({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text, ...(alternatives.length ? { alternatives } : {}) });
  } catch (error) {
    // Final speech releases the microphone before the background acknowledges
    // it. A transport failure must still end that capture, unless superseded.
    if (disposed || generation !== decisionGeneration) return;
    if (decisionListening?.sessionId === sessionId) { decisionListening = undefined; busy = false; }
    report({ target: 'background', type: 'DECISION_LISTENING_ERROR', sessionId, decisionId, error: errorText(error) });
  }
}
function readback(readbackId: string, segments: string[]): Reply {
  if (disposed || dictating || decisionListening) return { ok: false, error: 'Finish speaking before reading the decision aloud.' };
  const session = capture;
  // Clear all pre-readback speech, including callbacks still held by the recognizer.
  if (session) { session.queue.length = 0; clearTimeout(session.idle); }
  captureGeneration++; microphone.cancel(); stopFeedback(); feedbackActive = true;
  const generation = feedbackGeneration;
  let completed = false;
  const resume = (error?: string): void => {
    if (completed || generation !== feedbackGeneration) return;
    completed = true; stopFeedback();
    if (!disposed && session && capture === session) listenCapture(session);
    if (!disposed) report({ target: 'background', type: 'READBACK_FINISHED', readbackId, ...(error ? { error } : {}) });
  };
  const voice = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices().find(voice => voice.localService && voice.lang.startsWith('en')) : undefined;
  if (!voice || typeof SpeechSynthesisUtterance === 'undefined') { const error = 'No local speech voice is available. Read the decision text in Control.'; resume(error); return { ok: false, error }; }
  const speak = (index: number): void => {
    if (generation !== feedbackGeneration || disposed) return;
    if (index >= segments.length) { resume(); return; }
    const utterance = new SpeechSynthesisUtterance(segments[index]!); utterance.voice = voice; utterance.rate = 1.15;
    let ended = false;
    utterance.onend = () => { if (ended || generation !== feedbackGeneration) return; ended = true; clearTimeout(feedbackTimer); speak(index + 1); };
    utterance.onerror = () => { if (!ended) { ended = true; resume('Local speech playback stopped. Try Read or repeat aloud again.'); } };
    feedbackTimer = setTimeout(() => { if (!ended) { ended = true; resume('Readback timed out before this page finished. Try Read or repeat aloud again.'); } }, 30_000);
    try { speechSynthesis.speak(utterance); } catch { ended = true; resume('Local speech playback could not start. Read the decision text in Control.'); }
  };
  speak(0); return { ok: true };
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
  if (disposed) { respond({ ok: false, error: 'The voice engine has been closed.' }); return false; }
  if (message.type === 'CANCEL_DECISION_AUDIO') {
    cancelDecisionListening(); stopFeedback();
    if (capture && !disposed) { capture.queue.length = 0; clearTimeout(capture.idle); captureGeneration++; microphone.cancel(); listenCapture(capture); }
    respond({ ok: true }); return false;
  }
  if (message.type === 'SPEAK_READBACK') { respond(readback(message.readbackId, message.segments)); return false; }
  if (message.type === 'DICTATION_MODE') {
    if (dictating === message.enabled) { respond({ ok: true }); return false; }
    dictating = message.enabled;
    if (capture) {
      const session = capture; session.queue.length = 0; clearTimeout(session.idle);
      // Buffered speech belongs to the old mode, including unfinished recognition results.
      captureGeneration++; microphone.cancel(); stopFeedback(); listenCapture(session);
      if (capture === session) status(session, dictating ? 'Dictation on. Speak text; say “stop dictation” when finished.' : 'Listening for commands…');
    }
    respond({ ok: true }); return false;
  }
  if (message.type === 'FEEDBACK') { feedback(message.text, message.mode); respond({ ok: true }); return false; }
  if (message.type === 'PING') { respond({ ok: true }); return false; }
  if (message.type === 'DISPOSE_ENGINE') {
    disposed = true; cancelDecisionListening(); stopFeedback(); stopCapture(); speech.cancel();
    void parser.dispose().then(() => respond({ ok: true }), () => respond({ ok: true }));
    return true;
  }
  if (busy || capture) { respond({ ok: false, error: 'The engine is busy. Stop the current session first.' }); return false; }
  respond({ ok: true });
  if (message.type === 'START_DECISION_LISTENING') void listenDecision(message.sessionId, message.decisionId, message.settings);
  if (message.type === 'START_LISTENING') {
    if (message.settings.listeningMode === 'continuous') startCapture(message.requestId, message.settings);
    else void process(message.requestId, message.settings);
  }
  if (message.type === 'PARSE_TEXT') void process(message.requestId, message.settings, message.text);
  return false;
};
chrome.runtime.onMessage.addListener(listener);
window.addEventListener('pagehide', () => { disposed = true; cancelDecisionListening(); stopFeedback(); stopCapture(); speech.cancel(); void parser.dispose(); chrome.runtime.onMessage.removeListener(listener); }, { once: true });
