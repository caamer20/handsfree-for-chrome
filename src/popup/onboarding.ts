import './popup.css';
import './onboarding.css';
import { DiagnosticsPanel } from './diagnostics';
import { allowMicrophone, checkMicrophone } from './microphone-check';
import { recoveryAdvice } from '../common/diagnostics';
import { element as el } from './dom';
import { send, errorText } from '../common/messaging';
import type { AppState } from '../common/types';

let state: AppState | undefined;
let activePage = true;
let starting = false;
let permissionCheck: AbortController | undefined;
let microphoneCheck: AbortController | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let permissionError = '';
let practiceError = '';
function render(next: AppState): void {
  state = next;
  el('welcome-shortcut').textContent = next.shortcut || 'a shortcut you choose';
  el('shortcut-status').textContent = next.shortcut ? `${next.shortcut} is assigned. Use it on a website to toggle listening.` : 'No shortcut is assigned yet. Choose an available combination before relying on voice control.';
  if (next.settings.micGranted && !permissionCheck) { el('grant-mic').textContent = 'Microphone enabled ✓'; el('permission-status').textContent = 'Microphone permission was enabled. Try the spoken practice below to check that it works.'; }
  if (permissionError) el('permission-status').textContent = permissionError;
  const setup = next.voiceSetup; const running = setup?.status === 'running';
  el<HTMLButtonElement>('start-voice-practice').disabled = starting || running || !next.settings.micGranted || !!microphoneCheck || !!permissionCheck;
  el<HTMLButtonElement>('welcome-pace').disabled = starting || running;
  el('start-voice-practice').textContent = setup ? 'Try spoken practice again' : 'Start spoken practice';
  el('stop-voice-practice').hidden = !running;
  el<HTMLButtonElement>('grant-mic').disabled = running || !!microphoneCheck || !!permissionCheck;
  el<HTMLButtonElement>('test-microphone').disabled = running || !!microphoneCheck || !!permissionCheck;
  el('voice-practice-status').textContent = setup?.detail ?? (next.settings.setupVoicePassed ? 'A spoken practice has already passed on this device. You can check it again.' : next.settings.micGranted ? 'Ready. Choose Start practice, then say “open a new tab”.' : 'Enable the microphone above to begin.');
  if (practiceError) el('voice-practice-status').textContent = practiceError;
  el('voice-practice-transcript').hidden = !setup?.transcript;
  el('voice-practice-transcript').textContent = setup?.transcript ? `Heard: “${setup.transcript}”` : '';
  for (const [name, passed] of [
    ['microphone', setup && setup.stage !== 'microphone'],
    ['speech', setup && ['browser', 'complete'].includes(setup.stage)],
    ['browser', setup?.status === 'passed'],
  ] as const) { el(`voice-step-${name}`).classList.toggle('complete', !!passed); }
  el('spoken-setup').dataset.status = setup?.status ?? 'ready';
  el<HTMLButtonElement>('welcome-open-panel').disabled = next.currentWindowId === undefined;
}
async function refresh(): Promise<void> {
  const reply = await send({ target: 'background', type: 'GET_STATE' });
  if (activePage && reply.ok && reply.state) render(reply.state);
}
el('grant-mic').addEventListener('click', () => {
  if (permissionCheck || microphoneCheck) return;
  const controller = new AbortController(); permissionCheck = controller;
  permissionError = '';
  if (state) render(state);
  el('permission-status').textContent = 'Choose Allow in Chrome’s microphone prompt.';
  void allowMicrophone(controller.signal).then(async () => {
    const saved = await send({ target: 'background', type: 'MICROPHONE_READY' }); if (!saved.ok) throw new Error(saved.error);
  }).catch(error => { permissionError = `${errorText(error)} ${recoveryAdvice(errorText(error)).detail}`; if (activePage) el('permission-status').textContent = permissionError; }).finally(() => {
    permissionCheck = undefined; if (activePage) void refresh();
  });
});
el('start-voice-practice').addEventListener('click', () => {
  if (!state || starting) return;
  practiceError = ''; starting = true; render(state);
  const pace = el<HTMLSelectElement>('welcome-pace').value as AppState['settings']['voicePace'];
  void send({ target: 'background', type: 'START_VOICE_SETUP', pace }).then(reply => {
    if (!reply.ok) practiceError = reply.error;
  }).catch(error => { practiceError = errorText(error); }).finally(() => { starting = false; if (activePage) void refresh(); });
});
el('stop-voice-practice').addEventListener('click', () => { if (state?.voiceSetup) void send({ target: 'background', type: 'CANCEL_VOICE_SETUP', id: state.voiceSetup.id }); });
el('open-settings').addEventListener('click', () => { void send({ target: 'background', type: 'OPEN_PAGE', page: 'settings' }); });
el('welcome-change-shortcut').addEventListener('click', () => { void send({ target: 'background', type: 'OPEN_PAGE', page: 'shortcuts' }); });
el('welcome-open-panel').addEventListener('click', () => {
  if (state?.currentWindowId !== undefined) void chrome.sidePanel.open({ windowId: state.currentWindowId }).catch(error => { el('shortcut-status').textContent = errorText(error); });
});
new DiagnosticsPanel('welcome-diagnostics', async message => { const reply = await send(message); if (!reply.ok) el('permission-status').textContent = reply.error; return reply.ok; });
el('test-microphone').addEventListener('click', () => {
  if (microphoneCheck || permissionCheck) return;
  const controller = new AbortController(); microphoneCheck = controller;
  if (state) render(state); el('stop-microphone-test').hidden = false;
  el('mic-test-status').textContent = 'Speak for five seconds. This sound check stays on your device.';
  void checkMicrophone(controller.signal, level => { el<HTMLMeterElement>('mic-level').value = level; }).then(async heard => {
    await send({ target: 'background', type: 'MICROPHONE_READY' });
    if (activePage) el('mic-test-status').textContent = heard ? 'Sound detected. The microphone is off. Now try the spoken practice.' : 'No clear sound detected. Check your input device and mute switch. The microphone is off.';
  }).catch(error => { if (activePage) el('mic-test-status').textContent = controller.signal.aborted ? 'Microphone check stopped.' : recoveryAdvice(errorText(error)).detail; }).finally(() => {
    microphoneCheck = undefined; if (activePage) { el('stop-microphone-test').hidden = true; void refresh(); }
  });
});
el('stop-microphone-test').addEventListener('click', () => microphoneCheck?.abort());
el('practice-command').addEventListener('click', () => {
  const button = el<HTMLButtonElement>('practice-command'); button.disabled = true;
  el('practice-status').textContent = 'Opening a practice tab…';
  void send({ target: 'background', type: 'RUN_SETUP_COMMAND' }).then(reply => { if (activePage) el('practice-status').textContent = reply.ok ? reply.message ?? 'Practice completed.' : reply.error; }).catch(error => { if (activePage) el('practice-status').textContent = errorText(error); }).finally(() => { button.disabled = false; });
});
const onStorage = (): void => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void refresh(); }, 50); };
chrome.storage.onChanged.addListener(onStorage);
window.addEventListener('pagehide', () => {
  activePage = false; permissionCheck?.abort(); microphoneCheck?.abort(); clearTimeout(refreshTimer); chrome.storage.onChanged.removeListener(onStorage);
  if (state?.voiceSetup?.status === 'running') void send({ target: 'background', type: 'CANCEL_VOICE_SETUP', id: state.voiceSetup.id }).catch(() => undefined);
}, { once: true });
void refresh().then(() => { if (state) el<HTMLSelectElement>('welcome-pace').value = state.settings.voicePace; }).catch(error => { el('permission-status').textContent = errorText(error); });
