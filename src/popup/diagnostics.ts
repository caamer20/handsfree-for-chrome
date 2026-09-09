import { send, errorText } from '../common/messaging';
import { element as el } from './dom';
import type { Message } from '../common/schema';
import type { DiagnosticCheck } from '../common/diagnostics';
export class DiagnosticsPanel {
  constructor(private prefix: string, private perform: (message: Message) => Promise<boolean>) {
    el(`${prefix}-check`).addEventListener('click', () => { void this.refresh(); });
  }
  async refresh(): Promise<void> {
    const button = el<HTMLButtonElement>(`${this.prefix}-check`); button.disabled = true;
    const list = el(`${this.prefix}-results`); list.replaceChildren();
    try {
      const reply = await send({ target: 'background', type: 'GET_DIAGNOSTICS' }); if (!reply.ok) throw new Error(reply.error);
      const checks = reply.diagnostics ?? [];
      try {
        const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        checks.splice(1, 0, { title: 'Chrome microphone permission', status: permission.state === 'denied' ? 'attention' : 'info', detail: permission.state === 'granted' ? 'Chrome currently allows access. Use the microphone check to test sound input.' : permission.state === 'denied' ? 'Chrome currently blocks the microphone. Open setup and update the extension’s microphone permission.' : 'Chrome will ask when you enable the microphone.', action: 'onboarding' });
      } catch { /* Some browser versions do not expose the microphone permission query. */ }
      for (const check of checks) this.row(list, check);
    } catch (error) { list.textContent = `Could not check readiness: ${errorText(error)}`; }
    finally { button.disabled = false; }
  }
  private row(list: HTMLElement, check: DiagnosticCheck): void {
    const row = document.createElement('li'); row.className = `diagnostic ${check.status}`;
    const heading = document.createElement('strong'); heading.textContent = `${check.status === 'ready' ? '✓' : check.status === 'attention' ? '!' : '•'} ${check.title}`;
    const detail = document.createElement('p'); detail.textContent = check.detail; row.append(heading, detail);
    if (check.action) {
      const action = check.action; const button = document.createElement('button'); button.className = 'text-button';
      button.textContent = action === 'onboarding' ? 'Open setup guide' : action === 'shortcuts' ? 'Choose shortcut' : action === 'sleep' ? 'Release engine' : 'Open settings';
      button.addEventListener('click', () => { void this.perform(action === 'sleep' ? { target: 'background', type: 'SLEEP_ENGINE' } : { target: 'background', type: 'OPEN_PAGE', page: action }).then(() => this.refresh()); }); row.append(button);
    }
    list.append(row);
  }
}
