// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { allowMicrophone, checkMicrophone } from '../src/popup/microphone-check';
const stop = vi.fn(); const close = vi.fn(async () => undefined); const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
let capture: ReturnType<typeof vi.fn>; let sample = 140;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); sample = 140;
  capture = vi.fn(async () => stream); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: capture } });
  vi.stubGlobal('AudioContext', class { createAnalyser() { return { fftSize: 256, getByteTimeDomainData: (array: Uint8Array) => array.fill(sample) }; } createMediaStreamSource() { return { connect: vi.fn() }; } resume = async () => undefined; close = close; });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('measures sound and closes every device and timer after five seconds', async () => {
  const result = checkMicrophone(new AbortController().signal, vi.fn()); await vi.advanceTimersByTimeAsync(5001);
  expect(await result).toBe(true); expect(stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('reports quiet input honestly instead of calling it working speech recognition', async () => {
  sample = 128; const result = checkMicrophone(new AbortController().signal, vi.fn()); await vi.advanceTimersByTimeAsync(5001); expect(await result).toBe(false);
});
it('cancels an unanswered permission request and stops any stream that arrives later', async () => {
  let allow: (stream: MediaStream) => void = () => undefined; capture.mockImplementation(() => new Promise(resolve => { allow = resolve; }));
  const controller = new AbortController(); const result = checkMicrophone(controller.signal, vi.fn()); const failed = expect(result).rejects.toThrow('stopped');
  controller.abort(); await failed; allow(stream); await Promise.resolve(); expect(stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('times out ignored permission prompts and cleans up when permission is denied', async () => {
  capture.mockImplementationOnce(() => new Promise(() => undefined)); const timed = expect(checkMicrophone(new AbortController().signal, vi.fn())).rejects.toThrow('not answered'); await vi.advanceTimersByTimeAsync(20_001); await timed;
  capture.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError')); await expect(checkMicrophone(new AbortController().signal, vi.fn())).rejects.toThrow('Denied'); expect(vi.getTimerCount()).toBe(0);
});
it('releases the permission-only stream immediately without creating an audio processor', async () => {
  await allowMicrophone(new AbortController().signal);
  expect(stop).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('cleans up a permission-only stream that arrives after the page was closed', async () => {
  let allow: (value: MediaStream) => void = () => undefined;
  capture.mockImplementation(() => new Promise(resolve => { allow = resolve; }));
  const controller = new AbortController(); const result = expect(allowMicrophone(controller.signal)).rejects.toThrow('stopped');
  controller.abort(); await result; allow(stream); await Promise.resolve();
  expect(stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
