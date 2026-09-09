interface RecognitionEvent { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } }; }
interface RecognitionError { error: string; }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  onend: (() => void) | null;
  start(): void; abort(): void;
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const speechErrors: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Open microphone setup to allow it.',
  'service-not-allowed': 'Chrome speech recognition is unavailable. Try a typed command.',
  'audio-capture': 'No microphone is available. Check your microphone connection.',
  'network': 'Chrome speech recognition needs a network connection. Try a typed command.',
  'no-speech': 'No speech heard. Try the shortcut again.',
  'aborted': 'Listening cancelled.',
};

/** Recognition owns its audio stream. Never acquire a second, unused getUserMedia stream. */
export class SpeechSession {
  private cancelCurrent: (() => void) | null = null;
  listen(language: string, onInterim: (text: string) => void): Promise<string> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const scope = window as SpeechWindow;
      const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
      if (!Constructor) { reject(new Error('Speech recognition is not available in this Chrome build. Use a typed command.')); return; }
      const recognition = new Constructor();
      let done = false;
      const finish = (text?: string, error?: string): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        recognition.onresult = null; recognition.onerror = null; recognition.onend = null;
        this.cancelCurrent = null;
        try { recognition.abort(); } catch { /* Already ended. */ }
        if (text) resolve(text.slice(0, 500)); else reject(new Error(error ?? 'No speech heard. Try again.'));
      };
      this.cancelCurrent = () => finish(undefined, 'Listening cancelled.');
      recognition.lang = language;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = event => {
        let final = ''; let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0]?.transcript ?? '';
          if (result?.isFinal) final += text; else interim += text;
        }
        if (final.trim()) finish(final.trim()); else if (interim) onInterim(interim.slice(0, 500));
      };
      recognition.onerror = event => finish(undefined, speechErrors[event.error] ?? `Speech recognition: ${event.error}`);
      recognition.onend = () => finish();
      const timer = setTimeout(() => finish(undefined, 'Listening timed out. Press the shortcut to try again.'), 20_000);
      try { recognition.start(); } catch (error) { finish(undefined, error instanceof Error ? error.message : 'Could not start the microphone.'); }
    });
  }
  startContinuous(language: string, onFinal: (text: string) => void, onInterim: (text: string) => void, onError: (text: string) => void): void {
    this.cancel();
    const scope = window as SpeechWindow;
    const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    if (!Constructor) throw new Error('Speech recognition is not available in this Chrome build. Use a typed command.');
    let stopped = false; let recognition: Recognition | null = null;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;
    let finalTimer: ReturnType<typeof setTimeout> | undefined;
    let pending = ''; let failures = 0;
    const flush = (): void => {
      clearTimeout(finalTimer);
      const text = pending.trim(); pending = '';
      if (text && !stopped) onFinal(text.slice(0, 500));
    };
    const detach = (): void => {
      if (!recognition) return;
      recognition.onresult = null; recognition.onerror = null; recognition.onend = null;
      try { recognition.abort(); } catch { /* Already ended. */ }
      recognition = null;
    };
    this.cancelCurrent = () => {
      stopped = true; clearTimeout(restartTimer); clearTimeout(finalTimer); pending = '';
      detach(); this.cancelCurrent = null;
    };
    const fatal = (message: string): void => { this.cancel(); onError(message); };
    const start = (): void => {
      if (stopped) return;
      detach();
      const current = new Constructor(); recognition = current;
      const seen = new Set<number>(); let delay = 300;
      current.lang = language; current.continuous = true; current.interimResults = true; current.maxAlternatives = 1;
      current.onresult = event => {
        failures = 0; let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]; const text = result?.[0]?.transcript ?? '';
          if (result?.isFinal) {
            if (!seen.has(i)) { seen.add(i); pending += ` ${text}`; }
          } else interim += text;
        }
        clearTimeout(finalTimer);
        if (pending) finalTimer = setTimeout(flush, interim ? 1000 : 600);
        if (interim) onInterim(interim.slice(0, 500));
      };
      current.onerror = event => {
        if (stopped) return;
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        if (event.error === 'network' && ++failures < 4) {
          delay = Math.min(8000, 1000 * 2 ** (failures - 1));
          onInterim('Speech connection interrupted. Reconnecting…');
          return;
        }
        fatal(speechErrors[event.error] ?? 'Speech recognition stopped. Press the shortcut to try again.');
      };
      current.onend = () => {
        flush(); detach();
        if (!stopped) restartTimer = setTimeout(start, delay);
      };
      try { current.start(); } catch { fatal('Could not start the microphone. Check microphone access, then try again.'); }
    };
    start();
  }
  cancel(): void { this.cancelCurrent?.(); }
}
