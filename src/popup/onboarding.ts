import './popup.css';
import './onboarding.css';
import { element as el } from './dom';
import { send, errorText } from '../common/messaging';

async function init(): Promise<void> {
  const response = await send({ target: 'background', type: 'GET_STATE' });
  if (!response.ok || !response.state) return;
  el('welcome-shortcut').textContent = response.state.shortcut || 'your shortcut (set it in Settings)';
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
      const reply = await send({ target: 'background', type: 'GET_STATE' });
      if (!reply.ok || !reply.state) throw new Error('Could not save microphone permission. Try again.');
      const saved = await send({ target: 'background', type: 'SAVE_SETTINGS', settings: { ...reply.state.settings, micGranted: true } });
      if (!saved.ok) throw new Error(saved.error);
      status.textContent = 'You’re ready. Open a web page, press your shortcut, and say “open a new tab”.';
      button.textContent = 'Microphone enabled ✓';
    } catch (error) { status.textContent = `Microphone setup: ${errorText(error)}. You can still type commands.`; }
    finally { stream?.getTracks().forEach(track => track.stop()); button.disabled = false; }
  })();
});
el('open-settings').addEventListener('click', () => { void send({ target: 'background', type: 'OPEN_PAGE', page: 'settings' }); });
void init().catch(error => { el('permission-status').textContent = errorText(error); });
