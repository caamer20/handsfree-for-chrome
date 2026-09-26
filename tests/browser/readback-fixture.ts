import type { ExtensionTarget } from './extension-target';

/** Verify local readback transport/content without relying on OS audio output. */
export async function installReadbackFixture(engine: ExtensionTarget): Promise<void> {
  await engine.evaluate(`(() => {
    globalThis.__handsfreeReadback = [];
    globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ localService: true, lang: 'en-US' }],
      cancel: () => {},
      speak: utterance => { globalThis.__handsfreeReadback.push(utterance.text); queueMicrotask(() => utterance.onend?.()); }
    } });
  })()`);
}
