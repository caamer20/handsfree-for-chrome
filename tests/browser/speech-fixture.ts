import type { Page } from '@playwright/test';
import { ExtensionTarget } from './extension-target';
import { expect, message, state } from './fixtures';

/** Synthetic ASR output in the real offscreen engine. This does not test audio recognition. */
export async function installSpeechFixture(control: Page): Promise<ExtensionTarget> {
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  const engine = await ExtensionTarget.attach(control, '/offscreen.html');
  await engine.evaluate(`(() => {
    const fixture = { current: null, starts: 0, aborts: 0 };
    class Recognition {
      lang = ''; continuous = true; interimResults = true; maxAlternatives = 3;
      onstart = null; onresult = null; onend = null; onerror = null; results = [];
      start() { fixture.current = this; fixture.starts++; queueMicrotask(() => this.onstart?.()); }
      abort() { fixture.aborts++; this.stopped = true; }
      emit(text, alternatives = [], final = true) {
        const result = { isFinal: final, length: alternatives.length + 1 };
        [text, ...alternatives].forEach((transcript, index) => result[index] = { transcript });
        const last = this.results.at(-1); const index = last && !last.isFinal ? this.results.length - 1 : this.results.length;
        this.results[index] = result; this.onresult?.({ resultIndex: index, results: this.results });
      }
    }
    globalThis.__handsfreeTestSpeech = fixture;
    globalThis.SpeechRecognition = Recognition;
    globalThis.webkitSpeechRecognition = Recognition;
  })()`);
  return engine;
}
export async function emitSpeech(engine: ExtensionTarget, text: string, alternatives: string[] = [], final = true): Promise<void> {
  await expect.poll(() => engine.evaluate('Boolean(globalThis.__handsfreeTestSpeech.current && !globalThis.__handsfreeTestSpeech.current.stopped)')).toBe(true);
  await engine.evaluate(`globalThis.__handsfreeTestSpeech.current.emit(${JSON.stringify(text)}, ${JSON.stringify(alternatives)}, ${JSON.stringify(final)})`);
}
