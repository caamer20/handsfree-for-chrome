import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpeechSession } from '../src/offscreen/speech';
import { closeOffscreen, ensureOffscreen } from '../src/background/offscreen-manager';
class FakeRecognition {
  static latest: FakeRecognition;
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
  onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(); abort = vi.fn();
  constructor() { FakeRecognition.latest = this; }
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', { webkitSpeechRecognition: FakeRecognition }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('releases recognition listeners, timer, and microphone on a final transcript', async () => {
  const speech = new SpeechSession();
  const result = speech.listen('en-US', vi.fn());
  const instance = FakeRecognition.latest;
  instance.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'open a new tab' } }] });
  await expect(result).resolves.toBe('open a new tab');
  expect(instance.abort).toHaveBeenCalledOnce();
  expect(instance.onresult).toBeNull(); expect(instance.onerror).toBeNull(); expect(instance.onend).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
it('aborts and drops handlers on cancellation and timeout', async () => {
  const speech = new SpeechSession();
  const result = speech.listen('en-US', vi.fn());
  const cancelled = expect(result).rejects.toThrow('cancelled');
  speech.cancel(); await cancelled;
  expect(FakeRecognition.latest.onresult).toBeNull();
  const timeout = speech.listen('en-US', vi.fn());
  const timedOut = expect(timeout).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(20_000); await timedOut;
  expect(FakeRecognition.latest.abort).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('creates one offscreen document for concurrent requests and serializes teardown', async () => {
  let open = false;
  const createDocument = vi.fn(async () => { open = true; });
  const closeDocument = vi.fn(async () => { open = false; });
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' }, getContexts: vi.fn(async () => open ? [{}] : []), sendMessage: vi.fn(async () => ({ ok: true })) },
    offscreen: { createDocument, closeDocument, Reason: { USER_MEDIA: 'USER_MEDIA', WORKERS: 'WORKERS' } },
  });
  await Promise.all([ensureOffscreen(), ensureOffscreen(), ensureOffscreen()]);
  expect(createDocument).toHaveBeenCalledOnce();
  await Promise.all([closeOffscreen(), ensureOffscreen()]);
  expect(closeDocument).toHaveBeenCalledOnce();
  expect(createDocument).toHaveBeenCalledTimes(2);
  expect(open).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('continuous speech emits each final once, survives quiet periods and restarts, then stops cleanly', async () => {
  const speech = new SpeechSession(); const final = vi.fn(); const error = vi.fn();
  speech.startContinuous('en-GB', final, vi.fn(), error);
  const first = FakeRecognition.latest;
  expect(first.continuous).toBe(true); expect(first.lang).toBe('en-GB');
  const event = { resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'open a new tab' } }] };
  first.onresult?.(event); first.onresult?.(event);
  await vi.advanceTimersByTimeAsync(650);
  expect(final).toHaveBeenCalledExactlyOnceWith('open a new tab');
  await vi.advanceTimersByTimeAsync(180_000);
  expect(first.abort).not.toHaveBeenCalled();
  first.onend?.(); await vi.advanceTimersByTimeAsync(300);
  const second = FakeRecognition.latest; expect(second).not.toBe(first);
  second.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'zoom in' } }] });
  await vi.advanceTimersByTimeAsync(650); expect(final).toHaveBeenLastCalledWith('zoom in');
  second.onend?.(); speech.cancel();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(FakeRecognition.latest).toBe(second); expect(error).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('drops buffered speech on stop and does not restart after microphone denial', async () => {
  const speech = new SpeechSession(); const final = vi.fn(); const error = vi.fn();
  speech.startContinuous('en-US', final, vi.fn(), error);
  FakeRecognition.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'close all tabs' } }] });
  speech.cancel(); await vi.advanceTimersByTimeAsync(1000); expect(final).not.toHaveBeenCalled();
  speech.startContinuous('en-US', final, vi.fn(), error);
  const last = FakeRecognition.latest; last.onerror?.({ error: 'not-allowed' });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('Microphone access is blocked'));
  expect(last.onend).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});
it('retries temporary speech network failures a bounded number of times', async () => {
  const speech = new SpeechSession(); const error = vi.fn();
  speech.startContinuous('en-US', vi.fn(), vi.fn(), error);
  for (let i = 0; i < 4; i++) {
    FakeRecognition.latest.onerror?.({ error: 'network' }); FakeRecognition.latest.onend?.();
    await vi.advanceTimersByTimeAsync(8000);
  }
  expect(error).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
