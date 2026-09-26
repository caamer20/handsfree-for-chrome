import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings, type Message } from '../src/common/schema';
import type { Reply } from '../src/common/types';
const mocks = vi.hoisted(() => ({ start: vi.fn(), cancel: vi.fn(), parse: vi.fn(), dispose: vi.fn(async () => undefined) }));
vi.mock('../src/offscreen/intent-parser', () => ({ IntentParser: class { parse = mocks.parse; dispose = mocks.dispose; } }));
vi.mock('../src/offscreen/speech', () => ({ SpeechSession: class { startContinuous = mocks.start; cancel = mocks.cancel; } }));
type Listener = (message: Message, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void) => boolean;
let listener: Listener;
const sessionId = '776d62da-a7ab-4b55-89a8-acfb37320bf2';
const sendMessage = vi.fn<(message: Message) => Promise<Reply>>();
const emit = (text: string, alternatives?: string[]): void => { const fn = mocks.start.mock.calls.at(-1)?.[1] as (text: string, alternatives?: string[]) => void; fn(text, alternatives); };
async function settle(): Promise<void> { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function start(settings = defaultSettings): void { listener({ target: 'offscreen', type: 'START_LISTENING', requestId: sessionId, settings }, { id: 'test' }, vi.fn()); }
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); vi.clearAllMocks();
  sendMessage.mockImplementation(async message => message.type === 'BEGIN_VOICE_COMMAND' ? { ok: true, request: { id: crypto.randomUUID(), tabId: 1, windowId: 1, startedAt: Date.now() } } : { ok: true });
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('chrome', { runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}`, sendMessage, onMessage: { addListener: (fn: Listener) => { listener = fn; }, removeListener: vi.fn() } } });
  await import('../src/offscreen/offscreen');
});
afterEach(async () => {
  listener({ target: 'offscreen', type: 'DISPOSE_ENGINE' }, { id: 'test' }, vi.fn());
  await settle(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.unstubAllGlobals();
});
it('runs successive grammar commands, keeps capture alive, and ignores speech missing the trigger', async () => {
  start({ ...defaultSettings, triggerPhrase: 'Hey HandsFree' });
  emit('just some conversation'); await settle(); expect(sendMessage).not.toHaveBeenCalled();
  emit('Hey HandsFree open a new tab'); await settle();
  emit('Hey HandsFree zoom in'); await settle();
  const actions = sendMessage.mock.calls.map(([message]) => message).filter(message => message.type === 'EXECUTE_ACTIONS');
  expect(actions).toHaveLength(2); expect(actions[0]).toMatchObject({ actions: [{ action: 'create_tab' }] }); expect(actions[1]).toMatchObject({ actions: [{ action: 'zoom' }] });
  expect(mocks.start).toHaveBeenCalledOnce(); expect(mocks.parse).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(sendMessage).toHaveBeenCalledWith({ target: 'background', type: 'CAPTURE_HEARTBEAT', sessionId });
});
it('routes flexible commands to the cloud, then executes queued grammar commands in order', async () => {
  let resolveCloud: ((reply: Reply) => void) | undefined;
  sendMessage.mockImplementation(async message => {
    if (message.type === 'BEGIN_VOICE_COMMAND') return { ok: true, request: { id: crypto.randomUUID(), tabId: 1, windowId: 1, startedAt: Date.now() } };
    if (message.type === 'PARSE_CLOUD') return new Promise<Reply>(resolve => { resolveCloud = resolve; });
    return { ok: true };
  });
  start({ ...defaultSettings, aiEnabled: true, aiProvider: 'openai', aiModel: 'fixture' });
  emit('make some space for another website'); await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'PARSE_CLOUD', text: 'make some space for another website' }));
  emit('zoom in'); emit('open a new tab'); await settle();
  expect(sendMessage.mock.calls.filter(([m]) => m.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(1);
  resolveCloud?.({ ok: true }); await settle();
  expect(sendMessage.mock.calls.filter(([m]) => m.type === 'BEGIN_VOICE_COMMAND').map(([m]) => 'text' in m ? m.text : '')).toEqual(['make some space for another website', 'zoom in', 'open a new tab']);
  expect(mocks.parse).not.toHaveBeenCalled();
});
it('drops pre-recorded confirmation when a command begins waiting for review', async () => {
  let finish: ((reply: Reply) => void) | undefined;
  sendMessage.mockImplementation(async message => {
    if (message.type === 'BEGIN_VOICE_COMMAND') return { ok: true, request: { id: crypto.randomUUID(), tabId: 1, windowId: 1, startedAt: Date.now() } };
    if (message.type === 'EXECUTE_ACTIONS') return new Promise<Reply>(resolve => { finish = resolve; });
    return { ok: true };
  });
  start(); emit('close tabs to the right'); await settle();
  emit('confirm command'); emit('open a new tab');
  finish?.({ ok: true, pendingReview: true }); await settle();
  expect(sendMessage.mock.calls.filter(([m]) => m.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(1);
});
it('stopping clears pending speech and prevents queued commands after slow inference', async () => {
  let finish: ((reply: Reply) => void) | undefined;
  sendMessage.mockImplementation(async message => {
    if (message.type === 'BEGIN_VOICE_COMMAND') return { ok: true, request: { id: crypto.randomUUID(), tabId: 1, windowId: 1, startedAt: Date.now() } };
    if (message.type === 'EXECUTE_ACTIONS') return new Promise<Reply>(resolve => { finish = resolve; });
    return { ok: true };
  });
  start(); emit('open a new tab'); await settle(); emit('zoom in');
  listener({ target: 'offscreen', type: 'DISPOSE_ENGINE' }, { id: 'test' }, vi.fn());
  finish?.({ ok: true }); await settle();
  expect(sendMessage.mock.calls.filter(([m]) => m.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(1);
});
it('sends a voice interruption immediately while inference is pending and drops queued speech', async () => {
  let finish: ((reply: Reply) => void) | undefined;
  sendMessage.mockImplementation(async message => {
    if (message.type === 'BEGIN_VOICE_COMMAND') return { ok: true, request: { id: crypto.randomUUID(), tabId: 1, windowId: 1, startedAt: Date.now() } };
    if (message.type === 'PARSE_CLOUD') return new Promise(resolve => { finish = resolve; });
    return { ok: true };
  });
  start({ ...defaultSettings, aiEnabled: true, aiProvider: 'openai', aiModel: 'fixture' });
  emit('make some room for another website'); await settle(); emit('open Gmail'); emit('stop'); await settle();
  expect(sendMessage).toHaveBeenCalledWith({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId, stopListening: false });
  finish?.({ ok: true, handled: true }); await settle();
  expect(sendMessage.mock.calls.filter(([m]) => m.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(1);
});
it('dictates literal phrases without a trigger and reserves explicit dictation exit commands', async () => {
  start({ ...defaultSettings, triggerPhrase: 'Hey HandsFree' });
  listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: true }, { id: 'test' }, vi.fn());
  emit('close all tabs'); emit('Actually pin it instead'); await settle();
  expect(sendMessage.mock.calls.filter(([m]) => m.type === 'DICTATION_TEXT').map(([m]) => 'text' in m ? m.text : '')).toEqual(['close all tabs', 'Actually pin it instead']);
  expect(sendMessage.mock.calls.filter(([m]) => m.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(0);
  emit('Hey HandsFree stop dictation'); await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'BEGIN_VOICE_COMMAND', text: 'stop dictation' }));
});
it('drops speech queued before a clarification is displayed', async () => {
  let finish: ((reply: Reply) => void) | undefined;
  sendMessage.mockImplementation(async message => {
    if (message.type === 'BEGIN_VOICE_COMMAND') return { ok: true, request: { id: crypto.randomUUID(), tabId: 1, windowId: 1, startedAt: Date.now() } };
    if (message.type === 'EXECUTE_ACTIONS') return new Promise(resolve => { finish = resolve; });
    return { ok: true };
  });
  start(); emit('mute Gmail'); await settle(); emit('the second one');
  finish?.({ ok: true, needsClarification: true }); await settle();
  expect(sendMessage.mock.calls.filter(([m]) => m.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(1);
});

it('recognizes new dictation exit wording while keeping ordinary stop as literal text', async () => {
  start(); listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: true }, { id: 'test' }, vi.fn());
  emit('stop'); emit('back to commands'); await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'DICTATION_TEXT', text: 'stop' }));
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'BEGIN_VOICE_COMMAND', text: 'stop dictation' }));
});

it.each([{ pendingReview: true }, { needsClarification: true }, { resetCapture: true }])('forwards decision alternatives and drops queued answers after a conflict: %s', async outcome => {
  let finish: ((reply: Reply) => void) | undefined;
  sendMessage.mockImplementation(async message => message.type === 'BEGIN_VOICE_COMMAND' ? new Promise(resolve => { finish = resolve; }) : { ok: true });
  start({ ...defaultSettings, triggerPhrase: 'Hey HandsFree' });
  const beforePrompt = mocks.start.mock.calls.at(-1)!;
  emit('Hey HandsFree confirm command', ['Hey HandsFree cancel command', 'unrelated background speech']); await settle();
  expect(sendMessage).toHaveBeenCalledWith({ target: 'background', type: 'BEGIN_VOICE_COMMAND', sessionId, text: 'confirm command', alternatives: ['cancel command'] });
  emit('Hey HandsFree confirm command');
  finish?.({ ok: true, handled: true, ...outcome }); await settle();
  expect(mocks.start).toHaveBeenCalledTimes(2);
  beforePrompt[1]('Hey HandsFree confirm command'); beforePrompt[2]('earlier unfinished answer'); beforePrompt[3]('old recognition error'); await settle();
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(1);
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'VOICE_TRANSCRIPT')).toHaveLength(0);
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'CAPTURE_STATUS' && message.fatal)).toHaveLength(0);
});

it('keeps primary cancellation immediate even when an alternative sounds like approval', async () => {
  start(); emit('cancel command', ['confirm command']); await settle();
  expect(sendMessage).toHaveBeenCalledWith({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId, stopListening: false });
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(0);
});
it('forwards replacement alternatives through the immediate interruption route', async () => {
  start({ ...defaultSettings, triggerPhrase: 'Hey HandsFree' });
  emit('Hey HandsFree actually pin it instead', ['Hey HandsFree actually close it instead', 'background conversation']); await settle();
  expect(sendMessage).toHaveBeenCalledWith({ target: 'background', type: 'INTERRUPT_COMMAND', sessionId, stopListening: false, replacement: 'pin it', alternatives: ['actually close it instead'] });
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(0);
});

it('discards old recognition callbacks in both directions when dictation mode changes', async () => {
  start();
  const commandCapture = mocks.start.mock.calls.at(-1)!;
  listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: true }, { id: 'test' }, vi.fn());
  expect(mocks.start).toHaveBeenCalledTimes(2);
  commandCapture[1]('open a new tab'); commandCapture[2]('old interim'); commandCapture[3]('old error'); await settle();
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'DICTATION_TEXT' || message.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(0);
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'CAPTURE_STATUS' && message.fatal)).toHaveLength(0);
  emit('new dictated words'); await settle();
  expect(sendMessage).toHaveBeenCalledWith({ target: 'background', type: 'DICTATION_TEXT', sessionId, text: 'new dictated words' });
  const dictationCapture = mocks.start.mock.calls.at(-1)!;
  listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: false }, { id: 'test' }, vi.fn());
  expect(mocks.start).toHaveBeenCalledTimes(3);
  dictationCapture[1]('close this tab'); dictationCapture[2]('old dictated interim'); dictationCapture[3]('old dictation error'); await settle();
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(0);
  emit('open a new tab'); await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXECUTE_ACTIONS', actions: [{ action: 'create_tab', params: { url: 'chrome://newtab/' } }] }));
  listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: false }, { id: 'test' }, vi.fn());
  expect(mocks.start).toHaveBeenCalledTimes(3);
});

it('clears feedback before restarting recognition for dictation', async () => {
  const speak = vi.fn(); const cancel = vi.fn();
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ localService: true, lang: 'en-US' }], speak, cancel });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  start();
  listener({ target: 'offscreen', type: 'FEEDBACK', mode: 'speech', text: 'Dictation on' }, { id: 'test' }, vi.fn());
  expect(speak).toHaveBeenCalledOnce();
  const spoken = speak.mock.calls[0]![0] as { onend: () => void };
  listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: true }, { id: 'test' }, vi.fn());
  expect(cancel).toHaveBeenCalledTimes(2); expect(mocks.start).toHaveBeenCalledTimes(2);
  spoken.onend(); await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.start).toHaveBeenCalledTimes(2);
  emit('writing starts now'); await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'DICTATION_TEXT', text: 'writing starts now' }));
});

it('keeps spoken punctuation literal by default during dictation', async () => {
  start(); listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: true }, { id: 'test' }, vi.fn());
  emit('hello comma world period'); await settle();
  expect(sendMessage).toHaveBeenCalledWith({ target: 'background', type: 'DICTATION_TEXT', sessionId, text: 'hello comma world period' });
});
it('formats only opted-in dictation data and preserves literal escapes and explicit controls', async () => {
  start({ ...defaultSettings, dictationPunctuation: true });
  listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: true }, { id: 'test' }, vi.fn());
  emit('Hello comma world period'); emit('literal comma period new line'); emit('literal stop dictation'); emit('literal scratch that'); emit('scratch that'); await settle();
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'DICTATION_TEXT').map(([message]) => 'text' in message ? message.text : '')).toEqual([
    'Hello, world.', 'literal comma period new line', 'literal stop dictation', 'literal scratch that', 'scratch that',
  ]);
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'BEGIN_VOICE_COMMAND')).toHaveLength(0);
  emit('stop dictation'); await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'BEGIN_VOICE_COMMAND', text: 'stop dictation' }));
});
it('does not turn punctuation-formatted words into exit or undo controls', async () => {
  start({ ...defaultSettings, dictationPunctuation: true });
  listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: true }, { id: 'test' }, vi.fn());
  emit('stop dictation period'); emit('scratch that period'); emit('undo last dictation exclamation mark'); await settle();
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'DICTATION_TEXT').map(([message]) => 'text' in message ? message.text : '')).toEqual([
    'stop dictation.', 'literal scratch that.', 'literal undo last dictation!',
  ]);
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'BEGIN_VOICE_COMMAND' || message.type === 'INTERRUPT_COMMAND')).toHaveLength(0);
});
it('preserves punctuation words in command and search payloads outside dictation mode', async () => {
  start({ ...defaultSettings, dictationPunctuation: true });
  emit('search Google for comma period'); await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXECUTE_ACTIONS', actions: [{ action: 'create_tab', params: { url: 'https://www.google.com/search?q=comma%20period' } }] }));
  listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: true }, { id: 'test' }, vi.fn());
  emit('comma period'); await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'DICTATION_TEXT', text: ',.' }));
  listener({ target: 'offscreen', type: 'DICTATION_MODE', enabled: false }, { id: 'test' }, vi.fn());
  emit('type comma period'); await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXECUTE_ACTIONS', actions: [{ action: 'page_action', params: { operation: 'type', text: 'comma period' } }] }));
});
