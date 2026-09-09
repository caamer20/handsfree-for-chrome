import './popup.css';
import './onboarding.css';
import { DiagnosticsPanel } from './diagnostics';
import { checkMicrophone } from './microphone-check';
import { recoveryAdvice } from '../common/diagnostics';
import { element as el } from './dom';
import { send, errorText } from '../common/messaging';

async function init(): Promise<void> {
  const response = await send({ target: 'background', type: 'GET_STATE' });
  if (!response.ok || !response.state) return;
  el('welcome-shortcut').textContent = response.state.shortcut || 'your shortcut (set it in Settings)';
  el('practice-status').textContent = response.state.settings.setupCommandPassed ? 'Your first browser command has already passed. You can try it again below.' : '';
  if (response.state.settings.micGranted) el('permission-status').textContent = 'Microphone setup is complete. Press your shortcut on a web page to begin.';
}
el('grant-mic').addEventListener('click', () => {
  const button = el<HTMLButtonElement>('grant-mic');
  button.disabled = true;
  const status = el('permission-status'); status.textContent = 'Choose Allow in Chrome’s microphone prompt.';
  void (async () => {
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // This visible page requests the permission; it never keeps the microphone open.
      stream.getTracks().forEach(track => track.stop()); stream = undefined;
      const saved = await send({ target: 'background', type: 'MICROPHONE_READY' });
      if (!saved.ok) throw new Error(saved.error);
      status.textContent = 'You’re ready. Open a web page, press your shortcut, and say “open a new tab”.';
      button.textContent = 'Microphone enabled ✓';
    } catch (error) { status.textContent = `Microphone setup: ${errorText(error)}. ${recoveryAdvice(errorText(error)).detail}`; }
    finally { stream?.getTracks().forEach(track => track.stop()); button.disabled = false; }
  })();
});
el('open-settings').addEventListener('click', () => { void send({ target: 'background', type: 'OPEN_PAGE', page: 'settings' }); });
void init().catch(error => { el('permission-status').textContent = errorText(error); });

new DiagnosticsPanel('welcome-diagnostics', async message => { const reply = await send(message); if (!reply.ok) el('permission-status').textContent = reply.error; return reply.ok; });
let microphoneCheck: AbortController | undefined;
let activePage = true;
el('test-microphone').addEventListener('click', () => {
  if (microphoneCheck) return;
  const controller = new AbortController(); microphoneCheck = controller;
  el<HTMLButtonElement>('test-microphone').disabled = true; el('stop-microphone-test').hidden = false;
  el('mic-test-status').textContent = 'Speak for five seconds. The meter checks sound locally; nothing is recorded or sent.';
  void checkMicrophone(controller.signal, level => { el<HTMLMeterElement>('mic-level').value = level; }).then(async heard => {
    await send({ target: 'background', type: 'MICROPHONE_READY' });
    if (activePage) el('mic-test-status').textContent = heard ? 'Sound detected. The microphone is off again. This tests sound input, not speech recognition.' : 'No clear sound detected. Check your input device and mute switch, then try again. The microphone is off.';
  }).catch(error => { if (activePage) el('mic-test-status').textContent = controller.signal.aborted ? 'Microphone check stopped.' : recoveryAdvice(errorText(error)).detail; }).finally(() => {
    microphoneCheck = undefined; if (activePage) { el<HTMLButtonElement>('test-microphone').disabled = false; el('stop-microphone-test').hidden = true; }
  });
});
el('stop-microphone-test').addEventListener('click', () => microphoneCheck?.abort());
window.addEventListener('pagehide', () => { activePage = false; microphoneCheck?.abort(); }, { once: true });
el('practice-command').addEventListener('click', () => {
  const button = el<HTMLButtonElement>('practice-command'); button.disabled = true;
  el('practice-status').textContent = 'Opening a practice tab…';
  void send({ target: 'background', type: 'RUN_SETUP_COMMAND' }).then(reply => { el('practice-status').textContent = reply.ok ? reply.message ?? 'Practice completed.' : reply.error; }).catch(error => { el('practice-status').textContent = errorText(error); }).finally(() => { button.disabled = false; });
});
