/** Request permission without leaving a stream open, including late permission answers. */
export function allowMicrophone(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown): void => {
      if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve();
    };
    const cancel = (): void => finish(new DOMException('Microphone setup stopped.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Microphone permission was not answered. Try again when ready.')), 20_000);
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) { cancel(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { finish(new Error('Microphone access is unavailable. Open this guide in Chrome.')); return; }
    void navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(stream => { stream.getTracks().forEach(track => track.stop()); finish(); }).catch(finish);
  });
}
/** Five seconds of local amplitude measurement. No audio recording, playback, or transcription. */
export function checkMicrophone(signal: AbortSignal, onLevel: (level: number) => void): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let stream: MediaStream | undefined; let audio: AudioContext | undefined; let interval: ReturnType<typeof setInterval> | undefined;
    let finished = false; let heard = false;
    const finish = (error?: Error): void => {
      if (finished) return; finished = true; clearTimeout(timer); clearInterval(interval); signal.removeEventListener('abort', cancel);
      stream?.getTracks().forEach(track => track.stop()); void audio?.close().catch(() => undefined); onLevel(0);
      if (error) reject(error); else resolve(heard);
    };
    const cancel = (): void => finish(new DOMException('Microphone check stopped.', 'AbortError'));
    let timer = setTimeout(() => finish(new Error('Microphone permission was not answered. Try again when ready.')), 20_000);
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) { cancel(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { finish(new Error('Microphone access is unavailable. Open this guide in Chrome.')); return; }
    void navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(async captured => {
      if (finished) { captured.getTracks().forEach(track => track.stop()); return; }
      stream = captured; audio = new AudioContext();
      const analyser = audio.createAnalyser(); analyser.fftSize = 256; audio.createMediaStreamSource(stream).connect(analyser);
      await audio.resume(); if (finished) return;
      const samples = new Uint8Array(analyser.fftSize);
      interval = setInterval(() => { analyser.getByteTimeDomainData(samples); const level = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length); if (level > 0.015) heard = true; onLevel(Math.min(1, level * 6)); }, 80);
      clearTimeout(timer); timer = setTimeout(() => finish(), 5000);
    }).catch((error: unknown) => finish(error instanceof Error ? error : new Error('The microphone could not be opened.')));
  });
}
