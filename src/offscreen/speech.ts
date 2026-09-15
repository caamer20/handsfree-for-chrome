interface RecognitionResult { isFinal: boolean; length?: number; [index: number]: { transcript: string }; }
interface RecognitionEvent { resultIndex: number; results: { length: number; [index: number]: RecognitionResult }; }
interface RecognitionError { error: string; }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
  start(): void; abort(): void;
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
export interface SpeechOptions {
  pace?: 'natural' | 'relaxed';
  onStart?: () => void;
  onAlternatives?: (alternatives: string[]) => void;
  immediate?: (text: string) => boolean;
}
const speechErrors: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Open microphone setup to allow it.',
  'service-not-allowed': 'Chrome speech recognition is unavailable. Try a typed command.',
  'audio-capture': 'No microphone is available. Check your microphone connection.',
  'network': 'Chrome speech recognition needs a network connection. Try a typed command.',
  'no-speech': 'No speech heard. Try the shortcut again.',
  'aborted': 'Listening cancelled.',
};

/** Keep alternatives bounded, never combine separate results into extra commands. */
class Utterance {
  private chunks: string[][] = [];
  private lastFinal = -1;
  interim = '';
  overflow = false;
  update(event: RecognitionEvent): void {
    this.interim = '';
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index]; if (!result) continue;
      if (result.isFinal && index > this.lastFinal) {
        this.lastFinal = index;
        const candidates = Array.from({ length: Math.min(3, result.length ?? 1) }, (_, i) => result[i]?.transcript.trim() ?? '').filter(Boolean);
        if (candidates.length) this.chunks.push(candidates);
      } else if (!result.isFinal) this.interim += result[0]?.transcript ?? '';
    }
    if (this.text.length > 500 || this.chunks.length > 24) { this.chunks = []; this.overflow = true; }
  }
  get text(): string { return this.chunks.map(chunk => chunk[0]).join(' ').trim(); }
  alternatives(): string[] {
    const texts: string[] = [];
    for (let i = this.chunks.length - 1; i >= 0 && texts.length < 3; i--) {
      for (const alternative of this.chunks[i]!.slice(1)) {
        const text = this.chunks.map((chunk, index) => index === i ? alternative : chunk[0]).join(' ').trim();
        if (text.length <= 500 && text !== this.text && !texts.includes(text)) texts.push(text);
      }
    }
    return texts.slice(0, 3);
  }
  clear(): void { this.chunks = []; this.interim = ''; this.overflow = false; }
}

/** Recognition owns its audio stream. Never acquire a second, unused audio stream. */
export class SpeechSession {
  private cancelCurrent: (() => void) | null = null;

  listen(language: string, onInterim: (text: string) => void, options: SpeechOptions = {}): Promise<string> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const scope = window as SpeechWindow;
      const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
      if (!Constructor) { reject(new Error('Speech recognition is not available in this Chrome build. Use a typed command.')); return; }
      const recognition = new Constructor(); const utterance = new Utterance();
      let done = false; let finalTimer: ReturnType<typeof setTimeout> | undefined;
      const pause = options.pace === 'relaxed' ? 1600 : 600;
      const finish = (text?: string, error?: string): void => {
        if (done) return;
        done = true; clearTimeout(timer); clearTimeout(finalTimer);
        recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.onstart = null;
        this.cancelCurrent = null;
        try { recognition.abort(); } catch { /* Already ended. */ }
        if (text) { options.onAlternatives?.(utterance.alternatives()); resolve(text); }
        else reject(new Error(error ?? 'No complete speech heard. Try again.'));
      };
      this.cancelCurrent = () => finish(undefined, 'Listening cancelled.');
      recognition.lang = language; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 3;
      recognition.onstart = () => options.onStart?.();
      recognition.onresult = event => {
        utterance.update(event); clearTimeout(finalTimer);
        if (utterance.overflow) { finish(undefined, 'That phrase was too long. Try one shorter command.'); return; }
        const partial = `${utterance.text} ${utterance.interim}`.trim(); if (partial) onInterim(partial.slice(0, 500));
        if (utterance.text && !utterance.interim) finalTimer = setTimeout(() => finish(utterance.text), pause);
      };
      recognition.onerror = event => finish(undefined, speechErrors[event.error] ?? `Speech recognition: ${event.error}`);
      recognition.onend = () => finish(utterance.interim ? undefined : utterance.text || undefined);
      const timer = setTimeout(() => finish(undefined, 'Listening timed out. Press the shortcut to try again.'), options.pace === 'relaxed' ? 40_000 : 20_000);
      try { recognition.start(); } catch (error) { finish(undefined, error instanceof Error ? error.message : 'Could not start the microphone.'); }
    });
  }

  startContinuous(language: string, onFinal: (text: string, alternatives?: string[]) => void, onInterim: (text: string) => void, onError: (text: string) => void, options: SpeechOptions = {}): void {
    this.cancel();
    const scope = window as SpeechWindow;
    const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    if (!Constructor) throw new Error('Speech recognition is not available in this Chrome build. Use a typed command.');
    let stopped = false; let recognition: Recognition | null = null;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;
    let finalTimer: ReturnType<typeof setTimeout> | undefined;
    let utterance = new Utterance(); let failures = 0;
    const pause = options.pace === 'relaxed' ? 1600 : 600;
    const flush = (): void => {
      clearTimeout(finalTimer);
      if (utterance.interim || utterance.overflow) { utterance.clear(); return; }
      const text = utterance.text; const alternatives = utterance.alternatives(); utterance.clear();
      if (text && !stopped) { if (alternatives.length) onFinal(text, alternatives); else onFinal(text); }
    };
    const detach = (): void => {
      if (!recognition) return;
      recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.onstart = null;
      try { recognition.abort(); } catch { /* Already ended. */ }
      recognition = null;
    };
    this.cancelCurrent = () => {
      stopped = true; clearTimeout(restartTimer); clearTimeout(finalTimer); utterance.clear();
      detach(); this.cancelCurrent = null;
    };
    const fatal = (message: string): void => { this.cancel(); onError(message); };
    const start = (): void => {
      if (stopped) return;
      detach(); utterance = new Utterance();
      const current = new Constructor(); recognition = current; let delay = 300;
      current.lang = language; current.continuous = true; current.interimResults = true; current.maxAlternatives = 3;
      current.onstart = () => options.onStart?.();
      current.onresult = event => {
        failures = 0; utterance.update(event); clearTimeout(finalTimer);
        if (utterance.overflow) { fatal('That phrase was too long. Try one shorter command.'); return; }
        if (utterance.interim) {
          onInterim(`${utterance.text} ${utterance.interim}`.trim().slice(0, 500));
          // An unfinished phrase must never execute its already-finalized prefix.
          finalTimer = setTimeout(() => fatal('I did not catch the end of that phrase. Try the complete command again.'), pause * 5);
        } else if (utterance.text) {
          if (options.immediate?.(utterance.text)) flush();
          else finalTimer = setTimeout(flush, pause);
        }
      };
      current.onerror = event => {
        if (stopped) return;
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        utterance.clear(); clearTimeout(finalTimer);
        if (event.error === 'network' && ++failures < 4) {
          delay = Math.min(8000, 1000 * 2 ** (failures - 1));
          onInterim('Speech connection interrupted. Reconnecting…'); return;
        }
        fatal(speechErrors[event.error] ?? 'Speech recognition stopped. Press the shortcut to try again.');
      };
      current.onend = () => {
        const incomplete = !!utterance.interim;
        if (incomplete) { fatal('I did not catch the end of that phrase. Try the complete command again.'); return; }
        flush(); detach();
        if (!stopped) restartTimer = setTimeout(start, delay);
      };
      try { current.start(); } catch { fatal('Could not start the microphone. Check microphone access, then try again.'); }
    };
    start();
  }
  cancel(): void { this.cancelCurrent?.(); }
}
